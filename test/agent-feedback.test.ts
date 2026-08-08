import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  createAgentFeedbackList,
  createAgentFeedbackWatch,
  validateAgentFeedbackWatchFrame,
} from '../src/lib/agent-feedback.js';
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

test('Agent feedback watch emits safe deltas once and stops immediately when cancelled', async () => {
  let feedback: unknown = [
    {
      id: 7001,
      type: 'comment',
      comment: 'Baseline feedback.',
      created_at: '2026-08-04T10:00:00.000Z',
    },
  ];
  const source = feedbackSource();
  const watch = createAgentFeedbackWatch({
    ...source,
    readFeedback: async () => feedback,
  });
  const controller = new AbortController();
  const iterator = watch(
    {
      project_id: 1001,
      task_definition_id: 3001,
      interval_seconds: 1,
      history: 1,
    },
    { signal: controller.signal },
  )[Symbol.asyncIterator]();

  const baseline = await iterator.next();
  assert.equal(baseline.done, false);
  assert.deepEqual(baseline.value?.feedback, [
    {
      feedback_id: 7001,
      kind: 'comment',
      text: 'Baseline feedback.',
      created_at: '2026-08-04T10:00:00.000Z',
      updated_at: null,
      is_new: null,
    },
  ]);

  feedback = [
    ...(feedback as unknown[]),
    {
      id: 7002,
      type: 'comment',
      comment: 'New feedback.',
      created_at: '2026-08-04T10:01:00.000Z',
      author: { email: 'marker-private@example.invalid' },
    },
  ];
  const delta = await iterator.next();
  assert.equal(delta.done, false);
  assert.equal(delta.value?.type, 'feedback');
  assert.deepEqual(delta.value?.feedback.map((item) => item.feedback_id), [7002]);
  assert.equal(JSON.stringify(delta.value).includes('marker-private'), false);

  controller.abort();
  const stopped = await iterator.next();
  assert.equal(stopped.done, true);
});

test('Agent feedback watch rejects id-less records instead of collapsing distinct deltas', async () => {
  const watch = createAgentFeedbackWatch(
    feedbackSource({
      feedback: [
        {
          type: 'event',
          comment: null,
          created_at: null,
        },
      ],
    }),
  );

  await assert.rejects(
    () =>
      watch(
        {
          project_id: 1001,
          task_definition_id: 3001,
          interval_seconds: 1,
          history: 1,
        },
        { signal: new AbortController().signal },
      )[Symbol.asyncIterator]().next(),
    (error: unknown) =>
      error instanceof AgentProtocolError &&
      error.code === 'REMOTE_UNAVAILABLE' &&
      error.summary === 'OnTrack omitted a feedback id required for streaming.',
  );

  assert.throws(
    () =>
      validateAgentFeedbackWatchFrame({
        type: 'baseline',
        at: '2026-08-04T10:00:00.000Z',
        project_id: 1001,
        task_definition_id: 3001,
        abbreviation: 'D4',
        interval_seconds: 1,
        total_feedback: 1,
        feedback: [
          {
            feedback_id: null,
            kind: 'event',
            text: null,
            created_at: null,
            updated_at: null,
            is_new: null,
          },
        ],
      }),
    (error: unknown) =>
      error instanceof AgentProtocolError && error.code === 'REMOTE_UNAVAILABLE',
  );
});

test('Agent feedback watch forwards cancellation into every baseline read', async () => {
  const controller = new AbortController();
  const signals: Array<AbortSignal | undefined> = [];
  const source = feedbackSource();
  const watch = createAgentFeedbackWatch({
    readProject: async (_projectId, signal) => {
      signals.push(signal);
      return source.readProject();
    },
    readUnit: async (_unitId, signal) => {
      signals.push(signal);
      return source.readUnit();
    },
    readFeedback: async (_projectId, _taskDefinitionId, signal) => {
      signals.push(signal);
      return source.readFeedback();
    },
  });

  const frame = await watch(
    {
      project_id: 1001,
      task_definition_id: 3001,
      interval_seconds: 1,
      history: 1,
    },
    { signal: controller.signal },
  )[Symbol.asyncIterator]().next();

  assert.equal(frame.done, false);
  assert.deepEqual(signals, [controller.signal, controller.signal, controller.signal]);
});

test('Agent feedback watch stops when cancellation interrupts a pending baseline read', async () => {
  const controller = new AbortController();
  const source = feedbackSource();
  let started!: () => void;
  const feedbackReadStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const watch = createAgentFeedbackWatch({
    readProject: source.readProject,
    readUnit: source.readUnit,
    readFeedback: async (_projectId, _taskDefinitionId, signal) => {
      started();
      return new Promise((resolve) => {
        signal?.addEventListener('abort', () => resolve([]), { once: true });
      });
    },
  });
  const iterator = watch(
    {
      project_id: 1001,
      task_definition_id: 3001,
      interval_seconds: 1,
      history: 1,
    },
    { signal: controller.signal },
  )[Symbol.asyncIterator]();

  const pending = iterator.next();
  await feedbackReadStarted;
  controller.abort();

  const result = await Promise.race([
    pending,
    new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 25)),
  ]);
  assert.notEqual(result, 'timeout');
  assert.equal(result.done, true);
});

test('Agent feedback projections redact sensitive values embedded in feedback text', async () => {
  const credentialField = ['auth', 'token'].join('_');
  const credentialValue = ['fixture', 'secret'].join('-');
  const email = 'marker-private@example.invalid';
  const listFeedback = createAgentFeedbackList(
    feedbackSource({
      feedback: [
        {
          id: 7001,
          comment: 'Code: use map; state=ready.',
        },
        {
          id: 7002,
          comment:
            `Contact ${email} with ${credentialField}=${credentialValue}.`,
        },
      ],
    }),
  );

  const output = await listFeedback({ project_id: 1001, task_definition_id: 3001 });
  const normalText = output.feedback[0]?.text ?? '';
  const sensitiveText = output.feedback[1]?.text ?? '';

  assert.equal(normalText, 'Code: use map; state=ready.');
  assert.equal(sensitiveText.includes(email), false);
  assert.equal(sensitiveText.includes(credentialValue), false);
  assert.equal(sensitiveText.includes('[REDACTED]'), true);
});
