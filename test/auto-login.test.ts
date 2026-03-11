import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SsoFallbackError,
  classifySsoFallback,
  extractMfaNumberChallengeFromText,
  extractCredentialsFromAuthPayload,
  extractCredentialsFromCookieJar,
  extractCredentialsFromUrl,
  resolveBrowserLaunchPlan,
} from '../src/lib/auto-login.js';

test('extractCredentialsFromUrl parses authToken and username', () => {
  const parsed = extractCredentialsFromUrl(
    'https://ontrack.infotech.monash.edu/sign_in?authToken=abc123&username=student1',
  );

  assert.deepEqual(parsed, {
    authToken: 'abc123',
    username: 'student1',
    source: 'url',
  });
});

test('extractCredentialsFromUrl returns null when params are missing', () => {
  const parsed = extractCredentialsFromUrl('https://ontrack.infotech.monash.edu/home');
  assert.equal(parsed, null);
});

test('extractCredentialsFromAuthPayload parses request payload', () => {
  const parsed = extractCredentialsFromAuthPayload({
    auth_token: 'token-1',
    username: 'student1',
    remember: true,
  });

  assert.deepEqual(parsed, {
    authToken: 'token-1',
    username: 'student1',
    source: 'auth_request',
  });
});

test('extractCredentialsFromAuthPayload supports camelCase authToken', () => {
  const parsed = extractCredentialsFromAuthPayload({
    authToken: 'token-2',
    username: 'student2',
  });

  assert.deepEqual(parsed, {
    authToken: 'token-2',
    username: 'student2',
    source: 'auth_request',
  });
});

test('extractCredentialsFromCookieJar parses credentials when both values exist', () => {
  const parsed = extractCredentialsFromCookieJar([
    { name: 'auth_token', value: 'cookie-token' },
    { name: 'username', value: 'cookie-user' },
  ]);

  assert.deepEqual(parsed, {
    authToken: 'cookie-token',
    username: 'cookie-user',
    source: 'cookie',
  });
});

test('extractCredentialsFromCookieJar returns null when cookie values are incomplete', () => {
  const parsed = extractCredentialsFromCookieJar([{ name: 'auth_token', value: 'cookie-token' }]);
  assert.equal(parsed, null);
});

test('resolveBrowserLaunchPlan uses ONTRACK_BROWSER_PATH first', () => {
  const plan = resolveBrowserLaunchPlan(
    { ONTRACK_BROWSER_PATH: '/custom/chrome' } as NodeJS.ProcessEnv,
    (path) => path === '/custom/chrome',
  );

  assert.deepEqual(plan, {
    source: 'env',
    executablePath: '/custom/chrome',
  });
});

test('resolveBrowserLaunchPlan falls back to bundled when no browser exists', () => {
  const plan = resolveBrowserLaunchPlan({} as NodeJS.ProcessEnv, () => false);
  assert.equal(plan.source, 'bundled');
  assert.equal(plan.executablePath, undefined);
});

test('resolveBrowserLaunchPlan selects system browser when available', () => {
  const plan = resolveBrowserLaunchPlan(
    {} as NodeJS.ProcessEnv,
    () => true,
  );
  assert.equal(plan.source, 'system');
  assert.equal(typeof plan.executablePath, 'string');
  assert.equal((plan.executablePath || '').length > 0, true);
});

test('classifySsoFallback maps known fallback reasons', () => {
  assert.equal(
    classifySsoFallback(new SsoFallbackError('captcha', 'fallback', 'captcha detected')),
    'captcha',
  );
  assert.equal(classifySsoFallback(new Error('Unsupported MFA: webauthn challenge')), 'unsupported_mfa');
  assert.equal(classifySsoFallback(new Error('Unable to locate username field selector')), 'selector_missing');
  assert.equal(classifySsoFallback(new Error('Timeout waiting for verify')), 'timeout');
});

test('extractMfaNumberChallengeFromText finds number challenge code', () => {
  const numbers = extractMfaNumberChallengeFromText(`
    Check your Okta Verify app.
    Enter the following number to sign in:
    68
  `);

  assert.deepEqual(numbers, ['68']);
});

test('extractMfaNumberChallengeFromText supports multi-option number challenge', () => {
  const numbers = extractMfaNumberChallengeFromText(`
    Number challenge
    Select the matching number in Okta Verify
    12 / 35 / 87
  `);

  assert.deepEqual(numbers, ['12', '35', '87']);
});

test('extractMfaNumberChallengeFromText ignores unrelated numbers', () => {
  const numbers = extractMfaNumberChallengeFromText(`
    Verify it's you with a security method
    Last signed in 2026-03-11
  `);

  assert.deepEqual(numbers, []);
});
