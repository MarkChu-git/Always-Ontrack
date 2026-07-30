import { test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  classifyAuthFailure,
  createSessionFromAccessToken,
  migrateLegacySession,
  sessionUsability,
} from '../src/lib/auth.js';

const legacy = {
  baseUrl: 'https://ontrack.infotech.monash.edu/api',
  username: 'student1',
  authToken: 'secret-token',
  user: { id: 1, role: 'Student' },
  savedAt: '2026-07-31T00:00:00.000Z',
};

test('migrateLegacySession preserves credentials immutably and marks their unknown legacy lifecycle', () => {
  const migrated = migrateLegacySession(legacy);
  assert.deepEqual(migrated, { ...legacy, source: 'legacy' });
  assert.notEqual(migrated, legacy);
  assert.equal(legacy.source, undefined);
});

test('access-token response creates an expiry-aware browser session without exposing the token in status', () => {
  const session = createSessionFromAccessToken(legacy.baseUrl, 'student1', {
    auth_token: 'secret-token',
    auth_token_expiry: '2026-08-01T00:00:00.000Z',
    user: { id: 1, role: 'Student' },
  }, '2026-07-31T00:00:00.000Z');
  assert.equal(session.expiresAt, '2026-08-01T00:00:00.000Z');
  assert.equal(session.source, 'access-token');
  assert.deepEqual(sessionUsability(session, new Date('2026-07-31T12:00:00.000Z')), {
    state: 'usable',
    expiresAt: '2026-08-01T00:00:00.000Z',
  });
});

test('session usability fails closed for malformed or expired expiry but permits legacy migration only as unknown', () => {
  assert.deepEqual(sessionUsability({ ...legacy, expiresAt: 'bad-date' }, new Date()), { state: 'expired' });
  assert.deepEqual(sessionUsability({ ...legacy, expiresAt: '2026-07-30T00:00:00.000Z' }, new Date('2026-07-31')), { state: 'expired', expiresAt: '2026-07-30T00:00:00.000Z' });
  assert.deepEqual(sessionUsability(migrateLegacySession(legacy), new Date()), { state: 'unknown' });
});

test('auth failure classification centralizes only 401 and 419', () => {
  assert.equal(classifyAuthFailure(401), 'unauthorized');
  assert.equal(classifyAuthFailure(419), 'expired');
  assert.equal(classifyAuthFailure(403), 'other');
});
