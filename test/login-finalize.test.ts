import { afterEach, beforeEach, test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OnTrackApiClient } from '../src/lib/api.js';
import { OnTrackHttpError, OnTrackTransportError } from '../src/lib/auth.js';
import {
  finalizeCapturedLogin,
  PairedCredentialRejectedError,
  type CapturedLoginMaterial,
} from '../src/lib/login-finalize.js';

/**
 * Which credentials may be replayed through `POST /auth` and which may not is
 * what decides whether login works at all: OnTrack answers 419 when an already
 * active access token is offered there, so a pairing capture that is already a
 * live API token has to be persisted as-is.
 */

const BASE_URL = 'https://ontrack.example.test/api';
const PAIRED_TOKEN = 'paired-token';
const EXCHANGED_TOKEN = 'exchanged-token';

const originalFetch = globalThis.fetch;
const originalConfigHome = process.env.XDG_CONFIG_HOME;
let configRoot = '';

interface RecordedCall {
  url: string;
  method: string;
}

function mockFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): RecordedCall[] {
  const calls: RecordedCall[] = [];
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET' });
    return handler(String(input), init);
  }) as typeof fetch;
  return calls;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function exchangeResponse(): Response {
  return jsonResponse(
    {
      auth_token: EXCHANGED_TOKEN,
      auth_token_expiry: '2026-08-21T00:00:00.000Z',
      user: { id: 1, username: 'student1', role: 'student' },
    },
    201,
  );
}

function pairedMaterial(
  overrides: Partial<CapturedLoginMaterial> = {},
): CapturedLoginMaterial {
  return {
    authToken: PAIRED_TOKEN,
    username: 'student1',
    source: 'pair-relay',
    ...overrides,
  };
}

function readPersistedSession(): Promise<string> {
  return readFile(join(configRoot, 'ontrack-cli', 'session.json'), 'utf8');
}

beforeEach(async () => {
  configRoot = await mkdtemp(join(tmpdir(), 'ontrack-finalize-'));
  process.env.XDG_CONFIG_HOME = configRoot;
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  if (originalConfigHome === undefined) {
    delete process.env.XDG_CONFIG_HOME;
  } else {
    process.env.XDG_CONFIG_HOME = originalConfigHome;
  }
  await rm(configRoot, { recursive: true, force: true });
});

test('a verified paired credential is persisted without a /auth exchange', async () => {
  const calls = mockFetch((url) => {
    assert.match(url, /\/api\/projects$/);
    return jsonResponse([], 200);
  });

  const session = await finalizeCapturedLogin(
    new OnTrackApiClient(BASE_URL),
    pairedMaterial({ expiresAt: '2026-08-21T00:00:00.000Z' }),
  );

  assert.equal(session.authToken, PAIRED_TOKEN);
  assert.equal(session.expiresAt, '2026-08-21T00:00:00.000Z');
  assert.equal(session.source, 'pair-relay');
  assert.deepEqual(calls.map((call) => call.method), ['GET']);
  assert.match(await readPersistedSession(), new RegExp(PAIRED_TOKEN));
});

test('a paired credential is kept when verification is inconclusive', async () => {
  // 403 for a restricted role and 5xx say nothing about the credential, so the
  // token must not be thrown into an exchange that would reject it.
  for (const status of [403, 500]) {
    const calls = mockFetch(() => jsonResponse({ error: 'nope' }, status));
    const session = await finalizeCapturedLogin(
      new OnTrackApiClient(BASE_URL),
      pairedMaterial(),
    );
    assert.equal(session.authToken, PAIRED_TOKEN);
    assert.equal(calls.length, 1, `status ${status} must not trigger an exchange`);
  }
});

test('a paired credential is kept when verification cannot reach the server', async () => {
  const calls = mockFetch(() => {
    throw new Error('connect ECONNREFUSED');
  });

  const session = await finalizeCapturedLogin(
    new OnTrackApiClient(BASE_URL),
    pairedMaterial(),
  );

  assert.equal(session.authToken, PAIRED_TOKEN);
  assert.equal(calls.length, 1);
});

