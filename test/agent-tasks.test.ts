import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { createAgentTasksList } from '../src/lib/agent-tasks.js';
import { AgentProtocolError } from '../src/lib/agent-protocol.js';

test('Student Task View catalogue resolves tutorial-specific visibility through the observed project-unit join', async () => {
  const project = {
    id: 1001,
    unit_id: 2001,
    target_grade: 1,
    tasks: [],
    tutorial_enrolments: [{ tutorial_id: 4001 }],
  };
  const unit = {
    id: 2001,
    code: 'FIT0001',
    tutorial_streams: [{ abbreviation: 'A' }, { abbreviation: 'B' }],
    tutorials: [{ id: 4001, tutorial_stream_abbr: 'A' }],
    task_definitions: [
      {
        id: 3001,
        abbreviation: 'T1',
        name: 'Tutorial task',
        target_grade: 1,
        tutorial_stream_abbr: 'A',
      },
    ],
  };
  const originalProject = structuredClone(project);
  const originalUnit = structuredClone(unit);
  const listTasks = createAgentTasksList({
    readProject: async () => project,
    readUnit: async () => unit,
  });

  const output = await listTasks({ project_id: 1001, unit_id: 2001 });

  assert.deepEqual(output, {
    count: 1,
    tasks: [
      {
        project_id: 1001,
        unit_id: 2001,
        unit_code: 'FIT0001',
        task_definition_id: 3001,
        task_instance_id: null,
        abbreviation: 'T1',
        name: 'Tutorial task',
        status: 'not_instantiated',
        due_date: null,
        completion_date: null,
        instantiated: false,
        visibility: 'within_target',
      },
    ],
  });
  assert.deepEqual(project, originalProject);
  assert.deepEqual(unit, originalUnit);
});

test('Student Task View catalogue fails closed when nested unit identity conflicts with a null flat alias', async () => {
  const listTasks = createAgentTasksList({
    readProject: async () => ({
      id: 1001,
      unit: { id: 2001 },
      unit_id: null,
      tasks: [],
    }),
    readUnit: async () => ({
      id: 2001,
      task_definitions: [],
    }),
  });

  await assert.rejects(
    () => listTasks({ project_id: 1001 }),
    (error: unknown) =>
      error instanceof AgentProtocolError &&
      error.code === 'REMOTE_UNAVAILABLE',
  );
});

test('Student Task View catalogue validates project identity before reading its unit', async () => {
  let unitReads = 0;
  const listTasks = createAgentTasksList({
    readProject: async () => ({
      id: 1002,
      unit_id: 2001,
      tasks: [],
    }),
    readUnit: async () => {
      unitReads += 1;
      return { id: 2001, task_definitions: [] };
    },
  });

  await assert.rejects(
    () => listTasks({ project_id: 1001 }),
    (error: unknown) =>
      error instanceof AgentProtocolError &&
      error.code === 'REMOTE_UNAVAILABLE' &&
      error.summary === 'OnTrack returned an unexpected project identity.',
  );
  assert.equal(unitReads, 0);
});

test('Student Task View catalogue reports duplicate Task Instances as sanitized remote contract drift', async () => {
  const listTasks = createAgentTasksList({
    readProject: async () => ({
      id: 1001,
      unit_id: 2001,
      tasks: [
        { id: 9001, task_definition_id: 3001, status: 'working_on_it' },
        { id: 9002, task_definition_id: 3001, status: 'complete' },
      ],
    }),
    readUnit: async () => ({
      id: 2001,
      task_definitions: [{ id: 3001, abbreviation: 'T1' }],
    }),
  });

  await assert.rejects(
    () => listTasks({ project_id: 1001 }),
    (error: unknown) =>
      error instanceof AgentProtocolError &&
      error.code === 'REMOTE_UNAVAILABLE' &&
      error.summary === 'OnTrack returned duplicate task instance identities.',
  );
});

test('Student Task View catalogue fails closed when a Task Instance references no authoritative Task Definition', async () => {
  const listTasks = createAgentTasksList({
    readProject: async () => ({
      id: 1001,
      unit_id: 2001,
      tasks: [
        { id: 9001, task_definition_id: 3999, status: 'working_on_it' },
      ],
    }),
    readUnit: async () => ({
      id: 2001,
      task_definitions: [{ id: 3001, abbreviation: 'T1' }],
    }),
  });

  await assert.rejects(
    () => listTasks({ project_id: 1001 }),
    (error: unknown) =>
      error instanceof AgentProtocolError &&
      error.code === 'REMOTE_UNAVAILABLE' &&
      error.summary ===
        'OnTrack returned a task instance without an authoritative task definition.',
  );
});

