import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  assertAgentStreamFrameLimit,
  diffAgentWatchStates,
  projectAgentWatchState,
  splitAgentWatchEventFrames,
  validateAgentWatchFrame,
  type AgentWatchState,
} from '../src/lib/agent-watch.js';
import {
  projectAgentFeedbackItems,
  validateAgentFeedbackWatchFrame,
} from '../src/lib/agent-feedback.js';
import { AgentProtocolError } from '../src/lib/agent-protocol.js';
import { buildWatchSnapshots } from '../src/lib/watch-snapshots.js';
import type { ProjectSummary } from '../src/lib/types.js';

function watchState(overrides: Partial<AgentWatchState> = {}): AgentWatchState {
  return {
    task_key: '1001:3001',
    project_id: 1001,
    unit_id: 2001,
    unit_code: 'FIT0001',
    task_definition_id: 3001,
    task_instance_id: 9001,
    abbreviation: 'D4',
    status: 'working_on_it',
    start: {
      kind: 'start',
      value: '2026-08-10',
      source: 'personal',
      editable: true,
      interpretation: 'unit_local_calendar_date',
    },
    target: {
      kind: 'target',
      value: '2026-08-20',
      source: 'grade_default',
      editable: true,
      interpretation: 'unit_local_calendar_date',
    },
    feedback_deadline: {
      kind: 'feedback_deadline',
      value: '2026-08-25',
      source: 'unit_default',
      editable: false,
      interpretation: 'unit_local_calendar_date',
    },
    feedback: {
      comment_count: 1,
      last_comment_at: '2026-08-01T10:00:00.000Z',
    },
    ...overrides,
  };
}

test('Agent watch emits one typed date change per Plan Date kind', () => {
  const previous = new Map([['1001:3001', watchState()]]);
  const current = new Map([
    [
      '1001:3001',
      watchState({
        start: {
          kind: 'start',
          value: '2026-08-11',
          source: 'personal',
          editable: true,
          interpretation: 'unit_local_calendar_date',
        },
        target: {
          kind: 'target',
          value: '2026-08-21',
          source: 'personal',
          editable: true,
          interpretation: 'unit_local_calendar_date',
        },
        feedback_deadline: {
          kind: 'feedback_deadline',
          value: '2026-08-26',
          source: 'unit_default',
          editable: false,
          interpretation: 'unit_local_calendar_date',
        },
      }),
    ],
  ]);

  const events = diffAgentWatchStates(
    previous,
    current,
    '2026-08-02T10:00:00.000Z',
  );

  assert.deepEqual(
    events.map((event) => [event.type, event.date_kind]),
    [
      ['date_changed', 'start'],
      ['date_changed', 'target'],
      ['date_changed', 'feedback_deadline'],
    ],
  );
  assert.deepEqual(events[0]?.previous, {
    kind: 'start',
    value: '2026-08-10',
    source: 'personal',
    editable: true,
    interpretation: 'unit_local_calendar_date',
  });
  assert.deepEqual(events[2]?.current, {
    kind: 'feedback_deadline',
    value: '2026-08-26',
    source: 'unit_default',
    editable: false,
    interpretation: 'unit_local_calendar_date',
  });
});

test('Agent watch state is person-free and rejects unsafe remote display text', () => {
  const output = projectAgentWatchState({
    task_key: '1001:3001',
    project_id: 1001,
    unit_id: 2001,
    unit_code: 'FIT0001',
    task_definition_id: 3001,
    task_instance_id: 9001,
    abbreviation: 'D4',
    status: 'working_on_it',
    start: {
      kind: 'start',
      value: '2026-08-10',
      source: 'personal',
      editable: true,
      interpretation: 'unit_local_calendar_date',
    },
    target: {
      kind: 'target',
      value: '2026-08-20',
      source: 'grade_default',
      editable: true,
      interpretation: 'unit_local_calendar_date',
    },
    feedback_deadline: {
      kind: 'feedback_deadline',
      value: '2026-08-25',
      source: 'unit_default',
      editable: false,
      interpretation: 'unit_local_calendar_date',
    },
    feedback: { comment_count: 1, last_comment_at: null },
    author: { email: 'marker-private@example.invalid' },
  });

  assert.equal(JSON.stringify(output).includes('marker-private'), false);
  assert.throws(
    () =>
      projectAgentWatchState({
        ...output,
        abbreviation: 'D4\u0007',
      }),
    (error: unknown) =>
      error instanceof AgentProtocolError &&
      error.code === 'REMOTE_UNAVAILABLE',
  );
});

