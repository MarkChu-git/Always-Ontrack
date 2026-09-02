import { test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  persistRefreshCookieBestEffort,
  REFRESH_COOKIE_PERSISTENCE_DIAGNOSTIC,
  type AuthDiagnostic,
} from '../src/lib/auth-diagnostic.js';

test('refresh-cookie persistence failure emits one structured safe diagnostic', () => {
  let diagnostics: readonly AuthDiagnostic[] = [];

  persistRefreshCookieBestEffort(
    () => {
      throw new Error('rotated-secret must never be reported');
    },
    (diagnostic) => {
      diagnostics = [...diagnostics, diagnostic];
    },
  );

  assert.deepEqual(diagnostics, [REFRESH_COOKIE_PERSISTENCE_DIAGNOSTIC]);
  assert.equal(diagnostics[0]?.code, 'refresh_cookie_persistence_failed');
  assert.doesNotMatch(JSON.stringify(diagnostics), /rotated-secret/);
});

test('successful refresh-cookie persistence emits no diagnostic', () => {
  let calls = 0;
  let diagnostics: readonly AuthDiagnostic[] = [];

  persistRefreshCookieBestEffort(
    () => {
      calls += 1;
    },
    (diagnostic) => {
      diagnostics = [...diagnostics, diagnostic];
    },
  );

  assert.equal(calls, 1);
  assert.deepEqual(diagnostics, []);
});

test('a failing diagnostic sink cannot invalidate a usable credential', () => {
  assert.doesNotThrow(() =>
    persistRefreshCookieBestEffort(
      () => {
        throw new Error('persistence unavailable');
      },
      () => {
        throw new Error('presentation unavailable');
      },
    ),
  );
});
