import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, join, resolve, sep } from "node:path";
import { homedir } from "node:os";
import type {
  Browser,
  BrowserContext,
  BrowserContextOptions,
  Frame,
  Locator,
  Page,
} from "playwright-core";

/**
 * Browser automation flow for Monash SSO / Okta handoff.
 *
 * Responsibilities:
 * - drive guided username/password entry when requested
 * - detect MFA method selection and number challenge states
 * - capture final OnTrack credentials from URL/auth payload/cookies/storage
 * - classify failures into explicit fallback reasons
 */
export interface LoginCredentials {
  authToken: string;
  username: string;
  expiresAt?: string;
  source: "url" | "auth_request" | "auth_response" | "local_storage" | "cookie";
  contract?: "access-token" | "legacy-auth";
}

/** Guided SSO options for username/password + MFA interaction mode. */
export interface SsoLoginOptions {
  ssoUrl: string;
  apiBaseUrl: string;
  username: string;
  password: string;
  timeoutMs?: number;
  headless?: boolean;
  chooseMfaMethod?: (
    options: MfaMethodOption[],
  ) => Promise<number | null | undefined>;
  requestMfaCode?: (methodLabel: string) => Promise<string | null | undefined>;
  onMfaNumberChallenge?: (numbers: string[]) => void;
  browserAdapter?: BrowserLaunchAdapter;
}

/** One CLI-presented MFA option extracted from page controls. */
export interface MfaMethodOption {
  id: number;
  label: string;
  recommended?: boolean;
}

/** High-level guided login lifecycle steps used by terminal callbacks. */
export type SsoStep =
  | "username"
  | "password"
  | "mfa_select"
  | "mfa_code"
  | "mfa_wait"
  | "completed"
  | "fallback";

/** Categorized fallback reasons surfaced to callers and users. */
export type SsoFallbackReason =
  | "captcha"
  | "unsupported_mfa"
  | "selector_missing"
  | "timeout"
  | "browser_unavailable"
  | "automation_error";

/** Typed fallback error carrying reason + stage for better UX messaging. */
export class SsoFallbackError extends Error {
  constructor(
    readonly reason: SsoFallbackReason,
    readonly step: SsoStep,
    message: string,
  ) {
    super(message);
    this.name = "SsoFallbackError";
  }
}

/** Browser launch strategy selected at runtime. */
export interface BrowserLaunchPlan {
  source: "env" | "system" | "bundled";
  executablePath?: string;
}

/** Narrow browser Adapter for deterministic, no-network login state-machine tests. */
export interface BrowserLaunchAdapter {
  launch(options: {
    headless: boolean;
    executablePath?: string;
  }): Promise<Pick<Browser, "newContext" | "close">>;
}

const DEFAULT_ONTRACK_ORIGIN = "https://ontrack.infotech.monash.edu";

/** Type guard for non-empty string-like values. */
function hasValue(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** True only when a URL belongs to the exact OnTrack origin being authenticated. */
function isTargetOnTrackUrl(urlValue: string, targetOrigin: string): boolean {
  try {
    return new URL(urlValue).origin === new URL(targetOrigin).origin;
  } catch {
    return false;
  }
}

/** True only for an auth endpoint on the exact OnTrack origin. */
function isTargetOnTrackAuthUrl(
  urlValue: string,
  targetOrigin: string,
): boolean {
  if (!isTargetOnTrackUrl(urlValue, targetOrigin)) {
    return false;
  }

  return (
    new URL(urlValue).pathname === "/api/auth" ||
    new URL(urlValue).pathname.startsWith("/api/auth/")
  );
}

/** Extract authToken/username directly from redirect URL query params. */
export function extractCredentialsFromUrl(
  urlValue: string,
  targetOrigin: string = DEFAULT_ONTRACK_ORIGIN,
): LoginCredentials | null {
  try {
    const url = new URL(urlValue);
    if (url.origin !== new URL(targetOrigin).origin) {
      return null;
    }
    const authToken = url.searchParams.get("authToken");
    const username = url.searchParams.get("username");
    if (!hasValue(authToken) || !hasValue(username)) {
      return null;
    }
    return {
      authToken,
      username,
      source: "url",
    };
  } catch {
    return null;
  }
}

/** Parse `/api/auth` request/response payload variants into common credential shape. */
export function extractCredentialsFromAuthPayload(
  payload: unknown,
): LoginCredentials | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const authToken = hasValue(record.auth_token)
    ? record.auth_token
    : hasValue(record.authToken)
      ? record.authToken
      : null;
  const username = hasValue(record.username) ? record.username : null;
  const user = record.user;
  const nestedUsername =
    user && typeof user === "object"
      ? extractUsernameFromUserRecord(user as Record<string, unknown>)
      : null;
  const expiresAt = hasValue(record.auth_token_expiry)
    ? record.auth_token_expiry
    : hasValue(record.authTokenExpiry)
      ? record.authTokenExpiry
      : undefined;

  if (!authToken || (!username && !nestedUsername)) {
    return null;
  }

  return {
    authToken,
    username: username ?? nestedUsername!,
    ...(expiresAt ? { expiresAt } : {}),
    source: "auth_request",
  };
}

/** Extract credentials from cookies for cases where URL/network interception misses. */
export function extractCredentialsFromCookieJar(
  cookies: Array<{ name: string; value: string; domain?: string }>,
  targetOrigin: string = DEFAULT_ONTRACK_ORIGIN,
): LoginCredentials | null {
  let targetHostname: string;
  try {
    targetHostname = new URL(targetOrigin).hostname;
  } catch {
    return null;
  }

  const belongsToTargetHost = (cookie: { domain?: string }): boolean => {
    const cookieDomain = cookie.domain?.trim().toLowerCase().replace(/^\./, "");
    return Boolean(
      cookieDomain && cookieDomain === targetHostname.toLowerCase(),
    );
  };

  const find = (names: string[]): string | undefined => {
    for (const name of names) {
      const hit = cookies.find(
        (cookie) => cookie.name === name && belongsToTargetHost(cookie),
      );
      if (hit?.value) {
        return hit.value;
      }
    }
    return undefined;
  };

  const authToken = find(["authToken", "auth_token", "Auth-Token"]);
  const username = find(["username", "Username"]);
  if (!authToken || !username) {
    return null;
  }

  return {
    authToken,
    username,
    source: "cookie",
  };
}

/** Extract credentials from outbound request headers set by web app runtime. */
function extractCredentialsFromRequestHeaders(
  headers: Record<string, string>,
): LoginCredentials | null {
  const normalized = new Map<string, string>();
  for (const [key, value] of Object.entries(headers)) {
    normalized.set(key.toLowerCase(), value);
  }

  const authToken =
    normalized.get("auth-token") ||
    normalized.get("auth_token") ||
    normalized.get("authtoken");
  const username = normalized.get("username");
  if (!authToken || !username) {
    return null;
  }

  return {
    authToken,
    username,
    source: "auth_request",
  };
}

/** Candidate local browser locations by platform (used before bundled Chromium). */
function candidateBrowserPaths(): string[] {
  const paths: string[] = [];

  if (process.platform === "darwin") {
    paths.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    );
  } else if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA;
    const programFiles = process.env.PROGRAMFILES;
    const programFilesX86 = process.env["PROGRAMFILES(X86)"];
    const windowsCandidates = [
      local
        ? join(local, "Google", "Chrome", "Application", "chrome.exe")
        : undefined,
      programFiles
        ? join(programFiles, "Google", "Chrome", "Application", "chrome.exe")
        : undefined,
      programFilesX86
        ? join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe")
        : undefined,
      programFiles
        ? join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe")
        : undefined,
      programFilesX86
        ? join(
            programFilesX86,
            "Microsoft",
            "Edge",
            "Application",
            "msedge.exe",
          )
        : undefined,
    ].filter((item): item is string => Boolean(item));
    paths.push(...windowsCandidates);
  } else {
    paths.push(
      "/usr/bin/google-chrome-stable",
      "/usr/bin/google-chrome",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/snap/bin/chromium",
      "/opt/google/chrome/chrome",
      "/opt/microsoft/msedge/msedge",
    );
  }

  return paths;
}

/** Select browser launch strategy: explicit env path > system browser > bundled. */
export function resolveBrowserLaunchPlan(
  env: NodeJS.ProcessEnv = process.env,
  fileExists: (path: string) => boolean = existsSync,
): BrowserLaunchPlan {
  const explicitBrowser = env.ONTRACK_BROWSER_PATH?.trim();
  if (explicitBrowser) {
    // The executable override is trusted local operator configuration.
    // codeql[js/path-injection]
    if (!fileExists(explicitBrowser)) {
      throw new SsoFallbackError(
        "browser_unavailable",
        "fallback",
        `ONTRACK_BROWSER_PATH points to a missing executable: ${explicitBrowser}`,
      );
    }
    return {
      source: "env",
      executablePath: explicitBrowser,
    };
  }

  for (const path of candidateBrowserPaths()) {
    // Candidate paths come only from fixed OS locations or process-owned OS environment roots.
    // codeql[js/path-injection]
    if (fileExists(path)) {
      return {
        source: "system",
        executablePath: path,
      };
    }
  }

  return {
    source: "bundled",
  };
}

/** Human-readable remediation when no launchable browser is found. */
function browserInstallHint(): string {
  return (
    "No browser executable found. Install Chrome/Chromium/Edge, install a reviewed Playwright Chromium runtime manually, " +
    "or set ONTRACK_BROWSER_PATH."
  );
}

/** Detect launch failures caused by missing X/Wayland display servers. */
function isMissingDisplayServerError(message: string): boolean {
  return /missing x server|\$display|headed browser without having a xserver|ozone_platform_x11|platform failed to initialize/i.test(
    message,
  );
}

/** Detect launch failures caused by missing shared system libraries. */
function isMissingSharedLibraryError(message: string): boolean {
  return /error while loading shared libraries|cannot open shared object file/i.test(
    message,
  );
}

/** Map unknown automation failures to high-level fallback reasons for CLI messaging. */
export function classifySsoFallback(error: unknown): SsoFallbackReason {
  if (error instanceof SsoFallbackError) {
    return error.reason;
  }

  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error).toLowerCase();
  if (message.includes("captcha")) {
    return "captcha";
  }
  if (
    message.includes("unsupported mfa") ||
    message.includes("webauthn") ||
    message.includes("email")
  ) {
    return "unsupported_mfa";
  }
  if (
    message.includes("selector") ||
    message.includes("username field") ||
    message.includes("password field")
  ) {
    return "selector_missing";
  }
  if (message.includes("timeout")) {
    return "timeout";
  }
  if (message.includes("browser")) {
    return "browser_unavailable";
  }
  return "automation_error";
}

