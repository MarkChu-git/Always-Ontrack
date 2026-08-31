import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  availableLoginMethods,
  defaultLoginMethod,
  parseLoginMethodChoice,
  resolveLoginMethod,
  shouldPromptLoginMethod,
} from '../src/lib/login-method.js';

test('parseLoginMethodChoice accepts numbers, letters, and names', () => {
  assert.equal(parseLoginMethodChoice('1'), 'browser');
  assert.equal(parseLoginMethodChoice(' B '), 'browser');
  assert.equal(parseLoginMethodChoice('auto'), 'browser');
  assert.equal(parseLoginMethodChoice('this'), 'browser');
  assert.equal(parseLoginMethodChoice('2'), 'pair');
  assert.equal(parseLoginMethodChoice('pairing'), 'pair');
  assert.equal(parseLoginMethodChoice('3'), 'terminal');
  assert.equal(parseLoginMethodChoice('sso'), 'terminal');
  assert.equal(parseLoginMethodChoice('terminal'), 'terminal');
  assert.equal(parseLoginMethodChoice(''), null);
  assert.equal(parseLoginMethodChoice('4'), null);
});

test('availableLoginMethods keeps 1/3 numbering when pairing is off', () => {
  assert.deepEqual(
    availableLoginMethods(true).map((choice) => choice.id),
    ['browser', 'pair', 'terminal'],
  );
  assert.deepEqual(
    availableLoginMethods(false).map((choice) => choice.id),
    ['browser', 'terminal'],
  );
});

test('defaultLoginMethod prefers pairing only when a relay exists', () => {
  assert.equal(defaultLoginMethod(true), 'pair');
  assert.equal(defaultLoginMethod(false), 'browser');
});

test('resolveLoginMethod honours flags, then an interactive choice', () => {
  assert.equal(
    resolveLoginMethod({
      auto: true,
      pairFlag: false,
      noPairFlag: false,
      sso: false,
      relayAvailable: true,
    }),
    'browser',
  );
  assert.equal(
    resolveLoginMethod({
      auto: false,
      pairFlag: false,
      noPairFlag: true,
      sso: false,
      relayAvailable: true,
    }),
    'browser',
  );
  assert.equal(
    resolveLoginMethod({
      auto: false,
      pairFlag: true,
      noPairFlag: false,
      sso: false,
      relayAvailable: true,
    }),
    'pair',
  );
  assert.equal(
    resolveLoginMethod({
      auto: false,
      pairFlag: false,
      noPairFlag: false,
      sso: true,
      relayAvailable: true,
    }),
    'terminal',
  );
  assert.equal(
    resolveLoginMethod({
      auto: false,
      pairFlag: false,
      noPairFlag: false,
      sso: false,
      relayAvailable: false,
    }),
    'choose',
  );
  assert.equal(
    resolveLoginMethod({
      auto: false,
      pairFlag: false,
      noPairFlag: false,
      sso: false,
      relayAvailable: true,
    }),
    'choose',
  );
});

test('shouldPromptLoginMethod stays off in CI/headless even on a TTY', () => {
  const ttys = { stdin: { isTTY: true }, stdout: { isTTY: true } };
  assert.equal(shouldPromptLoginMethod({ ONTRACK_HEADLESS: '1' }, ttys), false);
  assert.equal(shouldPromptLoginMethod({ CI: 'true' }, ttys), false);
  assert.equal(shouldPromptLoginMethod({}, ttys), true);
  assert.equal(
    shouldPromptLoginMethod({}, { stdin: { isTTY: false }, stdout: { isTTY: true } }),
    false,
  );
});
