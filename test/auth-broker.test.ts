import { test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  createOnTrackAuthBroker,
  renewSessionOverHttp,
  type OnTrackAuthBrokerDependencies,
} from '../src/lib/auth-broker.js';
import type { AuthDiagnostic } from '../src/lib/auth-diagnostic.js';
import type { LoginCredentials } from '../src/lib/auto-login.js';
import type { CapturedSignIn } from '../src/lib/api.js';
import type { RefreshCookieMaterial, SessionData } from '../src/lib/types.js';
import { AUTH_REFRESH_LOCK_TIMEOUT } from '../src/lib/session.js';

const expiredSession: SessionData = {
  baseUrl: 'https://ontrack.example/api',
  username: 'student1',
  authToken: 'expired-secret',
  user: { username: 'student1' },
  savedAt: '2026-07-31T00:00:00.000Z',
  expiresAt: '2026-07-31T00:30:00.000Z',
  source: 'access-token',
};

function dependencies(
  overrides: Partial<OnTrackAuthBrokerDependencies> = {},
): OnTrackAuthBrokerDependencies {
  let session: SessionData | null = expiredSession;
  return {
    loadSession: async () => session,
    saveSession: async (next) => {
      session = next;
    },
    withRefreshLock: async (operation) => operation(),
    getAuthMethod: async () => ({
      method: 'saml',
      redirect_to: 'https://identity.example/sso',
    }),
    captureStoredSession: async () => null,
    captureInteractiveSession: async () => null,
    exchangeLegacyCredential: async (
      _baseUrl: string,
      captured: LoginCredentials,
    ): Promise<CapturedSignIn> => ({
      response: {
        auth_token: captured.authToken,
        auth_token_expiry: '2026-07-31T03:00:00.000Z',
        user: { username: captured.username },
      },
      refreshCookie: null,
    }),
    readStoredRefreshCookie: () => null,
    httpRefreshAccessToken: async () => null,
    persistRefreshCookie: () => undefined,
    now: () => new Date('2026-07-31T01:00:00.000Z'),
    ...overrides,
  };
}

test('broker silently converts an observed access-token response into a persisted session', async () => {
  let saved: SessionData | undefined;
  const broker = createOnTrackAuthBroker(
    { baseUrl: expiredSession.baseUrl },
    dependencies({
      captureStoredSession: async () => ({
        username: 'student1',
        authToken: 'fresh-secret',
        expiresAt: '2026-07-31T03:00:00.000Z',
        source: 'auth_response',
        contract: 'access-token',
      }),
      saveSession: async (session) => {
        saved = session;
      },
    }),
  );

  const result = await broker.ensure({ minTtlSeconds: 600 });
  assert.deepEqual(result, {
    status: 'ready',
    expiresAt: '2026-07-31T03:00:00.000Z',
    refreshed: true,
  });
  assert.equal(saved?.authToken, 'fresh-secret');
  assert.equal(saved?.source, 'access-token');
  assert.equal(JSON.stringify(result).includes('fresh-secret'), false);
});

test('broker never starts interactive capture unless explicitly allowed', async () => {
  let interactiveCalls = 0;
  const broker = createOnTrackAuthBroker(
    { baseUrl: expiredSession.baseUrl },
    dependencies({
      captureInteractiveSession: async () => {
        interactiveCalls += 1;
        return null;
      },
    }),
  );

  const result = await broker.ensure({ interaction: 'never' });
  assert.equal(result.status, 'auth_required');
  assert.equal(interactiveCalls, 0);
});

test('broker status is lifecycle-only and never includes credential values', async () => {
  const broker = createOnTrackAuthBroker(
    { baseUrl: expiredSession.baseUrl },
    dependencies(),
  );
  const status = await broker.status();
  assert.deepEqual(status, {
    status: 'expired',
    source: 'access-token',
    expiresAt: '2026-07-31T00:30:00.000Z',
    baseUrl: 'https://ontrack.example/api',
  });
  assert.equal(JSON.stringify(status).includes(expiredSession.authToken), false);
  assert.equal(JSON.stringify(status).includes(expiredSession.username), false);
});

