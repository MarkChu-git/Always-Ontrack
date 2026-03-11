import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import type { ProjectSummary } from '../src/lib/types.js';
import {
  buildPdfFilename,
  diffWatchStates,
  makeWatchTaskKey,
  parseTaskSelectorArgs,
  resolveDownloadDir,
  resolveTaskSelector,
  toWatchStateMap,
} from '../src/lib/utils.js';

const sampleProjects: ProjectSummary[] = [
  {
    id: 101,
    unit: {
      id: 55,
      code: 'FIT2004',
      name: 'Algorithms and Data Structures',
    },
    tasks: [
      {
        id: 11,
        status: 'not_started',
        dueDate: '2026-03-20',
        definition: {
          id: 501,
          abbreviation: 'T1',
          name: 'Task 1',
        },
      },
      {
        id: 12,
        status: 'working_on_it',
        dueDate: '2026-04-02',
        definition: {
          id: 502,
          abbreviation: 'T2',
          name: 'Task 2',
        },
      },
    ],
  },
];

test('parseTaskSelectorArgs supports --task-id', () => {
  const selector = parseTaskSelectorArgs(['--project-id', '101', '--task-id', '501']);
  assert.deepEqual(selector, {
    projectId: 101,
    taskId: 501,
    abbr: undefined,
  });
});

test('parseTaskSelectorArgs supports --abbr', () => {
  const selector = parseTaskSelectorArgs(['--project-id', '101', '--abbr', 'T1']);
  assert.deepEqual(selector, {
    projectId: 101,
    taskId: undefined,
    abbr: 'T1',
  });
});

test('parseTaskSelectorArgs requires --task-id or --abbr', () => {
  assert.throws(
    () => parseTaskSelectorArgs(['--project-id', '101']),
    /Task-level commands require either --task-id <id> or --abbr <abbr>/,
  );
});

test('resolveTaskSelector throws when --task-id and --abbr do not match', () => {
  assert.throws(
    () => resolveTaskSelector(sampleProjects, { projectId: 101, taskId: 501, abbr: 'T2' }),
    /--task-id and --abbr refer to different tasks/,
  );
});

test('resolveTaskSelector accepts matching --task-id and --abbr', () => {
  const resolved = resolveTaskSelector(sampleProjects, { projectId: 101, taskId: 501, abbr: 'T1' });
  assert.equal(resolved.taskDefId, 501);
  assert.equal(resolved.abbr, 'T1');
  assert.equal(resolved.unitCode, 'FIT2004');
});

test('buildPdfFilename and resolveDownloadDir follow defaults', () => {
  const filename = buildPdfFilename('FIT2004', 'T1', 'task');
  assert.equal(filename, 'FIT2004_T1_task.pdf');

  const sanitized = buildPdfFilename('FIT 2004', 'Task 1', 'submission');
  assert.equal(sanitized, 'FIT_2004_Task_1_submission.pdf');

  const outDir = resolveDownloadDir(undefined, '/tmp/workspace');
  assert.equal(outDir, resolve('/tmp/workspace/downloads'));
});

test('diffWatchStates emits status/due/new_feedback deltas', () => {
  const key = makeWatchTaskKey(101, 501);
  const previous = toWatchStateMap([
    {
      taskKey: key,
      projectId: 101,
      taskId: 501,
      unitCode: 'FIT2004',
      abbr: 'T1',
      status: 'working_on_it',
      dueDate: '2026-03-20',
      commentCount: 1,
      lastCommentAt: '2026-03-10T00:00:00.000Z',
    },
  ]);

  const current = toWatchStateMap([
    {
      taskKey: key,
      projectId: 101,
      taskId: 501,
      unitCode: 'FIT2004',
      abbr: 'T1',
      status: 'ready_for_feedback',
      dueDate: '2026-03-22',
      commentCount: 2,
      lastCommentAt: '2026-03-11T00:00:00.000Z',
    },
  ]);

  const events = diffWatchStates(previous, current, '2026-03-11T12:00:00.000Z');
  assert.deepEqual(events.map((event) => event.type), [
    'status_changed',
    'due_changed',
    'new_feedback',
  ]);
  assert.equal(events.find((event) => event.type === 'new_feedback')?.deltaComments, 1);
});

test('diffWatchStates emits no events when nothing changed', () => {
  const key = makeWatchTaskKey(101, 501);
  const previous = toWatchStateMap([
    {
      taskKey: key,
      projectId: 101,
      taskId: 501,
      status: 'working_on_it',
      dueDate: '2026-03-20',
      commentCount: 1,
      lastCommentAt: '2026-03-10T00:00:00.000Z',
    },
  ]);

  const current = toWatchStateMap([
    {
      taskKey: key,
      projectId: 101,
      taskId: 501,
      status: 'working_on_it',
      dueDate: '2026-03-20',
      commentCount: 1,
      lastCommentAt: '2026-03-10T00:00:00.000Z',
    },
  ]);

  const events = diffWatchStates(previous, current);
  assert.equal(events.length, 0);
});
