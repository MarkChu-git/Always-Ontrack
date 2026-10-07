import { afterEach, beforeEach, test } from 'bun:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, rm, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserContext } from 'playwright-core';
import {
  captureSsoCredentials,
  captureSsoCredentialsWithGuidedLogin,
  type BrowserLaunchAdapter,
  persistRefreshCookie,
  readStoredRefreshCookie,
  setBrowserSessionStatePathForTests,
  setSsoBrowserProfileDirForTests,
  SsoFallbackError,
} from '../src/lib/auto-login.js';

type Handler = (...args: unknown[]) => void;

const LANDING_URL =
  'https://ontrack.infotech.monash.edu/sign_in?authToken=url-token&username=url-user';

/** One persistent-profile launch the fake adapter recorded. */
interface PersistentLaunch {
  userDataDir: string;
  options: Record<string, unknown>;
}

interface FakeBrowserOptions {
  urlAfterGoto?: string;
  request?: { url: string; method: string; postData: string };
  response?: { url: string; status: number; body: unknown };
  cookieCredentials?: boolean;
  /** A refresh-cookie pair already in the jar, as restored browser state leaves it. */
  refreshCookie?: boolean;
  /** Makes reading the cookie jar fail, as it does once the window is closed. */
  cookiesError?: Error;
  /** OnTrack cookies the context's storage-state snapshot reports. */
  storageCookies?: unknown[];
  /** Records the options of every throwaway context the capture creates. */
  contextOptions?: unknown[];
  /** Offers a persistent-profile launch, recording each one; `failure` makes it throw. */
  persistent?: {
    launches: PersistentLaunch[];
    failure?: Error;
  };
  storageCredentials?: boolean;
  captcha?: boolean;
  unsupportedMfa?: boolean;
  /** Shows an Okta Verify push prompt and nothing else, as a remembered profile can. */
  oktaVerify?: boolean;
  guidedFields?: boolean;
  visibilityNeverSettles?: boolean;
  newContextError?: Error;
  guidedRedirectAfterPassword?: string;
  delayedFillAfterMs?: number;
  lifecycle?: {
    closeCalls: number;
    fillCalls?: number;
    fillAttempts?: number;
    closed?: boolean;
  };
}