test('broker status calls an expired access token renewable while the refresh cookie lasts', async () => {
  // OnTrack issues ten-minute access tokens, but the refresh cookie renews
  // them silently for about a week, so "expired" overstates the problem.
  const broker = createOnTrackAuthBroker(
    { baseUrl: expiredSession.baseUrl },
    dependencies({
      readStoredRefreshCookie: () => ({
        username: 'student1',
        refreshToken: 'refresh-secret',
        expiresAt: '2026-08-07T00:30:00.000Z',
      }),
    }),
  );
  const status = await broker.status();
  assert.deepEqual(status, {
    status: 'renewable',
    source: 'access-token',
    expiresAt: '2026-07-31T00:30:00.000Z',
    renewableUntil: '2026-08-07T00:30:00.000Z',
    baseUrl: 'https://ontrack.example/api',
  });
  assert.equal(JSON.stringify(status).includes('refresh-secret'), false);
});

test('broker status reports renewableUntil as a canonical UTC instant', async () => {
  // The agent contract validates RFC 3339 instants, so a stored expiry in
  // another valid form must not reach it verbatim.
  const broker = createOnTrackAuthBroker(
    { baseUrl: expiredSession.baseUrl },
    dependencies({
      readStoredRefreshCookie: () => ({
        username: 'student1',
        refreshToken: 'refresh-secret',
        expiresAt: '2026-08-07T10:30:00+10:00',
      }),
    }),
  );
  const status = await broker.status();
  assert.equal(status.renewableUntil, '2026-08-07T00:30:00.000Z');
});

test('broker matches a URL-encoded username cookie to its session', async () => {
  // Rails URL-encodes cookie values, so "student@example.edu" is stored as
  // "student%40example.edu".
  const broker = createOnTrackAuthBroker(
    { baseUrl: expiredSession.baseUrl },
    dependencies({
      loadSession: async () => ({
        ...expiredSession,
        username: 'student@example.edu',
        user: { username: 'student@example.edu' },
      }),
      readStoredRefreshCookie: () => ({
        username: 'student%40example.edu',
        refreshToken: 'refresh-secret',
        expiresAt: '2026-08-07T00:30:00.000Z',
      }),
    }),
  );
  const status = await broker.status();
  assert.equal(status.status, 'renewable');
  assert.equal(status.renewableUntil, '2026-08-07T00:30:00.000Z');
});

test('broker status calls a session renewable when its refresh cookie names no expiry', async () => {
  // The broker renews with such a cookie all the same; it just cannot say
  // until when.
  const broker = createOnTrackAuthBroker(
    { baseUrl: expiredSession.baseUrl },
    dependencies({
      readStoredRefreshCookie: () => ({ username: 'student1', refreshToken: 'undated' }),
    }),
  );
  const status = await broker.status();
  assert.equal(status.status, 'renewable');
  assert.equal('renewableUntil' in status, false);
});

test('broker says the next sign-in is due when the refresh cookie runs out', async () => {
  // The access token lasts ten minutes; the session lasts as long as the
  // refresh cookie renews it.
  const dueWith = (cookie: RefreshCookieMaterial | null) =>
    createOnTrackAuthBroker(
      { baseUrl: expiredSession.baseUrl },
      dependencies({ readStoredRefreshCookie: () => cookie }),
    ).signInDueAt();
  assert.equal(
    await dueWith({ username: 'student1', refreshToken: 'r', expiresAt: '2026-08-07T00:30:00.000Z' }),
    '2026-08-07T00:30:00.000Z',
  );
  // A cookie that names no expiry renews without a known end.
  assert.equal(await dueWith({ username: 'student1', refreshToken: 'r' }), null);
  // Nothing renews the session, so its access token is the whole story.
  assert.equal(await dueWith(null), '2026-07-31T00:30:00.000Z');
});

test('broker has no sign-in due without a session', async () => {
  const broker = createOnTrackAuthBroker(
    { baseUrl: expiredSession.baseUrl },
    dependencies({ loadSession: async () => null }),
  );
  assert.equal(await broker.signInDueAt(), null);
});

