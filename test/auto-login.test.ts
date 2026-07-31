import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  SsoFallbackError,
  buildContextOptionsWithStoredSession,
  classifySsoFallback,
  clearBrowserSessionState,
  extractMfaNumberChallengeFromText,
  extractCredentialsFromAuthPayload,
  extractCredentialsFromCookieJar,
  extractCredentialsFromStorageEntries,
  extractCredentialsFromUrl,
  expandSystemBrowserProfileCandidates,
  isSystemBrowserProfileReuseEnabled,
  resolveBrowserSessionStatePath,
  resolveBrowserLaunchPlan,
  resolveSystemBrowserUserDataDirs,
  saveBrowserSessionState,
} from "../src/lib/auto-login.js";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("extractCredentialsFromUrl parses authToken and username", () => {
  const parsed = extractCredentialsFromUrl(
    "https://ontrack.infotech.monash.edu/sign_in?authToken=abc123&username=student1",
  );

  assert.deepEqual(parsed, {
    authToken: "abc123",
    username: "student1",
    source: "url",
  });
});

test("extractCredentialsFromUrl returns null when params are missing", () => {
  const parsed = extractCredentialsFromUrl(
    "https://ontrack.infotech.monash.edu/home",
  );
  assert.equal(parsed, null);
});

test("extractCredentialsFromUrl rejects matching query parameters on a non-OnTrack origin", () => {
  const parsed = extractCredentialsFromUrl(
    "https://attacker.example/sign_in?authToken=stolen-token&username=student1",
    "https://ontrack.infotech.monash.edu",
  );

  assert.equal(parsed, null);
});

test("extractCredentialsFromAuthPayload parses request payload", () => {
  const parsed = extractCredentialsFromAuthPayload({
    auth_token: "token-1",
    username: "student1",
    remember: true,
  });

  assert.deepEqual(parsed, {
    authToken: "token-1",
    username: "student1",
    source: "auth_request",
  });
});

test("extractCredentialsFromAuthPayload supports camelCase authToken", () => {
  const parsed = extractCredentialsFromAuthPayload({
    authToken: "token-2",
    username: "student2",
  });

  assert.deepEqual(parsed, {
    authToken: "token-2",
    username: "student2",
    source: "auth_request",
  });
});

test("extractCredentialsFromAuthPayload captures access-token expiry and nested user identity", () => {
  const parsed = extractCredentialsFromAuthPayload({
    auth_token: "refreshed-token",
    auth_token_expiry: "2030-01-01T00:00:00.000Z",
    user: {
      username: "student3",
      role: "Student",
    },
  });

  assert.deepEqual(parsed, {
    authToken: "refreshed-token",
    username: "student3",
    expiresAt: "2030-01-01T00:00:00.000Z",
    source: "auth_request",
  });
});

test("extractCredentialsFromCookieJar parses credentials when both values exist", () => {
  const parsed = extractCredentialsFromCookieJar([
    {
      name: "auth_token",
      value: "cookie-token",
      domain: "ontrack.infotech.monash.edu",
    },
    {
      name: "username",
      value: "cookie-user",
      domain: "ontrack.infotech.monash.edu",
    },
  ]);

  assert.deepEqual(parsed, {
    authToken: "cookie-token",
    username: "cookie-user",
    source: "cookie",
  });
});

test("extractCredentialsFromCookieJar returns null when cookie values are incomplete", () => {
  const parsed = extractCredentialsFromCookieJar([
    {
      name: "auth_token",
      value: "cookie-token",
      domain: "ontrack.infotech.monash.edu",
    },
  ]);
  assert.equal(parsed, null);
});

test("extractCredentialsFromCookieJar rejects same-named cookies outside the target host", () => {
  const parsed = extractCredentialsFromCookieJar(
    [
      {
        name: "auth_token",
        value: "attacker-token",
        domain: "attacker.example",
      },
      { name: "username", value: "attacker-user", domain: "attacker.example" },
    ],
    "https://ontrack.infotech.monash.edu",
  );

  assert.equal(parsed, null);
});

test("extractCredentialsFromStorageEntries parses OnTrack doubtfire token + user keys", () => {
  const parsed = extractCredentialsFromStorageEntries([
    {
      scope: "local",
      key: "doubtfire_credentials_token",
      value: "token-from-storage",
    },
    {
      scope: "local",
      key: "doubtfire_user",
      value: JSON.stringify({
        id: 7,
        username: "student1",
        role: "student",
      }),
    },
    {
      scope: "local",
      key: "remember_doubtfire_credentials_token",
      value: "true",
    },
  ]);

  assert.deepEqual(parsed, {
    authToken: "token-from-storage",
    username: "student1",
    source: "local_storage",
  });
});

