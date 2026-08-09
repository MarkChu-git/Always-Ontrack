import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildContextOptionsWithStoredSession,
  captureCredentialsFromStoredBrowserSession,
  injectRememberIntoAuthExchange,
  persistRefreshCookie,
  readStoredRefreshCookie,
  setBrowserSessionStatePathForTests,
  SsoFallbackError,
} from "../src/lib/auto-login.js";

const SSO_URL = "https://identity.example/sso";
const API_BASE_URL = "https://ontrack.infotech.monash.edu/api";
const TARGET_ORIGIN = "https://ontrack.infotech.monash.edu";
let browserStateEnvironmentTail = Promise.resolve();

function sessionCookie(
  value: string,
  name = "refresh_state",
  expires = -1,
) {
  return {
    name,
    value,
    domain: "ontrack.infotech.monash.edu",
    path: "/",
    expires,
    httpOnly: true,
    secure: true,
    sameSite: "Lax" as const,
  };
}

async function withBrowserState(
  prefix: string,
  run: (storagePath: string) => Promise<void>,
): Promise<void> {
  const previousEnvironmentUser = browserStateEnvironmentTail;
  let releaseEnvironment: (() => void) | undefined;
  browserStateEnvironmentTail = new Promise<void>((resolve) => {
    releaseEnvironment = resolve;
  });
  await previousEnvironmentUser;

  let tempRoot: string | undefined;
  try {
    tempRoot = await mkdtemp(join(homedir(), `.${prefix}`));
    const storagePath = join(tempRoot, "browser-state.json");
    setBrowserSessionStatePathForTests(storagePath);
    await run(storagePath);
  } finally {
    try {
      setBrowserSessionStatePathForTests(undefined);
      if (tempRoot) {
        await rm(tempRoot, { recursive: true, force: true });
      }
    } finally {
      releaseEnvironment?.();
    }
  }
}

