import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'bun:test';
import {
  createAuthRuntime,
  type AuthRuntimeAdapter,
} from '../src/lib/auth-runtime.js';
import {
  saveSession,
  withSessionRefreshLock,
} from '../src/lib/session.js';
import type { SessionData } from '../src/lib/types.js';

const baseSession: SessionData = {
  baseUrl: 'https://ontrack.example/api',
  username: 'student1',
  authToken: 'cached-token-must-not-leak',
  user: { username: 'student1' },
  savedAt: '2026-07-31T00:00:00.000Z',
  expiresAt: '2026-07-31T01:00:00.000Z',
  source: 'access-token',
  refreshedAt: '2026-07-31T00:00:00.000Z',
};

function freshSession(token: string = 'refreshed-token-must-not-leak'): SessionData {
  return {
    ...baseSession,
    authToken: token,
    expiresAt: '2026-07-31T02:00:00.000Z',
    refreshedAt: '2026-07-31T00:30:00.000Z',
  };
}

function createAdapter(overrides: Partial<AuthRuntimeAdapter> = {}): AuthRuntimeAdapter {
  let session: SessionData | null = baseSession;
  return {
    loadSession: async () => session,
    saveSession: async (next) => {
      session = next;
    },
    withRefreshLock: async (operation) => operation(),
    silentRefresh: async () => null,
    beginInteractiveLogin: async () => null,
    ...overrides,
  };
}

test('auth runtime returns ready without adapter refresh when expiry exceeds the requested margin', async () => {
  let refreshCalls = 0;
  const runtime = createAuthRuntime(createAdapter({
    silentRefresh: async () => {
      refreshCalls += 1;
      return freshSession();
    },
    now: () => new Date('2026-07-31T00:00:00.000Z'),
  }));

  const result = await runtime.ensure({ minTtlSeconds: 600 });

  assert.deepEqual(result, {
    status: 'ready',
    expiresAt: '2026-07-31T01:00:00.000Z',
    refreshed: false,
  });
  assert.equal(refreshCalls, 0);
  assert.equal(JSON.stringify(result).includes(baseSession.authToken), false);
});

test('auth runtime silently refreshes sessions inside the expiry margin and persists the replacement', async () => {
  let saved: SessionData | undefined;
  let refreshCalls = 0;
  const runtime = createAuthRuntime(createAdapter({
    silentRefresh: async () => {
      refreshCalls += 1;
      return freshSession();
    },
    saveSession: async (session) => {
      saved = session;
    },
    now: () => new Date('2026-07-31T00:55:00.000Z'),
  }));

  const result = await runtime.ensure({ minTtlSeconds: 600 });

  assert.deepEqual(result, {
    status: 'ready',
    expiresAt: '2026-07-31T02:00:00.000Z',
    refreshed: true,
  });
  assert.equal(refreshCalls, 1);
  assert.equal(saved?.authToken, 'refreshed-token-must-not-leak');
  assert.equal(JSON.stringify(result).includes('refreshed-token-must-not-leak'), false);
});

