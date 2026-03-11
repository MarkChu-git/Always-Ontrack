import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractCredentialsFromAuthPayload,
  extractCredentialsFromCookieJar,
  extractCredentialsFromUrl,
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
