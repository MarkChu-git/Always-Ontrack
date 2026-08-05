import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { AgentProtocolError } from '../src/lib/agent-protocol.js';
import { buildAgentPlanShowOutput } from '../src/lib/agent-plan.js';
import type { ProjectSummary } from '../src/lib/types.js';

function projectFixture(): ProjectSummary {
  return {
    id: 101,
    target_grade: 1,
    tasks: [],
    unit: {
      id: 55,
      code: 'FIT0001',
      allow_flexible_dates: true,
      task_definitions: [
        {
          id: 501,
          abbreviation: 'D4',
          name: 'Design task',
          target_grade: 0,
          start_date: '2026-03-01',
          target_date: '2026-03-08',
          due_date: '2026-03-12',
          grade_due_dates: [
            {
              target_grade: 1,
              start_date: '2026-03-02',
              target_due_date: '2026-03-10',
            },
          ],
        },
        {
          id: 502,
          abbreviation: 'HD1',
          name: 'Beyond-target task',
          target_grade: 2,
          start_date: '2026-04-01',
          target_date: '2026-04-08',
          due_date: '2026-04-12',
        },
      ],
    },
  };
}

function assertRemoteUnavailable(run: () => unknown): void {
  assert.throws(run, (error: unknown) =>
    error instanceof AgentProtocolError && error.code === 'REMOTE_UNAVAILABLE'
  );
}

test('agent plan output is definition-first and preserves date-source semantics', () => {
  const output = buildAgentPlanShowOutput(
    [projectFixture()],
    [
      {
        id: 1,
        task_definition_id: 501,
        prerequisite_id: 400,
        task_status: 'complete',
      },
      {
        id: 2,
        taskDefinitionId: 501,
        prerequisiteId: 401,
        taskStatus: 'working',
      },
      {
        id: 3,
        task_definition_id: 999,
        prerequisite_id: 402,
        task_status: 'complete',
      },
    ],
    { project_id: 101, include_beyond_target: false },
  );

  assert.deepEqual(output, {
    project_id: 101,
    unit_id: 55,
    unit_code: 'FIT0001',
    include_beyond_target: false,
    count: 1,
    tasks: [
      {
        task_definition_id: 501,
        task_instance_id: null,
        abbreviation: 'D4',
        name: 'Design task',
        status: 'not_instantiated',
        instantiated: false,
        visibility: 'within_target',
        flexible_dates: true,
        start: {
          kind: 'start',
          value: '2026-03-02',
          source: 'grade_default',
          editable: true,
          interpretation: 'unit_local_calendar_date',
        },
        target: {
          kind: 'target',
          value: '2026-03-10',
          source: 'grade_default',
          editable: true,
          interpretation: 'unit_local_calendar_date',
        },
        feedback_deadline: {
          kind: 'feedback_deadline',
          value: '2026-03-12',
          source: 'unit_default',
          editable: false,
          interpretation: 'unit_local_calendar_date',
        },
        prerequisites: [
          {
            task_definition_id: 400,
            required_status: 'complete',
            current_status: null,
          },
          {
            task_definition_id: 401,
            required_status: 'working',
            current_status: null,
          },
        ],
      },
    ],
  });

  assert.deepEqual(output.tasks[0]?.prerequisites, [
    {
      task_definition_id: 400,
      required_status: 'complete',
      current_status: null,
    },
    {
      task_definition_id: 401,
      required_status: 'working',
      current_status: null,
    },
  ]);

  const beyond = buildAgentPlanShowOutput(
    [projectFixture()],
    [],
    { project_id: 101, include_beyond_target: true },
  );
  assert.equal(beyond.count, 2);
  assert.equal(beyond.tasks[1]?.visibility, 'beyond_target');
});

test('agent plan dates use personal values first and return explicit missing values', () => {
  const project = projectFixture();
  project.tasks = [
    {
      id: 9001,
      task_definition_id: 501,
      status: 'working_on_it',
      target_start_date: '2026-03-03',
      target_due_date: '2026-03-09',
    },
  ];
  const definitions = project.unit?.task_definitions ?? [];
  definitions[0] = {
    ...definitions[0],
    due_date: undefined,
  };

  const output = buildAgentPlanShowOutput(
    [project],
    [{ task_definition_id: 501, prerequisite_id: 501, task_status: 'complete' }],
    { project_id: 101 },
  );
  assert.equal(output.tasks[0]?.task_instance_id, 9001);
  assert.equal(output.tasks[0]?.instantiated, true);
  assert.equal(output.tasks[0]?.prerequisites[0]?.current_status, 'working_on_it');
  assert.deepEqual(output.tasks[0]?.start, {
    kind: 'start',
    value: '2026-03-03',
    source: 'personal',
    editable: true,
    interpretation: 'unit_local_calendar_date',
  });
  assert.deepEqual(output.tasks[0]?.feedback_deadline, {
    kind: 'feedback_deadline',
    value: null,
    source: 'missing',
    editable: false,
    interpretation: 'unit_local_calendar_date',
  });
});