/** Safe JSON parsing helper for intercepted request/response payloads. */
function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Recursively collect auth token + username candidates from arbitrary JSON-like payloads. */
function extractCredentialsFromUnknownObject(
  value: unknown,
  depth: number = 0,
): { authToken?: string; username?: string } {
  if (!value || typeof value !== "object" || depth > 6) {
    return {};
  }

  const tokenKeys = new Set([
    "authenticationtoken",
    "auth_token",
    "authtoken",
    "auth-token",
  ]);
  const usernameKeys = new Set(["username", "user_name", "login"]);
  let authToken: string | undefined;
  let username: string | undefined;

  const visit = (node: unknown, level: number): void => {
    if (level > 6 || !node) {
      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item, level + 1);
        if (authToken && username) {
          return;
        }
      }
      return;
    }

    if (typeof node !== "object") {
      return;
    }

    const record = node as Record<string, unknown>;
    for (const [key, rawValue] of Object.entries(record)) {
      const normalizedKey = key.toLowerCase();
      if (!authToken && tokenKeys.has(normalizedKey) && hasValue(rawValue)) {
        authToken = rawValue.trim();
      }
      if (!username && usernameKeys.has(normalizedKey) && hasValue(rawValue)) {
        username = rawValue.trim();
      }
      if (authToken && username) {
        return;
      }
    }

    for (const child of Object.values(record)) {
      visit(child, level + 1);
      if (authToken && username) {
        return;
      }
    }
  };

  visit(value, depth);
  return { authToken, username };
}

/** Snapshot of one browser storage key/value pair used during session reuse probing. */
interface BrowserStorageEntry {
  scope: "local" | "session";
  key: string;
  value: string;
}

/** Decode storage string values that may be raw text or JSON-encoded strings. */
function normalizeStorageStringValue(raw: string): string | null {
  if (!hasValue(raw)) {
    return null;
  }

  const trimmed = raw.trim();
  const parsed = tryParseJson(trimmed);
  if (typeof parsed === "string" && hasValue(parsed)) {
    return parsed.trim();
  }

  return trimmed;
}

/** Parse username-ish fields from user objects that OnTrack stores in browser storage. */
function extractUsernameFromUserRecord(
  record: Record<string, unknown>,
): string | null {
  const candidates = [
    record.username,
    record.user_name,
    record.login,
    record.email,
    record.student_email,
  ];

  for (const candidate of candidates) {
    if (hasValue(candidate)) {
      return candidate.trim();
    }
  }

  return null;
}

/**
 * Parse auth credentials from browser storage entries.
 * This handles OnTrack's real storage layout where token + user are stored under different keys:
 * - `doubtfire_credentials_token` (token string)
 * - `doubtfire_user` (JSON user object containing username)
 */
export function extractCredentialsFromStorageEntries(
  entries: BrowserStorageEntry[],
): LoginCredentials | null {
  if (!Array.isArray(entries) || entries.length === 0) {
    return null;
  }

  let authToken: string | null = null;
  let username: string | null = null;

  const normalizedEntries = entries
    .filter((entry) => hasValue(entry.key) && hasValue(entry.value))
    .map((entry) => ({
      ...entry,
      normalizedKey: entry.key.trim().toLowerCase(),
    }));

  // 1) Exact-key extraction for known OnTrack keys (most reliable + fastest).
  for (const entry of normalizedEntries) {
    if (entry.normalizedKey === "doubtfire_credentials_token") {
      authToken = normalizeStorageStringValue(entry.value);
      if (authToken) {
        break;
      }
    }
  }

  for (const entry of normalizedEntries) {
    if (entry.normalizedKey !== "doubtfire_user") {
      continue;
    }

    const parsed = tryParseJson(entry.value);
    if (parsed && typeof parsed === "object") {
      username = extractUsernameFromUserRecord(
        parsed as Record<string, unknown>,
      );
      if (!username) {
        const extracted = extractCredentialsFromUnknownObject(parsed);
        username = extracted.username ?? null;
      }
    } else {
      username = normalizeStorageStringValue(entry.value);
    }

    if (username) {
      break;
    }
  }

  // 2) Generic key-based fallback (covers future key renames and other identity providers).
  for (const entry of normalizedEntries) {
    if (
      !authToken &&
      ["auth_token", "authtoken", "auth-token", "authenticationtoken"].includes(
        entry.normalizedKey,
      )
    ) {
      authToken = normalizeStorageStringValue(entry.value);
    }

    if (
      !username &&
      ["username", "user_name", "login", "email"].includes(entry.normalizedKey)
    ) {
      username = normalizeStorageStringValue(entry.value);
    }
  }

  // 3) Recursive object scan fallback for opaque JSON blobs.
  if (!authToken || !username) {
    for (const entry of normalizedEntries) {
      const parsed = tryParseJson(entry.value);
      if (!parsed || typeof parsed !== "object") {
        continue;
      }

      const extracted = extractCredentialsFromUnknownObject(parsed);
      if (!authToken && extracted.authToken) {
        authToken = extracted.authToken;
      }
      if (!username && extracted.username) {
        username = extracted.username;
      }

      if (authToken && username) {
        break;
      }
    }
  }

  if (!authToken || !username) {
    return null;
  }

  return {
    authToken,
    username,
    source: "local_storage",
  };
}

/** Attempt to recover credentials from OnTrack localStorage session payload. */
async function extractCredentialsFromLocalStorage(page: {
  evaluate: (fn: () => unknown) => Promise<unknown>;
}): Promise<LoginCredentials | null> {
  try {
    const data = await page.evaluate(() => {
      try {
        const collect = (storage: Storage, scope: "local" | "session") => {
          const out: Array<{
            scope: "local" | "session";
            key: string;
            value: string;
          }> = [];
          for (let index = 0; index < storage.length; index += 1) {
            const key = storage.key(index);
            if (!key) {
              continue;
            }
            const item = storage.getItem(key);
            if (item) {
              out.push({ scope, key, value: item });
            }
          }
          return out;
        };

        return [
          ...collect(localStorage, "local"),
          ...collect(sessionStorage, "session"),
        ];
      } catch {
        return null;
      }
    });

    if (!Array.isArray(data) || data.length === 0) {
      return null;
    }

    return extractCredentialsFromStorageEntries(data as BrowserStorageEntry[]);
  } catch {
    return null;
  }
}

/** Browser-assisted capture options used by non-guided SSO mode. */
export interface AutoLoginOptions {
  ssoUrl: string;
  apiBaseUrl: string;
  timeoutMs?: number;
  headless?: boolean;
  browserAdapter?: BrowserLaunchAdapter;
  /** Trusted adapter seam for isolating live-profile policy in tests. */
  systemBrowserProfileReuseEnabled?: () => boolean;
}

/** Candidate system browser profile location used for direct session reuse probe. */
export interface SystemBrowserProfileLocation {
  label: string;
  userDataDir: string;
  profileDir: string;
}

/**
 * Resolve disk location for persisted browser session state (cookies/localStorage).
 * This state is generated by successful automated logins and reused on future runs.
 */
export function resolveBrowserSessionStatePath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  const explicit = env.ONTRACK_BROWSER_STATE_PATH?.trim();
  if (explicit) {
    return explicit;
  }

  if (env.XDG_CONFIG_HOME) {
    return join(env.XDG_CONFIG_HOME, "ontrack-cli", "browser-state.json");
  }

  if (platform === "win32" && env.APPDATA) {
    return join(env.APPDATA, "ontrack-cli", "browser-state.json");
  }

  return join(home, ".config", "ontrack-cli", "browser-state.json");
}

let browserSessionStatePathForTests: string | undefined;

/** @internal Isolate browser-state filesystem tests without production env paths. */
export function setBrowserSessionStatePathForTests(
  storagePath: string | undefined,
): void {
  browserSessionStatePathForTests = storagePath
    ? resolve(storagePath)
    : undefined;
}

/**
 * Credential-bearing browser state always uses one operator-owned path. It
 * intentionally ignores environment path overrides so Agent or service
 * configuration cannot redirect authentication file I/O.
 */
function resolveManagedBrowserSessionStatePath(): string {
  if (browserSessionStatePathForTests) {
    return browserSessionStatePathForTests;
  }
  const home = homedir();
  return process.platform === "win32"
    ? join(home, "AppData", "Roaming", "ontrack-cli", "browser-state.json")
    : join(home, ".config", "ontrack-cli", "browser-state.json");
}

/**
 * Resolve the private directory containing an existing browser-state file.
 * The filename is fixed and the directory is canonicalized inside the local
 * operator's home before any atomic state operation receives it.
 */