test('broker status keeps an expired access token expired without a usable refresh cookie', async () => {
  const cookies: RefreshCookieMaterial[] = [
    { username: 'student1', refreshToken: 'stale', expiresAt: '2026-07-31T00:59:00.000Z' },
    { username: 'someone-else', refreshToken: 'foreign', expiresAt: '2026-08-07T00:30:00.000Z' },
  ];
  for (const cookie of cookies) {
    const broker = createOnTrackAuthBroker(
      { baseUrl: expiredSession.baseUrl },
      dependencies({ readStoredRefreshCookie: () => cookie }),
    );
    const status = await broker.status();
    assert.equal(status.status, 'expired', cookie.refreshToken);
    assert.equal('renewableUntil' in status, false, cookie.refreshToken);
  }
});

test('broker never reuses a stored session from a different requested origin', async () => {
  let authMethodBaseUrl = '';
  const broker = createOnTrackAuthBroker(
    { baseUrl: 'https://staging.ontrack.example/api' },
    dependencies({
      getAuthMethod: async (baseUrl) => {
        authMethodBaseUrl = baseUrl;
        return {
          method: 'saml',
          redirect_to: 'https://identity.example/sso',
        };
      },
    }),
  );

  assert.deepEqual(await broker.status(), {
    status: 'signed_out',
    baseUrl: 'https://staging.ontrack.example/api',
  });
  const result = await broker.ensure({ interaction: 'never' });
  assert.equal(result.status, 'auth_required');
  assert.equal(authMethodBaseUrl, 'https://staging.ontrack.example/api');
  assert.equal(await broker.currentSession(), null);
});

test('broker refreshes over plain HTTP when a stored refresh cookie exists', async () => {
  let saved: SessionData | undefined;
  let browserCaptures = 0;
  let authMethodCalls = 0;
  const broker = createOnTrackAuthBroker(
    { baseUrl: expiredSession.baseUrl },
    dependencies({
      saveSession: async (session) => {
        saved = session;
      },
      readStoredRefreshCookie: () => ({
        username: 'student1',
        refreshToken: 'refresh-secret',
        expiresAt: '2026-08-07T00:00:00.000Z',
      }),
      httpRefreshAccessToken: async () => ({
        response: {
          auth_token: 'fresh-secret',
          auth_token_expiry: '2026-07-31T03:00:00.000Z',
          user: { username: 'student1' },
        },
        refreshCookie: null,
      }),
      captureStoredSession: async () => {
        browserCaptures += 1;
        return null;
      },
      getAuthMethod: async () => {
        authMethodCalls += 1;
        return { method: 'saml', redirect_to: 'https://identity.example/sso' };
      },
    }),
  );

  const result = await broker.ensure({ minTtlSeconds: 600 });
  assert.deepEqual(result, {
    status: 'ready',
    expiresAt: '2026-07-31T03:00:00.000Z',
    refreshed: true,
  });
  assert.equal(saved?.authToken, 'fresh-secret');
  assert.equal(saved?.source, 'access-token');
  assert.equal(browserCaptures, 0);
  assert.equal(authMethodCalls, 0);
  assert.equal(JSON.stringify(result).includes('fresh-secret'), false);
  assert.equal(JSON.stringify(result).includes('refresh-secret'), false);
});

/** Counts every broker step that is not the HTTP renewal itself. */
function countSideSteps() {
  const counts = { authMethodLookups: 0, browserCaptures: 0, exchanges: 0 };
  return {
    counts,
    overrides: {
      getAuthMethod: async () => {
        counts.authMethodLookups += 1;
        return { method: 'saml', redirect_to: 'https://identity.example/sso' };
      },
      captureStoredSession: async () => {
        counts.browserCaptures += 1;
        return null;
      },
      captureInteractiveSession: async () => {
        counts.browserCaptures += 1;
        return null;
      },
      exchangeLegacyCredential: async (): Promise<CapturedSignIn> => {
        counts.exchanges += 1;
        throw new Error('419 Authentication Timeout');
      },
    } as Partial<OnTrackAuthBrokerDependencies>,
  };
}