test('a paired credential OnTrack rejects is retried through the /auth exchange', async () => {
  const calls = mockFetch((url) =>
    /\/api\/projects$/.test(url)
      ? jsonResponse({ error: 'unauthorized' }, 401)
      : exchangeResponse(),
  );

  const session = await finalizeCapturedLogin(
    new OnTrackApiClient(BASE_URL),
    pairedMaterial(),
  );

  assert.equal(session.authToken, EXCHANGED_TOKEN);
  assert.equal(session.source, 'pair-relay');
  assert.deepEqual(calls.map((call) => call.method), ['GET', 'POST']);
});

test('a declared legacy-auth pairing contract exchanges without verifying first', async () => {
  const calls = mockFetch((url) => {
    assert.match(url, /\/api\/auth$/);
    return exchangeResponse();
  });

  const session = await finalizeCapturedLogin(
    new OnTrackApiClient(BASE_URL),
    pairedMaterial({ contract: 'legacy-auth' }),
  );

  assert.equal(session.authToken, EXCHANGED_TOKEN);
  assert.deepEqual(calls.map((call) => call.method), ['POST']);
});

test('a declared legacy-auth pairing contract reports a 419 as re-pairing guidance', async () => {
  // This is the landing-URL paste path, and a spent token is its normal failure;
  // the raw 419 would say nothing about what to do next.
  mockFetch(() => jsonResponse({ error: 'Authentication Timeout' }, 419));

  await assert.rejects(
    () =>
      finalizeCapturedLogin(
        new OnTrackApiClient(BASE_URL),
        pairedMaterial({ contract: 'legacy-auth' }),
      ),
    PairedCredentialRejectedError,
  );
});

test('a declared legacy-auth pairing contract preserves 5xx and transport failures', async () => {
  for (const scenario of [
    {
      fetch: () => jsonResponse({ error: 'service unavailable' }, 503),
      expected: OnTrackHttpError,
    },
    {
      fetch: () => {
        throw new Error('connect ECONNREFUSED');
      },
      expected: OnTrackTransportError,
    },
  ]) {
    mockFetch(scenario.fetch);
    await assert.rejects(
      () =>
        finalizeCapturedLogin(
          new OnTrackApiClient(BASE_URL),
          pairedMaterial({ contract: 'legacy-auth' }),
        ),
      (error: unknown) => {
        assert.ok(error instanceof scenario.expected);
        assert.equal(error instanceof PairedCredentialRejectedError, false);
        return true;
      },
    );
  }
});

test('a rejected access-token pairing contract is never offered to the exchange', async () => {
  // The bookmarklet minted it, so a rejection means the token is dead; the
  // exchange would only answer with the 419 this path exists to avoid.
  const calls = mockFetch(() => jsonResponse({ error: 'unauthorized' }, 401));

  await assert.rejects(
    () =>
      finalizeCapturedLogin(
        new OnTrackApiClient(BASE_URL),
        pairedMaterial({ contract: 'access-token', expiresAt: '2026-08-21T00:00:00.000Z' }),
      ),
    PairedCredentialRejectedError,
  );
  assert.deepEqual(calls.map((call) => call.method), ['GET']);
});

test('a paired credential rejected on both paths fails with re-pairing guidance', async () => {
  mockFetch(() => jsonResponse({ error: 'Authentication Timeout' }, 419));

  await assert.rejects(
    () => finalizeCapturedLogin(new OnTrackApiClient(BASE_URL), pairedMaterial()),
    (error: unknown) => {
      assert.ok(error instanceof PairedCredentialRejectedError);
      assert.match(error.message, /reinstall the pairing bookmarklet/);
      return true;
    },
  );
  // A rejected credential must not leave a session behind for later commands.
  await assert.rejects(() => stat(join(configRoot, 'ontrack-cli', 'session.json')));
});

test('a browser access-token capture still persists with no HTTP at all', async () => {
  const calls = mockFetch(() => {
    throw new Error('no request expected');
  });

  const session = await finalizeCapturedLogin(new OnTrackApiClient(BASE_URL), {
    authToken: 'browser-access-token',
    username: 'student1',
    expiresAt: '2026-08-21T00:00:00.000Z',
    contract: 'access-token',
    source: 'access-token',
  });

  assert.equal(session.authToken, 'browser-access-token');
  assert.equal(session.source, 'access-token');
  assert.equal(calls.length, 0);
});
