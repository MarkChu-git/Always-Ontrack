import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { AgentProtocolError } from '../src/lib/agent-protocol.js';
import { createAgentTutorialsStatus } from '../src/lib/agent-tasks.js';

test('tutorial status resolves enrolled streams without exposing tutorial or learner details', async () => {
  const project = {
    id: 1001,
    unit_id: 2001,
    tutorial_enrolments: [{ tutorial_id: 4001 }],
  };
  const unit = {
    id: 2001,
    tutorial_streams: [{ abbreviation: 'A' }, { abbreviation: 'B' }],
    tutorials: [
      {
        id: 4001,
        tutorial_stream_abbr: 'A',
        room: 'Building 1, Room 2',
        tutor: { name: 'Private tutor' },
      },
    ],
    allow_student_change_tutorial: true,
  };
  const originalProject = structuredClone(project);
  const originalUnit = structuredClone(unit);
  const readTutorialStatus = createAgentTutorialsStatus({
    readProject: async () => project,
    readUnit: async () => unit,
  });

  const output = await readTutorialStatus({ project_id: 1001 });

  assert.deepEqual(output, {
    project_id: 1001,
    unit_id: 2001,
    state: 'known',
    available_streams: ['A', 'B'],
    enrolled_streams: ['A'],
    applies_to_all_streams: false,
    can_change_tutorial: true,
  });
  assert.equal(JSON.stringify(output).includes('Private tutor'), false);
  assert.equal(JSON.stringify(output).includes('Building 1'), false);
  assert.deepEqual(project, originalProject);
  assert.deepEqual(unit, originalUnit);
});

test('tutorial status returns an unknown projection when tutorial metadata is unavailable', async () => {
  const readTutorialStatus = createAgentTutorialsStatus({
    readProject: async () => ({
      id: 1001,
      unit_id: 2001,
      tasks: [],
      tutorial_enrolments: [{ tutorial_id: 4001 }],
    }),
    readUnit: async () => ({ id: 2001, task_definitions: [] }),
  });

  assert.deepEqual(await readTutorialStatus({ project_id: 1001 }), {
    project_id: 1001,
    unit_id: 2001,
    state: 'unknown',
    available_streams: [],
    enrolled_streams: [],
    applies_to_all_streams: null,
    can_change_tutorial: null,
  });
});

test('tutorial status reports a generic tutorial as applying to every stream', async () => {
  const readTutorialStatus = createAgentTutorialsStatus({
    readProject: async () => ({
      id: 1001,
      unit_id: 2001,
      tutorial_enrolments: [{ tutorial_id: 4001 }],
    }),
    readUnit: async () => ({
      id: 2001,
      tutorial_streams: [{ abbreviation: 'A' }, { abbreviation: 'B' }],
      tutorials: [{ id: 4001 }],
      allow_student_change_tutorial: false,
    }),
  });

  assert.deepEqual(await readTutorialStatus({ project_id: 1001 }), {
    project_id: 1001,
    unit_id: 2001,
    state: 'known',
    available_streams: ['A', 'B'],
    enrolled_streams: [],
    applies_to_all_streams: true,
    can_change_tutorial: false,
  });
});

test('tutorial status fails closed when the tutorial change policy is malformed', async () => {
  const readTutorialStatus = createAgentTutorialsStatus({
    readProject: async () => ({ id: 1001, unit_id: 2001, tasks: [] }),
    readUnit: async () => ({
      id: 2001,
      task_definitions: [],
      allow_student_change_tutorial: 'true',
    }),
  });

  await assert.rejects(
    () => readTutorialStatus({ project_id: 1001 }),
    (error: unknown) =>
      error instanceof AgentProtocolError &&
      error.code === 'REMOTE_UNAVAILABLE' &&
      error.summary === 'OnTrack returned an invalid tutorial change policy.',
  );
});

test('tutorial status fails closed on conflicting tutorial change policy aliases', async () => {
  const readTutorialStatus = createAgentTutorialsStatus({
    readProject: async () => ({ id: 1001, unit_id: 2001, tasks: [] }),
    readUnit: async () => ({
      id: 2001,
      task_definitions: [],
      allowStudentChangeTutorial: true,
      allow_student_change_tutorial: false,
    }),
  });

  await assert.rejects(
    () => readTutorialStatus({ project_id: 1001 }),
    (error: unknown) =>
      error instanceof AgentProtocolError &&
      error.code === 'REMOTE_UNAVAILABLE' &&
      error.summary === 'OnTrack returned conflicting tutorial change policy aliases.',
  );
});

test('tutorial status fails closed on malformed tutorial join aliases', async () => {
  const cases = [
    {
      project: {
        id: 1001,
        unit_id: 2001,
        tutorial_enrolments: [{ tutorial_id: 4001 }],
        tutorialEnrolments: [{ tutorial_id: 4002 }],
      },
      unit: { id: 2001 },
    },
    {
      project: { id: 1001, unit_id: 2001 },
      unit: {
        id: 2001,
        tutorial_streams: [{ abbreviation: 'A', tutorial_stream_abbr: 'B' }],
      },
    },
    {
      project: { id: 1001, unit_id: 2001 },
      unit: {
        id: 2001,
        tutorials: [
          { id: 4001, tutorialStreamAbbr: 'A', tutorial_stream_abbr: 'B' },
        ],
      },
    },
  ];

  for (const { project, unit } of cases) {
    const readTutorialStatus = createAgentTutorialsStatus({
      readProject: async () => project,
      readUnit: async () => unit,
    });
    await assert.rejects(
      () => readTutorialStatus({ project_id: 1001 }),
      (error: unknown) =>
        error instanceof AgentProtocolError && error.code === 'REMOTE_UNAVAILABLE',
    );
  }
});

test('tutorial status rejects a mismatched unit hint before reading the unit', async () => {
  let unitReads = 0;
  const readTutorialStatus = createAgentTutorialsStatus({
    readProject: async () => ({ id: 1001, unit_id: 2001 }),
    readUnit: async () => {
      unitReads += 1;
      return { id: 2001 };
    },
  });

  await assert.rejects(
    () => readTutorialStatus({ project_id: 1001, unit_id: 2999 }),
    (error: unknown) =>
      error instanceof AgentProtocolError && error.code === 'INVALID_ARGUMENT',
  );
  assert.equal(unitReads, 0);
});