test('renewSessionOverHttp renews and saves under the refresh lock, with no browser', async () => {
  const steps: string[] = [];
  const side = countSideSteps();
  let saved: SessionData | undefined;
  const renewed = await renewSessionOverHttp(
    'https://ontrack.example/api/',
    dependencies({
      ...side.overrides,
      withRefreshLock: async (operation) => {
        steps.push('lock');
        try {
          return await operation();
        } finally {
          steps.push('unlock');
        }
      },
      readStoredRefreshCookie: (baseUrl) => {
        assert.equal(baseUrl, 'https://ontrack.example/api');
        return { username: 'student1', refreshToken: 'refresh-secret' };
      },
      httpRefreshAccessToken: async (baseUrl, cookie) => {
        steps.push(`renew ${baseUrl} ${cookie.refreshToken}`);
        return {
          response: {
            auth_token: 'fresh-secret',
            auth_token_expiry: '2026-07-31T03:00:00.000Z',
            user: { username: 'student1' },
          },
          refreshCookie: null,
        };
      },
      saveSession: async (session) => {
        steps.push('save');
        saved = session;
      },
    }),
  );

  assert.deepEqual(steps, [
    'lock',
    'renew https://ontrack.example/api refresh-secret',
    'save',
    'unlock',
  ]);
  assert.equal(saved?.authToken, 'fresh-secret');
  assert.equal(renewed?.authToken, 'fresh-secret');
  assert.equal(renewed?.expiresAt, '2026-07-31T03:00:00.000Z');
  assert.equal(renewed?.source, 'access-token');
  assert.equal(renewed?.baseUrl, 'https://ontrack.example/api');
  assert.deepEqual(side.counts, { authMethodLookups: 0, browserCaptures: 0, exchanges: 0 });
});

test('renewSessionOverHttp does nothing without a stored refresh cookie', async () => {
  const side = countSideSteps();
  let locks = 0;
  let requests = 0;
  let saves = 0;
  const renewed = await renewSessionOverHttp(
    expiredSession.baseUrl,
    dependencies({
      ...side.overrides,
      readStoredRefreshCookie: () => null,
      withRefreshLock: async (operation) => {
        locks += 1;
        return operation();
      },
      httpRefreshAccessToken: async () => {
        requests += 1;
        return null;
      },
      saveSession: async () => {
        saves += 1;
      },
    }),
  );

  assert.equal(renewed, null);
  assert.deepEqual({ locks, requests, saves }, { locks: 0, requests: 0, saves: 0 });
  assert.deepEqual(side.counts, { authMethodLookups: 0, browserCaptures: 0, exchanges: 0 });
});

test('renewSessionOverHttp leaves sign-in to the caller while another process holds the lock', async () => {
  let requests = 0;
  const renewed = await renewSessionOverHttp(
    expiredSession.baseUrl,
    dependencies({
      readStoredRefreshCookie: () => ({ username: 'student1', refreshToken: 'refresh-secret' }),
      withRefreshLock: async () => {
        throw Object.assign(new Error('Timed out acquiring session refresh lock.'), {
          code: AUTH_REFRESH_LOCK_TIMEOUT,
        });
      },
      httpRefreshAccessToken: async () => {
        requests += 1;
        return null;
      },
    }),
  );

  assert.equal(renewed, null);
  assert.equal(requests, 0);
});

test('broker persists a refresh cookie the renewal rotated', async () => {
  // Without this the stored cookie keeps its original expiry, so the session
  // dies one cookie lifetime after login however often it was renewed.
  let persisted: RefreshCookieMaterial | undefined;
  const broker = createOnTrackAuthBroker(
    { baseUrl: expiredSession.baseUrl },
    dependencies({
      readStoredRefreshCookie: () => ({
        username: 'student1',
        refreshToken: 'refresh-secret',
        expiresAt: '2026-08-07T00:00:00.000Z',
      }),
      httpRefreshAccessToken: async () => ({
        response: {
          auth_token: 'fresh-secret',
          auth_token_expiry: '2026-07-31T03:00:00.000Z',
          user: { username: 'student1' },
        },
        refreshCookie: {
          username: 'student1',
          refreshToken: 'rotated-secret',
          expiresAt: '2026-08-14T00:00:00.000Z',
        },
      }),
      persistRefreshCookie: (cookie) => {
        persisted = { ...cookie };
      },
    }),
  );

  const result = await broker.ensure({ minTtlSeconds: 600 });
  assert.equal(result.status, 'ready');
  assert.deepEqual(persisted, {
    username: 'student1',
    refreshToken: 'rotated-secret',
    expiresAt: '2026-08-14T00:00:00.000Z',
  });
});