test('Agent stream frames enforce item and aggregate output bounds', () => {
  assert.throws(
    () =>
      validateAgentWatchFrame({
        type: 'baseline',
        at: '2026-08-02T10:00:00.000Z',
        interval_seconds: 60,
        tasks: Array.from({ length: 201 }, () => watchState()),
      }),
    (error: unknown) =>
      error instanceof AgentProtocolError &&
      error.code === 'REMOTE_UNAVAILABLE',
  );
  assert.throws(
    () =>
      assertAgentStreamFrameLimit('feedback.watch', {
        type: 'feedback',
        feedback: Array.from({ length: 200 }, () => ({
          text: 'x'.repeat(4096),
        })),
      }),
    (error: unknown) =>
      error instanceof AgentProtocolError &&
      error.code === 'REMOTE_UNAVAILABLE',
  );
});

test('Agent watch event schema keeps event payloads type-specific', () => {
  const validBase = {
    task_key: '1001:3001',
    project_id: 1001,
    unit_id: 2001,
    task_definition_id: 3001,
    unit_code: 'FIT0001',
    abbreviation: 'D4',
    at: '2026-08-02T10:00:00.000Z',
  };
  assert.throws(
    () =>
      validateAgentWatchFrame({
        type: 'events',
        at: validBase.at,
        events: [
          {
            ...validBase,
            type: 'status_changed',
            previous: 'working_on_it',
            current: 'complete',
            date_kind: 'target',
          },
        ],
      }),
    (error: unknown) =>
      error instanceof AgentProtocolError &&
      error.code === 'REMOTE_UNAVAILABLE',
  );
  assert.throws(
    () =>
      validateAgentWatchFrame({
        type: 'events',
        at: validBase.at,
        events: [
          {
            ...validBase,
            type: 'date_changed',
            previous: '2026-08-01',
            current: '2026-08-02',
          },
        ],
      }),
    (error: unknown) =>
      error instanceof AgentProtocolError &&
      error.code === 'REMOTE_UNAVAILABLE',
  );
});

test('Agent watch splits a full poll without dropping typed events', () => {
  const previous = new Map<string, AgentWatchState>();
  const current = new Map<string, AgentWatchState>();
  for (let index = 0; index < 200; index += 1) {
    const task = watchState({
      task_key: `1001:${3001 + index}`,
      task_definition_id: 3001 + index,
      status: 'not_started',
    });
    previous.set(task.task_key, task);
    current.set(task.task_key, {
      ...task,
      status: 'working_on_it',
      start: { ...task.start, value: '2026-08-11' },
      target: { ...task.target, value: '2026-08-21' },
      feedback_deadline: { ...task.feedback_deadline, value: '2026-08-26' },
      feedback: {
        comment_count: 2,
        last_comment_at: '2026-08-02T10:00:00.000Z',
      },
    });
  }

  const events = diffAgentWatchStates(
    previous,
    current,
    '2026-08-02T10:00:00.000Z',
  );
  const frames = splitAgentWatchEventFrames('2026-08-02T10:00:00.000Z', events);

  assert.equal(events.length, 1000);
  assert.equal(frames.length >= 2, true);
  assert.equal(
    frames.every(
      (frame) => frame.type === 'events' && frame.events.length <= 800,
    ),
    true,
  );
  assert.deepEqual(
    frames.flatMap((frame) => (frame.type === 'events' ? frame.events : [])),
    events,
  );
});

test('Agent watch rejects impossible calendar dates through the canonical Plan Date schema', () => {
  assert.throws(
    () =>
      validateAgentWatchFrame({
        type: 'baseline',
        at: '2026-08-02T10:00:00.000Z',
        interval_seconds: 60,
        tasks: [
          {
            ...watchState(),
            target: {
              ...watchState().target,
              value: '2026-02-31',
            },
          },
        ],
      }),
    (error: unknown) =>
      error instanceof AgentProtocolError &&
      error.code === 'REMOTE_UNAVAILABLE',
  );
});

