import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createAgentFeedbackList } from '../src/lib/agent-feedback.js';
import { AgentProtocolError } from '../src/lib/agent-protocol.js';

function feedbackSource(overrides: {
  readonly project?: unknown;
  readonly unit?: unknown;
  readonly feedback?: unknown;
} = {}) {
  return {
    readProject: async () =>
      overrides.project ?? {
        id: 1001,
        unit_id: 2001,
        target_grade: 1,
        tasks: [
          {
            id: 9001,
            task_definition_id: 3001,
            status: 'ready_for_feedback',
          },
        ],
      },
    readUnit: async () =>
      overrides.unit ?? {
        id: 2001,
        code: 'FIT0001',
        task_definitions: [
          {
            id: 3001,
            abbreviation: 'D4',
            name: 'Design reflection',
            target_grade: 1,
          },
        ],
      },
    readFeedback: async () =>
      overrides.feedback ?? [
        {
          id: 7001,
          type: 'comment',
          comment: 'Clear reasoning. Explain the trade-off in section 2.',
          created_at: '2026-08-04T10:00:00.000Z',
          is_new: true,
          author: { email: 'marker-private@example.invalid' },
          recipient: { email: 'student-private@example.invalid' },
          attachments: [{ url: 'https://private.example.invalid/feedback.pdf' }],
          auth_token: 'must-not-project',
        },
      ],
  };
}

test('project-scoped Agent feedback list exposes bounded task feedback without people or raw remote fields', async () => {
  const source = feedbackSource();
  const readOrder: string[] = [];
  const listFeedback = createAgentFeedbackList({
    ...source,
    readProject: async (projectId) => {
      readOrder.push(`project:${projectId}`);
      return source.readProject();
    },
    readUnit: async (unitId) => {
      readOrder.push(`unit:${unitId}`);
      return source.readUnit();
    },
    readFeedback: async (projectId, taskDefinitionId) => {
      readOrder.push(`feedback:${projectId}:${taskDefinitionId}`);
      return source.readFeedback();
    },
  });

  const output = await listFeedback({
    project_id: 1001,
    task_definition_id: 3001,
  });

  assert.deepEqual(readOrder, ['project:1001', 'unit:2001', 'feedback:1001:3001']);
  assert.deepEqual(output, {
    project_id: 1001,
    unit_id: 2001,
    unit_code: 'FIT0001',
    task_definition_id: 3001,
    task_instance_id: 9001,
    abbreviation: 'D4',
    instantiated: true,
    count: 1,
    feedback: [
      {
        feedback_id: 7001,
        kind: 'comment',
        text: 'Clear reasoning. Explain the trade-off in section 2.',
        created_at: '2026-08-04T10:00:00.000Z',
        updated_at: null,
        is_new: true,
      },
    ],
  });
  const serialized = JSON.stringify(output);
  assert.equal(serialized.includes('marker-private'), false);
  assert.equal(serialized.includes('student-private'), false);
  assert.equal(serialized.includes('private.example.invalid'), false);
  assert.equal(serialized.includes('must-not-project'), false);
});

test('Agent feedback list rejects invalid project identity before unit or feedback reads', async () => {
  let unitReads = 0;
  let feedbackReads = 0;
  const listFeedback = createAgentFeedbackList({
    readProject: async () => ({ id: 1002, unit_id: 2001, tasks: [] }),
    readUnit: async () => {
      unitReads += 1;
      return { id: 2001, task_definitions: [] };
    },
    readFeedback: async () => {
      feedbackReads += 1;
      return [];
    },
  });

  await assert.rejects(
    () => listFeedback({ project_id: 1001, task_definition_id: 3001 }),
    (error: unknown) =>
      error instanceof AgentProtocolError &&
      error.code === 'REMOTE_UNAVAILABLE' &&
      error.summary === 'OnTrack returned an unexpected project identity.',
  );
  assert.equal(unitReads, 0);
  assert.equal(feedbackReads, 0);
});

test('Agent feedback list preserves bounded multi-line feedback while normalizing Windows line endings', async () => {
  const listFeedback = createAgentFeedbackList(
    feedbackSource({
      feedback: [
        {
          id: 7001,
          comment: 'First observation.\r\n\r\nSecond observation.',
        },
      ],
    }),
  );

  const output = await listFeedback({ project_id: 1001, abbreviation: 'D4' });

  assert.equal(
    output.feedback[0]?.text,
    'First observation.\n\nSecond observation.',
  );
});

test('Agent feedback list fails closed on malformed comment aliases and unsafe or oversized feedback text', async () => {
  const invalidFeedback = [
    [{ id: 7001, comment: 'one', text: 'two' }],
    [{ id: 7001, comment: 'unsafe\u0007text' }],
    [{ id: 7001, comment: 'x'.repeat(4097) }],
    Array.from({ length: 201 }, (_, index) => ({ id: index + 1 })),
  ];

  for (const feedback of invalidFeedback) {
    const listFeedback = createAgentFeedbackList(feedbackSource({ feedback }));
    await assert.rejects(
      () => listFeedback({ project_id: 1001, abbreviation: 'D4' }),
      (error: unknown) =>
        error instanceof AgentProtocolError && error.code === 'REMOTE_UNAVAILABLE',
    );
  }
});

test('Agent feedback list fails closed when otherwise valid feedback exceeds the complete envelope limit', async () => {
  const listFeedback = createAgentFeedbackList(
    feedbackSource({
      feedback: Array.from({ length: 200 }, (_, index) => ({
        id: index + 1,
        comment: 'x'.repeat(4096),
      })),
    }),
  );

  await assert.rejects(
    () => listFeedback({ project_id: 1001, task_definition_id: 3001 }),
    (error: unknown) =>
      error instanceof AgentProtocolError &&
      error.code === 'REMOTE_UNAVAILABLE' &&
      error.summary === 'OnTrack returned feedback data exceeding the output safety limit.',
  );
});