function createBrowserAdapter(options: FakeBrowserOptions): BrowserLaunchAdapter {
  const handlers = new Map<string, Handler[]>();
  let url = 'https://sso.example/login';
  const invisibleLocator = {
    first: () => invisibleLocator,
    nth: () => invisibleLocator,
    count: async () => 0,
    isVisible: async () => false,
    getAttribute: async () => null,
    fill: async () => undefined,
    click: async () => undefined,
    innerText: async () => '',
    inputValue: async () => '',
    evaluate: async () => '',
    locator: () => invisibleLocator,
    getByRole: () => invisibleLocator,
    filter: () => invisibleLocator,
  };
  const field = {
    ...invisibleLocator,
    first: () => field,
    nth: () => field,
    count: async () => 1,
    isVisible: async () => !options.lifecycle?.closed,
    fill: async (value: string) => {
      if (options.lifecycle) {
        options.lifecycle.fillAttempts = (options.lifecycle.fillAttempts ?? 0) + 1;
      }
      if (options.delayedFillAfterMs) {
        await new Promise((resolve) => setTimeout(resolve, options.delayedFillAfterMs));
      }
      if (options.lifecycle?.closed) {
        return;
      }
      if (options.lifecycle) {
        options.lifecycle.fillCalls = (options.lifecycle.fillCalls ?? 0) + 1;
      }
      if (value === 'secret' && options.guidedRedirectAfterPassword) {
        url = options.guidedRedirectAfterPassword;
      }
    },
  };
  const page = {
    url: () => url,
    on: (event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    frames: () => [page],
    mainFrame: () => page,
    locator: (selector: string) => {
      if (options.guidedFields && (selector === 'input#okta-signin-username' || selector === 'input#okta-signin-password')) {
        return field;
      }
      if (options.captcha && selector.includes('recaptcha')) return field;
      if (options.unsupportedMfa && selector.includes('webauthn')) return field;
      return invisibleLocator;
    },
    getByRole: () => invisibleLocator,
    getByText: (pattern: RegExp) => {
      const textLocator = {
      ...invisibleLocator,
      first: () => textLocator,
      nth: () => textLocator,
      count: async () => 1,
      isVisible: async () => Boolean(
        options.visibilityNeverSettles
          ? await new Promise<boolean>(() => undefined)
          :
        (options.captcha && pattern.test('captcha')) ||
        (options.unsupportedMfa && pattern.test('security key')) ||
        (options.oktaVerify && pattern.test('okta verify')),
      ),
      };
      return textLocator;
    },
    goto: async (_candidate: string) => {
      url = options.urlAfterGoto ?? 'https://ontrack.infotech.monash.edu/home';
      for (const handler of handlers.get('request') ?? []) {
        handler({
          method: () => options.request?.method ?? 'GET',
          url: () => options.request?.url ?? url,
          postData: () => options.request?.postData ?? null,
          headers: () => ({}),
        });
      }
      for (const handler of handlers.get('response') ?? []) {
        handler({
          url: () => options.response?.url ?? url,
          status: () => options.response?.status ?? 200,
          json: async () => options.response?.body,
        });
      }
    },
    waitForLoadState: async () => undefined,
    evaluate: async () => options.storageCredentials
      ? [
          { scope: 'local', key: 'doubtfire_credentials_token', value: 'storage-token' },
          { scope: 'local', key: 'doubtfire_user', value: '{"username":"storage-user"}' },
        ]
      : [],
  };
  const close = async () => {
    if (options.lifecycle) {
      options.lifecycle.closeCalls += 1;
      options.lifecycle.closed = true;
    }
  };
  const context = {
    newPage: async () => page,
    on: () => undefined,
    pages: () => [page],
    cookies: async () => {
      if (options.cookiesError) throw options.cookiesError;
      return [
      ...(options.cookieCredentials
        ? [
            { name: 'auth_token', value: 'cookie-token', domain: 'ontrack.infotech.monash.edu' },
            { name: 'username', value: 'cookie-user', domain: 'ontrack.infotech.monash.edu' },
          ]
        : []),
      ...(options.refreshCookie
        ? [
            { name: 'refresh_token', value: 'restored-refresh', domain: 'ontrack.infotech.monash.edu' },
            { name: 'username', value: 'url-user', domain: 'ontrack.infotech.monash.edu' },
          ]
        : []),
      ];
    },
    storageState: async () => ({ cookies: options.storageCookies ?? [], origins: [] }),
  };
  const persistent = options.persistent;
  return {
    launch: async () => ({
      newContext: async (contextOptions?: unknown) => {
        options.contextOptions?.push(contextOptions);
        if (options.newContextError) throw options.newContextError;
        return context;
      },
      close,
    }),
    ...(persistent
      ? {
          launchPersistentContext: async (
            userDataDir: string,
            launchOptions: Record<string, unknown>,
          ) => {
            persistent.launches.push({ userDataDir, options: launchOptions });
            if (persistent.failure) throw persistent.failure;
            return { ...context, close } as unknown as BrowserContext;
          },
        }
      : {}),
  };
}

// A capture in a throwaway browser reads, migrates and rewrites the stored
// browser state, so every test gets its own file instead of the operator's
// ~/.config/ontrack-cli/browser-state.json.
let browserStateRoot = '';

beforeEach(async () => {
  browserStateRoot = await mkdtemp(join(tmpdir(), 'ontrack-browser-state-'));
  setBrowserSessionStatePathForTests(join(browserStateRoot, 'browser-state.json'));
});

afterEach(async () => {
  setBrowserSessionStatePathForTests(undefined);
  await rm(browserStateRoot, { recursive: true, force: true });
});

/** Point the SSO profile at a private temporary directory. */
async function withSsoProfileDir(run: (profileDir: string) => Promise<void>): Promise<void> {
  // Inside the operator home, like the managed path this seam replaces.
  const root = await mkdtemp(join(homedir(), '.ontrack-sso-profile-'));
  const profileDir = join(root, 'sso-browser-profile');
  setSsoBrowserProfileDirForTests(profileDir);
  try {
    await run(profileDir);
  } finally {
    setSsoBrowserProfileDirForTests(undefined);
    await rm(root, { recursive: true, force: true });
  }
}

async function settleWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('test deadline exceeded')), timeoutMs),
    ),
  ]);
}

test('injected browser Adapter captures credentials from an exact OnTrack redirect without browser/network I/O', async () => {
  const credentials = await captureSsoCredentials({
    ssoUrl: 'https://sso.example/login',
    apiBaseUrl: 'https://ontrack.infotech.monash.edu/api',
    browserAdapter: createBrowserAdapter({ urlAfterGoto: LANDING_URL }),
  });
  assert.deepEqual(credentials, { authToken: 'url-token', username: 'url-user', source: 'url' });
});