test('auth runtime force refresh bypasses a locally usable token after server rejection', async () => {
  let refreshCalls = 0;
  const runtime = createAuthRuntime(createAdapter({
    silentRefresh: async () => {
      refreshCalls += 1;
      return freshSession();
    },
    now: () => new Date('2026-07-31T00:00:00.000Z'),
  }));

  const result = await runtime.ensure({
    minTtlSeconds: 0,
    interaction: 'never',
    forceRefresh: true,
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.status === 'ready' && result.refreshed, true);
  assert.equal(refreshCalls, 1);
});

test('auth runtime starts interactive fallback only when silent refresh cannot produce a session', async () => {
  let interactiveCalls = 0;
  const runtime = createAuthRuntime(createAdapter({
    silentRefresh: async () => null,
    beginInteractiveLogin: async () => {
      interactiveCalls += 1;
      return freshSession('interactive-token-must-not-leak');
    },
    now: () => new Date('2026-07-31T00:55:00.000Z'),
  }));

  const result = await runtime.ensure({
    minTtlSeconds: 600,
    interaction: 'if_required',
  });

  assert.deepEqual(result, {
    status: 'ready',
    expiresAt: '2026-07-31T02:00:00.000Z',
    refreshed: true,
  });
  assert.equal(interactiveCalls, 1);
  assert.equal(JSON.stringify(result).includes('interactive-token-must-not-leak'), false);
});

test('auth runtime reports auth_required without starting an interactive flow when interaction is disabled', async () => {
  let interactiveCalls = 0;
  const runtime = createAuthRuntime(createAdapter({
    silentRefresh: async () => null,
    beginInteractiveLogin: async () => {
      interactiveCalls += 1;
      return freshSession();
    },
    now: () => new Date('2026-07-31T00:55:00.000Z'),
  }));

  const result = await runtime.ensure({ minTtlSeconds: 600, interaction: 'never' });

  assert.deepEqual(result, {
    status: 'auth_required',
    code: 'HUMAN_VERIFICATION_REQUIRED',
    retryable: true,
  });
  assert.equal(interactiveCalls, 0);
});

test('auth runtime deduplicates concurrent same-process refresh operations', async () => {
  let refreshCalls = 0;
  let releaseRefresh: (() => void) | undefined;
  const refreshGate = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  const runtime = createAuthRuntime(createAdapter({
    silentRefresh: async () => {
      refreshCalls += 1;
      await refreshGate;
      return freshSession();
    },
    now: () => new Date('2026-07-31T00:55:00.000Z'),
  }));

  const first = runtime.ensure({ minTtlSeconds: 600 });
  const second = runtime.ensure({ minTtlSeconds: 600 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(refreshCalls, 1);
  releaseRefresh?.();

  assert.deepEqual(await Promise.all([first, second]), [
    {
      status: 'ready',
      expiresAt: '2026-07-31T02:00:00.000Z',
      refreshed: true,
    },
    {
      status: 'ready',
      expiresAt: '2026-07-31T02:00:00.000Z',
      refreshed: true,
    },
  ]);
});

test('separate runtimes reuse a credential refreshed while waiting on the shared lock', async () => {
  let session: SessionData | null = baseSession;
  let refreshCalls = 0;
  let lockTail = Promise.resolve();
  const adapter = createAdapter({
    loadSession: async () => session,
    saveSession: async (next) => {
      session = next;
    },
    withRefreshLock: async <T>(operation: () => Promise<T>): Promise<T> => {
      const previous = lockTail;
      let release: (() => void) | undefined;
      lockTail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await operation();
      } finally {
        release?.();
      }
    },
    silentRefresh: async () => {
      refreshCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return freshSession(`replacement-${refreshCalls}`);
    },
    now: () => new Date('2026-07-31T00:00:00.000Z'),
  });
  const first = createAuthRuntime(adapter);
  const second = createAuthRuntime(adapter);

  const results = await Promise.all([
    first.ensure({ minTtlSeconds: 0, forceRefresh: true }),
    second.ensure({ minTtlSeconds: 0, forceRefresh: true }),
  ]);

  assert.equal(refreshCalls, 1);
  assert.equal(results[0].status, 'ready');
  assert.equal(results[1].status, 'ready');
});

test('auth runtime stops on silent refresh failure without opening interactive login or exposing the cause', async () => {
  let interactiveCalls = 0;
  const runtime = createAuthRuntime(createAdapter({
    silentRefresh: async () => {
      throw new Error('private refresh diagnostic token=do-not-leak');
    },
    beginInteractiveLogin: async () => {
      interactiveCalls += 1;
      return freshSession();
    },
    now: () => new Date('2026-07-31T00:55:00.000Z'),
  }));

  const result = await runtime.ensure({ minTtlSeconds: 600, interaction: 'if_required' });

  assert.deepEqual(result, {
    status: 'error',
    code: 'AUTH_REFRESH_FAILED',
    retryable: true,
  });
  assert.equal(interactiveCalls, 0);
  assert.equal(JSON.stringify(result).includes('do-not-leak'), false);
});

test('auth runtime converts refresh-lock failures into a redacted terminal error result', async () => {
  const runtime = createAuthRuntime(createAdapter({
    withRefreshLock: async () => {
      throw new Error('lock credential detail must not escape');
    },
    now: () => new Date('2026-07-31T00:55:00.000Z'),
  }));

  const result = await runtime.ensure({ minTtlSeconds: 600 });

  assert.deepEqual(result, {
    status: 'error',
    code: 'AUTH_REFRESH_FAILED',
    retryable: true,
  });
  assert.equal(JSON.stringify(result).includes('credential detail'), false);
});

test('session refresh lock serializes contenders, recovers a stale lock, times out on a fresh lock, and releases in finally', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ontrack-auth-runtime-'));
  const lockPath = join(root, 'refresh.lock');
  try {
    let active = 0;
    let peakActive = 0;
    await Promise.all([
      withSessionRefreshLock(async () => {
        active += 1;
        peakActive = Math.max(peakActive, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
      }, { lockPath, timeoutMs: 200, pollIntervalMs: 2 }),
      withSessionRefreshLock(async () => {
        active += 1;
        peakActive = Math.max(peakActive, active);
        active -= 1;
      }, { lockPath, timeoutMs: 200, pollIntervalMs: 2 }),
    ]);
    assert.equal(peakActive, 1);
    assert.equal(existsSync(lockPath), false);

    active = 0;
    peakActive = 0;
    await Promise.all([
      withSessionRefreshLock(async () => {
        active += 1;
        peakActive = Math.max(peakActive, active);
        await new Promise((resolve) => setTimeout(resolve, 45));
        active -= 1;
      }, {
        lockPath,
        timeoutMs: 150,
        staleMs: 12,
        pollIntervalMs: 2,
      }),
      new Promise<void>((resolve, reject) => {
        setTimeout(() => {
          void withSessionRefreshLock(async () => {
            active += 1;
            peakActive = Math.max(peakActive, active);
            active -= 1;
          }, {
            lockPath,
            timeoutMs: 150,
            staleMs: 12,
            pollIntervalMs: 2,
          }).then(resolve, reject);
        }, 18);
      }),
    ]);
    assert.equal(peakActive, 1);
    assert.equal(existsSync(lockPath), false);

    await mkdir(lockPath);
    await writeFile(join(lockPath, 'owner.json'), '{}');
    await utimes(lockPath, new Date(0), new Date(0));
    await withSessionRefreshLock(async () => undefined, {
      lockPath,
      timeoutMs: 100,
      staleMs: 1,
      pollIntervalMs: 2,
    });
    assert.equal(existsSync(lockPath), false);

    await mkdir(lockPath);
    await assert.rejects(
      () => withSessionRefreshLock(async () => undefined, {
        lockPath,
        timeoutMs: 20,
        staleMs: 60_000,
        pollIntervalMs: 2,
      }),
      /Timed out acquiring session refresh lock/,
    );
    await rm(lockPath, { recursive: true, force: true });

    await assert.rejects(
      () => withSessionRefreshLock(async () => {
        throw new Error('expected action failure');
      }, { lockPath }),
      /expected action failure/,
    );
    assert.equal(existsSync(lockPath), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('saveSession atomically replaces a session file without leaving a temporary credential file', async () => {
  const root = join(tmpdir(), `ontrack-auth-session-${crypto.randomUUID()}`);
  const sessionPath = join(root, 'nested', 'session.json');
  try {
    await saveSession(freshSession(), { sessionPath });
    const names = await readdir(join(root, 'nested'));
    assert.deepEqual(names, ['session.json']);
    assert.equal(existsSync(sessionPath), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