test("extractCredentialsFromStorageEntries supports JSON-encoded token string", () => {
  const parsed = extractCredentialsFromStorageEntries([
    {
      scope: "session",
      key: "doubtfire_credentials_token",
      value: JSON.stringify("quoted-token"),
    },
    {
      scope: "session",
      key: "doubtfire_user",
      value: JSON.stringify({
        email: "student2@monash.edu",
      }),
    },
  ]);

  assert.deepEqual(parsed, {
    authToken: "quoted-token",
    username: "student2@monash.edu",
    source: "local_storage",
  });
});

test("resolveBrowserLaunchPlan uses ONTRACK_BROWSER_PATH first", () => {
  const plan = resolveBrowserLaunchPlan(
    { ONTRACK_BROWSER_PATH: "/custom/chrome" } as NodeJS.ProcessEnv,
    (path) => path === "/custom/chrome",
  );

  assert.deepEqual(plan, {
    source: "env",
    executablePath: "/custom/chrome",
  });
});

test("resolveBrowserLaunchPlan falls back to bundled when no browser exists", () => {
  const plan = resolveBrowserLaunchPlan({} as NodeJS.ProcessEnv, () => false);
  assert.equal(plan.source, "bundled");
  assert.equal(plan.executablePath, undefined);
});

test("resolveBrowserLaunchPlan selects system browser when available", () => {
  const plan = resolveBrowserLaunchPlan({} as NodeJS.ProcessEnv, () => true);
  assert.equal(plan.source, "system");
  assert.equal(typeof plan.executablePath, "string");
  assert.equal((plan.executablePath || "").length > 0, true);
});

test("resolveBrowserSessionStatePath uses explicit env override when provided", () => {
  const path = resolveBrowserSessionStatePath(
    {
      ONTRACK_BROWSER_STATE_PATH: "/tmp/custom-browser-state.json",
    } as NodeJS.ProcessEnv,
    "linux",
    "/home/demo",
  );

  assert.equal(path, "/tmp/custom-browser-state.json");
});

test("resolveBrowserSessionStatePath falls back to XDG config root on unix", () => {
  const path = resolveBrowserSessionStatePath(
    {
      XDG_CONFIG_HOME: "/tmp/xdg",
    } as NodeJS.ProcessEnv,
    "linux",
    "/home/demo",
  );

  assert.equal(path, "/tmp/xdg/ontrack-cli/browser-state.json");
});

test("resolveBrowserSessionStatePath uses APPDATA on windows", () => {
  const path = resolveBrowserSessionStatePath(
    {
      APPDATA: "C:\\Users\\mark\\AppData\\Roaming",
    } as NodeJS.ProcessEnv,
    "win32",
    "C:\\Users\\mark",
  );

  assert.equal(
    path,
    "C:\\Users\\mark\\AppData\\Roaming/ontrack-cli/browser-state.json",
  );
});