test('browser Adapter accepts only OnTrack auth request credentials and preserves response expiry', async () => {
  const credentials = await captureSsoCredentials({
    ssoUrl: 'https://sso.example/login',
    apiBaseUrl: 'https://ontrack.infotech.monash.edu/api',
    browserAdapter: createBrowserAdapter({
      request: {
        method: 'POST',
        url: 'https://ontrack.infotech.monash.edu/api/auth',
        postData: '{"auth_token":"request-token","username":"request-user"}',
      },
    }),
  });
  assert.deepEqual(credentials, { authToken: 'request-token', username: 'request-user', source: 'auth_request' });
});

test('browser Adapter marks the observed access-token response contract', async () => {
  const credentials = await captureSsoCredentials({
    ssoUrl: 'https://sso.example/login',
    apiBaseUrl: 'https://ontrack.infotech.monash.edu/api',
    browserAdapter: createBrowserAdapter({
      response: {
        url: 'https://ontrack.infotech.monash.edu/api/auth/access-token',
        status: 201,
        body: {
          auth_token: 'access-token-value',
          auth_token_expiry: '2030-01-01T00:00:00.000Z',
          user: { username: 'access-user' },
        },
      },
    }),
  });
  assert.deepEqual(credentials, {
    authToken: 'access-token-value',
    username: 'access-user',
    expiresAt: '2030-01-01T00:00:00.000Z',
    source: 'auth_response',
    contract: 'access-token',
  });
});

test('browser Adapter falls back to target-local storage and target cookies only', async () => {
  const fromStorage = await captureSsoCredentials({
    ssoUrl: 'https://sso.example/login',
    apiBaseUrl: 'https://ontrack.infotech.monash.edu/api',
    browserAdapter: createBrowserAdapter({ storageCredentials: true }),
  });
  assert.deepEqual(fromStorage, { authToken: 'storage-token', username: 'storage-user', source: 'local_storage' });
  const fromCookies = await captureSsoCredentials({
    ssoUrl: 'https://sso.example/login',
    apiBaseUrl: 'https://ontrack.infotech.monash.edu/api',
    browserAdapter: createBrowserAdapter({ cookieCredentials: true }),
  });
  assert.deepEqual(fromCookies, { authToken: 'cookie-token', username: 'cookie-user', source: 'cookie' });
});

test('browser Adapter maps CAPTCHA and unsupported MFA to explicit non-retryable fallback errors', async () => {
  for (const [input, reason] of [
    [{ captcha: true }, 'captcha'],
    [{ unsupportedMfa: true }, 'unsupported_mfa'],
  ] as const) {
    await assert.rejects(
      () => captureSsoCredentials({
        ssoUrl: 'https://sso.example/login',
        apiBaseUrl: 'https://ontrack.infotech.monash.edu/api',
        timeoutMs: 50,
        browserAdapter: createBrowserAdapter(input),
      }),
      (error: unknown) => error instanceof SsoFallbackError && error.reason === reason,
    );
  }
});

test('guided capture records terminal steps while using only fake visible selectors', async () => {
  const steps: string[] = [];
  const credentials = await captureSsoCredentialsWithGuidedLogin({
    ssoUrl: 'https://monashuni.okta.com/login',
    apiBaseUrl: 'https://ontrack.infotech.monash.edu/api',
    username: 'student',
    password: 'secret',
    browserAdapter: createBrowserAdapter({
      guidedFields: true,
      urlAfterGoto: 'https://monashuni.okta.com/login',
      guidedRedirectAfterPassword: 'https://ontrack.infotech.monash.edu/sign_in?authToken=guided-token&username=guided-user',
    }),
  }, (step) => steps.push(step));
  assert.equal(credentials.authToken, 'guided-token');
  assert.deepEqual(steps, ['username', 'password', 'completed']);
});

test('capture enforces one hard deadline when a selector operation never settles', async () => {
  const lifecycle = { closeCalls: 0 };

  await assert.rejects(
    () => settleWithin(captureSsoCredentials({
      ssoUrl: 'https://sso.example/login',
      apiBaseUrl: 'https://ontrack.infotech.monash.edu/api',
      timeoutMs: 20,
      browserAdapter: createBrowserAdapter({
        visibilityNeverSettles: true,
        lifecycle,
      }),
    }), 150),
    (error: unknown) =>
      error instanceof SsoFallbackError && error.reason === 'timeout',
  );

  assert.equal(lifecycle.closeCalls, 1);
});

