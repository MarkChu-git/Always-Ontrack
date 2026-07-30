import { test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  SsoFallbackError,
  buildContextOptionsWithStoredSession,
  classifySsoFallback,
  expandSystemBrowserProfileCandidates,
  extractCredentialsFromAuthPayload,
  extractCredentialsFromCookieJar,
  extractCredentialsFromStorageEntries,
  extractCredentialsFromUrl,
  extractMfaNumberChallengeFromText,
  resolveBrowserLaunchPlan,
  resolveBrowserSessionStatePath,
  resolveSystemBrowserUserDataDirs,
  saveBrowserSessionState,
} from '../src/lib/auto-login.js';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('credential extractors reject malformed, cross-origin, and incomplete identity inputs', () => {
  assert.equal(extractCredentialsFromUrl('not a URL'), null);
  assert.equal(extractCredentialsFromUrl('https://ontrack.infotech.monash.edu/?authToken=  &username=user'), null);
  assert.equal(extractCredentialsFromAuthPayload(null), null);
  assert.equal(extractCredentialsFromAuthPayload({ auth_token: 'token', user: { username: ' ' } }), null);
  assert.deepEqual(extractCredentialsFromAuthPayload({ authToken: 'token', authTokenExpiry: '2031-01-01', user: { login: ' nested ' } }), {
    authToken: 'token', username: 'nested', expiresAt: '2031-01-01', source: 'auth_request',
  });
  assert.equal(extractCredentialsFromCookieJar([], 'not a URL'), null);
  assert.deepEqual(extractCredentialsFromCookieJar([
    { name: 'authToken', value: 'token', domain: '.ontrack.infotech.monash.edu' },
    { name: 'Username', value: 'user', domain: '.ontrack.infotech.monash.edu' },
  ]), { authToken: 'token', username: 'user', source: 'cookie' });
});

test('storage credential adapter handles generic keys, opaque nested payloads, and invalid entries', () => {
  assert.deepEqual(extractCredentialsFromStorageEntries([
    { scope: 'local', key: ' auth-token ', value: ' generic-token ' },
    { scope: 'session', key: 'email', value: ' generic@example.edu ' },
  ]), { authToken: 'generic-token', username: 'generic@example.edu', source: 'local_storage' });
  assert.deepEqual(extractCredentialsFromStorageEntries([
    { scope: 'local', key: 'opaque', value: JSON.stringify({ wrapped: [{ authenticationToken: 'nested-token' }, { user_name: 'nested-user' }] }) },
  ]), { authToken: 'nested-token', username: 'nested-user', source: 'local_storage' });
  assert.equal(extractCredentialsFromStorageEntries([
    { scope: 'local', key: '', value: 'ignored' },
    { scope: 'local', key: 'auth_token', value: '' },
  ]), null);
});

test('browser path/profile safety helpers cover unsupported platforms and missing directories', () => {
  assert.equal(resolveBrowserSessionStatePath({} as NodeJS.ProcessEnv, 'linux', '/home/test'), '/home/test/.config/ontrack-cli/browser-state.json');
  assert.equal(resolveSystemBrowserUserDataDirs({} as NodeJS.ProcessEnv, 'win32', 'C:/Users/test').length, 0);
  assert.equal(resolveSystemBrowserUserDataDirs({} as NodeJS.ProcessEnv, 'linux', '/home/test').length, 4);
  assert.throws(
    () => resolveBrowserLaunchPlan({ ONTRACK_BROWSER_PATH: '/missing/browser' } as NodeJS.ProcessEnv, () => false),
    (error: unknown) => error instanceof SsoFallbackError && error.reason === 'browser_unavailable',
  );
  const expanded = expandSystemBrowserProfileCandidates([
    { label: 'Missing', userDataDir: '/missing', profileDir: 'Default' },
    { label: 'No listing', userDataDir: '/profiles', profileDir: 'Default' },
    { label: 'Duplicate', userDataDir: '/profiles', profileDir: 'Default' },
  ], {
    pathExists: (path) => path === '/profiles' || path === '/profiles/Default',
    listDirNames: () => [],
  });
  assert.deepEqual(expanded, [{ label: 'No listing', userDataDir: '/profiles', profileDir: 'Default' }]);
});

test('browser state persistence fails closed for malformed state and exact-origin filtering', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ontrack-state-coverage-'));
  const storagePath = join(root, 'state.json');
  try {
    await saveBrowserSessionState({ storageState: async () => ({ cookies: [{ name: 'missing fields' }], origins: [{}] }) }, {
      storagePath,
      targetOrigin: 'https://ontrack.infotech.monash.edu',
    });
    assert.deepEqual(JSON.parse(await readFile(storagePath, 'utf8')), { cookies: [], origins: [] });
    await writeFile(storagePath, JSON.stringify({ cookies: [], origins: [{ origin: 'https://ontrack.infotech.monash.edu.evil', localStorage: [] }] }));
    assert.deepEqual(buildContextOptionsWithStoredSession({ storagePath, targetOrigin: 'https://ontrack.infotech.monash.edu' }), {
      storageState: { cookies: [], origins: [] },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('SSO fallback and MFA helpers retain safe classifications on uncommon messages', () => {
  assert.equal(classifySsoFallback(new Error('browser process unavailable')), 'browser_unavailable');
  assert.equal(classifySsoFallback(new Error('unexpected renderer crash')), 'automation_error');
  assert.equal(classifySsoFallback('CAPTCHA required'), 'captcha');
  assert.deepEqual(extractMfaNumberChallengeFromText('Approve sign in with 7, 7, then 88.'), ['7', '88']);
  assert.deepEqual(extractMfaNumberChallengeFromText('number challenge\n44\n55\n66\n77'), ['44', '55', '66']);
});
