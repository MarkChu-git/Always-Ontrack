import { spawn, type ChildProcess } from "node:child_process";
import { lstatSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import type { Browser } from "playwright-core";

export type LightpandaProviderErrorCode =
  | "LIGHTPANDA_BUN_UNSUPPORTED"
  | "LIGHTPANDA_CLEANUP_FAILED"
  | "LIGHTPANDA_CREDENTIAL_USE_FORBIDDEN"
  | "LIGHTPANDA_CDP_ENDPOINT_REJECTED"
  | "LIGHTPANDA_CONTEXT_UNSUPPORTED"
  | "LIGHTPANDA_EXECUTABLE_UNTRUSTED"
  | "LIGHTPANDA_EXITED"
  | "LIGHTPANDA_INSPECTION_TIMEOUT"
  | "LIGHTPANDA_PUBLIC_URL_REJECTED"
  | "LIGHTPANDA_SPAWN_FAILED"
  | "LIGHTPANDA_START_TIMEOUT"
  | "LIGHTPANDA_START_FAILED";

/** Stable provider failure that never contains browser credentials or raw logs. */
export class LightpandaProviderError extends Error {
  constructor(
    readonly code: LightpandaProviderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LightpandaProviderError";
  }
}

/** Minimal file metadata needed to validate an executable without test filesystem I/O. */
export interface LightpandaPathMetadata {
  mode: number;
  uid?: number;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

/** Injectable filesystem seam. The default verifies the real local executable. */
export interface LightpandaProviderFileSystem {
  platform: NodeJS.Platform;
  currentUid: (() => number | undefined) | undefined;
  isAbsolute(path: string): boolean;
  dirname(path: string): string;
  realpath(path: string): string;
  lstat(path: string): LightpandaPathMetadata;
  stat(path: string): LightpandaPathMetadata;
}

export interface LightpandaProviderRuntime {
  bunVersion: string | undefined;
  environment: NodeJS.ProcessEnv;
  spawnProcess: typeof spawn;
  fetchVersion: (url: string, signal: AbortSignal) => Promise<Response>;
  connectOverCdp: (url: string, timeoutMs: number) => Promise<Browser>;
  fileSystem?: LightpandaProviderFileSystem;
}

export interface LightpandaLaunchOptions {
  purpose: "credential-free-public-spike";
  executablePath: string;
  publicUrl: string;
  startupTimeoutMs?: number;
  inspectionTimeoutMs?: number;
  shutdownTimeoutMs?: number;
}

export interface LightpandaPublicInspection {
  requestedOrigin: "https://monashuni.okta.com";
  finalOrigin: "https://monashuni.okta.com";
  inputCount: number;
  identifierInputPresent: boolean;
  cookieCount: number;
}

export interface LightpandaPublicSpike {
  inspect(): Promise<LightpandaPublicInspection>;
  close(): Promise<void>;
}

const defaultFileSystem: LightpandaProviderFileSystem = {
  platform: process.platform,
  currentUid:
    typeof process.getuid === "function" ? () => process.getuid?.() : undefined,
  isAbsolute,
  dirname,
  realpath: realpathSync,
  lstat: lstatSync,
  stat: statSync,
};

const defaultRuntime: LightpandaProviderRuntime = {
  bunVersion: process.versions.bun,
  environment: process.env,
  spawnProcess: spawn,
  fetchVersion: (url, signal) => fetch(url, { signal }),
  connectOverCdp: async (url, timeoutMs) => {
    const { chromium } = await import("playwright-core");
    return chromium.connectOverCDP(url, { timeout: timeoutMs });
  },
};

function executableValidationError(): LightpandaProviderError {
  return new LightpandaProviderError(
    "LIGHTPANDA_EXECUTABLE_UNTRUSTED",
    "The requested Lightpanda executable is not a trusted local executable file.",
  );
}

function isWritableByGroupOrOther(metadata: LightpandaPathMetadata): boolean {
  return (metadata.mode & 0o022) !== 0;
}

/**
 * Restrict the provider binary to an operator-controlled POSIX path. Windows
 * fails closed because Node's POSIX metadata cannot prove ACL ownership.
 */
function validateLightpandaExecutable(
  executablePath: string,
  fileSystem: LightpandaProviderFileSystem,
): string {
  if (fileSystem.platform === "win32") {
    // Fail closed until the provider can validate Windows owner/ACL semantics.
    throw executableValidationError();
  }
  if (!fileSystem.isAbsolute(executablePath)) {
    throw executableValidationError();
  }

  let original: LightpandaPathMetadata;
  let resolvedPath: string;
  let executable: LightpandaPathMetadata;
  try {
    original = fileSystem.lstat(executablePath);
    if (original.isSymbolicLink()) {
      throw executableValidationError();
    }
    resolvedPath = fileSystem.realpath(executablePath);
    if (!fileSystem.isAbsolute(resolvedPath)) {
      throw executableValidationError();
    }
    executable = fileSystem.stat(resolvedPath);
  } catch (error) {
    if (error instanceof LightpandaProviderError) {
      throw error;
    }
    throw executableValidationError();
  }

  if (!executable.isFile() || (executable.mode & 0o111) === 0) {
    throw executableValidationError();
  }

  const currentUid = fileSystem.currentUid?.();
  if (
    typeof currentUid !== "number" ||
    (executable.uid !== currentUid && executable.uid !== 0) ||
    isWritableByGroupOrOther(executable)
  ) {
    throw executableValidationError();
  }

  let ancestor = fileSystem.dirname(resolvedPath);
  while (true) {
    let metadata: LightpandaPathMetadata;
    try {
      metadata = fileSystem.stat(ancestor);
    } catch {
      throw executableValidationError();
    }
    if (!metadata.isDirectory() || isWritableByGroupOrOther(metadata)) {
      throw executableValidationError();
    }
    const parent = fileSystem.dirname(ancestor);
    if (parent === ancestor) {
      return resolvedPath;
    }
    ancestor = parent;
  }
}

function supportsLightpandaCdp(bunVersion: string | undefined): boolean {
  if (!bunVersion) {
    return false;
  }
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(bunVersion);
  if (!match) {
    return false;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 1 || (major === 1 && minor >= 4);
}

function validatePublicSpikeUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new LightpandaProviderError(
      "LIGHTPANDA_PUBLIC_URL_REJECTED",
      "The credential-free Lightpanda spike requires a reviewed public URL.",
    );
  }
  if (
    url.protocol !== "https:" ||
    url.origin !== "https://monashuni.okta.com" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  ) {
    throw new LightpandaProviderError(
      "LIGHTPANDA_PUBLIC_URL_REJECTED",
      "The credential-free Lightpanda spike requires a reviewed public URL.",
    );
  }
  return url;
}

function minimalChildEnvironment(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    ["LANG", "LC_ALL"]
      .map((key) => [key, environment[key]] as const)
      .filter((entry): entry is readonly [string, string] =>
        typeof entry[1] === "string"
      ),
  );
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

async function waitForExit(
  child: ChildProcess,
  timeoutMs: number,
): Promise<boolean> {
  if (hasExited(child)) {
    return true;
  }
  return new Promise((resolve) => {
    const onExit = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(hasExited(child));
    }, timeoutMs);
    timer.unref?.();
    child.once("exit", onExit);
  });
}