test('guided capture never fills credentials into an untrusted top-level origin', async () => {
  const lifecycle = { closeCalls: 0, fillCalls: 0 };

  await assert.rejects(
    () => captureSsoCredentialsWithGuidedLogin({
      ssoUrl: 'https://evil.example/phish',
      apiBaseUrl: 'https://ontrack.infotech.monash.edu/api',
      username: 'student',
      password: 'secret',
      timeoutMs: 20,
      browserAdapter: createBrowserAdapter({
        guidedFields: true,
        urlAfterGoto: 'https://evil.example/phish',
        lifecycle,
      }),
    }),
    (error: unknown) =>
      error instanceof SsoFallbackError &&
      (error.reason === 'selector_missing' || error.reason === 'timeout'),
  );

  assert.equal(lifecycle.fillCalls, 0);
  assert.equal(lifecycle.closeCalls, 1);
});

test('deadline closes the browser before an in-flight credential fill can complete', async () => {
  const lifecycle = {
    closeCalls: 0,
    fillCalls: 0,
    fillAttempts: 0,
    closed: false,
  };

  await assert.rejects(
    () => captureSsoCredentialsWithGuidedLogin({
      ssoUrl: 'https://monashuni.okta.com/login',
      apiBaseUrl: 'https://ontrack.infotech.monash.edu/api',
      username: 'student',
      password: 'secret',
      timeoutMs: 20,
      browserAdapter: createBrowserAdapter({
        guidedFields: true,
        urlAfterGoto: 'https://monashuni.okta.com/login',
        delayedFillAfterMs: 50,
        lifecycle,
      }),
    }),
    (error: unknown) =>
      error instanceof SsoFallbackError && error.reason === 'timeout',
  );
  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.equal(lifecycle.fillAttempts, 1);
  assert.equal(lifecycle.fillCalls, 0);
  assert.equal(lifecycle.closeCalls, 1);
  assert.equal(lifecycle.closed, true);
});

test('capture closes a launched browser when isolated context creation fails', async () => {
  const lifecycle = { closeCalls: 0 };

  await assert.rejects(
    () => captureSsoCredentials({
      ssoUrl: 'https://sso.example/login',
      apiBaseUrl: 'https://ontrack.infotech.monash.edu/api',
      timeoutMs: 50,
      browserAdapter: createBrowserAdapter({
        newContextError: new Error('context creation failed'),
        lifecycle,
      }),
    }),
    /context creation failed/,
  );

  assert.equal(lifecycle.closeCalls, 1);
});

test('credential capture fails closed before launching unauthenticated Lightpanda CDP', async () => {
  let launchCalls = 0;

  await assert.rejects(
    () => captureSsoCredentials({
      ssoUrl: 'https://monashuni.okta.com/login',
      apiBaseUrl: 'https://ontrack.infotech.monash.edu/api',
      timeoutMs: 50,
      browserPlan: {
        source: 'lightpanda',
        executablePath: '/trusted/lightpanda',
      },
      browserAdapter: {
        launch: async () => {
          launchCalls += 1;
          throw new Error('must not launch');
        },
      },
    }),
    (error: unknown) =>
      error instanceof SsoFallbackError &&
      error.reason === 'browser_unavailable' &&
      /unauthenticated.*CDP/i.test(error.message),
  );

  assert.equal(launchCalls, 0);
});

test('a login-token capture leaves the refresh cookie to the CLI exchange', async () => {
  // The CLI spends a one-time login token itself and that exchange issues a
  // fresh refresh cookie. One already in the jar is restored state, and
  // reporting it would overwrite the fresh cookie once the session is
  // persisted.
  const credentials = await captureSsoCredentials({
    ssoUrl: 'https://sso.example/login',
    apiBaseUrl: 'https://ontrack.infotech.monash.edu/api',
    browserAdapter: createBrowserAdapter({ urlAfterGoto: LANDING_URL, refreshCookie: true }),
  });
  assert.deepEqual(credentials, { authToken: 'url-token', username: 'url-user', source: 'url' });
});

