import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "bun:test";
import {
  LightpandaProviderError,
  launchLightpandaPublicSpike as launchLightpandaProvider,
  type LightpandaLaunchOptions,
  type LightpandaPathMetadata,
  type LightpandaProviderFileSystem,
  type LightpandaProviderRuntime,
} from "../src/lib/lightpanda-provider.js";

function launchLightpandaBrowser(
  options: Omit<LightpandaLaunchOptions, "purpose">,
  runtime: LightpandaProviderRuntime,
) {
  return launchLightpandaProvider(
    {
      publicUrl: "https://monashuni.okta.com/",
      ...options,
      purpose: "credential-free-public-spike",
    },
    runtime,
  );
}

class FakeLightpandaProcess extends EventEmitter {
  readonly stderr = new EventEmitter();
  readonly killSignals: NodeJS.Signals[] = [];
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  killed = false;

  constructor(
    private readonly exitOnSignals: readonly NodeJS.Signals[] = ["SIGTERM"],
  ) {
    super();
  }

  emitStderr(text: string): void {
    this.stderr.emit("data", Buffer.from(text));
  }

  finish(code: number | null, signal: NodeJS.Signals | null): void {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("exit", code, signal);
  }

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.killSignals.push(signal);
    this.killed = true;
    if (this.exitOnSignals.includes(signal)) {
      queueMicrotask(() => this.finish(null, signal));
    }
    return true;
  }
}

function metadata(
  overrides: Partial<LightpandaPathMetadata> = {},
): LightpandaPathMetadata {
  return {
    mode: 0o100755,
    uid: 501,
    isFile: () => true,
    isDirectory: () => false,
    isSymbolicLink: () => false,
    ...overrides,
  };
}

function trustedFileSystem(
  overrides: Partial<LightpandaProviderFileSystem> = {},
): LightpandaProviderFileSystem {
  const canonicalExecutable = "/trusted/bin/lightpanda";
  return {
    platform: "darwin",
    currentUid: () => 501,
    isAbsolute: (path) => path.startsWith("/"),
    dirname: (path) => {
      if (path === "/") {
        return "/";
      }
      const separator = path.lastIndexOf("/");
      return separator <= 0 ? "/" : path.slice(0, separator);
    },
    realpath: () => canonicalExecutable,
    lstat: () => metadata(),
    stat: (path) =>
      path === canonicalExecutable
        ? metadata()
        : metadata({
            mode: 0o40755,
            isFile: () => false,
            isDirectory: () => true,
          }),
    ...overrides,
  };
}

async function settleWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("test deadline exceeded")), timeoutMs),
    ),
  ]);
}

test("Lightpanda refuses any credential-bearing launch purpose", async () => {
  let spawnCalls = 0;
  await assert.rejects(
    () => launchLightpandaProvider(
      {
        purpose: "credential-bearing-auth" as never,
        executablePath: "/trusted/bin/lightpanda",
        publicUrl: "https://monashuni.okta.com/",
      },
      {
        bunVersion: "1.4.0",
        environment: {},
        fileSystem: trustedFileSystem(),
        spawnProcess: () => {
          spawnCalls += 1;
          throw new Error("must not spawn");
        },
        fetchVersion: async () => {
          throw new Error("must not fetch");
        },
        connectOverCdp: async () => {
          throw new Error("must not connect");
        },
      },
    ),
    (error: unknown) =>
      error instanceof LightpandaProviderError &&
      error.code === "LIGHTPANDA_CREDENTIAL_USE_FORBIDDEN",
  );
  assert.equal(spawnCalls, 0);
});

test("Lightpanda rejects non-allowlisted public spike URLs before spawn", async () => {
  let spawnCalls = 0;
  await assert.rejects(
    () => launchLightpandaProvider(
      {
        purpose: "credential-free-public-spike",
        executablePath: "/trusted/bin/lightpanda",
        publicUrl: "https://evil.example/phish",
      },
      {
        bunVersion: "1.4.0",
        environment: {},
        fileSystem: trustedFileSystem(),
        spawnProcess: () => {
          spawnCalls += 1;
          throw new Error("must not spawn");
        },
        fetchVersion: async () => {
          throw new Error("must not fetch");
        },
        connectOverCdp: async () => {
          throw new Error("must not connect");
        },
      },
    ),
    (error: unknown) =>
      error instanceof LightpandaProviderError &&
      error.code === "LIGHTPANDA_PUBLIC_URL_REJECTED",
  );
  assert.equal(spawnCalls, 0);
});