test('Student Task View catalogue rejects conflicting flat and nested Task Definition identities', async () => {
  const listTasks = createAgentTasksList({
    readProject: async () => ({
      id: 1001,
      unit_id: 2001,
      tasks: [
        {
          id: 9001,
          task_definition_id: 3001,
          definition: { id: 3002 },
          status: 'working_on_it',
        },
      ],
    }),
    readUnit: async () => ({
      id: 2001,
      task_definitions: [
        { id: 3001, abbreviation: 'T1' },
        { id: 3002, abbreviation: 'T2' },
      ],
    }),
  });

  await assert.rejects(
    () => listTasks({ project_id: 1001 }),
    (error: unknown) =>
      error instanceof AgentProtocolError &&
      error.code === 'REMOTE_UNAVAILABLE',
  );
});

test('Student Task View catalogue accepts equivalent Task Definition catalogue aliases', async () => {
  const definitions = [{ id: 3001, abbreviation: 'T1', name: 'Task 1' }];
  const listTasks = createAgentTasksList({
    readProject: async () => ({
      id: 1001,
      unit_id: 2001,
      tasks: [],
    }),
    readUnit: async () => ({
      id: 2001,
      taskDefinitions: structuredClone(definitions),
      task_definitions: structuredClone(definitions),
    }),
  });

  const output = await listTasks({ project_id: 1001 });

  assert.equal(output.count, 1);
  assert.equal(output.tasks[0]?.task_definition_id, 3001);
});

test('Student Task View catalogue joins one Task Instance and applies case-insensitive status filtering', async () => {
  const listTasks = createAgentTasksList({
    readProject: async () => ({
      id: 1001,
      unit_id: 2001,
      tasks: [
        {
          id: 9001,
          task_definition_id: 3001,
          status: 'working_on_it',
          due_date: '2026-08-12T00:00:00Z',
          completion_date: '2026-08-11T00:00:00Z',
        },
      ],
    }),
    readUnit: async () => ({
      id: 2001,
      code: 'FIT0001',
      task_definitions: [
        { id: 3001, abbreviation: 'T1', name: 'Task 1' },
        { id: 3002, abbreviation: 'T2', name: 'Task 2' },
      ],
    }),
  });

  const output = await listTasks({
    project_id: 1001,
    status: ' WORKING_ON_IT ',
  });

  assert.deepEqual(output, {
    count: 1,
    tasks: [
      {
        project_id: 1001,
        unit_id: 2001,
        unit_code: 'FIT0001',
        task_definition_id: 3001,
        task_instance_id: 9001,
        abbreviation: 'T1',
        name: 'Task 1',
        status: 'working_on_it',
        due_date: '2026-08-12T00:00:00Z',
        completion_date: '2026-08-11T00:00:00Z',
        instantiated: true,
        visibility: 'within_target',
      },
    ],
  });
});

test('Student Task View catalogue returns only decisively visible Task Definitions', async () => {
  const listTasks = createAgentTasksList({
    readProject: async () => ({
      id: 1001,
      unit_id: 2001,
      target_grade: 0,
      tasks: [],
      tutorial_enrolments: [{ tutorial_id: 4001 }],
    }),
    readUnit: async () => ({
      id: 2001,
      tutorial_streams: [{ abbreviation: 'A' }, { abbreviation: 'B' }],
      tutorials: [{ id: 4001, tutorial_stream_abbr: 'A' }],
      task_definitions: [
        { id: 3001, abbreviation: 'VISIBLE', target_grade: 0 },
        { id: 3002, abbreviation: 'GRADE', target_grade: 1 },
        {
          id: 3003,
          abbreviation: 'STREAM',
          target_grade: 0,
          tutorial_stream_abbr: 'B',
        },
      ],
    }),
  });

  const output = await listTasks({ project_id: 1001 });

  assert.deepEqual(
    output.tasks.map((task) => task.task_definition_id),
    [3001],
  );
});

test('Student Task View catalogue fails closed when visibility cannot be determined', async () => {
  const listTasks = createAgentTasksList({
    readProject: async () => ({
      id: 1001,
      unit_id: 2001,
      tasks: [],
    }),
    readUnit: async () => ({
      id: 2001,
      task_definitions: [
        { id: 3001, abbreviation: 'T1', target_grade: 1 },
      ],
    }),
  });

  await assert.rejects(
    () => listTasks({ project_id: 1001 }),
    (error: unknown) =>
      error instanceof AgentProtocolError &&
      error.code === 'REMOTE_UNAVAILABLE',
  );
});