test("clearBrowserSessionState removes only a valid regular browser-state file", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "ontrack-browser-clear-"));
  const validPath = join(rootPath, "browser-state.json");
  const unrelatedPath = join(rootPath, "notes.txt");
  try {
    await writeFile(
      validPath,
      JSON.stringify({ cookies: [], origins: [] }),
      "utf8",
    );
    clearBrowserSessionState(validPath);
    await assert.rejects(() => stat(validPath), /ENOENT/);

    await writeFile(unrelatedPath, "do not delete", "utf8");
    assert.throws(
      () => clearBrowserSessionState(unrelatedPath),
      /invalid browser-state file/,
    );
    assert.equal(await readFile(unrelatedPath, "utf8"), "do not delete");
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("resolveSystemBrowserUserDataDirs uses env override for user data root", () => {
  const dirs = resolveSystemBrowserUserDataDirs(
    {
      ONTRACK_BROWSER_USER_DATA_DIR: "/profiles/chrome",
      ONTRACK_BROWSER_PROFILE_DIR: "Profile 2",
    } as NodeJS.ProcessEnv,
    "linux",
    "/home/demo",
  );

  assert.deepEqual(dirs, [
    {
      label: "env:ONTRACK_BROWSER_USER_DATA_DIR",
      userDataDir: "/profiles/chrome",
      profileDir: "Profile 2",
    },
  ]);
});

test("resolveSystemBrowserUserDataDirs returns platform defaults on mac", () => {
  const dirs = resolveSystemBrowserUserDataDirs(
    {} as NodeJS.ProcessEnv,
    "darwin",
    "/Users/demo",
  );

  assert.equal(dirs.length > 0, true);
  assert.equal(dirs[0]?.profileDir, "Default");
  assert.equal(
    dirs.some((item) =>
      item.userDataDir.includes(
        "/Users/demo/Library/Application Support/Google/Chrome",
      ),
    ),
    true,
  );
});

test("system browser profile reuse is disabled unless explicitly opted in", () => {
  assert.equal(
    isSystemBrowserProfileReuseEnabled({} as NodeJS.ProcessEnv),
    false,
  );
  assert.equal(
    isSystemBrowserProfileReuseEnabled({
      ONTRACK_ENABLE_SYSTEM_BROWSER_PROFILE: "1",
    } as NodeJS.ProcessEnv),
    true,
  );
});

test("saveBrowserSessionState makes its directory 0700 and state file 0600", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "ontrack-browser-state-"));
  const storagePath = join(tempRoot, "nested", "browser-state.json");

  try {
    await saveBrowserSessionState(
      {
        storageState: async () => ({
          cookies: [
            {
              name: "auth_token",
              value: "ontrack-token",
              domain: "ontrack.infotech.monash.edu",
              path: "/",
              expires: -1,
              httpOnly: false,
              secure: true,
              sameSite: "Lax",
            },
            {
              name: "idp_session",
              value: "must-not-persist",
              domain: "monash.okta.com",
              path: "/",
              expires: -1,
              httpOnly: true,
              secure: true,
              sameSite: "Lax",
            },
          ],
          origins: [
            {
              origin: "https://ontrack.infotech.monash.edu",
              localStorage: [
                { name: "doubtfire_credentials_token", value: "ontrack-token" },
              ],
            },
            {
              origin: "https://monash.okta.com",
              localStorage: [{ name: "idp_token", value: "must-not-persist" }],
            },
          ],
        }),
      },
      { storagePath, targetOrigin: "https://ontrack.infotech.monash.edu" },
    );

    const directoryMode = (await stat(join(tempRoot, "nested"))).mode & 0o777;
    const stateMode = (await stat(storagePath)).mode & 0o777;
    assert.equal(directoryMode, 0o700);
    assert.equal(stateMode, 0o600);
    const persisted = JSON.parse(await readFile(storagePath, "utf8")) as {
      cookies: Array<{ value: string }>;
      origins: Array<{
        origin: string;
        localStorage: Array<{ value: string }>;
      }>;
    };
    assert.deepEqual(persisted.cookies, [
      {
        name: "auth_token",
        value: "ontrack-token",
        domain: "ontrack.infotech.monash.edu",
        path: "/",
        expires: -1,
        httpOnly: false,
        secure: true,
        sameSite: "Lax",
      },
    ]);
    assert.deepEqual(persisted.origins, [
      {
        origin: "https://ontrack.infotech.monash.edu",
        localStorage: [
          { name: "doubtfire_credentials_token", value: "ontrack-token" },
        ],
      },
    ]);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("buildContextOptionsWithStoredSession migrates legacy state and excludes cross-site data", async () => {
  const tempRoot = await mkdtemp(
    join(tmpdir(), "ontrack-legacy-browser-state-"),
  );
  const storagePath = join(tempRoot, "browser-state.json");
  const onTrackCookie = {
    name: "auth_token",
    value: "ontrack-token",
    domain: "ontrack.infotech.monash.edu",
    path: "/",
    expires: -1,
    httpOnly: false,
    secure: true,
    sameSite: "Lax",
  };

  try {
    await writeFile(
      storagePath,
      JSON.stringify({
        cookies: [
          onTrackCookie,
          {
            name: "idp_session",
            value: "must-not-load",
            domain: "monash.okta.com",
            path: "/",
            expires: -1,
            httpOnly: true,
            secure: true,
            sameSite: "Lax",
          },
        ],
        origins: [
          {
            origin: "https://ontrack.infotech.monash.edu",
            localStorage: [
              { name: "doubtfire_credentials_token", value: "ontrack-token" },
            ],
          },
          {
            origin: "https://monash.okta.com",
            localStorage: [{ name: "idp_token", value: "must-not-load" }],
          },
        ],
      }),
      "utf8",
    );

    const contextOptions = buildContextOptionsWithStoredSession({
      storagePath,
      targetOrigin: "https://ontrack.infotech.monash.edu",
    });

    assert.deepEqual(contextOptions, {
      storageState: {
        cookies: [onTrackCookie],
        origins: [
          {
            origin: "https://ontrack.infotech.monash.edu",
            localStorage: [
              { name: "doubtfire_credentials_token", value: "ontrack-token" },
            ],
          },
        ],
      },
    });
    const migrated = await readFile(storagePath, "utf8");
    assert.equal(migrated.includes("must-not-load"), false);
    assert.equal((await stat(storagePath)).mode & 0o777, 0o600);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("buildContextOptionsWithStoredSession rejects invalid persisted JSON", async () => {
  const tempRoot = await mkdtemp(
    join(tmpdir(), "ontrack-invalid-browser-state-"),
  );
  const storagePath = join(tempRoot, "browser-state.json");

  try {
    await writeFile(storagePath, "{not-json", "utf8");
    assert.equal(
      buildContextOptionsWithStoredSession({
        storagePath,
        targetOrigin: "https://ontrack.infotech.monash.edu",
      }),
      undefined,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("expandSystemBrowserProfileCandidates discovers Default and Profile N folders", () => {
  const expanded = expandSystemBrowserProfileCandidates(
    [
      {
        label: "Chrome",
        userDataDir: "/profiles/chrome",
        profileDir: "Default",
      },
    ],
    {
      pathExists: (path) => path === "/profiles/chrome",
      listDirNames: () => [
        "System Profile",
        "Profile 2",
        "Default",
        "Profile 1",
      ],
    },
  );

  assert.deepEqual(expanded, [
    {
      label: "Chrome",
      userDataDir: "/profiles/chrome",
      profileDir: "Default",
    },
    {
      label: "Chrome",
      userDataDir: "/profiles/chrome",
      profileDir: "Profile 1",
    },
    {
      label: "Chrome",
      userDataDir: "/profiles/chrome",
      profileDir: "Profile 2",
    },
  ]);
});

test("expandSystemBrowserProfileCandidates honors explicit profile override", () => {
  const expanded = expandSystemBrowserProfileCandidates(
    [
      {
        label: "Chrome",
        userDataDir: "/profiles/chrome",
        profileDir: "Profile 3",
      },
    ],
    {
      profileOverride: "Profile 3",
      pathExists: (path) =>
        path === "/profiles/chrome" || path === "/profiles/chrome/Profile 3",
      listDirNames: () => ["Default", "Profile 1"],
    },
  );

  assert.deepEqual(expanded, [
    {
      label: "Chrome",
      userDataDir: "/profiles/chrome",
      profileDir: "Profile 3",
    },
  ]);
});

test("classifySsoFallback maps known fallback reasons", () => {
  assert.equal(
    classifySsoFallback(
      new SsoFallbackError("captcha", "fallback", "captcha detected"),
    ),
    "captcha",
  );
  assert.equal(
    classifySsoFallback(new Error("Unsupported MFA: webauthn challenge")),
    "unsupported_mfa",
  );
  assert.equal(
    classifySsoFallback(new Error("Unable to locate username field selector")),
    "selector_missing",
  );
  assert.equal(
    classifySsoFallback(new Error("Timeout waiting for verify")),
    "timeout",
  );
});

test("extractMfaNumberChallengeFromText finds number challenge code", () => {
  const numbers = extractMfaNumberChallengeFromText(`
    Check your Okta Verify app.
    Enter the following number to sign in:
    68
  `);

  assert.deepEqual(numbers, ["68"]);
});

test("extractMfaNumberChallengeFromText supports multi-option number challenge", () => {
  const numbers = extractMfaNumberChallengeFromText(`
    Number challenge
    Select the matching number in Okta Verify
    12 / 35 / 87
  `);

  assert.deepEqual(numbers, ["12", "35", "87"]);
});

test("extractMfaNumberChallengeFromText ignores unrelated numbers", () => {
  const numbers = extractMfaNumberChallengeFromText(`
    Verify it's you with a security method
    Last signed in 2026-03-11
  `);

  assert.deepEqual(numbers, []);
});