test('a captured live credential survives a cookie jar that can no longer be read', async () => {
  // The refresh cookie is extra; once the credential is in hand, closing the
  // window early must not turn a successful sign-in into a failure.
  const credentials = await captureSsoCredentials({
    ssoUrl: 'https://sso.example/login',
    apiBaseUrl: 'https://ontrack.infotech.monash.edu/api',
    browserAdapter: createBrowserAdapter({
      response: {
        url: 'https://ontrack.infotech.monash.edu/api/auth/access-token',
        status: 201,
        body: {
          auth_token: 'access-token-value',
          auth_token_expiry: '2030-01-01T00:00:00.000Z',
          user: { username: 'access-user' },
        },
      },
      cookiesError: new Error('Target page, context or browser has been closed'),
    }),
  });
  assert.equal(credentials.authToken, 'access-token-value');
  assert.equal(credentials.refreshCookie, undefined);
});

test('a throwaway capture context blocks service workers', async () => {
  // doubtfire-web ships an Angular service worker, and Playwright routes never
  // see requests a service worker handles, so the page could spend the login
  // token behind the route that stops it.
  const contextOptions: unknown[] = [];
  await captureSsoCredentials({
    ssoUrl: 'https://sso.example/login',
    apiBaseUrl: 'https://ontrack.infotech.monash.edu/api',
    browserAdapter: createBrowserAdapter({ urlAfterGoto: LANDING_URL, contextOptions }),
  });
  assert.equal(contextOptions.length, 1);
  assert.equal((contextOptions[0] as { serviceWorkers?: string }).serviceWorkers, 'block');
});

test('capture signs in through a private, persistent SSO profile', async () => {
  await withSsoProfileDir(async (profileDir) => {
    const launches: PersistentLaunch[] = [];
    const contextOptions: unknown[] = [];
    const lifecycle = { closeCalls: 0 };
    const credentials = await captureSsoCredentials({
      ssoUrl: 'https://sso.example/login',
      apiBaseUrl: 'https://ontrack.infotech.monash.edu/api',
      headless: true,
      browserAdapter: createBrowserAdapter({
        urlAfterGoto: LANDING_URL,
        persistent: { launches },
        contextOptions,
        lifecycle,
      }),
    });

    assert.equal(credentials.authToken, 'url-token');
    assert.equal(launches.length, 1);
    assert.equal(launches[0].userDataDir, profileDir);
    assert.equal(launches[0].options.headless, true);
    assert.equal(launches[0].options.serviceWorkers, 'block');
    assert.equal(contextOptions.length, 0, 'no throwaway context once the profile opened');
    // The profile holds the identity provider's session, so it is owner-only.
    if (process.platform !== 'win32') {
      assert.equal((await stat(profileDir)).mode & 0o077, 0);
    }
    // Closing releases the profile lock and flushes its cookies for next time.
    assert.equal(lifecycle.closeCalls, 1);
  });
});

test('a profile held by another login falls back to a throwaway browser and says so', async () => {
  await withSsoProfileDir(async () => {
    const launches: PersistentLaunch[] = [];
    const contextOptions: unknown[] = [];
    const notices: string[] = [];
    const credentials = await captureSsoCredentials({
      ssoUrl: 'https://sso.example/login',
      apiBaseUrl: 'https://ontrack.infotech.monash.edu/api',
      onNotice: (message) => notices.push(message),
      browserAdapter: createBrowserAdapter({
        urlAfterGoto: LANDING_URL,
        persistent: {
          launches,
          failure: new Error('Failed to create a ProcessSingleton for your profile directory.'),
        },
        contextOptions,
      }),
    });

    assert.equal(credentials.authToken, 'url-token');
    assert.equal(launches.length, 1);
    assert.equal(contextOptions.length, 1);
    // Without the profile Okta does not recognize the device, so the user
    // has to learn why this sign-in asked for MFA again.
    assert.equal(notices.length, 1);
    assert.match(notices[0] ?? '', /throwaway browser/);
  });
});

test('ONTRACK_SSO_PROFILE=ephemeral keeps every capture in a throwaway browser', async () => {
  const previous = process.env.ONTRACK_SSO_PROFILE;
  process.env.ONTRACK_SSO_PROFILE = 'ephemeral';
  try {
    await withSsoProfileDir(async () => {
      const launches: PersistentLaunch[] = [];
      const contextOptions: unknown[] = [];
      await captureSsoCredentials({
        ssoUrl: 'https://sso.example/login',
        apiBaseUrl: 'https://ontrack.infotech.monash.edu/api',
        browserAdapter: createBrowserAdapter({
          urlAfterGoto: LANDING_URL,
          persistent: { launches },
          contextOptions,
        }),
      });

      assert.equal(launches.length, 0);
      assert.equal(contextOptions.length, 1);
    });
  } finally {
    if (previous === undefined) {
      delete process.env.ONTRACK_SSO_PROFILE;
    } else {
      process.env.ONTRACK_SSO_PROFILE = previous;
    }
  }
});

