import { test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  captureSsoCredentials,
  captureSsoCredentialsWithGuidedLogin,
  type BrowserLaunchAdapter,
  SsoFallbackError,
} from '../src/lib/auto-login.js';

type Handler = (...args: unknown[]) => void;

interface FakeBrowserOptions {
  urlAfterGoto?: string;
  request?: { url: string; method: string; postData: string };
  response?: { url: string; status: number; body: unknown };
  cookieCredentials?: boolean;
  storageCredentials?: boolean;
  captcha?: boolean;
  unsupportedMfa?: boolean;
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
        (options.unsupportedMfa && pattern.test('security key')),
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
  const context = {
    newPage: async () => page,
    on: () => undefined,
    pages: () => [page],
    cookies: async () => options.cookieCredentials
      ? [
          { name: 'auth_token', value: 'cookie-token', domain: 'ontrack.infotech.monash.edu' },
          { name: 'username', value: 'cookie-user', domain: 'ontrack.infotech.monash.edu' },
        ]
      : [],
    storageState: async () => ({ cookies: [], origins: [] }),
  };
  return {
    launch: async () => ({
      newContext: async () => {
        if (options.newContextError) throw options.newContextError;
        return context;
      },
      close: async () => {
        if (options.lifecycle) {
          options.lifecycle.closeCalls += 1;
          options.lifecycle.closed = true;
        }
      },
    }),
  };
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
    browserAdapter: createBrowserAdapter({
      urlAfterGoto: 'https://ontrack.infotech.monash.edu/sign_in?authToken=url-token&username=url-user',
    }),
    refreshCookieWaitMs: 0,
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
    refreshCookieWaitMs: 0,
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
    refreshCookieWaitMs: 0,
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