function resolveTrustedExistingBrowserSessionStateLocation(
  targetOrigin: string,
): {
  stateDirectory: string;
  storagePath: string;
  directoryDevice: number;
  directoryInode: number;
} | null {
  const trustedRoot = realpathSync(homedir());
  const configuredPath = resolve(resolveManagedBrowserSessionStatePath());
  if (basename(configuredPath) !== "browser-state.json") {
    throw new Error(
      "Refusing to reuse a browser-state file with an unexpected name.",
    );
  }

  let stateDirectory: string;
  try {
    stateDirectory = realpathSync(dirname(configuredPath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }

  const trustedPrefix = `${trustedRoot}${sep}`;
  if (
    stateDirectory !== trustedRoot &&
    !stateDirectory.startsWith(trustedPrefix)
  ) {
    throw new Error(
      "Refusing to reuse browser state outside the local operator home.",
    );
  }
  const directoryMetadata = lstatSync(stateDirectory);
  if (
    !directoryMetadata.isDirectory() ||
    directoryMetadata.isSymbolicLink() ||
    (process.platform !== "win32" && (directoryMetadata.mode & 0o077) !== 0) ||
    (typeof process.getuid === "function" &&
      directoryMetadata.uid !== process.getuid())
  ) {
    throw new Error(
      "Refusing to reuse browser state from a non-private directory.",
    );
  }
  const storagePath = join(stateDirectory, "browser-state.json");
  const location: TrustedBrowserSessionStateLocation = {
    stateDirectory,
    storagePath,
    directoryDevice: directoryMetadata.dev,
    directoryInode: directoryMetadata.ino,
  };
  let storageMetadata: ReturnType<typeof lstatSync>;
  try {
    storageMetadata = lstatSync(storagePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      if (!recoverOrphanedBrowserSessionState(location, targetOrigin)) {
        return null;
      }
      // The recovered generation was already descriptor-validated. A
      // concurrent process may claim it immediately; the atomic rename below
      // treats that normal hand-off as a cache miss instead of surfacing ENOENT.
      return location;
    } else {
      throw error;
    }
  }
  if (!storageMetadata.isFile() || storageMetadata.isSymbolicLink()) {
    throw new Error(
      "Refusing to reuse a non-regular browser-state file.",
    );
  }
  return location;
}

interface TrustedBrowserSessionStateLocation {
  stateDirectory: string;
  storagePath: string;
  directoryDevice: number;
  directoryInode: number;
}

const ORPHANED_BROWSER_STATE_MIN_AGE_MS = 5_000;

function assertTrustedBrowserSessionStateDirectory(
  location: TrustedBrowserSessionStateLocation,
): void {
  const canonicalDirectory = realpathSync(location.stateDirectory);
  const metadata = lstatSync(canonicalDirectory);
  if (
    canonicalDirectory !== location.stateDirectory ||
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    metadata.dev !== location.directoryDevice ||
    metadata.ino !== location.directoryInode ||
    (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) ||
    (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  ) {
    throw new Error(
      "Browser-state directory identity or private permissions changed.",
    );
  }
}

function recoverOrphanedBrowserSessionState(
  location: TrustedBrowserSessionStateLocation,
  targetOrigin: string,
): boolean {
  assertTrustedBrowserSessionStateDirectory(location);
  const orphanCutoff = Date.now() - ORPHANED_BROWSER_STATE_MIN_AGE_MS;
  const candidates = readdirSync(location.stateDirectory)
    .filter((name) =>
      /^browser-state\.json\.probe-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        name,
      ),
    )
    .flatMap((name) => {
      const path = join(location.stateDirectory, name);
      try {
        const metadata = lstatSync(path);
        return metadata.isFile() &&
          !metadata.isSymbolicLink() &&
          metadata.mtimeMs <= orphanCutoff
          ? [{
              path,
              modifiedAt: metadata.mtimeMs,
              dev: metadata.dev,
              ino: metadata.ino,
            }]
          : [];
      } catch {
        return [];
      }
    })
    .sort((left, right) => right.modifiedAt - left.modifiedAt);

  for (const candidate of candidates) {
    assertTrustedBrowserSessionStateDirectory(location);
    let descriptor: number | undefined;
    let state: BrowserStorageState | undefined;
    try {
      const pathMetadata = lstatSync(candidate.path);
      descriptor = openSync(
        candidate.path,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      );
      const descriptorMetadata = fstatSync(descriptor);
      if (
        pathMetadata.isFile() &&
        !pathMetadata.isSymbolicLink() &&
        descriptorMetadata.isFile() &&
        pathMetadata.dev === descriptorMetadata.dev &&
        pathMetadata.ino === descriptorMetadata.ino
      ) {
        const parsed = JSON.parse(readFileSync(descriptor, "utf8")) as unknown;
        if (isBrowserStorageState(parsed)) {
          const filtered = filterBrowserSessionState(parsed, targetOrigin);
          if (hasReusableBrowserSessionState(filtered)) {
            state = filtered;
          }
        }
      }
    } catch {
      state = undefined;
    } finally {
      if (descriptor !== undefined) {
        closeSync(descriptor);
      }
    }
    if (state) {
      writeBrowserSessionStateIfAbsent(location, state);
    }
    removeBrowserSessionStateEntryIfSame(
      location,
      candidate.path,
      candidate,
    );
    if (state) {
      return true;
    }
  }
  return false;
}

function removeBrowserSessionStateEntryIfSame(
  location: TrustedBrowserSessionStateLocation,
  path: string,
  expected: {
    dev: number;
    ino: number;
  },
): boolean {
  assertTrustedBrowserSessionStateDirectory(location);
  let current: ReturnType<typeof lstatSync>;
  try {
    current = lstatSync(path);
  } catch {
    return false;
  }
  if (
    current.isSymbolicLink() ||
    current.dev !== expected.dev ||
    current.ino !== expected.ino
  ) {
    return false;
  }
  rmSync(path);
  return true;
}

function writeBrowserSessionStateIfAbsent(
  location: TrustedBrowserSessionStateLocation,
  state: BrowserStorageState,
): void {
  const serialized = JSON.stringify(state);
  assertTrustedBrowserSessionStateDirectory(location);
  let descriptor: number;
  try {
    descriptor = openSync(
      location.storagePath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      // A concurrent process already published a newer generation.
      return;
    }
    throw new Error(
      `Unable to restore private browser state: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const descriptorMetadata = fstatSync(descriptor);
  let writeFailure: unknown;
  try {
    writeFileSync(descriptor, serialized, "utf8");
  } catch (error) {
    writeFailure = error;
  }
  try {
    closeSync(descriptor);
  } catch (error) {
    writeFailure ??= error;
  }
  if (writeFailure !== undefined) {
    const removed = removeBrowserSessionStateEntryIfSame(
      location,
      location.storagePath,
      descriptorMetadata,
    );
    throw new Error(
      `Unable to write private browser state${
        removed ? "" : " and safely remove the partial file"
      }: ${
        writeFailure instanceof Error
          ? writeFailure.message
          : String(writeFailure)
      }`,
    );
  }
}

/** Remove the persisted OnTrack-only browser state used by silent renewal. */
export function clearBrowserSessionState(storagePath?: string): void {
  const path = storagePath ?? resolveManagedBrowserSessionStatePath();
  // This path is trusted local operator configuration.
  // codeql[js/path-injection]
  if (!existsSync(path)) {
    return;
  }
  // The path is validated as a regular, non-symlink JSON browser-state file before unlink.
  // codeql[js/path-injection]
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("Refusing to remove a non-regular browser-state path.");
  }

  let state: unknown;
  try {
    // The parsed shape is allowlisted below before the same path may be removed.
    // codeql[js/path-injection]
    state = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("Refusing to remove an invalid browser-state file.");
  }
  if (
    !state ||
    typeof state !== "object" ||
    !Array.isArray((state as { cookies?: unknown }).cookies) ||
    !Array.isArray((state as { origins?: unknown }).origins)
  ) {
    throw new Error("Refusing to remove an invalid browser-state file.");
  }
  // The same lstat-checked and shape-validated file is removed; directories and symlinks fail.
  // codeql[js/path-injection]
  rmSync(path);
}

/**
 * Resolve likely Chromium-family user-data roots from platform conventions.
 * Used to reuse an already logged-in browser profile before asking user credentials.
 */
export function resolveSystemBrowserUserDataDirs(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): SystemBrowserProfileLocation[] {
  const profileDir =
    (env.ONTRACK_BROWSER_PROFILE_DIR || "Default").trim() || "Default";
  const explicit = env.ONTRACK_BROWSER_USER_DATA_DIR?.trim();
  if (explicit) {
    return [
      {
        label: "env:ONTRACK_BROWSER_USER_DATA_DIR",
        userDataDir: explicit,
        profileDir,
      },
    ];
  }

  if (platform === "darwin") {
    return [
      {
        label: "Google Chrome",
        userDataDir: join(
          home,
          "Library",
          "Application Support",
          "Google",
          "Chrome",
        ),
        profileDir,
      },
      {
        label: "Microsoft Edge",
        userDataDir: join(
          home,
          "Library",
          "Application Support",
          "Microsoft Edge",
        ),
        profileDir,
      },
      {
        label: "Chromium",
        userDataDir: join(home, "Library", "Application Support", "Chromium"),
        profileDir,
      },
      {
        label: "Brave",
        userDataDir: join(
          home,
          "Library",
          "Application Support",
          "BraveSoftware",
          "Brave-Browser",
        ),
        profileDir,
      },
    ];
  }

  if (platform === "win32") {
    const local = env.LOCALAPPDATA?.trim() || "";
    if (!local) {
      return [];
    }
    return [
      {
        label: "Google Chrome",
        userDataDir: join(local, "Google", "Chrome", "User Data"),
        profileDir,
      },
      {
        label: "Microsoft Edge",
        userDataDir: join(local, "Microsoft", "Edge", "User Data"),
        profileDir,
      },
      {
        label: "Chromium",
        userDataDir: join(local, "Chromium", "User Data"),
        profileDir,
      },
      {
        label: "Brave",
        userDataDir: join(local, "BraveSoftware", "Brave-Browser", "User Data"),
        profileDir,
      },
    ];
  }

  return [
    {
      label: "Google Chrome",
      userDataDir: join(home, ".config", "google-chrome"),
      profileDir,
    },
    {
      label: "Microsoft Edge",
      userDataDir: join(home, ".config", "microsoft-edge"),
      profileDir,
    },
    {
      label: "Chromium",
      userDataDir: join(home, ".config", "chromium"),
      profileDir,
    },
    {
      label: "Brave",
      userDataDir: join(home, ".config", "BraveSoftware", "Brave-Browser"),
      profileDir,
    },
  ];
}

/** System browser-profile reuse is intentionally off unless the user opts in. */
export function isSystemBrowserProfileReuseEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.ONTRACK_ENABLE_SYSTEM_BROWSER_PROFILE === "1";
}

/** Heuristic profile directory matcher for Chromium-family user-data roots. */
function isLikelyChromiumProfileDir(name: string): boolean {
  return /^(Default|Profile \d+|Person \d+|Guest Profile)$/i.test(name);
}

/**
 * Expand each browser user-data candidate into concrete profile candidates.
 * When profile override is unset, auto-discovers Default/Profile N folders.
 */
export function expandSystemBrowserProfileCandidates(
  bases: SystemBrowserProfileLocation[],
  options: {
    profileOverride?: string | undefined;
    pathExists?: (path: string) => boolean;
    listDirNames?: (path: string) => string[];
  } = {},
): SystemBrowserProfileLocation[] {
  const pathExists = options.pathExists ?? existsSync;
  const listDirNames =
    options.listDirNames ??
    ((path: string): string[] => {
      try {
        return readdirSync(path, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name);
      } catch {
        return [];
      }
    });
  const hasProfileOverride = Boolean(options.profileOverride?.trim());
  const expanded: SystemBrowserProfileLocation[] = [];
  const seen = new Set<string>();

  const pushCandidate = (candidate: SystemBrowserProfileLocation): void => {
    const key = `${candidate.userDataDir}::${candidate.profileDir}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    expanded.push(candidate);
  };

  for (const base of bases) {
    if (!pathExists(base.userDataDir)) {
      continue;
    }

    if (hasProfileOverride) {
      const profilePath = join(base.userDataDir, base.profileDir);
      if (pathExists(profilePath)) {
        pushCandidate(base);
      }
      continue;
    }

    const discoveredNames = listDirNames(base.userDataDir).filter(
      isLikelyChromiumProfileDir,
    );
    const orderedNames = discoveredNames.sort((left, right) => {
      if (left === "Default") {
        return -1;
      }
      if (right === "Default") {
        return 1;
      }
      return left.localeCompare(right);
    });

    if (orderedNames.length === 0) {
      const defaultPath = join(base.userDataDir, base.profileDir);
      if (pathExists(defaultPath)) {
        pushCandidate(base);
      }
      continue;
    }

    for (const profileName of orderedNames) {
      pushCandidate({
        ...base,
        profileDir: profileName,
      });
    }
  }

  return expanded;
}

type BrowserStorageState = Exclude<
  NonNullable<BrowserContextOptions["storageState"]>,
  string
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isBrowserStorageCookie(
  value: unknown,
): value is BrowserStorageState["cookies"][number] {
  if (!isRecord(value)) {
    return false;
  }
  return (
    hasValue(value.name) &&
    typeof value.value === "string" &&
    hasValue(value.domain) &&
    hasValue(value.path) &&
    typeof value.expires === "number" &&
    typeof value.httpOnly === "boolean" &&
    typeof value.secure === "boolean" &&
    (value.sameSite === "Strict" ||
      value.sameSite === "Lax" ||
      value.sameSite === "None")
  );
}

function isBrowserStorageOrigin(
  value: unknown,
): value is BrowserStorageState["origins"][number] {
  if (
    !isRecord(value) ||
    !hasValue(value.origin) ||
    !Array.isArray(value.localStorage)
  ) {
    return false;
  }
  return value.localStorage.every(
    (entry) =>
      isRecord(entry) &&
      hasValue(entry.name) &&
      typeof entry.value === "string",
  );
}

function isBrowserStorageState(value: unknown): value is BrowserStorageState {
  return (
    isRecord(value) &&
    Array.isArray(value.cookies) &&
    Array.isArray(value.origins) &&
    value.cookies.every(isBrowserStorageCookie) &&
    value.origins.every(isBrowserStorageOrigin)
  );
}

/** Retain only the exact OnTrack origin, never IdP or unrelated browser state. */
function filterBrowserSessionState(
  state: BrowserStorageState,
  targetOrigin: string,
): BrowserStorageState {
  const target = new URL(targetOrigin);
  const targetHostname = target.hostname.toLowerCase();
  const nowSeconds = Date.now() / 1000;
  const cookies = state.cookies.filter(
    (cookie) =>
      cookie.domain.trim().toLowerCase().replace(/^\./, "") === targetHostname &&
      (cookie.expires === -1 || cookie.expires > nowSeconds),
  );
  const origins = state.origins.filter(
    (origin) => origin.origin === target.origin,
  );

  return { cookies, origins };
}

function hasReusableBrowserSessionState(state: BrowserStorageState): boolean {
  const hasLocalStorage = state.origins.some(
    (origin) => origin.localStorage.length > 0,
  );

  return state.cookies.length > 0 || hasLocalStorage;
}

function writePrivateBrowserSessionState(
  storagePath: string,
  state: BrowserStorageState,
): void {
  // Storage paths are trusted local operator configuration.
  // codeql[js/path-injection]
  mkdirSync(dirname(storagePath), { recursive: true, mode: 0o700 });
  // codeql[js/path-injection]
  chmodSync(dirname(storagePath), 0o700);
  // State is exact-origin filtered and paths are never derived from Agent or remote input.
  // codeql[js/path-injection]
  writeFileSync(storagePath, JSON.stringify(state), {
    encoding: "utf8",
    mode: 0o600,
  });
  // codeql[js/path-injection]
  chmodSync(storagePath, 0o600);
}

export interface SaveBrowserSessionStateOptions {
  storagePath?: string;
  targetOrigin?: string;
}

/** Persist a private, OnTrack-only browser session state for future reuse. */
export async function saveBrowserSessionState(
  context: {
    storageState: () => Promise<unknown>;
  },
  options: SaveBrowserSessionStateOptions = {},
): Promise<void> {
  const storagePath =
    options.storagePath ?? resolveManagedBrowserSessionStatePath();
  const targetOrigin = options.targetOrigin ?? DEFAULT_ONTRACK_ORIGIN;
  const state = await context.storageState();
  const filtered = filterBrowserSessionState(
    isBrowserStorageState(state) ? state : { cookies: [], origins: [] },
    targetOrigin,
  );
  if (!hasReusableBrowserSessionState(filtered)) {
    return;
  }
  writePrivateBrowserSessionState(storagePath, filtered);
}

/** Build context options with optional previously persisted browser session state. */
export function buildContextOptionsWithStoredSession(
  options: {
    storagePath?: string;
    targetOrigin?: string;
  } = {},
):
  | {
      storageState: BrowserStorageState;
    }
  | undefined {
  const storagePath =
    options.storagePath ?? resolveManagedBrowserSessionStatePath();
  const targetOrigin = options.targetOrigin ?? DEFAULT_ONTRACK_ORIGIN;
  // This is a trusted local operator store path.
  // codeql[js/path-injection]
  if (!existsSync(storagePath)) {
    return undefined;
  }

  try {
    // The file is parsed and structurally validated before it reaches Playwright.
    // codeql[js/path-injection]
    const parsed = JSON.parse(readFileSync(storagePath, "utf8")) as unknown;
    if (!isBrowserStorageState(parsed)) {
      return undefined;
    }
    const filtered = filterBrowserSessionState(parsed, targetOrigin);
    if (!hasReusableBrowserSessionState(filtered)) {
      return undefined;
    }
    // Migrate legacy full-state files before a browser context ever receives them.
    writePrivateBrowserSessionState(storagePath, filtered);
    return { storageState: filtered };
  } catch {
    // A corrupt or unreadable state is never passed to Playwright.
    try {
      // Best-effort permission repair on the same trusted local state path.
      // codeql[js/path-injection]
      chmodSync(storagePath, 0o600);
    } catch {
      // Ignore a best-effort permission repair failure.
    }
    return undefined;
  }
}

// Username selector list spans Okta + Microsoft + generic IdP form variants.
const USERNAME_SELECTORS = [
  "input#okta-signin-username",
  "input#username",
  "input#userNameInput",
  "input#i0116",
  'input[name="identifier"]',
  'input[name="loginfmt"]',
  'input[name="username"]',
  'input[name="user"]',
  'input[autocomplete="username"]',
  'input[type="email"]',
];

// Password selector list spans Okta + Microsoft + generic password input variants.
const PASSWORD_SELECTORS = [
  "input#okta-signin-password",
  "input#password",
  "input#passwordInput",
  "input#i0118",
  'input[name="password"]',
  'input[name="passwd"]',
  'input[autocomplete="current-password"]',
  'input[type="password"]',
];

// Submit controls used after filling credentials.
const PRIMARY_SUBMIT_SELECTORS = [
  "input#okta-signin-submit",
  "#idSIButton9",
  'button[type="submit"]',
  'input[type="submit"]',
  'button[name="action"]',
  'button[data-type="save"]',
];

// SSO entry controls used on landing pages that require an extra click into IdP.
const SSO_ENTRY_SELECTORS = [
  'a[href*="sso"]',
  'a[href*="monashuni.okta.com"]',
  'a[href*="saml"]',
  'button[id*="sso"]',
  'button[class*="sso"]',
  "button[data-sso]",
];

// Label-based fallback for SSO entry when selectors are unstable.
const SSO_ENTRY_LABELS = [
  "monash",
  "single sign",
  "sso",
  "continue",
  "sign in",
  "log in",
  "next",
];

const USERNAME_CONTINUE_LABELS = [
  "next",
  "continue",
  "sign in",
  "log in",
  "verify",
];
const PASSWORD_SUBMIT_LABELS = [
  "sign in",
  "log in",
  "verify",
  "continue",
  "next",
];
const MFA_SELECT_BUTTON_LABEL = /select/i;
const MFA_OPTION_LABEL_CLEANUP = /\bselect\b/gi;
const KNOWN_MFA_METHODS: Array<{
  pattern: RegExp;
  label: string;
  recommended?: boolean;
}> = [
  {
    pattern: /get a push notification/i,
    label: "Get a push notification (Okta Verify)",
    recommended: true,
  },
  {
    pattern: /enter a code/i,
    label: "Enter a code (Okta Verify)",
  },
  {
    pattern: /google authenticator/i,
    label: "Google Authenticator",
  },
];

const BLOCKED_LINK_HOSTS = new Set(["okta.com", "www.okta.com"]);

/** Convert unknown thrown values into printable message text. */
function asErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Snapshot page locations for timeout diagnostics and fallback hints. */
function summarizePageLocations(pages: Page[]): string {
  const locations: string[] = [];
  for (const page of pages) {
    try {
      const url = new URL(page.url());
      locations.push(`${url.origin}${url.pathname}`);
    } catch {
      // skip invalid/intermediate URL
    }
  }

  if (locations.length === 0) {
    return "(no stable page URL)";
  }

  return [...new Set(locations)].join(", ");
}

type InteractionScope = Page | Frame;

interface ScopeRef {
  page: Page;
  scope: InteractionScope;
}

interface DetectedMfaOption {
  scopeRef: ScopeRef;
  control: Locator;
  label: string;
  recommended: boolean;
}

interface GuidedSsoRuntimeState {
  usernameSubmitted: boolean;
  passwordSubmitted: boolean;
  sawUsernameField: boolean;
  sawPasswordField: boolean;
  ssoEntryClicked: boolean;
  mfaWaitNotified: boolean;
  sawOktaVerifyChallenge: boolean;
  mfaSelectionDone: boolean;
  mfaSelectionPrompted: boolean;
  selectedMfaMethodLabel?: string;
  expectsMfaCode: boolean;
  mfaCodePrompted: boolean;
  mfaCodeSubmitted: boolean;
  pendingMfaCode?: string;
  lastMfaChallengeNumbersKey?: string;
}

// Candidate nodes that often contain Okta number-challenge UI digits.
const MFA_CHALLENGE_NUMBER_SELECTORS = [
  '[data-se*="number-challenge"]',
  '[data-se*="numberChallenge"]',
  '[data-se*="challenge-number"]',
  '[data-se*="factor-number"]',
  '[data-se*="okta-verify-number"]',
  '[class*="number-challenge"]',
  '[id*="number-challenge"]',
  '[class*="challenge-number"]',
  '[id*="challenge-number"]',
].join(", ");

// Text signal used to decide whether nearby numbers are MFA challenge values.
const MFA_CHALLENGE_TEXT_SIGNAL =
  /number challenge|following number|enter the number|tap the number|okta verify|approve sign in|push notification/i;
const MFA_CHALLENGE_NUMBER_TOKEN = /\b\d{1,3}\b/g;

// MFA code input selectors for Google Authenticator / Okta Verify "enter code" flows.
const MFA_CODE_INPUT_SELECTORS = [
  'input[name="answer"]',
  'input[name="credentials.passcode"]',
  'input[name="passCode"]',
  'input[name="otp"]',
  'input[name="code"]',
  'input[name="verificationCode"]',
  'input[autocomplete="one-time-code"]',
  'input[inputmode="numeric"]',
];

const MFA_CODE_SUBMIT_LABELS = [
  "verify",
  "submit",
  "continue",
  "next",
  "sign in",
  "log in",
];

/** Identify MFA methods that require user-entered one-time code instead of push/number approval. */
function isCodeBasedMfaLabel(label: string): boolean {
  return /google authenticator|enter a code|passcode|one[- ]time/i.test(label);
}

/** Collect main page plus all child frames for resilient selector scanning. */
function collectScopes(page: Page): ScopeRef[] {
  const refs: ScopeRef[] = [{ page, scope: page }];
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) {
      continue;
    }
    refs.push({ page, scope: frame });
  }
  return refs;
}

/** True when selector exists and is visibly interactable in a given scope. */
async function canUseSelector(
  scope: InteractionScope,
  selector: string,
): Promise<boolean> {
  const locator = scope.locator(selector).first();
  try {
    const count = await locator.count();
    if (count === 0) {
      return false;
    }
    return await locator.isVisible({ timeout: 500 });
  } catch {
    return false;
  }
}

/** Fill the first visible field among selector candidates. */
async function fillFirstVisible(
  scopes: ScopeRef[],
  selectors: string[],
  value: string,
): Promise<boolean> {
  for (const selector of selectors) {
    for (const scopeRef of scopes) {
      if (!(await canUseSelector(scopeRef.scope, selector))) {
        continue;
      }
      await scopeRef.scope.locator(selector).first().fill(value);
      return true;
    }
  }
  return false;
}

/** Click button/link controls by likely action labels (next/continue/sign in). */
async function clickLikelyActionControl(
  scopes: ScopeRef[],
  labels: string[],
): Promise<boolean> {
  for (const label of labels) {
    const matcher = new RegExp(label, "i");
    for (const scopeRef of scopes) {
      for (const role of ["button", "link"] as const) {
        const controls = scopeRef.scope.getByRole(role, { name: matcher });
        const count = await controls.count();
        for (let index = 0; index < count; index += 1) {
          const control = controls.nth(index);
          try {
            if (!(await control.isVisible({ timeout: 300 }))) {
              continue;
            }

            if (role === "link") {
              const href = await control.getAttribute("href");
              const currentUrl = scopeRef.page.url();
              if (!isSafeActionLink(currentUrl, href)) {
                continue;
              }
            }

            await control.click();
            return true;
          } catch {
            // continue scanning
          }
        }
      }
    }
  }
  return false;
}

/** Guard link clicks to avoid navigation into unrelated marketing/support pages. */
function isSafeActionLink(currentUrl: string, href: string | null): boolean {
  if (!href) {
    return false;
  }

  try {
    const current = new URL(currentUrl);
    const target = new URL(href, current);
    const host = target.hostname.toLowerCase();

    if (BLOCKED_LINK_HOSTS.has(host)) {
      return false;
    }

    if (host === current.hostname.toLowerCase()) {
      return true;
    }

    if (host.endsWith(".okta.com")) {
      return true;
    }

    if (host.endsWith(".microsoftonline.com")) {
      return true;
    }

    if (host.includes("monash")) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

/** Click first visible selector match across all scopes. */
async function clickFirstVisible(
  scopes: ScopeRef[],
  selectors: string[],
): Promise<boolean> {
  for (const selector of selectors) {
    for (const scopeRef of scopes) {
      if (!(await canUseSelector(scopeRef.scope, selector))) {
        continue;
      }

      const control = scopeRef.scope.locator(selector).first();
      if (selector.startsWith("a[")) {
        try {
          const href = await control.getAttribute("href");
          if (!isSafeActionLink(scopeRef.page.url(), href)) {
            continue;
          }
        } catch {
          continue;
        }
      }

      await control.click();
      return true;
    }
  }
  return false;
}

/** Detect text signals (captcha, mfa prompts, etc.) across page/frame scopes. */
async function hasTextSignal(
  scopes: ScopeRef[],
  pattern: RegExp,
): Promise<boolean> {
  for (const scopeRef of scopes) {
    try {
      const node = scopeRef.scope.getByText(pattern).first();
      if (await node.isVisible({ timeout: 150 })) {
        return true;
      }
    } catch {
      // continue
    }
  }
  return false;
}

/** Detect captcha interstitials that require immediate fallback to manual flow. */
async function detectSsoCaptcha(scopes: ScopeRef[]): Promise<boolean> {
  return (
    (await hasTextSignal(
      scopes,
      /captcha|prove you are human|i am human|recaptcha/i,
    )) ||
    (await canUseSelectorInScopes(
      scopes,
      'iframe[src*="recaptcha"], div.g-recaptcha',
    ))
  );
}

/** Detect MFA methods intentionally unsupported in v1 guided automation. */
async function detectUnsupportedMfa(scopes: ScopeRef[]): Promise<boolean> {
  if (await hasTextSignal(scopes, /security key|webauthn|passkey/i)) {
    return true;
  }
  if (
    await canUseSelectorInScopes(
      scopes,
      [
        '[data-se*="webauthn"]',
        '[data-se*="security_key"]',
        '[data-se*="sms"]',
        '[data-se*="email"]',
      ].join(", "),
    )
  ) {
    return true;
  }
  if (
    await hasTextSignal(
      scopes,
      /use a security key|verify with sms|verification code via sms/i,
    )
  ) {
    return true;
  }
  return false;
}

/** Detect Okta Verify push/number challenge surfaces. */
async function detectOktaVerifyChallenge(scopes: ScopeRef[]): Promise<boolean> {
  return (
    (await hasTextSignal(
      scopes,
      /okta verify|check your okta verify app|number challenge/i,
    )) ||
    (await canUseSelectorInScopes(
      scopes,
      '[data-se*="okta_verify"], [data-se*="factor-push"], [data-se*="factor-number"]',
    ))
  );
}

/** Deduplicate values while preserving first-seen ordering. */
function uniqueInOrder(values: string[]): string[] {
  const unique = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (unique.has(value)) {
      continue;
    }
    unique.add(value);
    out.push(value);
  }
  return out;
}

/** Extract candidate short numeric tokens from free-form challenge text. */
function extractNumberTokens(text: string): string[] {
  const matches = text.match(MFA_CHALLENGE_NUMBER_TOKEN);
  if (!matches) {
    return [];
  }
  return matches;
}

/** Detect whether a text fragment looks like MFA number-challenge instructions. */
function hasMfaChallengeSignal(text: string): boolean {
  return MFA_CHALLENGE_TEXT_SIGNAL.test(text);
}

/** Parse 1-3 challenge numbers from mixed MFA text blocks. */
export function extractMfaNumberChallengeFromText(text: string): string[] {
  if (!text.trim()) {
    return [];
  }

  const normalized = text.replace(/\r/g, "\n");
  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const found: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (hasMfaChallengeSignal(line)) {
      found.push(...extractNumberTokens(line));
      for (let offset = 1; offset <= 3; offset += 1) {
        const nextLine = lines[index + offset];
        if (!nextLine) {
          break;
        }
        const nextLineTokens = extractNumberTokens(nextLine);
        if (/^\d{1,3}$/.test(nextLine) || nextLineTokens.length >= 2) {
          found.push(...nextLineTokens);
        }
      }
      continue;
    }

    if (!/^\d{1,3}$/.test(line)) {
      continue;
    }

    const previous = lines[index - 1] ?? "";
    const next = lines[index + 1] ?? "";
    if (hasMfaChallengeSignal(previous) || hasMfaChallengeSignal(next)) {
      found.push(line);
    }
  }

  if (found.length === 0 && hasMfaChallengeSignal(normalized)) {
    found.push(...extractNumberTokens(normalized));
  }

  return uniqueInOrder(found).slice(0, 3);
}

/** Aggregate challenge numbers from body text plus likely challenge DOM nodes. */
async function extractMfaNumberChallenge(
  scopes: ScopeRef[],
): Promise<string[]> {
  const textCandidates: string[] = [];

  for (const scopeRef of scopes) {
    try {
      const body = scopeRef.scope.locator("body").first();
      if ((await body.count()) > 0) {
        const bodyText = await body.innerText({ timeout: 150 });
        if (bodyText.trim()) {
          textCandidates.push(bodyText);
        }
      }
    } catch {
      // ignore inaccessible body content
    }

    try {
      const challengeNodes = scopeRef.scope.locator(
        MFA_CHALLENGE_NUMBER_SELECTORS,
      );
      const count = Math.min(await challengeNodes.count(), 12);
      for (let index = 0; index < count; index += 1) {
        const node = challengeNodes.nth(index);
        try {
          if (!(await node.isVisible({ timeout: 75 }))) {
            continue;
          }
          const text = (await node.innerText({ timeout: 75 })).trim();
          if (text) {
            textCandidates.push(text);
          }
        } catch {
          // skip individual inaccessible node
        }
      }
    } catch {
      // ignore selector errors
    }
  }

  const collected: string[] = [];
  for (const text of textCandidates) {
    collected.push(...extractMfaNumberChallengeFromText(text));
  }

  return uniqueInOrder(collected).slice(0, 3);
}

/** Scope-aware selector existence check. */
async function canUseSelectorInScopes(
  scopes: ScopeRef[],
  selector: string,
): Promise<boolean> {
  for (const scopeRef of scopes) {
    if (await canUseSelector(scopeRef.scope, selector)) {
      return true;
    }
  }
  return false;
}

/** True when any selector in a set can be used in any active scope. */
async function hasAnySelectorInScopes(
  scopes: ScopeRef[],
  selectors: string[],
): Promise<boolean> {
  for (const selector of selectors) {
    if (await canUseSelectorInScopes(scopes, selector)) {
      return true;
    }
  }
  return false;
}

/** Normalize noisy MFA labels into stable user-facing option text. */
function normalizeMfaLabel(raw: string): string {
  const compact = raw.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "";
  }

  const pushMatch = compact.match(/get a push notification/i);
  if (pushMatch) {
    return "Get a push notification (Okta Verify)";
  }

  const codeMatch = compact.match(/enter a code/i);
  if (codeMatch) {
    return "Enter a code (Okta Verify)";
  }

  const gaMatch = compact.match(/google authenticator/i);
  if (gaMatch) {
    return "Google Authenticator";
  }

  return compact
    .replace(MFA_OPTION_LABEL_CLEANUP, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Escape user-facing strings for dynamic RegExp construction. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Extract best-effort MFA option label from control and nearby container text. */
async function extractMfaOptionLabel(control: Locator): Promise<string> {
  try {
    const label = await control.evaluate((element) => {
      const pickByPattern = (text: string): string => {
        const patterns = [
          /get a push notification(?:\s+okta verify)?/i,
          /enter a code(?:\s+okta verify)?/i,
          /google authenticator/i,
        ];
        for (const pattern of patterns) {
          const match = text.match(pattern);
          if (match?.[0]) {
            return match[0];
          }
        }
        return "";
      };

      let node: HTMLElement | null = element as HTMLElement;
      let best = "";
      let depth = 0;
      while (node && depth < 8) {
        const text = (node.innerText || "").replace(/\s+/g, " ").trim();
        const patterned = pickByPattern(text);
        if (patterned) {
          return patterned;
        }
        if (text.length > best.length && text.length <= 400) {
          best = text;
        }
        node = node.parentElement;
        depth += 1;
      }
      return best;
    });
    return normalizeMfaLabel(label);
  } catch {
    return "";
  }
}

/** Collect controls that appear to perform MFA method selection ("Select"). */
async function collectSelectControls(scopeRef: ScopeRef): Promise<Locator[]> {
  const controls: Locator[] = [];

  const roleButtons = scopeRef.scope.getByRole("button", {
    name: MFA_SELECT_BUTTON_LABEL,
  });
  const roleButtonCount = await roleButtons.count();
  for (let index = 0; index < roleButtonCount; index += 1) {
    controls.push(roleButtons.nth(index));
  }

  const roleLinks = scopeRef.scope.getByRole("link", {
    name: MFA_SELECT_BUTTON_LABEL,
  });
  const roleLinkCount = await roleLinks.count();
  for (let index = 0; index < roleLinkCount; index += 1) {
    controls.push(roleLinks.nth(index));
  }

  const inputControls = scopeRef.scope.locator(
    'input[type="submit"], input[type="button"]',
  );
  const inputCount = await inputControls.count();
  for (let index = 0; index < inputCount; index += 1) {
    const control = inputControls.nth(index);
    try {
      const value =
        (await control.inputValue().catch(() => "")) ||
        (await control.getAttribute("value")) ||
        "";
      if (!MFA_SELECT_BUTTON_LABEL.test(value)) {
        continue;
      }
      controls.push(control);
    } catch {
      // ignore inaccessible controls
    }
  }

  return controls;
}

/** Find first enabled/visible action control in an MFA option container row. */
async function findVisibleActionControl(
  container: Locator,
): Promise<Locator | null> {
  const candidates = [
    container.getByRole("button"),
    container.getByRole("link"),
    container.locator(
      'button, a[role="button"], input[type="submit"], input[type="button"]',
    ),
  ];

  for (const group of candidates) {
    const count = Math.min(await group.count(), 10);
    for (let index = 0; index < count; index += 1) {
      const control = group.nth(index);
      try {
        if (!(await control.isVisible({ timeout: 100 }))) {
          continue;
        }
        if ((await control.getAttribute("disabled")) !== null) {
          continue;
        }
        return control;
      } catch {
        // skip inaccessible controls
      }
    }
  }

  return null;
}

/** Count how many known MFA method labels appear in a text block. */
function countKnownMfaMethodMentions(text: string): number {
  let count = 0;
  for (const method of KNOWN_MFA_METHODS) {
    if (method.pattern.test(text)) {
      count += 1;
    }
  }
  return count;
}

/** Discover MFA options by scanning known method labels and adjacent controls. */
async function collectKnownMfaMethodOptions(
  scopes: ScopeRef[],
): Promise<DetectedMfaOption[]> {
  const options: DetectedMfaOption[] = [];

  for (const scopeRef of scopes) {
    for (const method of KNOWN_MFA_METHODS) {
      const matches = scopeRef.scope.getByText(method.pattern);
      const count = Math.min(await matches.count(), 8);
      for (let index = 0; index < count; index += 1) {
        const matchedNode = matches.nth(index);
        try {
          if (!(await matchedNode.isVisible({ timeout: 100 }))) {
            continue;
          }
        } catch {
          continue;
        }

        const row = matchedNode.locator(
          "xpath=ancestor-or-self::*[self::div or self::li or self::tr or self::section or self::form][1]",
        );

        let rowText = "";
        try {
          rowText = (await row.innerText({ timeout: 100 }))
            .replace(/\s+/g, " ")
            .trim();
        } catch {
          // use matched node if row text is unavailable
        }

        if (rowText && countKnownMfaMethodMentions(rowText) > 1) {
          continue;
        }

        const control = await findVisibleActionControl(row);
        if (!control) {
          continue;
        }

        options.push({
          scopeRef,
          control,
          label: method.label,
          recommended: Boolean(method.recommended),
        });
      }
    }
  }

  return options;
}

/** Discover selectable MFA options via generic "Select" controls + known-label fallback. */
async function collectMfaSelectionOptions(
  scopes: ScopeRef[],
): Promise<DetectedMfaOption[]> {
  const options: DetectedMfaOption[] = [];
  for (const scopeRef of scopes) {
    const controls = await collectSelectControls(scopeRef);
    for (const control of controls) {
      try {
        if (!(await control.isVisible({ timeout: 150 }))) {
          continue;
        }
      } catch {
        continue;
      }

      const label = await extractMfaOptionLabel(control);
      if (!label) {
        continue;
      }

      options.push({
        scopeRef,
        control,
        label,
        recommended: /push notification|okta verify push|push/i.test(label),
      });
    }
  }

  options.push(...(await collectKnownMfaMethodOptions(scopes)));

  const unique = new Map<string, DetectedMfaOption>();
  for (const option of options) {
    const key = option.label.toLowerCase();
    if (!unique.has(key)) {
      unique.set(key, option);
    }
  }
  return [...unique.values()];
}

/** Click a detected MFA option with layered fallback click strategies. */
async function clickDetectedMfaOption(
  option: DetectedMfaOption,
): Promise<boolean> {
  try {
    if (await option.control.isVisible({ timeout: 300 })) {
      await option.control.click({ timeout: 1500, force: true });
      return true;
    }
  } catch {
    // fallback below
  }

  try {
    await option.control.evaluate((element) => {
      (element as HTMLElement).click();
    });
    return true;
  } catch {
    // fallback below
  }

  const coreLabel = option.label.replace(/\s*\(.*?\)\s*$/, "").trim();
  const labelPattern = new RegExp(escapeRegex(coreLabel), "i");
  const row = option.scopeRef.scope
    .locator("div, li, tr, section, form")
    .filter({ hasText: labelPattern })
    .first();

  try {
    const rowButtons = row.getByRole("button", {
      name: MFA_SELECT_BUTTON_LABEL,
    });
    if ((await rowButtons.count()) > 0) {
      await rowButtons.first().click({ timeout: 1500, force: true });
      return true;
    }
  } catch {
    // continue fallback
  }

  try {
    const rowInputs = row.locator('input[type="submit"], input[type="button"]');
    if ((await rowInputs.count()) > 0) {
      await rowInputs.first().click({ timeout: 1500, force: true });
      return true;
    }
  } catch {
    // continue fallback
  }

  return false;
}

/** Detect MFA choices, ask CLI callback for selection, then click chosen option. */
async function maybeHandleMfaMethodSelection(
  scopes: ScopeRef[],
  state: GuidedSsoRuntimeState,
  chooseMfaMethod:
    | ((options: MfaMethodOption[]) => Promise<number | null | undefined>)
    | undefined,
  onStep?: (step: SsoStep) => void,
): Promise<boolean> {
  if (state.mfaSelectionDone) {
    return false;
  }

  const detectedOptions = await collectMfaSelectionOptions(scopes);
  if (detectedOptions.length === 0) {
    return false;
  }

  onStep?.("mfa_select");

  const presentedOptions: MfaMethodOption[] = detectedOptions.map(
    (option, index) => ({
      id: index + 1,
      label: option.label,
      recommended: option.recommended,
    }),
  );

  const defaultOption =
    presentedOptions.find((item) => item.recommended) ?? presentedOptions[0];
  if (!defaultOption) {
    return false;
  }
  let selectedId = defaultOption.id;

  if (chooseMfaMethod && !state.mfaSelectionPrompted) {
    state.mfaSelectionPrompted = true;
    try {
      const chosen = await chooseMfaMethod(presentedOptions);
      if (
        typeof chosen === "number" &&
        presentedOptions.some((item) => item.id === chosen)
      ) {
        selectedId = chosen;
      }
    } catch {
      // keep default recommended path
    }
  }

  const selectedOption = detectedOptions[selectedId - 1];
  if (!selectedOption) {
    return false;
  }
  const clicked = await clickDetectedMfaOption(selectedOption);
  if (clicked) {
    state.mfaSelectionDone = true;
    state.selectedMfaMethodLabel = selectedOption.label;
    state.expectsMfaCode = isCodeBasedMfaLabel(selectedOption.label);
    return true;
  }

  return false;
}

/** Handle MFA code-entry methods by prompting user for OTP and submitting verification form. */
async function maybeHandleMfaCodeEntry(
  scopes: ScopeRef[],
  state: GuidedSsoRuntimeState,
  requestMfaCode:
    | ((methodLabel: string) => Promise<string | null | undefined>)
    | undefined,
  onStep?: (step: SsoStep) => void,
): Promise<boolean> {
  if (!state.expectsMfaCode || state.mfaCodeSubmitted) {
    return false;
  }

  const hasCodeField = await hasAnySelectorInScopes(
    scopes,
    MFA_CODE_INPUT_SELECTORS,
  );
  if (!hasCodeField) {
    return false;
  }

  onStep?.("mfa_code");

  if (!requestMfaCode) {
    throw new SsoFallbackError(
      "unsupported_mfa",
      "fallback",
      `Selected MFA method "${state.selectedMfaMethodLabel || "code"}" requires code entry, but no code prompt callback was provided.`,
    );
  }

  if (!state.mfaCodePrompted) {
    state.mfaCodePrompted = true;
    const input = await requestMfaCode(
      state.selectedMfaMethodLabel || "Verification code",
    );
    const code = input?.trim() ?? "";
    if (!code) {
      throw new SsoFallbackError(
        "unsupported_mfa",
        "fallback",
        `No code entered for MFA method "${state.selectedMfaMethodLabel || "code"}".`,
      );
    }
    state.pendingMfaCode = code;
  }

  const codeToSubmit = state.pendingMfaCode?.trim() ?? "";
  if (!codeToSubmit) {
    return false;
  }

  const codeFilled = await fillMfaCodeInputs(scopes, codeToSubmit);
  if (!codeFilled) {
    return false;
  }
  await submitAfterFieldFill(scopes, MFA_CODE_SUBMIT_LABELS);
  state.mfaCodeSubmitted = true;
  return true;
}

/** Fill OTP code in either segmented 1-digit inputs or a single MFA code field. */
async function fillMfaCodeInputs(
  scopes: ScopeRef[],
  code: string,
): Promise<boolean> {
  const compactCode = code.replace(/\s+/g, "");
  const segmentedSelector = [
    'input[inputmode="numeric"][maxlength="1"]',
    'input[type="tel"][maxlength="1"]',
    'input[name*="code"][maxlength="1"]',
    'input[id*="code"][maxlength="1"]',
  ].join(", ");

  for (const scopeRef of scopes) {
    const segmented = scopeRef.scope.locator(segmentedSelector);
    const count = Math.min(await segmented.count(), 12);
    if (count < 4) {
      continue;
    }
    try {
      if (!(await segmented.first().isVisible({ timeout: 150 }))) {
        continue;
      }
      const digits = [...compactCode];
      const max = Math.min(count, digits.length);
      for (let index = 0; index < max; index += 1) {
        await segmented.nth(index).fill(digits[index]);
      }
      return true;
    } catch {
      // try next scope/strategy
    }
  }

  return fillFirstVisible(scopes, MFA_CODE_INPUT_SELECTORS, compactCode);
}

/** Submit current auth step via selector, label-driven click, or Enter fallback. */
async function submitAfterFieldFill(
  scopes: ScopeRef[],
  labels: string[],
): Promise<boolean> {
  const submittedBySelector = await clickFirstVisible(
    scopes,
    PRIMARY_SUBMIT_SELECTORS,
  );
  if (submittedBySelector) {
    return true;
  }

  const submittedByLabel = await clickLikelyActionControl(scopes, labels);
  if (submittedByLabel) {
    return true;
  }

  const enterTargets = [...PASSWORD_SELECTORS, ...USERNAME_SELECTORS];
  for (const selector of enterTargets) {
    for (const scopeRef of scopes) {
      if (!(await canUseSelector(scopeRef.scope, selector))) {
        continue;
      }
      try {
        await scopeRef.scope.locator(selector).first().press("Enter");
        return true;
      } catch {
        // continue
      }
    }
  }

  return false;
}

/**
 * Execute one guided-SSO progression tick:
 * - enter username/password when fields are visible
 * - handle MFA method selection UI
 * - detect and emit number-challenge updates
 */
async function advanceGuidedSsoOnPage(
  page: Page,
  username: string,
  password: string,
  state: GuidedSsoRuntimeState,
  chooseMfaMethod:
    | ((options: MfaMethodOption[]) => Promise<number | null | undefined>)
    | undefined,
  requestMfaCode:
    | ((methodLabel: string) => Promise<string | null | undefined>)
    | undefined,
  onMfaNumberChallenge: ((numbers: string[]) => void) | undefined,
  onStep?: (step: SsoStep) => void,
): Promise<void> {
  const scopes = collectScopes(page);

  if (!state.ssoEntryClicked) {
    const clickedEntry =
      (await clickFirstVisible(scopes, SSO_ENTRY_SELECTORS)) ||
      (await clickLikelyActionControl(scopes, SSO_ENTRY_LABELS));
    if (clickedEntry) {
      state.ssoEntryClicked = true;
      try {
        await page.waitForLoadState("domcontentloaded", { timeout: 4000 });
      } catch {
        // continue with current state
      }
      return;
    }
  }

  if (!state.usernameSubmitted) {
    const hasUsernameField = await hasAnySelectorInScopes(
      scopes,
      USERNAME_SELECTORS,
    );
    if (hasUsernameField) {
      state.sawUsernameField = true;
    }

    const usernameFilled = await fillFirstVisible(
      scopes,
      USERNAME_SELECTORS,
      username,
    );
    if (usernameFilled) {
      onStep?.("username");
      state.usernameSubmitted = await submitAfterFieldFill(
        scopes,
        USERNAME_CONTINUE_LABELS,
      );
      if (!state.usernameSubmitted) {
        state.usernameSubmitted = true;
      }
    }
  }

  if (!state.passwordSubmitted) {
    const hasPasswordField = await hasAnySelectorInScopes(
      scopes,
      PASSWORD_SELECTORS,
    );
    if (hasPasswordField) {
      state.sawPasswordField = true;
    }

    const passwordFilled = await fillFirstVisible(
      scopes,
      PASSWORD_SELECTORS,
      password,
    );
    if (passwordFilled) {
      onStep?.("password");
      state.passwordSubmitted = await submitAfterFieldFill(
        scopes,
        PASSWORD_SUBMIT_LABELS,
      );
      if (!state.passwordSubmitted) {
        state.passwordSubmitted = true;
      }
    }
  }

  if (!state.mfaWaitNotified) {
    const handledSelection = await maybeHandleMfaMethodSelection(
      scopes,
      state,
      chooseMfaMethod,
      onStep,
    );
    if (handledSelection) {
      try {
        await page.waitForLoadState("domcontentloaded", { timeout: 2000 });
      } catch {
        // keep polling
      }
      return;
    }
  }

  if (state.expectsMfaCode && !state.mfaCodeSubmitted) {
    const submittedMfaCode = await maybeHandleMfaCodeEntry(
      scopes,
      state,
      requestMfaCode,
      onStep,
    );
    if (submittedMfaCode) {
      try {
        await page.waitForLoadState("domcontentloaded", { timeout: 2000 });
      } catch {
        // keep polling
      }
      return;
    }
  }

  if (!state.expectsMfaCode) {
    const sawChallenge = await detectOktaVerifyChallenge(scopes);
    if (sawChallenge) {
      state.sawOktaVerifyChallenge = true;
    }

    if (state.sawOktaVerifyChallenge) {
      const numbers = await extractMfaNumberChallenge(scopes);
      if (numbers.length > 0) {
        const key = numbers.join("|");
        if (key !== state.lastMfaChallengeNumbersKey) {
          state.lastMfaChallengeNumbersKey = key;
          onMfaNumberChallenge?.(numbers);
        }
      }

      if (!state.mfaWaitNotified) {
        state.mfaWaitNotified = true;
        onStep?.("mfa_wait");
        return;
      }
    }
  }

  if (state.usernameSubmitted || state.passwordSubmitted) {
    try {
      await page.waitForLoadState("domcontentloaded", { timeout: 2000 });
    } catch {
      // keep polling
    }
  }
}

/** Launch playwright chromium with best-available executable resolution. */
async function launchBrowserForCapture(options: {
  headless: boolean;
  browserAdapter?: BrowserLaunchAdapter;
}): Promise<{
  browser: Pick<Browser, "newContext" | "close">;
  plan: BrowserLaunchPlan;
}> {
  const plan = resolveBrowserLaunchPlan();
  const launchArgs =
    plan.executablePath !== undefined
      ? {
          headless: options.headless,
          executablePath: plan.executablePath,
        }
      : {
          headless: options.headless,
        };

  try {
    if (options.browserAdapter) {
      return {
        browser: await options.browserAdapter.launch(launchArgs),
        plan,
      };
    }

    let playwrightModule: typeof import("playwright-core");
    try {
      playwrightModule = await import("playwright-core");
    } catch {
      throw new SsoFallbackError(
        "browser_unavailable",
        "fallback",
        'Auto login requires dependency "playwright-core". Install the CLI with dependencies and retry.',
      );
    }
    const browser = await playwrightModule.chromium.launch(launchArgs);
    return {
      browser,
      plan,
    };
  } catch (error) {
    const detail = asErrorMessage(error);

    if (isMissingDisplayServerError(detail)) {
      throw new SsoFallbackError(
        "browser_unavailable",
        "fallback",
        "No display server found ($DISPLAY). Use default headless mode, or run with xvfb-run if you need --show-browser.",
      );
    }

    if (isMissingSharedLibraryError(detail)) {
      throw new SsoFallbackError(
        "browser_unavailable",
        "fallback",
        "Browser dependencies are missing. Install the required OS libraries through your system package manager, then retry.",
      );
    }

    if (plan.source === "bundled") {
      throw new SsoFallbackError(
        "browser_unavailable",
        "fallback",
        `${browserInstallHint()} (${detail})`,
      );
    }

    throw new SsoFallbackError(
      "browser_unavailable",
      "fallback",
      `Unable to launch browser at "${plan.executablePath}": ${detail}`,
    );
  }
}

/**
 * Core capture loop:
 * - optionally drives guided SSO interactions
 * - observes pages/requests/responses for credentials
 * - falls back with typed errors when flow cannot be automated
 */
async function captureSsoCredentialsInternal(
  options: AutoLoginOptions,
  guidedLogin?: {
    username: string;
    password: string;
    onStep?: (step: SsoStep) => void;
    chooseMfaMethod?: (
      options: MfaMethodOption[],
    ) => Promise<number | null | undefined>;
    requestMfaCode?: (
      methodLabel: string,
    ) => Promise<string | null | undefined>;
    onMfaNumberChallenge?: (numbers: string[]) => void;
  },
): Promise<LoginCredentials> {
  const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;

  // Browser launch plan supports env override, system browser, then bundled Chromium.
  const launch = await launchBrowserForCapture({
    headless: options.headless ?? false,
    browserAdapter: options.browserAdapter,
  });
  const browser = launch.browser;

  const targetOrigin = new URL(options.apiBaseUrl).origin;
  // Isolated context loads only sanitized, OnTrack-only persisted state when available.
  const context = await browser.newContext(
    buildContextOptionsWithStoredSession({ targetOrigin }),
  );
  const page = await context.newPage();
  const seenPages = new Set<Page>();
  let captured: LoginCredentials | null = null;

  const setCaptured = (value: LoginCredentials | null): void => {
    // Capture first valid credential source and ignore later duplicates.
    if (!captured && value) {
      captured = value;
    }
  };

  const registerPage = (currentPage: Page): void => {
    if (seenPages.has(currentPage)) {
      return;
    }
    seenPages.add(currentPage);

    // Immediate URL check covers flows where auth token appears in address bar.
    setCaptured(extractCredentialsFromUrl(currentPage.url(), targetOrigin));

    currentPage.on("framenavigated", () => {
      // Re-check URL after every navigation in case redirect carries token.
      setCaptured(extractCredentialsFromUrl(currentPage.url(), targetOrigin));
    });

    currentPage.on("request", (...args: unknown[]) => {
      const request = args[0] as {
        method: () => string;
        url: () => string;
        postData: () => string | null;
      };

      if (request.method() !== "POST") {
        return;
      }
      if (!isTargetOnTrackAuthUrl(request.url(), targetOrigin)) {
        return;
      }

      const payload = request.postData();
      if (!payload) {
        return;
      }
      const parsed = tryParseJson(payload);
      const maybe = extractCredentialsFromAuthPayload(parsed);
      setCaptured(maybe);
    });

    currentPage.on("response", (...args: unknown[]) => {
      void (async () => {
        if (captured) {
          return;
        }

        const response = args[0] as {
          url: () => string;
          status: () => number;
          json: () => Promise<unknown>;
        };
        if (
          !isTargetOnTrackAuthUrl(response.url(), targetOrigin) ||
          response.status() >= 400
        ) {
          return;
        }

        try {
          const body = await response.json();
          const parsed = extractCredentialsFromAuthPayload(body);
          if (parsed) {
            const contract = new URL(response.url()).pathname.endsWith(
              "/api/auth/access-token",
            )
              ? "access-token"
              : "legacy-auth";
            setCaptured({
              ...parsed,
              source: "auth_response",
              contract,
            });
          }
        } catch {
          // ignore non-json responses
        }
      })();
    });
  };

  registerPage(page);
  context.on("page", (newPage: Page) => registerPage(newPage));

  try {
    await page.goto(options.ssoUrl, { waitUntil: "domcontentloaded" });
    const start = Date.now();
    let sawOktaVerifyChallenge = false;
    const guidedState: GuidedSsoRuntimeState | null = guidedLogin
      ? {
          usernameSubmitted: false,
          passwordSubmitted: false,
          sawUsernameField: false,
          sawPasswordField: false,
          ssoEntryClicked: false,
          mfaWaitNotified: false,
          sawOktaVerifyChallenge: false,
          mfaSelectionDone: false,
          mfaSelectionPrompted: false,
          selectedMfaMethodLabel: undefined,
          expectsMfaCode: false,
          mfaCodePrompted: false,
          mfaCodeSubmitted: false,
          pendingMfaCode: undefined,
          lastMfaChallengeNumbersKey: undefined,
        }
      : null;

    while (!captured && Date.now() - start < timeoutMs) {
      for (const openPage of context.pages()) {
        if (captured) {
          break;
        }

        const scopes = collectScopes(openPage);

        if (guidedLogin && guidedState) {
          // Guided mode actively interacts with fields/buttons every polling cycle.
          await advanceGuidedSsoOnPage(
            openPage,
            guidedLogin.username,
            guidedLogin.password,
            guidedState,
            guidedLogin.chooseMfaMethod,
            guidedLogin.requestMfaCode,
            guidedLogin.onMfaNumberChallenge,
            guidedLogin.onStep,
          );
        }

        if (await detectSsoCaptcha(scopes)) {
          throw new SsoFallbackError(
            "captcha",
            "fallback",
            "SSO page requested CAPTCHA verification, which is not supported in automated mode.",
          );
        }

        if (await detectUnsupportedMfa(scopes)) {
          throw new SsoFallbackError(
            "unsupported_mfa",
            "fallback",
            "Detected an unsupported MFA challenge. Supported methods are Okta Verify push/number and code-entry methods (Okta Verify code / Google Authenticator).",
          );
        }

        if (await detectOktaVerifyChallenge(scopes)) {
          sawOktaVerifyChallenge = true;
          if (guidedState) {
            guidedState.sawOktaVerifyChallenge = true;
          }
        }

        setCaptured(extractCredentialsFromUrl(openPage.url(), targetOrigin));
        if (captured) {
          break;
        }

        try {
          const pageOrigin = new URL(openPage.url()).origin;
          if (pageOrigin === targetOrigin) {
            // Some flows only expose credentials in localStorage after landing on origin.
            setCaptured(await extractCredentialsFromLocalStorage(openPage));
          }
        } catch {
          // ignore invalid/intermediate URLs
        }
      }

      if (captured) {
        break;
      }

      const cookies = await context.cookies();
      // Cookie extraction is final in-loop fallback before next polling tick.
      setCaptured(extractCredentialsFromCookieJar(cookies, targetOrigin));

      if (captured) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    if (!captured) {
      if (guidedLogin) {
        const pageSnapshot = summarizePageLocations(context.pages());
        if (
          guidedState &&
          !guidedState.sawUsernameField &&
          !guidedState.sawPasswordField
        ) {
          throw new SsoFallbackError(
            "selector_missing",
            "username",
            `Unable to locate Monash SSO username/password fields after redirects. Seen pages: ${pageSnapshot}. Run with --show-browser and retry.`,
          );
        }
        throw new SsoFallbackError(
          "timeout",
          "fallback",
          sawOktaVerifyChallenge
            ? "Timed out waiting for Okta Verify approval. Please approve in the app and retry."
            : `Timed out waiting for SSO completion after submitting credentials. Seen pages: ${pageSnapshot}`,
        );
      }
      throw new Error(
        "Timed out waiting for SSO credentials. You can retry with --auto or use manual redirect URL paste.",
      );
    }
    // Best-effort persistence: retain only OnTrack cookies/localStorage for next login reuse.
    try {
      await saveBrowserSessionState(context, { targetOrigin });
    } catch {
      // non-fatal: login should still succeed even if state persistence is blocked
    }
  } finally {
    await browser.close();
  }

  return captured;
}

/**
 * Fast-path capture from persisted browser session state only.
 * Returns null when no reusable session is found, so caller can continue normal login flow.
 */
export async function captureCredentialsFromStoredBrowserSession(
  options: AutoLoginOptions,
): Promise<LoginCredentials | null> {
  const timeoutMs = Math.max(0, options.timeoutMs ?? 12_000);
  const deadline = Date.now() + timeoutMs;
  const fromStoredState = await captureCredentialsFromPersistedStateFile(
    options,
    Math.max(0, deadline - Date.now()),
  );
  if (fromStoredState) {
    return fromStoredState;
  }

  const profileReuseEnabled =
    options.systemBrowserProfileReuseEnabled?.() ??
    isSystemBrowserProfileReuseEnabled();
  if (!profileReuseEnabled) {
    return null;
  }

  return captureCredentialsFromSystemBrowserProfile(
    options,
    Math.max(0, deadline - Date.now()),
  );
}

/** Common probe routine shared by persisted-state and live-profile session reuse paths. */
async function probeCredentialsInOpenContext(
  context: Pick<BrowserContext, "cookies">,
  page: Page,
  options: AutoLoginOptions,
  timeoutMs: number,
): Promise<LoginCredentials | null> {
  const targetOrigin = new URL(options.apiBaseUrl).origin;
  const deadline = Date.now() + timeoutMs;
  let capturedFromRequestHeaders: LoginCredentials | null = null;

  page.on("request", (...args: unknown[]) => {
    if (capturedFromRequestHeaders) {
      return;
    }
    const request = args[0] as {
      headers: () => Record<string, string>;
      url: () => string;
    };
    if (!isTargetOnTrackAuthUrl(request.url(), targetOrigin)) {
      return;
    }
    const maybe = extractCredentialsFromRequestHeaders(request.headers());
    if (maybe) {
      capturedFromRequestHeaders = maybe;
    }
  });

  const checkCaptured = async (): Promise<LoginCredentials | null> => {
    if (capturedFromRequestHeaders) {
      return capturedFromRequestHeaders;
    }

    const fromUrl = extractCredentialsFromUrl(page.url(), targetOrigin);
    if (fromUrl) {
      return fromUrl;
    }

    try {
      const pageOrigin = new URL(page.url()).origin;
      if (pageOrigin === targetOrigin) {
        const fromStorage = await extractCredentialsFromLocalStorage(page);
        if (fromStorage) {
          return fromStorage;
        }
      }
    } catch {
      // ignore unstable intermediate URLs
    }

    return extractCredentialsFromCookieJar(
      await context.cookies(),
      targetOrigin,
    );
  };

  const candidates = [`${targetOrigin}/home`, options.ssoUrl];
  for (const candidate of candidates) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      break;
    }
    try {
      await page.goto(candidate, {
        waitUntil: "domcontentloaded",
        timeout: Math.min(remaining, 8_000),
      });
    } catch {
      // Continue probing state even if navigation failed; cookies/storage may still be readable.
    }

    const immediate = await checkCaptured();
    if (immediate) {
      return immediate;
    }
  }

  while (Date.now() < deadline) {
    const maybe = await checkCaptured();
    if (maybe) {
      return maybe;
    }
    const remaining = deadline - Date.now();
    if (remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(400, remaining)));
    }
  }

  return null;
}

