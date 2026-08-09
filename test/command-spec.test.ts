import { test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  AGENT_COMMAND_SPECS,
  buildCapabilities,
  getCommandSpec,
  resolveCommandPath,
} from '../src/lib/command-spec.js';

test('command registry has unique stable paths and explicit safety metadata', () => {
  const paths = AGENT_COMMAND_SPECS.map((spec) => spec.path);
  assert.equal(new Set(paths).size, paths.length);
  assert.ok(paths.includes('auth.ensure'));
  assert.ok(paths.includes('projects.list'));
  assert.ok(paths.includes('task.resources'));
  assert.ok(paths.includes('submission.upload'));

  for (const spec of AGENT_COMMAND_SPECS) {
    assert.equal(typeof spec.auth_required, 'boolean');
    assert.ok(['read', 'write', 'auth', 'local'].includes(spec.risk));
    assert.equal(spec.input_schema.type, 'object');
    if (spec.risk === 'write') {
      assert.equal(spec.confirmation, 'required');
    }
  }
});

test('capabilities are offline projections and do not expose implementation secrets', () => {
  const capabilities = buildCapabilities('0.5.0');
  assert.equal(capabilities.protocol, 'ontrack.agent/v1');
  assert.equal(capabilities.cli_version, '0.5.0');
  assert.deepEqual(capabilities.exit_codes['3'], 'authentication or human verification required');
  assert.equal(JSON.stringify(capabilities).includes('authToken'), false);
  assert.equal(JSON.stringify(capabilities).includes('cookie'), false);
});

test('command path resolution handles grouped and top-level commands', () => {
  assert.equal(resolveCommandPath(['projects']), 'projects.list');
  assert.equal(resolveCommandPath(['project', 'show']), 'project.show');
  assert.equal(resolveCommandPath(['task', 'resources']), 'task.resources');
  assert.equal(resolveCommandPath(['task', 'show']), 'task.show');
  assert.equal(resolveCommandPath(['auth', 'ensure']), 'auth.ensure');
  assert.equal(resolveCommandPath(['not-a-command']), 'not-a-command');
  assert.equal(getCommandSpec('task.show').path, 'task.show');
  assert.throws(() => getCommandSpec('missing.command'), /Unknown Agent command/);
});