test('a profile sign-in keeps the stored refresh cookie until the CLI exchange replaces it', async () => {
  // The profile never holds OnTrack's refresh cookie (the CLI's own exchange
  // stores it), so its snapshot must not overwrite the one on disk before that
  // exchange has even run: if the exchange then failed, renewal would be gone.
  await withSsoProfileDir(async () => {
    persistRefreshCookie(
      { username: 'url-user', refreshToken: 'stored-refresh', expiresAt: '2099-01-01T00:00:00.000Z' },
      { targetOrigin: 'https://ontrack.infotech.monash.edu' },
    );
    await captureSsoCredentials({
      ssoUrl: 'https://sso.example/login',
      apiBaseUrl: 'https://ontrack.infotech.monash.edu/api',
      browserAdapter: createBrowserAdapter({
        urlAfterGoto: LANDING_URL,
        persistent: { launches: [] },
        storageCookies: [
          {
            name: 'TS01dc4fc6',
            value: 'load-balancer',
            domain: 'ontrack.infotech.monash.edu',
            path: '/',
            expires: -1,
            httpOnly: false,
            secure: true,
            sameSite: 'Strict',
          },
        ],
      }),
    });
    assert.equal(
      readStoredRefreshCookie({ targetOrigin: 'https://ontrack.infotech.monash.edu' })?.refreshToken,
      'stored-refresh',
    );
  });
});

test('the profile launch cannot outlive the login deadline', async () => {
  // A launch still running when the login gives up would keep the profile
  // locked, so the next login could only fall back to a throwaway browser.
  await withSsoProfileDir(async () => {
    const launches: PersistentLaunch[] = [];
    await captureSsoCredentials({
      ssoUrl: 'https://sso.example/login',
      apiBaseUrl: 'https://ontrack.infotech.monash.edu/api',
      timeoutMs: 30_000,
      browserAdapter: createBrowserAdapter({ urlAfterGoto: LANDING_URL, persistent: { launches } }),
    });
    const timeout = launches[0]?.options.timeout;
    assert.equal(typeof timeout, 'number');
    assert.ok((timeout as number) > 0 && (timeout as number) <= 30_000, String(timeout));
  });
});

test('a profile path that resolves outside the operator home stays unused', async () => {
  // Like the browser-state file, the profile holds credentials, so a
  // relocated config directory (for example a symlinked ~/.config) must not
  // carry the identity provider's session somewhere else.
  const outside = await mkdtemp(join(tmpdir(), 'ontrack-sso-profile-outside-'));
  const profileDir = join(outside, 'sso-browser-profile');
  setSsoBrowserProfileDirForTests(profileDir);
  try {
    const launches: PersistentLaunch[] = [];
    const contextOptions: unknown[] = [];
    const notices: string[] = [];
    const credentials = await captureSsoCredentials({
      ssoUrl: 'https://sso.example/login',
      apiBaseUrl: 'https://ontrack.infotech.monash.edu/api',
      onNotice: (message) => notices.push(message),
      browserAdapter: createBrowserAdapter({
        urlAfterGoto: LANDING_URL,
        persistent: { launches },
        contextOptions,
      }),
    });

    assert.equal(credentials.authToken, 'url-token');
    assert.equal(launches.length, 0);
    assert.equal(contextOptions.length, 1);
    await assert.rejects(access(profileDir), 'the profile directory is never created');
    assert.equal(notices.length, 1);
    assert.match(notices[0] ?? '', /inside your home/);
  } finally {
    setSsoBrowserProfileDirForTests(undefined);
    await rm(outside, { recursive: true, force: true });
  }
});

test('a guided login left waiting on Okta Verify reports the MFA timeout', async () => {
  // Okta can skip straight to the push prompt for a profile it remembers. An
  // unanswered push is not a missing username/password field.
  await assert.rejects(
    () => captureSsoCredentialsWithGuidedLogin({
      ssoUrl: 'https://monashuni.okta.com/login',
      apiBaseUrl: 'https://ontrack.infotech.monash.edu/api',
      username: 'student',
      password: 'secret',
      timeoutMs: 200,
      browserAdapter: createBrowserAdapter({
        urlAfterGoto: 'https://monashuni.okta.com/signin/verify',
        oktaVerify: true,
      }),
    }),
    (error: unknown) =>
      error instanceof SsoFallbackError &&
      error.reason === 'timeout' &&
      /Okta Verify/.test(error.message),
  );
});
