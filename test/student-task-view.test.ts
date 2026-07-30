import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'bun:test';
import {
  buildStudentTaskViews,
  buildStudentTaskRows,
  resolveStudentTaskViews,
} from '../src/lib/student-task-view.js';
import type { ProjectSummary } from '../src/lib/types.js';

function emptyInstanceProject(): ProjectSummary {
  const fixture = JSON.parse(
    readFileSync(
      new URL('./fixtures/student-task-view/tutorial-visibility.json', import.meta.url),
      'utf8',
    ),
  ) as { project: ProjectSummary };
  return structuredClone(fixture.project);
}

test('buildStudentTaskViews derives visible tasks from definitions when project tasks are empty', () => {
  const project = emptyInstanceProject();
  const views = buildStudentTaskViews([project]);

  assert.equal(views.length, 1);
  assert.equal(views[0].reference.projectId, 101);
  assert.equal(views[0].reference.unitId, 55);
  assert.equal(views[0].reference.taskDefinitionId, 501);
  assert.equal(views[0].taskInstanceId, undefined);
  assert.equal(views[0].status, 'not_instantiated');
  assert.equal(views[0].visibility, 'within_target');
  assert.equal(views[0].definition.abbreviation, 'P1');
});

test('buildStudentTaskViews can expose beyond-target and tutorial-mismatch tasks explicitly', () => {
  const views = buildStudentTaskViews([emptyInstanceProject()], {
    includeBeyondTarget: true,
    includeTutorialMismatches: true,
  });

  assert.deepEqual(
    views.map((view) => [view.definition.abbreviation, view.visibility]),
    [
      ['P1', 'within_target'],
      ['P2', 'tutorial_mismatch'],
      ['C1', 'beyond_target'],
    ],
  );
});

test('buildStudentTaskViews marks unresolved tutorial context unknown and excludes it by default', () => {
  const project = emptyInstanceProject();
  project.unit = {
    ...project.unit!,
    tutorials: [],
  };

  assert.deepEqual(
    buildStudentTaskViews([project]).map((view) => view.reference.taskDefinitionId),
    [],
  );

  const views = buildStudentTaskViews([project], {
    includeBeyondTarget: true,
    includeTutorialMismatches: true,
    includeUnknown: true,
  });
  assert.deepEqual(
    views.map((view) => [view.reference.taskDefinitionId, view.visibility]),
    [
      [501, 'unknown'],
      [502, 'unknown'],
      [503, 'beyond_target'],
    ],
  );
});

test('buildStudentTaskViews joins instances only through an explicit task definition identity', () => {
  const project = emptyInstanceProject();
  project.tasks = [
    {
      id: 9001,
      task_definition_id: 501,
      status: 'working_on_it',
      due_date: '2026-03-12',
    },
    {
      id: 503,
      status: 'complete',
    },
  ];

  const views = buildStudentTaskViews([project], {
    includeBeyondTarget: true,
    includeTutorialMismatches: true,
  });

  const passTask = views.find((view) => view.reference.taskDefinitionId === 501);
  const creditTask = views.find((view) => view.reference.taskDefinitionId === 503);
  assert.equal(passTask?.taskInstanceId, 9001);
  assert.equal(passTask?.status, 'working_on_it');
  assert.equal(passTask?.dates.effectiveDue, '2026-03-12');
  assert.equal(creditTask?.taskInstanceId, undefined);
  assert.equal(creditTask?.status, 'not_instantiated');
});

test('buildStudentTaskViews rejects multiple instances for one task definition', () => {
  const project = emptyInstanceProject();
  project.tasks = [
    {
      id: 9001,
      task_definition_id: 501,
      status: 'working_on_it',
    },
    {
      id: 9002,
      task_definition_id: 501,
      status: 'complete',
    },
  ];

  assert.throws(
    () => buildStudentTaskViews([project]),
    /multiple task instances.*definition 501.*project 101/i,
  );
});

test('resolveStudentTaskViews uses definition ids and rejects ambiguous abbreviations', () => {
  const project = emptyInstanceProject();
  project.unit!.task_definitions = [
    ...(project.unit!.task_definitions ?? []),
    {
      id: 504,
      abbreviation: 'P1',
      name: 'Duplicate abbreviation',
      target_grade: 0,
      tutorial_stream_abbr: 'Main Feedback',
    },
  ];

  const views = buildStudentTaskViews([project], {
    includeBeyondTarget: true,
    includeTutorialMismatches: true,
  });

  assert.equal(
    resolveStudentTaskViews(views, {
      projectId: 101,
      taskDefinitionIds: [503],
      abbreviations: [],
    })[0].definition.name,
    'Credit task',
  );
  assert.throws(
    () =>
      resolveStudentTaskViews(views, {
        projectId: 101,
        taskDefinitionIds: [],
        abbreviations: ['P1'],
      }),
    /ambiguous/,
  );
});

test('buildStudentTaskViews does not mutate raw project, definition, or instance payloads', () => {
  const project = emptyInstanceProject();
  const before = structuredClone(project);

  buildStudentTaskViews([project], {
    includeBeyondTarget: true,
    includeTutorialMismatches: true,
  });

  assert.deepEqual(project, before);
});

test('buildStudentTaskRows preserves definition and instance identities separately', () => {
  const rows = buildStudentTaskRows([emptyInstanceProject()], {
    includeBeyondTarget: true,
    includeTutorialMismatches: true,
  });

  assert.equal(rows[0].taskDefinitionId, 501);
  assert.equal(rows[0].taskInstanceId, undefined);
  assert.equal(rows[0].id, undefined);
  assert.equal(rows[0].isInstantiated, false);
  assert.equal(rows[0].projectId, 101);
});