test('Student Task View catalogue enforces the 200-item result limit', async () => {
  const definitions = Array.from({ length: 201 }, (_, index) => ({
    id: index + 1,
    abbreviation: `T${index + 1}`,
  }));
  const listTasks = createAgentTasksList({
    readProject: async () => ({
      id: 1001,
      unit_id: 2001,
      tasks: [],
    }),
    readUnit: async () => ({
      id: 2001,
      task_definitions: definitions,
    }),
  });

  await assert.rejects(
    () => listTasks({ project_id: 1001 }),
    (error: unknown) =>
      error instanceof AgentProtocolError &&
      error.code === 'REMOTE_UNAVAILABLE',
  );
});

test('Student Task View catalogue accepts exactly 200 compact visible Task Definitions', async () => {
  const listTasks = createAgentTasksList({
    readProject: async () => ({
      id: 1001,
      unit_id: 2001,
      tasks: [],
    }),
    readUnit: async () => ({
      id: 2001,
      task_definitions: Array.from({ length: 200 }, (_, index) => ({
        id: index + 1,
        abbreviation: `T${index + 1}`,
      })),
    }),
  });

  const output = await listTasks({ project_id: 1001 });

  assert.equal(output.count, 200);
  assert.equal(output.tasks.length, 200);
});

test('Student Task View catalogue rejects unsafe control, format, and separator text from remote contracts', async () => {
  const unsafeValues = [
    'T\u0007',
    'T\u009b',
    'safe\u202edoc',
    'safe\u2028line',
    'safe\u2029paragraph',
    'safe\u200bzero-width',
  ];

  for (const abbreviation of unsafeValues) {
    const listTasks = createAgentTasksList({
      readProject: async () => ({
        id: 1001,
        unit_id: 2001,
        tasks: [],
      }),
      readUnit: async () => ({
        id: 2001,
        task_definitions: [{ id: 3001, abbreviation }],
      }),
    });

    await assert.rejects(
      () => listTasks({ project_id: 1001 }),
      (error: unknown) =>
        error instanceof AgentProtocolError &&
        error.code === 'REMOTE_UNAVAILABLE',
    );
  }
});

test('Student Task View catalogue bounds the complete pretty Agent envelope', async () => {
  const listTasks = createAgentTasksList({
    readProject: async () => ({
      id: 1001,
      unit_id: 2001,
      tasks: [],
    }),
    readUnit: async () => ({
      id: 2001,
      task_definitions: Array.from({ length: 200 }, (_, index) => ({
        id: index + 1,
        abbreviation: `T${index + 1}`,
        name: '\ud800'.repeat(512),
      })),
    }),
  });

  await assert.rejects(
    () => listTasks({ project_id: 1001 }),
    (error: unknown) =>
      error instanceof AgentProtocolError &&
      error.code === 'REMOTE_UNAVAILABLE',
  );
});

test('Student Task View catalogue classifies a caller-provided unit hint mismatch as invalid input', async () => {
  let unitReads = 0;
  const listTasks = createAgentTasksList({
    readProject: async () => ({
      id: 1001,
      unit_id: 2001,
      tasks: [],
    }),
    readUnit: async () => {
      unitReads += 1;
      return { id: 2999, task_definitions: [] };
    },
  });

  await assert.rejects(
    () => listTasks({ project_id: 1001, unit_id: 2999 }),
    (error: unknown) =>
      error instanceof AgentProtocolError &&
      error.code === 'INVALID_ARGUMENT',
  );
  assert.equal(unitReads, 0);
});

test('Student Task View catalogue rejects duplicate tutorial identities before visibility projection', async () => {
  const listTasks = createAgentTasksList({
    readProject: async () => ({
      id: 1001,
      unit_id: 2001,
      tasks: [],
      tutorial_enrolments: [{ tutorial_id: 4001 }],
    }),
    readUnit: async () => ({
      id: 2001,
      tutorial_streams: [{ abbreviation: 'A' }, { abbreviation: 'B' }],
      tutorials: [
        { id: 4001, tutorial_stream_abbr: 'A' },
        { id: 4001, tutorial_stream_abbr: 'B' },
      ],
      task_definitions: [
        {
          id: 3001,
          abbreviation: 'T1',
          tutorial_stream_abbr: 'A',
        },
      ],
    }),
  });

  await assert.rejects(
    () => listTasks({ project_id: 1001 }),
    (error: unknown) =>
      error instanceof AgentProtocolError &&
      error.code === 'REMOTE_UNAVAILABLE',
  );
});
