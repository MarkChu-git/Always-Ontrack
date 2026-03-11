import test from 'node:test';
import assert from 'node:assert/strict';
import { getWelcomeMenuItems, parseWelcomeSelection } from '../src/lib/welcome.js';

test('welcome menu ids are stable and sorted', () => {
  const items = getWelcomeMenuItems();
  const ids = items.map((item) => item.id);
  assert.deepEqual(ids, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
});

test('welcome menu marks sign-in as recommended', () => {
  const items = getWelcomeMenuItems();
  const first = items[0];
  assert.equal(first.title, 'Sign In (Monash SSO)');
  assert.equal(first.recommended, true);
});

test('parseWelcomeSelection handles numeric, zero, and quit aliases', () => {
  assert.equal(parseWelcomeSelection('1', [1, 2, 3]), 1);
  assert.equal(parseWelcomeSelection('0', [1, 2, 3]), 0);
  assert.equal(parseWelcomeSelection('q', [1, 2, 3]), 0);
  assert.equal(parseWelcomeSelection('quit', [1, 2, 3]), 0);
});

test('parseWelcomeSelection rejects invalid values', () => {
  assert.equal(parseWelcomeSelection('', [1, 2, 3]), null);
  assert.equal(parseWelcomeSelection('abc', [1, 2, 3]), null);
  assert.equal(parseWelcomeSelection('3abc', [1, 2, 3]), null);
  assert.equal(parseWelcomeSelection('99', [1, 2, 3]), null);
});
