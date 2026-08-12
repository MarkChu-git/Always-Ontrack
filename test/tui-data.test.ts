import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'bun:test';
import { buildStudentTaskViews } from '../src/lib/student-task-view.js';
import type { ProjectSummary } from '../src/lib/types.js';
import { bucketStatus, viewToTuiTask } from '../src/tui/data';

function fixtureProject(): ProjectSummary {
  const fixture = JSON.parse(
    readFileSync(
      new URL('./fixtures/student-task-view/tutorial-visibility.json', import.meta.url),
      'utf8',
    ),
  ) as { project: ProjectSummary };
  return structuredClone(fixture.project);
}

test('bucketStatus folds the full OnTrack workflow set into the six TUI buckets', () => {
  assert.equal(bucketStatus('not_started'), 'not_started');
  assert.equal(bucketStatus('not_instantiated'), 'not_started');
  assert.equal(bucketStatus('working_on_it'), 'working_on_it');
  assert.equal(bucketStatus('need_help'), 'need_help');
  assert.equal(bucketStatus('fix_and_resubmit'), 'need_help');
  assert.equal(bucketStatus('redo'), 'need_help');
  assert.equal(bucketStatus('fail'), 'need_help');
  assert.equal(bucketStatus('time_exceeded'), 'need_help');
  assert.equal(bucketStatus('ready_for_feedback'), 'ready_for_feedback');
  assert.equal(bucketStatus('feedback_exceeded'), 'ready_for_feedback');
  assert.equal(bucketStatus('assess_in_portfolio'), 'assess_in_portfolio');
  // Accepted but awaiting tutor discussion/demonstration: in-assessment, not complete.
  assert.equal(bucketStatus('discuss'), 'assess_in_portfolio');
  assert.equal(bucketStatus('demonstrate'), 'assess_in_portfolio');
  assert.equal(bucketStatus('complete'), 'complete');
  assert.equal(bucketStatus(undefined), 'not_started');
  assert.equal(bucketStatus('some_future_status'), 'not_started');
});

test('viewToTuiTask projects definition identity, dates, and status buckets', () => {
  const views = buildStudentTaskViews([fixtureProject()]);
  assert.ok(views.length > 0);
  const task = viewToTuiTask(views[0]);

  assert.equal(task.id, '101:501');
  assert.equal(task.title.startsWith('P1: '), true);
  assert.equal(task.status, 'not_started'); // not_instantiated folds into not_started
  assert.equal(task.dateSource, 'unit default');
  assert.notEqual(task.dueInDays, null); // fixture carries a due date
});

test('viewToTuiTask prefers a personal due-date override as the effective date', () => {
  const project = fixtureProject();
  const definition = project.unit?.task_definitions?.[0];
  assert.ok(definition);
  project.tasks = [
    {
      id: 9001,
      task_definition_id: definition.id,
      status: 'working_on_it',
      due_date: '2030-01-15',
    } as ProjectSummary['tasks'][number],
  ];

  const [task] = buildStudentTaskViews([project]).map(viewToTuiTask);
  assert.equal(task.status, 'working_on_it');
  assert.equal(task.dateSource, 'personal override');
  assert.equal(task.due, 'Jan 15');
  assert.ok(task.dueInDays !== null && task.dueInDays > 1000);
});