function captureOptions(
  browserAdapter: {
    launch: () => Promise<unknown>;
  },
) {
  return {
    ssoUrl: SSO_URL,
    apiBaseUrl: API_BASE_URL,
    timeoutMs: 25,
    headless: true,
    systemBrowserProfileReuseEnabled: () => false,
    browserAdapter: browserAdapter as never,
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

test("buildContextOptionsWithStoredSession does not reuse an empty persisted state", async () => {
  await withBrowserState("ontrack-empty-browser-state-", async (storagePath) => {
    await writeFile(
      storagePath,
      JSON.stringify({ cookies: [], origins: [] }),
      "utf8",
    );
    await chmod(storagePath, 0o640);

    assert.equal(
      buildContextOptionsWithStoredSession({
        storagePath,
        targetOrigin: TARGET_ORIGIN,
      }),
      undefined,
    );
    assert.equal((await stat(storagePath)).mode & 0o777, 0o640);

    await writeFile(
      storagePath,
      JSON.stringify({
        cookies: [],
        origins: [{ origin: TARGET_ORIGIN, localStorage: [] }],
      }),
      "utf8",
    );
    assert.equal(
      buildContextOptionsWithStoredSession({
        storagePath,
        targetOrigin: TARGET_ORIGIN,
      }),
      undefined,
    );
  });
});

test("buildContextOptionsWithStoredSession ignores expired persistent cookies but keeps session cookies", async () => {
  await withBrowserState(
    "ontrack-expired-browser-state-",
    async (storagePath) => {
      await writeFile(
        storagePath,
        JSON.stringify({
          cookies: [sessionCookie("expired", "auth_token", 1)],
          origins: [],
        }),
        "utf8",
      );
      assert.equal(
        buildContextOptionsWithStoredSession({
          storagePath,
          targetOrigin: TARGET_ORIGIN,
        }),
        undefined,
      );

      const retainedCookie = sessionCookie("ontrack-token", "auth_token");
      await writeFile(
        storagePath,
        JSON.stringify({ cookies: [retainedCookie], origins: [] }),
        "utf8",
      );
      assert.deepEqual(
        buildContextOptionsWithStoredSession({
          storagePath,
          targetOrigin: TARGET_ORIGIN,
        }),
        { storageState: { cookies: [retainedCookie], origins: [] } },
      );
    },
  );
});

test("stored browser capture rejects a state symlink that escapes the operator home", async () => {
  if (process.platform === "win32") {
    return;
  }

  const externalRoot = await mkdtemp(
    join(tmpdir(), "ontrack-browser-state-escape-"),
  );
  try {
    const externalStatePath = join(externalRoot, "browser-state.json");
    await writeFile(
      externalStatePath,
      JSON.stringify({
        cookies: [sessionCookie("outside-home")],
        origins: [],
      }),
      "utf8",
    );

    await withBrowserState(
      "ontrack-browser-state-link-",
      async (storagePath) => {
        let browserLaunches = 0;
        await symlink(externalStatePath, storagePath);

        await assert.rejects(
          () =>
            captureCredentialsFromStoredBrowserSession(
              captureOptions({
                launch: async () => {
                  browserLaunches += 1;
                  throw new Error("browser must not launch");
                },
              }),
            ),
          /non-regular browser-state file/,
        );
        assert.equal(browserLaunches, 0);
      },
    );
  } finally {
    await rm(externalRoot, { recursive: true, force: true });
  }
});

test("stored browser capture skips launch for empty state and invalidates a stale state after one bounded probe", async () => {
  await withBrowserState(
    "ontrack-stored-capture-state-",
    async (storagePath) => {
      let browserLaunches = 0;
      let currentUrl = "about:blank";
      const page = {
        on: () => page,
        url: () => currentUrl,
        goto: async (url: string) => {
          currentUrl = url;
          return null;
        },
        evaluate: async () => null,
      };
      const context = {
        newPage: async () => page,
        cookies: async () => [],
        storageState: async () => ({ cookies: [], origins: [] }),
      };
      const browserAdapter = {
        launch: async () => {
          browserLaunches += 1;
          return {
            newContext: async () => context,
            close: async () => undefined,
          };
        },
      };
      const options = captureOptions(browserAdapter);

      await writeFile(
        storagePath,
        JSON.stringify({ cookies: [], origins: [] }),
        "utf8",
      );
      assert.equal(await captureCredentialsFromStoredBrowserSession(options), null);
      assert.equal(browserLaunches, 0);

      await writeFile(
        storagePath,
        JSON.stringify({
          cookies: [sessionCookie("stale")],
          origins: [],
        }),
        "utf8",
      );
      assert.equal(await captureCredentialsFromStoredBrowserSession(options), null);
      assert.equal(browserLaunches, 1);
      await assert.rejects(() => readFile(storagePath, "utf8"), /ENOENT/);

      assert.equal(await captureCredentialsFromStoredBrowserSession(options), null);
      assert.equal(browserLaunches, 1);
    },
  );
});

test("failed stored browser probe never deletes a concurrently refreshed state generation", async () => {
  await withBrowserState(
    "ontrack-concurrent-browser-state-",
    async (storagePath) => {
      const replacement = {
        cookies: [sessionCookie("new-generation")],
        origins: [],
      };
      let replacementWritten = false;
      let currentUrl = "about:blank";
      const page = {
        on: () => page,
        url: () => currentUrl,
        goto: async (url: string) => {
          currentUrl = url;
          if (!replacementWritten) {
            replacementWritten = true;
            await writeFile(storagePath, JSON.stringify(replacement), "utf8");
          }
          return null;
        },
        evaluate: async () => null,
      };
      const context = {
        newPage: async () => page,
        cookies: async () => [],
        storageState: async () => ({ cookies: [], origins: [] }),
      };

      await writeFile(
        storagePath,
        JSON.stringify({
          cookies: [sessionCookie("old-generation")],
          origins: [],
        }),
        "utf8",
      );
      assert.equal(
        await captureCredentialsFromStoredBrowserSession(
          captureOptions({
            launch: async () => ({
              newContext: async () => context,
              close: async () => undefined,
            }),
          }),
        ),
        null,
      );
      assert.deepEqual(
        JSON.parse(await readFile(storagePath, "utf8")),
        replacement,
      );
    },
  );
});

test("stored browser capture restores its claimed state when context creation fails", async () => {
  await withBrowserState(
    "ontrack-browser-state-restore-",
    async (storagePath) => {
      const original = {
        cookies: [sessionCookie("recoverable")],
        origins: [],
      };
      await writeFile(storagePath, JSON.stringify(original), "utf8");

      await assert.rejects(
        () =>
          captureCredentialsFromStoredBrowserSession(
            captureOptions({
              launch: async () => ({
                newContext: async () => {
                  throw new Error("context creation failed");
                },
                close: async () => undefined,
              }),
            }),
          ),
        /context creation failed/,
      );
      assert.deepEqual(
        JSON.parse(await readFile(storagePath, "utf8")),
        original,
      );
    },
  );
});

test("stored browser capture applies one hard deadline and closes a hung probe", async () => {
  await withBrowserState(
    "ontrack-browser-state-deadline-",
    async (storagePath) => {
      const original = {
        cookies: [sessionCookie("recoverable")],
        origins: [],
      };
      let closeCalls = 0;
      await writeFile(storagePath, JSON.stringify(original), "utf8");

      await assert.rejects(
        () => settleWithin(
          captureCredentialsFromStoredBrowserSession(
            captureOptions({
              launch: async () => ({
                newContext: async () => ({
                  newPage: async () => ({
                    on: () => undefined,
                    url: () => "about:blank",
                    goto: async () => new Promise<never>(() => undefined),
                    evaluate: async () => null,
                  }),
                  cookies: async () => [],
                  storageState: async () => original,
                }),
                close: async () => {
                  closeCalls += 1;
                },
              }),
            }),
          ),
          150,
        ),
        (error: unknown) =>
          error instanceof SsoFallbackError && error.reason === "timeout",
      );

      assert.equal(closeCalls, 1);
      assert.deepEqual(JSON.parse(await readFile(storagePath, "utf8")), original);
    },
  );
});

test("opted-in system profile launch cannot exceed the shared silent-auth deadline", async () => {
  await withBrowserState(
    "ontrack-system-profile-deadline-",
    async () => {
      let launchCalls = 0;
      await assert.rejects(
        () => settleWithin(
          captureCredentialsFromStoredBrowserSession({
            ssoUrl: SSO_URL,
            apiBaseUrl: API_BASE_URL,
            timeoutMs: 25,
            headless: true,
            systemBrowserProfileReuseEnabled: () => true,
            systemBrowserProfileCandidates: [{
              label: "Test profile",
              userDataDir: "/trusted/profile",
              profileDir: "Default",
            }],
            browserPlan: {
              source: "system",
              executablePath: "/trusted/chrome",
            },
            systemBrowserProfileAdapter: {
              launchPersistentContext: async () => {
                launchCalls += 1;
                return new Promise<never>(() => undefined);
              },
            },
          }),
          150,
        ),
        (error: unknown) =>
          error instanceof SsoFallbackError && error.reason === "timeout",
      );
      assert.equal(launchCalls, 1);
    },
  );
});

test("stored browser capture does not expose its claimed state while the browser runs", async () => {
  await withBrowserState(
    "ontrack-browser-state-private-claim-",
    async (storagePath) => {
      const original = {
        cookies: [sessionCookie("recoverable")],
        origins: [],
      };
      await writeFile(storagePath, JSON.stringify(original), "utf8");

      await assert.rejects(
        () =>
          captureCredentialsFromStoredBrowserSession(
            captureOptions({
              launch: async () => {
                const stateDirectory = join(storagePath, "..");
                const entries = await Array.fromAsync(
                  new Bun.Glob("browser-state.json.probe-*").scan({
                    cwd: stateDirectory,
                  }),
                );
                assert.deepEqual(entries, []);
                return {
                  newContext: async () => {
                    throw new Error("context creation failed");
                  },
                  close: async () => undefined,
                };
              },
            }),
          ),
        /context creation failed/,
      );
      assert.deepEqual(
        JSON.parse(await readFile(storagePath, "utf8")),
        original,
      );
    },
  );
});

test("stored browser capture recovers an orphaned claim after a process crash", async () => {
  await withBrowserState(
    "ontrack-browser-state-orphan-claim-",
    async (storagePath) => {
      const orphanedPath =
        `${storagePath}.probe-00000000-0000-4000-8000-000000000001`;
      let browserLaunches = 0;
      let currentUrl = "about:blank";
      const page = {
        on: () => page,
        url: () => currentUrl,
        goto: async (url: string) => {
          currentUrl = url;
          return null;
        },
        evaluate: async () => null,
      };
      const context = {
        newPage: async () => page,
        cookies: async () => [],
        storageState: async () => ({ cookies: [], origins: [] }),
      };
      await writeFile(
        orphanedPath,
        JSON.stringify({
          cookies: [sessionCookie("recoverable")],
          origins: [],
        }),
        "utf8",
      );
      const staleTimestamp = new Date(Date.now() - 10_000);
      await utimes(orphanedPath, staleTimestamp, staleTimestamp);

      assert.equal(
        await captureCredentialsFromStoredBrowserSession(
          captureOptions({
            launch: async () => {
              browserLaunches += 1;
              return {
                newContext: async () => context,
                close: async () => undefined,
              };
            },
          }),
        ),
        null,
      );
      assert.equal(browserLaunches, 1);
      await assert.rejects(() => readFile(orphanedPath, "utf8"), /ENOENT/);
    },
  );
});

test("stored browser capture never steals a fresh claim from a concurrent process", async () => {
  await withBrowserState(
    "ontrack-browser-state-live-claim-",
    async (storagePath) => {
      const claimedPath =
        `${storagePath}.probe-00000000-0000-4000-8000-000000000002`;
      let browserLaunches = 0;
      await writeFile(
        claimedPath,
        JSON.stringify({
          cookies: [sessionCookie("still-owned")],
          origins: [],
        }),
        "utf8",
      );

      assert.equal(
        await captureCredentialsFromStoredBrowserSession(
          captureOptions({
            launch: async () => {
              browserLaunches += 1;
              throw new Error("browser must not launch");
            },
          }),
        ),
        null,
      );
      assert.equal(browserLaunches, 0);
      assert.deepEqual(
        JSON.parse(await readFile(claimedPath, "utf8")),
        {
          cookies: [sessionCookie("still-owned")],
          origins: [],
        },
      );
    },
  );
});

test("successful stored browser probe never overwrites a concurrent state generation", async () => {
  await withBrowserState(
    "ontrack-browser-state-publish-",
    async (storagePath) => {
      const replacement = {
        cookies: [sessionCookie("new-generation")],
        origins: [],
      };
      const capturedCookies = [
        sessionCookie("captured-token", "auth_token"),
        sessionCookie("captured-user", "username"),
      ];
      let replacementWritten = false;
      let currentUrl = "about:blank";
      const page = {
        on: () => page,
        url: () => currentUrl,
        goto: async (url: string) => {
          currentUrl = url;
          if (!replacementWritten) {
            replacementWritten = true;
            await writeFile(storagePath, JSON.stringify(replacement), "utf8");
          }
          return null;
        },
        evaluate: async () => null,
      };
      const context = {
        newPage: async () => page,
        cookies: async () => capturedCookies,
        storageState: async () => ({
          cookies: capturedCookies,
          origins: [],
        }),
      };

      await writeFile(
        storagePath,
        JSON.stringify({
          cookies: [sessionCookie("old-generation")],
          origins: [],
        }),
        "utf8",
      );
      assert.deepEqual(
        await captureCredentialsFromStoredBrowserSession(
          captureOptions({
            launch: async () => ({
              newContext: async () => context,
              close: async () => undefined,
            }),
          }),
        ),
        {
          authToken: "captured-token",
          username: "captured-user",
          source: "cookie",
        },
      );
      assert.deepEqual(
        JSON.parse(await readFile(storagePath, "utf8")),
        replacement,
      );
    },
  );
});

test("successful stored browser capture restores its claimed state when no fresh state can publish", async () => {
  await withBrowserState(
    "ontrack-browser-state-publish-restore-",
    async (storagePath) => {
      const original = {
        cookies: [sessionCookie("recoverable")],
        origins: [],
      };
      const capturedCookies = [
        sessionCookie("captured-token", "auth_token"),
        sessionCookie("captured-user", "username"),
      ];
      let currentUrl = "about:blank";
      const page = {
        on: () => page,
        url: () => currentUrl,
        goto: async (url: string) => {
          currentUrl = url;
          return null;
        },
        evaluate: async () => null,
      };
      const context = {
        newPage: async () => page,
        cookies: async () => capturedCookies,
        storageState: async () => ({ cookies: [], origins: [] }),
      };

      await writeFile(storagePath, JSON.stringify(original), "utf8");
      assert.deepEqual(
        await captureCredentialsFromStoredBrowserSession(
          captureOptions({
            launch: async () => ({
              newContext: async () => context,
              close: async () => undefined,
            }),
          }),
        ),
        {
          authToken: "captured-token",
          username: "captured-user",
          source: "cookie",
        },
      );
      assert.deepEqual(
        JSON.parse(await readFile(storagePath, "utf8")),
        original,
      );
    },
  );
});

test("failed exclusive publication removes its partial file before restoring state", async () => {
  await withBrowserState(
    "ontrack-browser-state-partial-write-",
    async (storagePath) => {
      const original = {
        cookies: [sessionCookie("recoverable")],
        origins: [],
      };
      const capturedCookies = [
        sessionCookie("captured-token", "auth_token"),
        sessionCookie("captured-user", "username"),
      ];
      const circularCookie: Record<string, unknown> = sessionCookie(
        "captured-token",
        "auth_token",
      );
      circularCookie.self = circularCookie;
      let currentUrl = "about:blank";
      const page = {
        on: () => page,
        url: () => currentUrl,
        goto: async (url: string) => {
          currentUrl = url;
          return null;
        },
        evaluate: async () => null,
      };
      const context = {
        newPage: async () => page,
        cookies: async () => capturedCookies,
        storageState: async () => ({
          cookies: [circularCookie],
          origins: [],
        }),
      };

      await writeFile(storagePath, JSON.stringify(original), "utf8");
      assert.deepEqual(
        await captureCredentialsFromStoredBrowserSession(
          captureOptions({
            launch: async () => ({
              newContext: async () => context,
              close: async () => undefined,
            }),
          }),
        ),
        {
          authToken: "captured-token",
          username: "captured-user",
          source: "cookie",
        },
      );
      assert.deepEqual(
        JSON.parse(await readFile(storagePath, "utf8")),
        original,
      );
    },
  );
});

test("injectRememberIntoAuthExchange only rewrites the token-exchange POST", () => {
  const origin = "https://ontrack.infotech.monash.edu";
  assert.equal(
    injectRememberIntoAuthExchange(
      "POST",
      `${origin}/api/auth`,
      '{"username":"u1","auth_token":"t"}',
      origin,
    ),
    '{"username":"u1","auth_token":"t","remember":true}',
  );
  assert.equal(
    injectRememberIntoAuthExchange(
      "POST",
      `${origin}/api/auth.json`,
      '{"username":"u1"}',
      origin,
    ),
    '{"username":"u1","remember":true}',
  );
  assert.equal(
    injectRememberIntoAuthExchange(
      "POST",
      `${origin}/api/auth/access-token`,
      '{"x":1}',
      origin,
    ),
    null,
  );
  assert.equal(
    injectRememberIntoAuthExchange("GET", `${origin}/api/auth`, '{"x":1}', origin),
    null,
  );
  assert.equal(injectRememberIntoAuthExchange("POST", `${origin}/api/auth`, null, origin), null);
  assert.equal(
    injectRememberIntoAuthExchange("POST", `${origin}/api/auth`, "not json", origin),
    null,
  );
  assert.equal(
    injectRememberIntoAuthExchange("POST", `${origin}/api/auth`, '{"remember":true}', origin),
    null,
  );
  assert.equal(
    injectRememberIntoAuthExchange("POST", "https://evil.example/api/auth", '{"x":1}', origin),
    null,
  );
});

test("persisted refresh cookies roundtrip through the trusted state store", async () => {
  await withBrowserState("ontrack-refresh-cookie-", async (storagePath) => {
    persistRefreshCookie(
      {
        username: "student1",
        refreshToken: "refresh-secret",
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
      { targetOrigin: TARGET_ORIGIN },
    );
    assert.deepEqual(readStoredRefreshCookie({ targetOrigin: TARGET_ORIGIN }), {
      username: "student1",
      refreshToken: "refresh-secret",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    const metadata = await stat(storagePath);
    assert.equal(metadata.mode & 0o077, 0);

    // A second persist merges instead of dropping unrelated stored cookies.
    const original = JSON.parse(await readFile(storagePath, "utf8")) as {
      cookies: Array<Record<string, unknown>>;
    };
    original.cookies.push({
      name: "unrelated",
      value: "kept",
      domain: "ontrack.infotech.monash.edu",
      path: "/",
      expires: -1,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    });
    await writeFile(storagePath, JSON.stringify(original), "utf8");
    persistRefreshCookie(
      {
        username: "student1",
        refreshToken: "rotated-secret",
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
      { targetOrigin: TARGET_ORIGIN },
    );
    const merged = readStoredRefreshCookie({ targetOrigin: TARGET_ORIGIN });
    assert.equal(merged?.refreshToken, "rotated-secret");
    const finalState = JSON.parse(await readFile(storagePath, "utf8")) as {
      cookies: Array<{ name: string }>;
    };
    assert.ok(finalState.cookies.some((cookie) => cookie.name === "unrelated"));
  });
});

test("expired refresh cookies are neither persisted nor returned", async () => {
  await withBrowserState("ontrack-refresh-cookie-expired-", async () => {
    persistRefreshCookie(
      {
        username: "student1",
        refreshToken: "old",
        expiresAt: "2020-01-01T00:00:00.000Z",
      },
      { targetOrigin: TARGET_ORIGIN },
    );
    assert.equal(readStoredRefreshCookie({ targetOrigin: TARGET_ORIGIN }), null);
  });
});

test("readStoredRefreshCookie returns null without a state file", async () => {
  await withBrowserState("ontrack-refresh-cookie-missing-", async () => {
    assert.equal(readStoredRefreshCookie({ targetOrigin: TARGET_ORIGIN }), null);
  });
});