test('feedback.watch runtime frames are validated and remain person-free', () => {
  const frame = validateAgentFeedbackWatchFrame({
    type: 'feedback',
    at: '2026-08-02T10:00:00.000Z',
    project_id: 1001,
    task_definition_id: 3001,
    abbreviation: 'D4',
    feedback: [
      {
        feedback_id: 7001,
        kind: 'comment',
        text: 'Check section two.',
        created_at: '2026-08-02T10:00:00.000Z',
        updated_at: null,
        is_new: null,
      },
    ],
  });
  assert.equal(frame.type, 'feedback');
  assert.throws(
    () =>
      validateAgentFeedbackWatchFrame({
        ...frame,
        feedback: [
          {
            ...frame.feedback[0],
            author: 'person-private@example.invalid',
          },
        ],
      }),
    (error: unknown) =>
      error instanceof AgentProtocolError &&
      error.code === 'REMOTE_UNAVAILABLE',
  );
});

test('Agent feedback timestamps reject arbitrary text and normalize valid offsets', () => {
  const feedback = projectAgentFeedbackItems([
    {
      id: 7001,
      type: 'comment',
      comment: 'Check section two.',
      created_at: '2026-08-02T18:00:00+08:00',
    },
  ]);
  assert.equal(feedback[0]?.created_at, '2026-08-02T10:00:00.000Z');
  assert.throws(
    () =>
      projectAgentFeedbackItems([
        {
          id: 7001,
          type: 'comment',
          comment: 'Check section two.',
          created_at: 'person-private@example.invalid',
        },
      ]),
    (error: unknown) =>
      error instanceof AgentProtocolError &&
      error.code === 'REMOTE_UNAVAILABLE',
  );
  assert.throws(
    () =>
      validateAgentWatchFrame({
        type: 'baseline',
        at: '2026-08-02T10:00:00.000Z',
        interval_seconds: 60,
        tasks: [
          {
            ...watchState(),
            feedback: {
              comment_count: 1,
              last_comment_at: 'person-private@example.invalid',
            },
          },
        ],
      }),
    (error: unknown) =>
      error instanceof AgentProtocolError &&
      error.code === 'REMOTE_UNAVAILABLE',
  );
});

test('Agent watch bounds concurrent feedback reads', async () => {
  const taskDefinitions = Array.from({ length: 200 }, (_, index) => ({
    id: 3001 + index,
    abbreviation: `D${index + 1}`,
    name: `Task ${index + 1}`,
    target_grade: 0,
  }));
  const project: ProjectSummary = {
    id: 1001,
    target_grade: 0,
    tasks: taskDefinitions.map((definition) => ({
      id: definition.id + 6000,
      task_definition_id: definition.id,
      status: 'working_on_it',
    })),
    unit: {
      id: 2001,
      code: 'FIT0001',
      allow_flexible_dates: true,
      task_definitions: taskDefinitions,
    },
  };
  let inFlight = 0;
  let maxInFlight = 0;

  const snapshots = await buildWatchSnapshots(
    {
      loadProjects: async () => [project],
      readComments: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise<void>((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
        return [];
      },
    },
    { agentOutput: true },
  );

  assert.equal(snapshots.length, 200);
  assert.equal(maxInFlight, 8);
});

test('Agent stream frame timestamps must be RFC 3339 instants', () => {
  assert.throws(
    () =>
      validateAgentWatchFrame({
        type: 'baseline',
        at: 'not-a-timestamp',
        interval_seconds: 60,
        tasks: [watchState()],
      }),
    (error: unknown) =>
      error instanceof AgentProtocolError &&
      error.code === 'REMOTE_UNAVAILABLE',
  );
  assert.throws(
    () =>
      validateAgentFeedbackWatchFrame({
        type: 'baseline',
        at: 'not-a-timestamp',
        project_id: 1001,
        task_definition_id: 3001,
        abbreviation: 'D4',
        interval_seconds: 60,
        total_feedback: 0,
        feedback: [],
      }),
    (error: unknown) =>
      error instanceof AgentProtocolError &&
      error.code === 'REMOTE_UNAVAILABLE',
  );
});