test('agent plan parsing fails closed for malformed dates and prerequisite aliases', () => {
  const invalidDates: unknown[] = [
    '2026-02-30',
    '2026-03-03T00:00:00Z',
    '',
    '2026-03-03\nsecret',
  ];
  for (const invalidDate of invalidDates) {
    const project = projectFixture();
    project.tasks = [
      {
        id: 9001,
        task_definition_id: 501,
        status: 'working_on_it',
        target_start_date: invalidDate,
      },
    ] as ProjectSummary['tasks'];
    assertRemoteUnavailable(() =>
      buildAgentPlanShowOutput([project], [], { project_id: 101 })
    );
  }
  const nullDateAlias = projectFixture();
  nullDateAlias.tasks = [
    {
      id: 9001,
      task_definition_id: 501,
      status: 'working_on_it',
      target_start_date: null,
      targetStartDate: '2026-03-03',
    },
  ];
  assertRemoteUnavailable(() =>
    buildAgentPlanShowOutput([nullDateAlias], [], { project_id: 101 })
  );

  const conflicts = projectFixture();
  conflicts.tasks = [
    {
      id: 9001,
      task_definition_id: 501,
      status: 'working_on_it',
      target_start_date: '2026-03-03',
      targetStartDate: '2026-03-04',
    },
  ];
  assertRemoteUnavailable(() =>
    buildAgentPlanShowOutput([conflicts], [], { project_id: 101 })
  );

  const malformedRows: unknown[] = [
    {},
    42,
    { task_definition_id: 501, taskDefinitionId: 502, prerequisite_id: 400 },
    { task_definition_id: 501, prerequisite_id: 0, task_status: 'complete' },
    { task_definition_id: 501, prerequisite_id: 400, task_status: 'bad\nstatus' },
    { task_definition_id: 501, prerequisite_id: 400, task_status: '\ncomplete' },
    {
      task_definition_id: 501,
      prerequisite_id: 400,
      task_status: null,
      taskStatus: 'complete',
    },
    {
      task_definition_id: 501,
      prerequisite_id: 400,
      task_status: 'complete',
      taskStatus: 'working',
    },
  ];
  for (const row of malformedRows) {
    assertRemoteUnavailable(() =>
      buildAgentPlanShowOutput([projectFixture()], [row], { project_id: 101 })
    );
  }
  assertRemoteUnavailable(() =>
    buildAgentPlanShowOutput([projectFixture()], {}, { project_id: 101 })
  );

  const unknownDefinition = projectFixture();
  unknownDefinition.tasks = [
    {
      id: 9001,
      task_definition_id: 999,
      status: 'working_on_it',
    },
  ];
  assertRemoteUnavailable(() =>
    buildAgentPlanShowOutput([unknownDefinition], [], { project_id: 101 })
  );

  const missingFlexibleFlag = projectFixture();
  delete (missingFlexibleFlag.unit as Record<string, unknown>).allow_flexible_dates;
  assertRemoteUnavailable(() =>
    buildAgentPlanShowOutput([missingFlexibleFlag], [], { project_id: 101 })
  );

  const conflictingGradeAliases = projectFixture();
  const firstDefinition = (conflictingGradeAliases.unit?.task_definitions ?? [])[0] as Record<
    string,
    unknown
  >;
  firstDefinition.gradeDueDates = [
    { target_grade: 1, start_date: '2026-03-02', target_due_date: '2026-03-10' },
  ];
  firstDefinition.grade_due_dates = [
    { target_grade: 1, start_date: '2026-03-03', target_due_date: '2026-03-10' },
  ];
  assertRemoteUnavailable(() =>
    buildAgentPlanShowOutput([conflictingGradeAliases], [], { project_id: 101 })
  );
});

test('agent plan retains tutorial mismatch and unknown visibility states', () => {
  const mismatch = projectFixture();
  mismatch.unit = {
    ...mismatch.unit!,
    tutorials: [{ id: 1, tutorial_stream_abbr: 'TUT1' }],
    tutorial_streams: [{ abbreviation: 'TUT1' }, { abbreviation: 'TUT2' }],
  };
  mismatch.tutorial_enrolments = [{ tutorial_id: 1 }];
  mismatch.unit.task_definitions = [
    ...(mismatch.unit.task_definitions ?? []),
    {
      id: 503,
      abbreviation: 'TUT2',
      name: 'Tutorial task',
      target_grade: 0,
      tutorial_stream_abbr: 'TUT2',
    },
  ];
  const mismatchOutput = buildAgentPlanShowOutput(
    [mismatch],
    [],
    { project_id: 101 },
  );
  assert.equal(
    mismatchOutput.tasks.find((task) => task.task_definition_id === 503)?.visibility,
    'tutorial_mismatch',
  );

  const unknown = projectFixture();
  unknown.unit = {
    ...unknown.unit!,
    task_definitions: [
      ...(unknown.unit?.task_definitions ?? []),
      {
        id: 503,
        abbreviation: 'TUT2',
        name: 'Tutorial task',
        target_grade: 0,
        tutorial_stream_abbr: 'TUT2',
      },
    ],
  };
  const unknownOutput = buildAgentPlanShowOutput([unknown], [], { project_id: 101 });
  assert.equal(
    unknownOutput.tasks.find((task) => task.task_definition_id === 503)?.visibility,
    'unknown',
  );
});

test('agent plan parsing enforces task and prerequisite count bounds', () => {
  const project = projectFixture();
  project.unit = {
    ...project.unit!,
    task_definitions: Array.from({ length: 201 }, (_, index) => ({
      id: index + 1,
      abbreviation: `T${index + 1}`,
      target_grade: 0,
    })),
  };
  assertRemoteUnavailable(() =>
    buildAgentPlanShowOutput([project], [], {
      project_id: 101,
      include_beyond_target: true,
    })
  );

  assertRemoteUnavailable(() =>
    buildAgentPlanShowOutput(
      [projectFixture()],
      Array.from({ length: 201 }, (_, index) => ({
        task_definition_id: 501,
        prerequisite_id: index + 1,
        task_status: 'complete',
      })),
      { project_id: 101 },
    )
  );
});
