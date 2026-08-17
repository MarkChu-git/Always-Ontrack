import { test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  isHeadlessServerEnvironment,
  normalizeBaseUrl,
  resolveExternalOpenCommand,
  parseSsoRedirectUrl,
  redactSensitiveText,
  resolveLoginMode,
  safeTextForHumanDisplay,
  safeUrlForHumanDisplay,
  safeUrlForManualDisplay,
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

test('human URL display removes query and fragment data', () => {
  assert.equal(
    safeUrlForHumanDisplay(
      'https://identity.example/sso/start?token=secret&state=opaque#callback',
    ),
    'https://identity.example/sso/start',
  );
});

test('human URL display validates and bounds terminal text', () => {
  const longUrl = `https://identity.example/${'a'.repeat(400)}`;
  const displayed = safeUrlForHumanDisplay(longUrl);
  assert.equal(displayed.length, 256);
  assert.equal(displayed.endsWith('...'), true);
  assert.throws(
    () => safeUrlForHumanDisplay('https://identity.example/%0aescape'),
    /control characters/,
  );
  assert.throws(
    () => safeUrlForHumanDisplay('https://user:secret@identity.example/sso'),
    /embedded credentials/,
  );
});

test('manual URL display preserves the full validated SSO query', () => {
  assert.equal(
    safeUrlForManualDisplay(
      'https://identity.example/sso/start?token=secret&state=opaque#callback',
    ),
    'https://identity.example/sso/start?token=secret&state=opaque#callback',
  );
});

test('manual URL display rejects unsafe or unbounded URLs', () => {
  assert.equal(safeUrlForManualDisplay('javascript:alert(1)'), null);
  assert.equal(
    safeUrlForManualDisplay('https://user:secret@identity.example/sso'),
    null,
  );
  assert.equal(
    safeUrlForManualDisplay('https://identity.example/%0aescape'),
    null,
  );
  assert.equal(
    safeUrlForManualDisplay(`https://identity.example/${'a'.repeat(4096)}`),
    null,
  );
});

test('human text display rejects terminal controls and bounds labels', () => {
  assert.equal(safeTextForHumanDisplay('  SAML SSO  ', 'unknown'), 'SAML SSO');
  assert.equal(safeTextForHumanDisplay('SAML\u001b[31m', 'unknown'), 'unknown');
  assert.equal(safeTextForHumanDisplay('SSO\u200bmethod', 'unknown'), 'unknown');
  assert.equal(safeTextForHumanDisplay(undefined, 'unknown'), 'unknown');

  const displayed = safeTextForHumanDisplay('a'.repeat(100), 'unknown');
  assert.equal(displayed.length, 80);
  assert.equal(displayed, `${'a'.repeat(77)}...`);
});

test('human display helpers fail closed for malformed runtime payload types', () => {
  assert.equal(
    safeTextForHumanDisplay({} as unknown as string, 'unknown'),
    'unknown',
  );
  assert.equal(
    safeUrlForManualDisplay(123 as unknown as string),
    null,
  );
  assert.equal(
    safeUrlForHumanDisplay(123 as unknown as string),
    '(unavailable)',
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

test('resolveLoginMode defaults to browser capture, manual only for direct credentials', () => {
  assert.equal(
    resolveLoginMode({
      hasAuthToken: false,
      hasUsername: false,
      hasRedirectUrl: false,
    }),
    'auto',
  );

  assert.equal(
    resolveLoginMode({
      hasAuthToken: true,
      hasUsername: true,
      hasRedirectUrl: false,
    }),
    'manual',
  );

  assert.equal(
    resolveLoginMode({
      hasAuthToken: false,
      hasUsername: false,
      hasRedirectUrl: true,
    }),
    'manual',
  );

  assert.equal(
    resolveLoginMode({
      hasAuthToken: true,
      hasUsername: false,
      hasRedirectUrl: false,
    }),
    'auto',
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
