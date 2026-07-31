import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildContextOptionsWithStoredSession,
  captureCredentialsFromStoredBrowserSession,
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
  let environmentChanged = false;
  const previousStoragePath = process.env.ONTRACK_BROWSER_STATE_PATH;
  try {
    tempRoot = await mkdtemp(join(homedir(), `.${prefix}`));
    const storagePath = join(tempRoot, "browser-state.json");
    process.env.ONTRACK_BROWSER_STATE_PATH = storagePath;
    environmentChanged = true;
    await run(storagePath);
  } finally {
    try {
      if (environmentChanged) {
        if (previousStoragePath === undefined) {
          delete process.env.ONTRACK_BROWSER_STATE_PATH;
        } else {
          process.env.ONTRACK_BROWSER_STATE_PATH = previousStoragePath;
        }
      }
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
          /outside the local operator home/,
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
