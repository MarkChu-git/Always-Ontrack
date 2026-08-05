import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { parseAgentCallInvocation } from '../src/lib/agent-call-input.js';

test('agent call input accepts bounded inline JSON and non-TTY stdin', async () => {
  const inline = await parseAgentCallInvocation([
    'task.show',
    '--input-json',
    '{"project_id":87}',
  ]);
  assert.deepEqual(inline, {
    command: 'task.show',
    input: { project_id: 87 },
  });

  const stdin = await parseAgentCallInvocation(
    ['task.show', '--input', '-'],
    { stdinIsTTY: false, readStdin: async () => '{"project_id":87}' },
  );
  assert.deepEqual(stdin.input, { project_id: 87 });
});

test('agent call input rejects interactive, malformed, oversized, and ambiguous input', async () => {
  await assert.rejects(
    () =>
      parseAgentCallInvocation(['task.show', '--input', '-'], {
        stdinIsTTY: true,
        readStdin: async () => '{}',
      }),
    /non-interactive stdin/,
  );
  await assert.rejects(
    () => parseAgentCallInvocation(['task.show', '--input-json', '[]']),
    /JSON object/,
  );
  await assert.rejects(
    () => parseAgentCallInvocation(['task.show', '--unknown']),
    /Unknown agent call flag/,
  );
  await assert.rejects(
    () =>
      parseAgentCallInvocation(['task.show', '--input-json', 'x'.repeat(64 * 1024 + 1)]),
    /exceeds 65536 bytes/,
  );
  await assert.rejects(
    () =>
      parseAgentCallInvocation([
        'task.show',
        '--input-json',
        '{}',
        '--input-json',
        '{}',
      ]),
    /either --input-json or --input/,
  );
});
