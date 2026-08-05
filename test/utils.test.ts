import { test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  isHeadlessServerEnvironment,
  normalizeBaseUrl,
  resolveExternalOpenCommand,
  parseSsoRedirectUrl,
  redactSensitiveText,
  resolveLoginMode,
  shouldMaskPromptInput,
} from '../src/lib/utils.js';

test('external opener accepts only safe HTTP(S) URLs and never uses a shell command', () => {
  assert.deepEqual(
    resolveExternalOpenCommand(
      'https://ontrack.infotech.monash.edu/sign_in?next=%2Fhome',
      'win32',
    ),
    {
      command: 'rundll32.exe',
      args: ['url.dll,FileProtocolHandler', 'https://ontrack.infotech.monash.edu/sign_in?next=%2Fhome'],
    },
  );
  assert.deepEqual(
    resolveExternalOpenCommand('https://example.test/path', 'darwin'),
    { command: 'open', args: ['https://example.test/path'] },
  );
  assert.deepEqual(
    resolveExternalOpenCommand('https://example.test/path', 'linux'),
    { command: 'xdg-open', args: ['https://example.test/path'] },
  );
  assert.throws(
    () => resolveExternalOpenCommand('javascript:alert(1)', 'linux'),
    /HTTP\(S\)/,
  );
  assert.throws(
    () => resolveExternalOpenCommand('https://example.test/%0aopen', 'linux'),
    /control characters/,
  );
});

test('normalizeBaseUrl converts site URLs to /api', () => {
  assert.equal(normalizeBaseUrl('https://ontrack.infotech.monash.edu/home'), 'https://ontrack.infotech.monash.edu/api');
  assert.equal(normalizeBaseUrl('https://ontrack.infotech.monash.edu/api'), 'https://ontrack.infotech.monash.edu/api');
});

test('normalizeBaseUrl rejects embedded credentials and insecure remote origins', () => {
  assert.throws(
    () => normalizeBaseUrl('https://student:secret@ontrack.example'),
    /must not include embedded credentials/,
  );
  assert.throws(
    () => normalizeBaseUrl('http://ontrack.example'),
    /must use HTTPS/,
  );
  assert.equal(
    normalizeBaseUrl('http://127.0.0.1:3000'),
    'http://127.0.0.1:3000/api',
  );
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

test('resolveLoginMode prefers auto, then guided sso as the default path', () => {
  assert.equal(
    resolveLoginMode({
      auto: true,
      sso: true,
      hasAuthToken: false,
      hasUsername: false,
      hasRedirectUrl: false,
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

test('redactSensitiveText masks auth headers and unquoted token fields without changing normal text', () => {
  const secrets = ['header-secret', 'bearer-secret', 'bare-secret', 'json-secret'];
  const input = [
    'Auth-Token: header-secret',
    'Authorization: Bearer bearer-secret',
    'authToken: bare-secret',
    '{"authToken":"json-secret"}',
    'status: normal text remains visible',
  ].join('; ');

  const output = redactSensitiveText(input);
  for (const secret of secrets) {
    assert.equal(output.includes(secret), false, `output leaked ${secret}`);
  }
  assert.match(output, /Auth-Token: \[REDACTED\]/);
  assert.match(output, /Authorization: \[REDACTED\]/);
  assert.match(output, /authToken: \[REDACTED\]/);
  assert.match(output, /"authToken":"\[REDACTED\]"/);
  assert.equal(output.includes('status: normal text remains visible'), true);
});

test('redactSensitiveText masks PII, Basic auth, API keys, and private-key markers', () => {
  const secrets = [
    'student@example.edu',
    '0400 000 000',
    'dXNlcjpwYXNz',
    'production-api-key',
    'private-key-material',
  ];
  const input = [
    'email=student@example.edu',
    'phone: 0400 000 000',
    'Authorization: Basic dXNlcjpwYXNz',
    'api_key=production-api-key',
    '-----BEGIN PRIVATE KEY-----\nprivate-key-material\n-----END PRIVATE KEY-----',
  ].join('; ');

  const output = redactSensitiveText(input);
  for (const secret of secrets) {
    assert.equal(output.includes(secret), false, `output leaked ${secret}`);
  }
});
