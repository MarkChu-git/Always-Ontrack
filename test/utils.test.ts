import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isHeadlessServerEnvironment,
  normalizeBaseUrl,
  parseSsoRedirectUrl,
  redactSensitiveText,
  resolveLoginMode,
  shouldMaskPromptInput,
} from '../src/lib/utils.js';

test('normalizeBaseUrl converts site URLs to /api', () => {
  assert.equal(normalizeBaseUrl('https://ontrack.infotech.monash.edu/home'), 'https://ontrack.infotech.monash.edu/api');
  assert.equal(normalizeBaseUrl('https://ontrack.infotech.monash.edu/api'), 'https://ontrack.infotech.monash.edu/api');
});

test('parseSsoRedirectUrl extracts auth token and username', () => {
  const parsed = parseSsoRedirectUrl(
    'https://ontrack.infotech.monash.edu/sign_in?authToken=abc123&username=student1',
  );

  assert.deepEqual(parsed, {
    authToken: 'abc123',
    username: 'student1',
  });
});

test('shouldMaskPromptInput only masks on tty streams', () => {
  assert.equal(
    shouldMaskPromptInput({ isTTY: true } as NodeJS.ReadStream, { isTTY: true } as NodeJS.WriteStream),
    true,
  );
  assert.equal(
    shouldMaskPromptInput({ isTTY: true } as NodeJS.ReadStream, { isTTY: false } as NodeJS.WriteStream),
    false,
  );
});

test('isHeadlessServerEnvironment detects ssh and explicit overrides', () => {
  assert.equal(
    isHeadlessServerEnvironment(
      { SSH_CONNECTION: '1', CI: '' },
      {
        stdin: { isTTY: true },
        stdout: { isTTY: true },
      },
    ),
    true,
  );

  assert.equal(
    isHeadlessServerEnvironment(
      { ONTRACK_HEADLESS: 'false', CI: 'true' },
      {
        stdin: { isTTY: false },
        stdout: { isTTY: false },
      },
    ),
    false,
  );
});

test('resolveLoginMode prefers auto, then explicit sso, then headless default sso', () => {
  assert.equal(
    resolveLoginMode({
      auto: true,
      sso: true,
      hasAuthToken: false,
      hasUsername: false,
      hasRedirectUrl: false,
      isHeadless: true,
    }),
    'auto',
  );

  assert.equal(
    resolveLoginMode({
      auto: false,
      sso: true,
      hasAuthToken: false,
      hasUsername: false,
      hasRedirectUrl: false,
      isHeadless: false,
    }),
    'sso_guided',
  );

  assert.equal(
    resolveLoginMode({
      auto: false,
      sso: false,
      hasAuthToken: false,
      hasUsername: false,
      hasRedirectUrl: false,
      isHeadless: true,
    }),
    'sso_guided',
  );

  assert.equal(
    resolveLoginMode({
      auto: false,
      sso: false,
      hasAuthToken: false,
      hasUsername: false,
      hasRedirectUrl: true,
      isHeadless: true,
    }),
    'manual',
  );
});

test('redactSensitiveText masks URL query tokens and key value pairs', () => {
  const input =
    'failed at https://a.test/sign_in?authToken=abc123&username=mark&code=xyz with password=secret and "access_token":"v1"';
  const output = redactSensitiveText(input);
  assert.equal(output.includes('authToken=[REDACTED]'), true);
  assert.equal(output.includes('code=[REDACTED]'), true);
  assert.equal(output.includes('password=[REDACTED]'), true);
  assert.equal(output.includes('"access_token":"[REDACTED]"'), true);
});
