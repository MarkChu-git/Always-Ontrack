import { test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  createOnTrackAuthBroker,
  type OnTrackAuthBrokerDependencies,
} from '../src/lib/auth-broker.js';
import type { LoginCredentials } from '../src/lib/auto-login.js';
import type { CapturedSignIn } from '../src/lib/api.js';
import type { SessionData } from '../src/lib/types.js';

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
        auth_token: 'fresh-secret',
        auth_token_expiry: '2026-07-31T03:00:00.000Z',
        user: { username: 'student1' },
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