async function terminateChild(
  child: ChildProcess,
  timeoutMs: number,
): Promise<boolean> {
  if (hasExited(child)) {
    return true;
  }
  try {
    if (!child.kill("SIGTERM") && !hasExited(child)) {
      return false;
    }
  } catch {
    return hasExited(child);
  }
  if (await waitForExit(child, timeoutMs)) {
    return true;
  }
  try {
    if (!child.kill("SIGKILL") && !hasExited(child)) {
      return false;
    }
  } catch {
    return hasExited(child);
  }
  return waitForExit(child, timeoutMs);
}

function cleanupFailure(): LightpandaProviderError {
  return new LightpandaProviderError(
    "LIGHTPANDA_CLEANUP_FAILED",
    "The experimental Lightpanda process could not be confirmed stopped.",
  );
}

async function settleAtMost(
  operation: Promise<unknown>,
  timeoutMs: number,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
    timer.unref?.();
  });
  try {
    await Promise.race([operation.catch(() => undefined), timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function waitForBoundPort(
  child: ChildProcess,
  timeoutMs: number,
): Promise<number> {
  return new Promise((resolve, reject) => {
    let logBuffer = "";
    const fail = (error: LightpandaProviderError): void => {
      cleanup();
      reject(error);
    };
    const onData = (chunk: Buffer | string): void => {
      logBuffer = `${logBuffer}${chunk.toString()}`.slice(-2048);
      const match = /address=127\.0\.0\.1:(\d{1,5})(?:\s|$)/.exec(logBuffer);
      const port = match ? Number(match[1]) : 0;
      if (port < 1 || port > 65535) {
        return;
      }
      cleanup();
      resolve(port);
    };
    const onError = (): void =>
      fail(
        new LightpandaProviderError(
          "LIGHTPANDA_SPAWN_FAILED",
          "The experimental Lightpanda process could not be started.",
        ),
      );
    const onExit = (): void =>
      fail(
        new LightpandaProviderError(
          "LIGHTPANDA_EXITED",
          "The experimental Lightpanda process exited before CDP was ready.",
        ),
      );
    const timer = setTimeout(
      () =>
        fail(
          new LightpandaProviderError(
            "LIGHTPANDA_START_TIMEOUT",
            "The experimental Lightpanda process did not become ready in time.",
          ),
        ),
      timeoutMs,
    );
    timer.unref?.();
    const cleanup = (): void => {
      clearTimeout(timer);
      child.stderr?.off("data", onData);
      child.off("error", onError);
      child.off("exit", onExit);
    };

    child.stderr?.on("data", onData);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

function validateCdpEndpoint(value: unknown, expectedPort: number): string {
  if (typeof value !== "string") {
    throw new LightpandaProviderError(
      "LIGHTPANDA_CDP_ENDPOINT_REJECTED",
      "Lightpanda returned an invalid local CDP endpoint.",
    );
  }
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new LightpandaProviderError(
      "LIGHTPANDA_CDP_ENDPOINT_REJECTED",
      "Lightpanda returned an invalid local CDP endpoint.",
    );
  }
  if (
    endpoint.protocol !== "ws:" ||
    endpoint.hostname !== "127.0.0.1" ||
    endpoint.port !== String(expectedPort) ||
    endpoint.username !== "" ||
    endpoint.password !== "" ||
    endpoint.search !== "" ||
    endpoint.hash !== ""
  ) {
    throw new LightpandaProviderError(
      "LIGHTPANDA_CDP_ENDPOINT_REJECTED",
      "Lightpanda returned an untrusted local CDP endpoint.",
    );
  }
  return endpoint.toString();
}

async function runWithStartupDeadline<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(
        new LightpandaProviderError(
          "LIGHTPANDA_START_TIMEOUT",
          "The experimental Lightpanda provider did not start in time.",
        ),
      );
    }, timeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([operation(controller.signal), timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function runWithInspectionDeadline<T>(
  timeoutMs: number,
  operation: () => Promise<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new LightpandaProviderError(
            "LIGHTPANDA_INSPECTION_TIMEOUT",
            "The credential-free Lightpanda inspection did not finish in time.",
          ),
        ),
      timeoutMs,
    );
    timer.unref?.();
  });
  try {
    return await Promise.race([operation(), timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function readCdpEndpoint(
  runtime: LightpandaProviderRuntime,
  port: number,
  timeoutMs: number,
): Promise<string> {
  try {
    const version = await runWithStartupDeadline(
      timeoutMs,
      async (signal) => {
        const response = await runtime.fetchVersion(
          `http://127.0.0.1:${port}/json/version`,
          signal,
        );
        if (!response.ok) {
          throw new Error("non-success response");
        }
        return response.json() as Promise<{
          webSocketDebuggerUrl?: unknown;
        }>;
      },
    );
    return validateCdpEndpoint(version.webSocketDebuggerUrl, port);
  } catch (error) {
    if (error instanceof LightpandaProviderError) {
      throw error;
    }
    throw new LightpandaProviderError(
      "LIGHTPANDA_START_FAILED",
      "The experimental Lightpanda CDP endpoint was unavailable.",
    );
  }
}

/** Launch a credential-free public-page Lightpanda compatibility spike. */
export async function launchLightpandaPublicSpike(
  options: LightpandaLaunchOptions,
  runtime: LightpandaProviderRuntime = defaultRuntime,
): Promise<LightpandaPublicSpike> {
  if (options.purpose !== "credential-free-public-spike") {
    throw new LightpandaProviderError(
      "LIGHTPANDA_CREDENTIAL_USE_FORBIDDEN",
      "Lightpanda CDP is unauthenticated and may only run credential-free public compatibility spikes.",
    );
  }
  const publicUrl = validatePublicSpikeUrl(options.publicUrl);
  if (!supportsLightpandaCdp(runtime.bunVersion)) {
    throw new LightpandaProviderError(
      "LIGHTPANDA_BUN_UNSUPPORTED",
      "The experimental Lightpanda provider requires Bun 1.4.0 or newer.",
    );
  }

  const executablePath = validateLightpandaExecutable(
    options.executablePath,
    runtime.fileSystem ?? defaultFileSystem,
  );

  const startupTimeoutMs = options.startupTimeoutMs ?? 10_000;
  const inspectionTimeoutMs = options.inspectionTimeoutMs ?? 15_000;
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? 1_000;
  let child: ChildProcess;
  try {
    child = runtime.spawnProcess(
      executablePath,
      [
        "serve",
        "--host",
        "127.0.0.1",
        "--port",
        "0",
        "--cdp-max-connections",
        "1",
        "--disable-metrics",
        "--log-level",
        "info",
      ],
      {
        env: minimalChildEnvironment(runtime.environment),
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
  } catch {
    throw new LightpandaProviderError(
      "LIGHTPANDA_SPAWN_FAILED",
      "The experimental Lightpanda process could not be started.",
    );
  }
  const handleChildError = (): void => undefined;
  child.on("error", handleChildError);
  child.once("exit", () => child.off("error", handleChildError));

  try {
    const deadlineAt = Date.now() + startupTimeoutMs;
    const port = await waitForBoundPort(child, startupTimeoutMs);
    const endpoint = await readCdpEndpoint(
      runtime,
      port,
      Math.max(1, deadlineAt - Date.now()),
    );
    const connectTimeoutMs = Math.max(1, deadlineAt - Date.now());
    const browser = await runWithStartupDeadline(
      connectTimeoutMs,
      () => runtime.connectOverCdp(endpoint, connectTimeoutMs),
    );
    let closePromise: Promise<void> | undefined;
    const createDefaultContext = async () => {
      try {
        return await browser.newContext();
      } catch {
        const defaultContext = browser.contexts()[0];
        if (defaultContext) {
          return defaultContext;
        }
        throw new LightpandaProviderError(
          "LIGHTPANDA_CONTEXT_UNSUPPORTED",
          "Lightpanda could not create an isolated public inspection context.",
        );
      }
    };
    return {
      inspect: () =>
        runWithInspectionDeadline(inspectionTimeoutMs, async () => {
          const context = await createDefaultContext();
          const page = await context.newPage();
          await page.goto(publicUrl.toString(), {
            waitUntil: "domcontentloaded",
            timeout: inspectionTimeoutMs,
          });
          const finalUrl = new URL(page.url());
          if (finalUrl.origin !== "https://monashuni.okta.com") {
            throw new LightpandaProviderError(
              "LIGHTPANDA_PUBLIC_URL_REJECTED",
              "The public Lightpanda inspection left its reviewed origin.",
            );
          }
          const renderDeadline =
            Date.now() + Math.min(5_000, inspectionTimeoutMs);
          let inputCount = 0;
          let identifierCount = 0;
          while (Date.now() < renderDeadline && identifierCount === 0) {
            [inputCount, identifierCount] = await Promise.all([
              page.locator("input").count(),
              page.locator('input[name="identifier"]').count(),
            ]);
            if (identifierCount === 0) {
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
          }
          const cookies = await context.cookies();
          return {
            requestedOrigin: "https://monashuni.okta.com",
            finalOrigin: "https://monashuni.okta.com",
            inputCount,
            identifierInputPresent: identifierCount > 0,
            cookieCount: cookies.length,
          };
        }),
      close: () => {
        closePromise ??= (async () => {
          await settleAtMost(browser.close(), shutdownTimeoutMs);
          if (!(await terminateChild(child, shutdownTimeoutMs))) {
            throw cleanupFailure();
          }
        })();
        return closePromise;
      },
    };
  } catch (error) {
    if (!(await terminateChild(child, shutdownTimeoutMs))) {
      throw cleanupFailure();
    }
    if (error instanceof LightpandaProviderError) {
      throw error;
    }
    throw new LightpandaProviderError(
      "LIGHTPANDA_START_FAILED",
      "The experimental Lightpanda provider could not start.",
    );
  }
}
