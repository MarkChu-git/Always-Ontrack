import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBaseUrl, parseSsoRedirectUrl } from '../src/lib/utils.js';

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