test("Lightpanda rejects Bun 1.3 before starting a credential-bearing process", async () => {
  let spawnCalls = 0;

  await assert.rejects(
    () =>
      launchLightpandaBrowser(
        {
          executablePath: "/trusted/lightpanda",
          startupTimeoutMs: 50,
        },
        {
          bunVersion: "1.3.14",
          environment: {},
          fileSystem: trustedFileSystem(),
          spawnProcess: () => {
            spawnCalls += 1;
            throw new Error("must not spawn");
          },
          fetchVersion: async () => {
            throw new Error("must not fetch");
          },
          connectOverCdp: async () => {
            throw new Error("must not connect");
          },
        },
      ),
    (error: unknown) =>
      error instanceof LightpandaProviderError &&
      error.code === "LIGHTPANDA_BUN_UNSUPPORTED" &&
      /Bun 1\.4\.0 or newer/.test(error.message),
  );

  assert.equal(spawnCalls, 0);
});

async function expectUntrustedExecutable(
  fileSystem: LightpandaProviderFileSystem,
  executablePath = "/trusted/bin/lightpanda",
): Promise<void> {
  let spawnCalls = 0;
  await assert.rejects(
    () =>
      launchLightpandaBrowser(
        { executablePath, startupTimeoutMs: 50 },
        {
          bunVersion: "1.4.0",
          environment: {},
          fileSystem,
          spawnProcess: () => {
            spawnCalls += 1;
            throw new Error("must not spawn");
          },
          fetchVersion: async () => {
            throw new Error("must not fetch");
          },
          connectOverCdp: async () => {
            throw new Error("must not connect");
          },
        },
      ),
    (error: unknown) =>
      error instanceof LightpandaProviderError &&
      error.code === "LIGHTPANDA_EXECUTABLE_UNTRUSTED" &&
      !error.message.includes(executablePath),
  );
  assert.equal(spawnCalls, 0);
}

test("Lightpanda verifies an absolute, canonical, private executable before spawn", async () => {
  await expectUntrustedExecutable(trustedFileSystem({ platform: "win32" }));
  await expectUntrustedExecutable(trustedFileSystem(), "relative/lightpanda");
  await expectUntrustedExecutable(
    trustedFileSystem({
      lstat: () => metadata({ isSymbolicLink: () => true }),
    }),
  );
  await expectUntrustedExecutable(
    trustedFileSystem({
      stat: (path) =>
        path === "/trusted/bin/lightpanda"
          ? metadata({ mode: 0o100644 })
          : metadata({
              mode: 0o40755,
              isFile: () => false,
              isDirectory: () => true,
            }),
    }),
  );
  await expectUntrustedExecutable(
    trustedFileSystem({
      stat: (path) =>
        path === "/trusted/bin/lightpanda"
          ? metadata({ uid: 777 })
          : metadata({
              mode: 0o40755,
              isFile: () => false,
              isDirectory: () => true,
            }),
    }),
  );
  await expectUntrustedExecutable(
    trustedFileSystem({
      stat: (path) =>
        path === "/trusted/bin/lightpanda"
          ? metadata()
          : metadata({
              mode: 0o40777,
              isFile: () => false,
              isDirectory: () => true,
            }),
    }),
  );
});

