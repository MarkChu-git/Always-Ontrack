import { test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  AGENT_SCHEMA_VERSION,
  AgentProtocolError,
  agentErrorEnvelope,
  agentSuccessEnvelope,
  clearAgentOutputContext,
  configureAgentOutputContext,
  exitCodeForAgentError,
  wrapAgentOutput,
} from '../src/lib/agent-protocol.js';

test('agent success envelope has a stable schema and never mutates command data', () => {
  const data = {
    projects: [{ id: 1, owner_email: 'student@example.edu' }],
    auth_token: 'must-not-leak',
    nested: { refreshCookie: 'must-not-leak-either' },
  };
  const result = agentSuccessEnvelope({
    command: 'projects.list',
    requestId: 'req_test',
    data,
  });

  assert.deepEqual(result, {
    schema_version: AGENT_SCHEMA_VERSION,
    request_id: 'req_test',
    command: 'projects.list',
    status: 'success',
    summary: 'Command completed successfully.',
    data: {
      projects: [{ id: 1, owner_email: 'student@example.edu' }],
      nested: {},
    },
    warnings: [],
    next_actions: [],
    artifacts: [],
  });
  assert.notEqual(result.data, data);
  assert.deepEqual(data, {
    projects: [{ id: 1, owner_email: 'student@example.edu' }],
    auth_token: 'must-not-leak',
    nested: { refreshCookie: 'must-not-leak-either' },
  });
});

test('typed protocol errors expose stable recovery metadata without raw causes', () => {
  const error = new AgentProtocolError({
    code: 'HUMAN_VERIFICATION_REQUIRED',
    status: 'auth_required',
    summary: 'Monash authentication requires human verification.',
    retryable: true,
    nextActions: [
      {
        action: 'auth.ensure',
        arguments: { interaction: 'if_required' },
      },
    ],
    cause: new Error('auth_token=must-not-leak'),
  });

  const envelope = agentErrorEnvelope({
    command: 'projects.list',
    requestId: 'req_auth',
    error,
  });
  assert.equal(envelope.error.code, 'HUMAN_VERIFICATION_REQUIRED');
  assert.equal(envelope.error.retryable, true);
  assert.equal(JSON.stringify(envelope).includes('must-not-leak'), false);
  assert.equal(exitCodeForAgentError(error), 3);
});

test('unknown failures become non-retryable internal errors with no exception text', () => {
  const envelope = agentErrorEnvelope({
    command: 'tasks.list',
    requestId: 'req_internal',
    error: new Error('password=hunter2'),
  });

  assert.equal(envelope.status, 'error');
  assert.equal(envelope.error.code, 'INTERNAL_ERROR');
  assert.equal(envelope.error.retryable, false);
  assert.equal(envelope.summary, 'The command failed unexpectedly.');
  assert.equal(JSON.stringify(envelope).includes('hunter2'), false);
  assert.equal(exitCodeForAgentError(new Error('boom')), 10);
});

test('envelope metadata is bounded, control-character safe, and credential-redacted', () => {
  const envelope = agentSuccessEnvelope({
    command: `tasks.list\n${'x'.repeat(200)}`,
    requestId: 'Bearer example-secret-token-value',
    warnings: ['Basic another-secret-value'],
    nextActions: [
      {
        action: 'auth.ensure',
        arguments: { auth_token: 'must-not-leak', interaction: 'if_required' },
      },
    ],
    data: {},
  });

  assert.match(envelope.request_id, /^req_[a-z0-9_-]+$/u);
  assert.notEqual(envelope.request_id, 'Bearer example-secret-token-value');
  assert.equal(envelope.command, 'agent.call');
  assert.deepEqual(envelope.warnings, ['[REDACTED]']);
  assert.equal(JSON.stringify(envelope).includes('must-not-leak'), false);

  const bounded = agentSuccessEnvelope({
    command: 'agent.list',
    requestId: 'req_metadata',
    nextActions: Array.from({ length: 40 }, (_, index) => ({
      action: `action.${index}\nunsafe`,
      arguments: { nested: { value: 'x'.repeat(500) } },
    })),
    data: {},
  });
  assert.equal(bounded.next_actions.length, 16);
  assert.equal(JSON.stringify(bounded).includes('\nunsafe'), false);
});

test('configured output context wraps existing JSON command payloads without changing legacy mode', () => {
  assert.deepEqual(wrapAgentOutput({ id: 1 }), { id: 1 });

  configureAgentOutputContext({
    command: 'project.show',
    requestId: 'req_context',
    streaming: false,
  });
  const wrapped = wrapAgentOutput({ id: 1 });
  assert.equal(wrapped.schema_version, AGENT_SCHEMA_VERSION);
  assert.equal(wrapped.command, 'project.show');
  assert.deepEqual(wrapped.data, { id: 1 });

  clearAgentOutputContext();
  assert.deepEqual(wrapAgentOutput({ id: 2 }), { id: 2 });
});