interface ClaimedBrowserSessionState {
  location: TrustedBrowserSessionStateLocation;
  contextOptions: {
    storageState: BrowserStorageState;
  };
}

/**
 * Restore a validated in-memory generation without overwriting a concurrently
 * published state. Exclusive creation never follows an existing symlink.
 */
function restoreClaimedBrowserSessionState(
  claim: ClaimedBrowserSessionState,
): void {
  writeBrowserSessionStateIfAbsent(
    claim.location,
    claim.contextOptions.storageState,
  );
}

/**
 * Atomically move one persisted state generation out of the shared path before
 * reading it through a no-follow descriptor. The random directory entry is
 * removed before browser launch, leaving only an in-memory validated state.
 */
function claimBrowserSessionState(
  targetOrigin: string,
): ClaimedBrowserSessionState | null {
  const location =
    resolveTrustedExistingBrowserSessionStateLocation(targetOrigin);
  if (!location) {
    return null;
  }
  const claimedPath = join(
    location.stateDirectory,
    `browser-state.json.probe-${randomUUID()}`,
  );
  assertTrustedBrowserSessionStateDirectory(location);
  try {
    renameSync(location.storagePath, claimedPath);
  } catch {
    return null;
  }

  let descriptor: number | undefined;
  let filtered: BrowserStorageState | undefined;
  try {
    assertTrustedBrowserSessionStateDirectory(location);
    const pathMetadata = lstatSync(claimedPath);
    if (!pathMetadata.isFile() || pathMetadata.isSymbolicLink()) {
      throw new Error("Claimed browser state is not a regular file.");
    }
    descriptor = openSync(
      claimedPath,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const descriptorMetadata = fstatSync(descriptor);
    if (
      !descriptorMetadata.isFile() ||
      descriptorMetadata.dev !== pathMetadata.dev ||
      descriptorMetadata.ino !== pathMetadata.ino
    ) {
      throw new Error("Claimed browser state is not a regular file.");
    }
    const parsed = JSON.parse(readFileSync(descriptor, "utf8")) as unknown;
    if (!isBrowserStorageState(parsed)) {
      throw new Error("Claimed browser state is invalid.");
    }
    filtered = filterBrowserSessionState(parsed, targetOrigin);
    if (!hasReusableBrowserSessionState(filtered)) {
      throw new Error("Claimed browser state is empty or expired.");
    }
  } catch {
    filtered = undefined;
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
  }
  try {
    // This locally generated random entry is retired before any browser process
    // starts. Unlinking a raced symlink removes the link, never its target.
    assertTrustedBrowserSessionStateDirectory(location);
    const metadata = lstatSync(claimedPath);
    if (metadata.isSymbolicLink()) {
      rmSync(claimedPath, { force: true });
    } else if (
      !removeBrowserSessionStateEntryIfSame(location, claimedPath, metadata)
    ) {
      throw new Error("Claimed browser state identity changed.");
    }
  } catch {
    throw new Error(
      "Unable to retire claimed browser state before browser launch.",
    );
  }
  if (!filtered) {
    return null;
  }
  return {
    location,
    contextOptions: { storageState: filtered },
  };
}

/**
 * Publish captured browser state only when no concurrent generation already
 * exists. The state is filtered in memory and written through an exclusively
 * created descriptor, so an existing file or symlink is never followed.
 */
async function publishCapturedBrowserSessionState(
  context: {
    storageState: () => Promise<unknown>;
  },
  location: TrustedBrowserSessionStateLocation,
  targetOrigin: string,
): Promise<boolean> {
  const state = await context.storageState();
  const filtered = filterBrowserSessionState(
    isBrowserStorageState(state) ? state : { cookies: [], origins: [] },
    targetOrigin,
  );
  if (!hasReusableBrowserSessionState(filtered)) {
    return false;
  }
  writeBrowserSessionStateIfAbsent(location, filtered);
  return true;
}

/** Probe saved state file created by previous automated logins. */
async function captureCredentialsFromPersistedStateFile(
  options: AutoLoginOptions,
  timeoutMs: number,
): Promise<LoginCredentials | null> {
  const targetOrigin = new URL(options.apiBaseUrl).origin;
  const claim = claimBrowserSessionState(targetOrigin);
  if (!claim) {
    return null;
  }

  let launch: Awaited<ReturnType<typeof launchBrowserForCapture>>;
  try {
    launch = await launchBrowserForCapture({
      headless: options.headless ?? true,
      browserAdapter: options.browserAdapter,
    });
  } catch (error) {
    restoreClaimedBrowserSessionState(claim);
    throw error;
  }
  const browser = launch.browser;

  try {
    let context: BrowserContext;
    let captured: LoginCredentials | null;
    try {
      context = await browser.newContext(claim.contextOptions);
      const page = await context.newPage();
      captured = await probeCredentialsInOpenContext(
        context,
        page,
        options,
        timeoutMs,
      );
    } catch (error) {
      restoreClaimedBrowserSessionState(claim);
      throw error;
    }
    if (!captured) {
      // A state that cannot renew credentials remains retired, while any
      // concurrent replacement at the canonical path stays untouched.
      return null;
    }
    try {
      const published = await publishCapturedBrowserSessionState(
        context,
        claim.location,
        targetOrigin,
      );
      if (!published) {
        restoreClaimedBrowserSessionState(claim);
        return captured;
      }
    } catch {
      // Preserve the in-memory claimed generation when a fresh state cannot publish.
      restoreClaimedBrowserSessionState(claim);
      return captured;
    }
    return captured;
  } finally {
    await browser.close();
  }
}

/** Probe live system browser profile state to reuse already logged-in sessions. */
async function captureCredentialsFromSystemBrowserProfile(
  options: AutoLoginOptions,
  timeoutMs: number,
): Promise<LoginCredentials | null> {
  const profileCandidates = expandSystemBrowserProfileCandidates(
    resolveSystemBrowserUserDataDirs(),
    {
      profileOverride: process.env.ONTRACK_BROWSER_PROFILE_DIR,
    },
  );

  if (profileCandidates.length === 0) {
    return null;
  }

  let playwrightModule: typeof import("playwright-core");
  try {
    playwrightModule = await import("playwright-core");
  } catch {
    return null;
  }

  let launchPlan: BrowserLaunchPlan;
  try {
    launchPlan = resolveBrowserLaunchPlan();
  } catch {
    return null;
  }

  // Live profile probing only makes sense with a concrete system browser executable.
  if (!launchPlan.executablePath) {
    return null;
  }

  const deadline = Date.now() + timeoutMs;
  for (const candidate of profileCandidates) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      break;
    }
    let context: BrowserContext | null = null;
    try {
      context = await playwrightModule.chromium.launchPersistentContext(
        candidate.userDataDir,
        {
          headless: options.headless ?? true,
          executablePath: launchPlan.executablePath,
          args: [`--profile-directory=${candidate.profileDir}`],
        },
      );

      const page = context.pages()[0] ?? (await context.newPage());
      const captured = await probeCredentialsInOpenContext(
        context,
        page,
        options,
        Math.min(remaining, 10_000),
      );
      if (captured) {
        // Never copy a real system browser profile's full storage state into CLI state.
        return captured;
      }
    } catch {
      // Profile can be locked by a running browser or blocked by OS policy; continue next candidate.
    } finally {
      if (context) {
        try {
          await context.close();
        } catch {
          // ignore close failures
        }
      }
    }
  }

  return null;
}

/** Browser-only credential capture (no guided username/password actions). */
export async function captureSsoCredentials(
  options: AutoLoginOptions,
): Promise<LoginCredentials> {
  return captureSsoCredentialsInternal(options);
}

/** Guided credential capture with step callbacks for terminal UX. */
export async function captureSsoCredentialsWithGuidedLogin(
  options: SsoLoginOptions,
  onStep?: (step: SsoStep) => void,
): Promise<LoginCredentials> {
  const credentials = await captureSsoCredentialsInternal(
    {
      ssoUrl: options.ssoUrl,
      apiBaseUrl: options.apiBaseUrl,
      timeoutMs: options.timeoutMs,
      headless: options.headless,
      browserAdapter: options.browserAdapter,
    },
    {
      username: options.username,
      password: options.password,
      onStep,
      chooseMfaMethod: options.chooseMfaMethod,
      requestMfaCode: options.requestMfaCode,
      onMfaNumberChallenge: options.onMfaNumberChallenge,
    },
  );
  onStep?.("completed");
  return credentials;
}