test("Lightpanda uses a minimal child environment and rejects an untrusted CDP endpoint", async () => {
  const child = new FakeLightpandaProcess();
  let connectCalls = 0;
  let spawnArgs: readonly string[] = [];
  let childEnvironment: NodeJS.ProcessEnv | undefined;
  const runtime = {
    bunVersion: "1.4.0",
    environment: {
      HOME: "/private/home",
      LANG: "en_AU.UTF-8",
      AUTH_TOKEN_SENTINEL: "must-not-reach-child",
      PASSWORD_SENTINEL: "must-not-reach-child",
      ONTRACK_AUTH_TOKEN: "must-not-reach-child",
    },
    fileSystem: trustedFileSystem({
      stat: (path) =>
        path === "/trusted/bin/lightpanda"
          ? metadata({ uid: 0 })
          : metadata({
              mode: 0o40755,
              isFile: () => false,
              isDirectory: () => true,
            }),
    }),
    spawnProcess: (
      _path: string,
      args: readonly string[],
      options: { env?: NodeJS.ProcessEnv },
    ) => {
      spawnArgs = [...args];
      childEnvironment = options.env;
      queueMicrotask(() =>
        child.emitStderr(
          '$scope=app $level=note $msg="server running" address=127.0.0.1:43123\n',
        ),
      );
      return child;
    },
    fetchVersion: async () =>
      new Response(
        JSON.stringify({
          webSocketDebuggerUrl: "ws://attacker.example:43123/session",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    connectOverCdp: async () => {
      connectCalls += 1;
      throw new Error("must not connect");
    },
  } as unknown as LightpandaProviderRuntime;

  await assert.rejects(
    () =>
      launchLightpandaBrowser(
        {
          executablePath: "/trusted/lightpanda",
          startupTimeoutMs: 100,
        },
        runtime,
      ),
    (error: unknown) =>
      error instanceof LightpandaProviderError &&
      error.code === "LIGHTPANDA_CDP_ENDPOINT_REJECTED",
  );

  assert.deepEqual(
    spawnArgs.slice(0, 7),
    [
      "serve",
      "--host",
      "127.0.0.1",
      "--port",
      "0",
      "--cdp-max-connections",
      "1",
    ],
  );
  assert.equal(connectCalls, 0);
  assert.deepEqual(child.killSignals, ["SIGTERM"]);
  assert.deepEqual(childEnvironment, {
    LANG: "en_AU.UTF-8",
  });
});

test.each([
  ["spawn error", "LIGHTPANDA_SPAWN_FAILED", (child: FakeLightpandaProcess) => child.emit("error", new Error("raw-stderr-token"))],
  ["signal exit", "LIGHTPANDA_EXITED", (child: FakeLightpandaProcess) => child.finish(null, "SIGSEGV")],
] as const)("Lightpanda reports %s without exposing browser stderr", async (_label, expectedCode, fail) => {
  const child = new FakeLightpandaProcess();
  const sentinel = "raw-stderr-token";
  const runtime = {
    bunVersion: "1.4.0",
    environment: {},
    fileSystem: trustedFileSystem(),
    spawnProcess: () => {
      queueMicrotask(() => {
        child.emitStderr(`fatal ${sentinel}`);
        fail(child);
      });
      return child;
    },
    fetchVersion: async () => {
      throw new Error("must not fetch");
    },
    connectOverCdp: async () => {
      throw new Error("must not connect");
    },
  } as unknown as LightpandaProviderRuntime;

  await assert.rejects(
    () => launchLightpandaBrowser({ executablePath: "/trusted/bin/lightpanda", startupTimeoutMs: 100 }, runtime),
    (error: unknown) =>
      error instanceof LightpandaProviderError &&
      error.code === expectedCode &&
      !error.message.includes(sentinel),
  );
  assert.deepEqual(child.killSignals, expectedCode === "LIGHTPANDA_EXITED" ? [] : ["SIGTERM"]);
});

test("Lightpanda aborts a non-responsive CDP HTTP probe at the startup deadline", async () => {
  const child = new FakeLightpandaProcess();
  let observedSignal: AbortSignal | undefined;
  const runtime = {
    bunVersion: "1.4.0",
    environment: {},
    fileSystem: trustedFileSystem(),
    spawnProcess: () => {
      queueMicrotask(() =>
        child.emitStderr("server running address=127.0.0.1:43123\n"),
      );
      return child;
    },
    fetchVersion: async (_url: string, signal: AbortSignal) => {
      observedSignal = signal;
      return new Promise<Response>(() => undefined);
    },
    connectOverCdp: async () => {
      throw new Error("must not connect");
    },
  } as unknown as LightpandaProviderRuntime;

  await assert.rejects(
    () =>
      settleWithin(
        launchLightpandaBrowser(
          {
            executablePath: "/trusted/lightpanda",
            startupTimeoutMs: 20,
            shutdownTimeoutMs: 10,
          },
          runtime,
        ),
        150,
      ),
    (error: unknown) =>
      error instanceof LightpandaProviderError &&
      error.code === "LIGHTPANDA_START_TIMEOUT",
  );

  assert.equal(observedSignal?.aborted, true);
  assert.deepEqual(child.killSignals, ["SIGTERM"]);
});

test("Lightpanda bounds a CDP response body that never finishes", async () => {
  const child = new FakeLightpandaProcess();
  const runtime = {
    bunVersion: "1.4.0",
    environment: {},
    fileSystem: trustedFileSystem(),
    spawnProcess: () => {
      queueMicrotask(() =>
        child.emitStderr("server running address=127.0.0.1:43123\n"),
      );
      return child;
    },
    fetchVersion: async () => ({
      ok: true,
      json: async () => new Promise<never>(() => undefined),
    } as Response),
    connectOverCdp: async () => {
      throw new Error("must not connect");
    },
  } as unknown as LightpandaProviderRuntime;

  await assert.rejects(
    () => settleWithin(
      launchLightpandaBrowser(
        {
          executablePath: "/trusted/bin/lightpanda",
          startupTimeoutMs: 20,
          shutdownTimeoutMs: 10,
        },
        runtime,
      ),
      150,
    ),
    (error: unknown) =>
      error instanceof LightpandaProviderError &&
      error.code === "LIGHTPANDA_START_TIMEOUT",
  );

  assert.deepEqual(child.killSignals, ["SIGTERM"]);
});

test("Lightpanda bounds a non-responsive CDP WebSocket handshake", async () => {
  const child = new FakeLightpandaProcess();
  const runtime = {
    bunVersion: "1.4.0",
    environment: {},
    fileSystem: trustedFileSystem(),
    spawnProcess: () => {
      queueMicrotask(() =>
        child.emitStderr("server running address=127.0.0.1:43123\n"),
      );
      return child;
    },
    fetchVersion: async () =>
      new Response(
        JSON.stringify({
          webSocketDebuggerUrl: "ws://127.0.0.1:43123/",
        }),
        { status: 200 },
      ),
    connectOverCdp: async () => new Promise<never>(() => undefined),
  } as unknown as LightpandaProviderRuntime;

  await assert.rejects(
    () =>
      settleWithin(
        launchLightpandaBrowser(
          {
            executablePath: "/trusted/lightpanda",
            startupTimeoutMs: 20,
            shutdownTimeoutMs: 10,
          },
          runtime,
        ),
        150,
      ),
    (error: unknown) =>
      error instanceof LightpandaProviderError &&
      error.code === "LIGHTPANDA_START_TIMEOUT",
  );

  assert.deepEqual(child.killSignals, ["SIGTERM"]);
});

test("Lightpanda exposes only a credential-free public inspection surface", async () => {
  const child = new FakeLightpandaProcess();
  let navigatedTo = "";
  let finalUrl = "https://monashuni.okta.com/signin";
  const page = {
    goto: async (url: string) => {
      navigatedTo = url;
    },
    url: () => finalUrl,
    locator: (selector: string) => ({
      count: async () => selector === "input" ? 4 : 1,
    }),
  };
  const context = {
    newPage: async () => page,
    cookies: async () => [{ name: "opaque", value: "must-not-return" }],
  };
  const cdpBrowser = {
    newContext: async () => context,
    contexts: () => [],
    close: async () => undefined,
  };
  const runtime = {
    bunVersion: "1.4.0",
    environment: {},
    fileSystem: trustedFileSystem(),
    spawnProcess: () => {
      queueMicrotask(() =>
        child.emitStderr("server running address=127.0.0.1:43123\n"),
      );
      return child;
    },
    fetchVersion: async () =>
      new Response(
        JSON.stringify({ webSocketDebuggerUrl: "ws://127.0.0.1:43123/" }),
        { status: 200 },
      ),
    connectOverCdp: async () => cdpBrowser,
  } as unknown as LightpandaProviderRuntime;
  const spike = await launchLightpandaBrowser(
    {
      executablePath: "/trusted/lightpanda",
      startupTimeoutMs: 100,
      shutdownTimeoutMs: 10,
    },
    runtime,
  );

  assert.deepEqual(Object.keys(spike).sort(), ["close", "inspect"]);
  assert.deepEqual(await spike.inspect(), {
    requestedOrigin: "https://monashuni.okta.com",
    finalOrigin: "https://monashuni.okta.com",
    inputCount: 4,
    identifierInputPresent: true,
    cookieCount: 1,
  });
  assert.equal(navigatedTo, "https://monashuni.okta.com/");

  finalUrl = "https://evil.example/callback";
  await assert.rejects(
    () => spike.inspect(),
    (error: unknown) =>
      error instanceof LightpandaProviderError &&
      error.code === "LIGHTPANDA_PUBLIC_URL_REJECTED",
  );

  await spike.close();
  assert.deepEqual(child.killSignals, ["SIGTERM"]);
});

test("Lightpanda reaps its process when Playwright browser close never settles", async () => {
  const child = new FakeLightpandaProcess();
  const runtime = {
    bunVersion: "1.4.0",
    environment: {},
    fileSystem: trustedFileSystem(),
    spawnProcess: () => {
      queueMicrotask(() =>
        child.emitStderr("server running address=127.0.0.1:43123\n"),
      );
      return child;
    },
    fetchVersion: async () =>
      new Response(
        JSON.stringify({ webSocketDebuggerUrl: "ws://127.0.0.1:43123/" }),
        { status: 200 },
      ),
    connectOverCdp: async () => ({
      newContext: async () => ({ marker: "context" }),
      contexts: () => [],
      close: async () => new Promise<never>(() => undefined),
    }),
  } as unknown as LightpandaProviderRuntime;
  const browser = await launchLightpandaBrowser(
    {
      executablePath: "/trusted/lightpanda",
      startupTimeoutMs: 100,
      shutdownTimeoutMs: 10,
    },
    runtime,
  );

  await settleWithin(browser.close(), 150);

  assert.deepEqual(child.killSignals, ["SIGTERM"]);
});

test("Lightpanda close is idempotent and escalates to SIGKILL when SIGTERM is ignored", async () => {
  const child = new FakeLightpandaProcess(["SIGKILL"]);
  let browserCloseCalls = 0;
  const runtime = {
    bunVersion: "1.4.0",
    environment: {},
    fileSystem: trustedFileSystem(),
    spawnProcess: () => {
      queueMicrotask(() =>
        child.emitStderr("server running address=127.0.0.1:43123\n"),
      );
      return child;
    },
    fetchVersion: async () =>
      new Response(
        JSON.stringify({ webSocketDebuggerUrl: "ws://127.0.0.1:43123/" }),
        { status: 200 },
      ),
    connectOverCdp: async () => ({
      newContext: async () => ({ marker: "context" }),
      contexts: () => [],
      close: async () => {
        browserCloseCalls += 1;
      },
    }),
  } as unknown as LightpandaProviderRuntime;
  const browser = await launchLightpandaBrowser(
    {
      executablePath: "/trusted/bin/lightpanda",
      startupTimeoutMs: 100,
      shutdownTimeoutMs: 10,
    },
    runtime,
  );

  const firstClose = browser.close();
  const secondClose = browser.close();
  assert.equal(firstClose, secondClose);
  await settleWithin(firstClose, 150);

  assert.equal(browserCloseCalls, 1);
  assert.deepEqual(child.killSignals, ["SIGTERM", "SIGKILL"]);
});

test("Lightpanda keeps child process errors handled after CDP becomes ready", async () => {
  const child = new FakeLightpandaProcess();
  const runtime = {
    bunVersion: "1.4.0",
    environment: {},
    fileSystem: trustedFileSystem(),
    spawnProcess: () => {
      queueMicrotask(() =>
        child.emitStderr("server running address=127.0.0.1:43123\n"),
      );
      return child;
    },
    fetchVersion: async () => new Response(
      JSON.stringify({ webSocketDebuggerUrl: "ws://127.0.0.1:43123/" }),
      { status: 200 },
    ),
    connectOverCdp: async () => ({
      newContext: async () => ({ marker: "context" }),
      contexts: () => [],
      close: async () => undefined,
    }),
  } as unknown as LightpandaProviderRuntime;
  const browser = await launchLightpandaBrowser(
    { executablePath: "/trusted/bin/lightpanda", shutdownTimeoutMs: 10 },
    runtime,
  );

  assert.doesNotThrow(() => child.emit("error", new Error("raw sentinel")));
  await browser.close();
});

test("Lightpanda reports cleanup failure when SIGKILL never produces exit", async () => {
  const child = new FakeLightpandaProcess([]);
  const runtime = {
    bunVersion: "1.4.0",
    environment: {},
    fileSystem: trustedFileSystem(),
    spawnProcess: () => {
      queueMicrotask(() =>
        child.emitStderr("server running address=127.0.0.1:43123\n"),
      );
      return child;
    },
    fetchVersion: async () => new Response(
      JSON.stringify({ webSocketDebuggerUrl: "ws://127.0.0.1:43123/" }),
      { status: 200 },
    ),
    connectOverCdp: async () => ({
      newContext: async () => ({ marker: "context" }),
      contexts: () => [],
      close: async () => undefined,
    }),
  } as unknown as LightpandaProviderRuntime;
  const browser = await launchLightpandaBrowser(
    {
      executablePath: "/trusted/bin/lightpanda",
      shutdownTimeoutMs: 10,
    },
    runtime,
  );

  await assert.rejects(
    () => settleWithin(browser.close(), 150),
    (error: unknown) =>
      error instanceof LightpandaProviderError &&
      error.code === "LIGHTPANDA_CLEANUP_FAILED",
  );
  assert.deepEqual(child.killSignals, ["SIGTERM", "SIGKILL"]);
});