test('broker reports a safe diagnostic when rotated-cookie persistence fails', async () => {
  let diagnostics: readonly AuthDiagnostic[] = [];
  const broker = createOnTrackAuthBroker(
    { baseUrl: expiredSession.baseUrl },
    dependencies({
      readStoredRefreshCookie: () => ({
        username: 'student1',
        refreshToken: 'refresh-secret',
      }),
      httpRefreshAccessToken: async () => ({
        response: {
          auth_token: 'fresh-secret',
          auth_token_expiry: '2026-07-31T03:00:00.000Z',
          user: { username: 'student1' },
        },
        refreshCookie: {
          username: 'student1',
          refreshToken: 'rotated-secret',
        },
      }),
      persistRefreshCookie: () => {
        throw new Error('rotated-secret must never be logged');
      },
      reportDiagnostic: (diagnostic) => {
        diagnostics = [...diagnostics, diagnostic];
      },
    }),
  );

  const result = await broker.ensure({ minTtlSeconds: 600 });
  assert.equal(result.status, 'ready');
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, 'refresh_cookie_persistence_failed');
  assert.match(diagnostics[0]?.message ?? '', /refresh cookie could not be persisted/i);
  assert.doesNotMatch(JSON.stringify(diagnostics), /fresh-secret|refresh-secret|rotated-secret/);
});

test('broker falls back to browser capture when the HTTP refresh is declined', async () => {
  let browserCaptures = 0;
  const broker = createOnTrackAuthBroker(
    { baseUrl: expiredSession.baseUrl },
    dependencies({
      readStoredRefreshCookie: () => ({
        username: 'student1',
        refreshToken: 'stale-refresh',
      }),
      httpRefreshAccessToken: async () => null,
      captureStoredSession: async () => {
        browserCaptures += 1;
        return null;
      },
    }),
  );

  const result = await broker.ensure({ interaction: 'never' });
  assert.equal(result.status, 'auth_required');
  assert.equal(browserCaptures, 1);
});

test('broker never replays a stored-browser page token through the /auth exchange', async () => {
  // The probe marks a token read from page storage, cookies or request headers
  // live. POST /auth answers 419 for one, and without an expiry it cannot
  // become a lifecycle-aware session either, so the broker asks for sign-in.
  let exchanges = 0;
  const broker = createOnTrackAuthBroker(
    { baseUrl: expiredSession.baseUrl },
    dependencies({
      captureStoredSession: async () => ({
        username: 'student1',
        authToken: 'page-token',
        source: 'local_storage',
        contract: 'access-token',
      }),
      exchangeLegacyCredential: async () => {
        exchanges += 1;
        throw new Error('419 Authentication Timeout');
      },
    }),
  );

  const result = await broker.ensure({ interaction: 'never' });
  assert.equal(result.status, 'auth_required');
  assert.equal(exchanges, 0);
});

test('broker persists a refresh cookie captured during the legacy exchange', async () => {
  let persisted: { cookie: unknown; baseUrl: string } | undefined;
  const broker = createOnTrackAuthBroker(
    { baseUrl: expiredSession.baseUrl },
    dependencies({
      captureStoredSession: async () => ({
        username: 'student1',
        authToken: 'legacy-token',
        expiresAt: '2026-07-31T03:00:00.000Z',
        source: 'auth_response',
        contract: 'legacy-auth',
      }),
      exchangeLegacyCredential: async (): Promise<CapturedSignIn> => ({
        response: {
          auth_token: 'fresh-secret',
          auth_token_expiry: '2026-07-31T03:00:00.000Z',
          user: { username: 'student1' },
        },
        refreshCookie: {
          username: 'student1',
          refreshToken: 'refresh-secret',
          expiresAt: '2026-08-07T00:00:00.000Z',
        },
      }),
      persistRefreshCookie: (cookie, baseUrl) => {
        persisted = { cookie, baseUrl };
      },
    }),
  );

  const result = await broker.ensure({ minTtlSeconds: 600 });
  assert.equal(result.status, 'ready');
  assert.deepEqual(persisted, {
    cookie: {
      username: 'student1',
      refreshToken: 'refresh-secret',
      expiresAt: '2026-08-07T00:00:00.000Z',
    },
    baseUrl: 'https://ontrack.example/api',
  });
});
