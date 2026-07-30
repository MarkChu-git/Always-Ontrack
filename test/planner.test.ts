import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  buildPlannerViews,
  buildResetTargetDatesMutation,
  buildTargetDateMutation,
  validatePlanDateChange,
} from '../src/lib/planner.js';
import { buildStudentTaskViews } from '../src/lib/student-task-view.js';
import type { ProjectSummary } from '../src/lib/types.js';

function plannerProject(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id: 101,
    target_grade: 1,
    spec_con_days: 2,
    tasks: [
      {
        id: 9001,
        task_definition_id: 501,
        status: 'working_on_it',
        target_start_date: '2026-03-03',
        target_due_date: '2026-03-09',
      },
    ],
    unit: {
      id: 55,
      code: 'FIT0001',
      allow_flexible_dates: true,
      task_definitions: [
        {
          id: 501,
          abbreviation: 'P1',
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
      ],
    },
    ...overrides,
  };
}

test('buildPlannerViews keeps personal, grade, unit, and feedback date semantics explicit', () => {
  const studentViews = buildStudentTaskViews([plannerProject()], {
    includeBeyondTarget: true,
  });
  const plans = buildPlannerViews(studentViews, [
    {
      id: 1,
      task_definition_id: 501,
      prerequisite_id: 400,
      task_status: 'complete',
    },
  ]);

  assert.equal(plans.length, 1);
  assert.deepEqual(plans[0].start, {
    kind: 'start',
    value: '2026-03-03',
    source: 'personal',
    editable: true,
    interpretation: 'unit_local_calendar_date',
  });
  assert.deepEqual(plans[0].target, {
    kind: 'target',
    value: '2026-03-09',
    source: 'personal',
    editable: true,
    interpretation: 'unit_local_calendar_date',
  });
  assert.deepEqual(plans[0].feedbackDeadline, {
    kind: 'feedback_deadline',
    value: '2026-03-12',
    source: 'unit_default',
    editable: false,
    interpretation: 'unit_local_calendar_date',
  });
  assert.deepEqual(plans[0].prerequisites, [
    { taskDefinitionId: 400, requiredStatus: 'complete' },
  ]);
});

test('buildPlannerViews leaves feedback deadline missing instead of deriving it', () => {
  const project = plannerProject();
  project.unit = {
    ...project.unit!,
    task_definitions: (project.unit!.task_definitions ?? []).map((definition) => {
      const { due_date: _dueDate, ...withoutDueDate } = definition;
      return withoutDueDate;
    }),
  };

  const plan = buildPlannerViews(
    buildStudentTaskViews([project], {
      includeBeyondTarget: true,
      includeUnknown: true,
    }),
    [],
  )[0];

  assert.deepEqual(plan.feedbackDeadline, {
    kind: 'feedback_deadline',
    value: undefined,
    source: 'missing',
    editable: false,
    interpretation: 'unit_local_calendar_date',
  });
});

test('buildPlannerViews uses target-grade dates before base unit dates', () => {
  const project = plannerProject({ tasks: [] });
  const plan = buildPlannerViews(
    buildStudentTaskViews([project], { includeBeyondTarget: true }),
    [],
  )[0];

  assert.equal(plan.start.value, '2026-03-02');
  assert.equal(plan.start.source, 'grade_default');
  assert.equal(plan.target.value, '2026-03-10');
  assert.equal(plan.target.source, 'grade_default');
});

test('validatePlanDateChange rejects invalid dates and inverted ranges', () => {
  assert.throws(
    () =>
      validatePlanDateChange({
        startDate: '2026-02-30',
        targetDate: '2026-03-10',
      }),
    /valid YYYY-MM-DD/,
  );
  assert.throws(
    () =>
      validatePlanDateChange({
        startDate: '2026-03-11',
        targetDate: '2026-03-10',
      }),
    /start date must not be after target date/i,
  );
});

test('planner mutations use the observed PUT contracts and snake-case payload', () => {
  const plan = buildPlannerViews(
    buildStudentTaskViews([plannerProject()], { includeBeyondTarget: true }),
    [],
  )[0];

  assert.deepEqual(
    buildTargetDateMutation(plan, {
      startDate: '2026-03-04',
      targetDate: '2026-03-11',
    }),
    {
      method: 'PUT',
      endpoint: '/projects/101/task_def_id/501/target_dates',
      body: {
        target_start_date: '2026-03-04',
        target_due_date: '2026-03-11',
      },
    },
  );
  assert.deepEqual(buildResetTargetDatesMutation(101), {
    method: 'PUT',
    endpoint: '/projects/101/reset_target_dates',
  });
});

test('buildTargetDateMutation refuses writes when the unit disables flexible dates', () => {
  const project = plannerProject({ tasks: [] });
  project.unit = {
    ...project.unit!,
    allow_flexible_dates: false,
  };
  const plan = buildPlannerViews(
    buildStudentTaskViews([project], { includeBeyondTarget: true }),
    [],
  )[0];

  assert.throws(
    () =>
      buildTargetDateMutation(plan, {
        startDate: '2026-03-04',
        targetDate: '2026-03-11',
      }),
    /does not allow flexible dates/i,
  );
});
