import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import type { FeedbackItem, ProjectSummary } from '../src/lib/types.js';
import {
  buildPdfFilename,
  diffWatchStates,
  feedbackIdentity,
  getFlagValues,
  getFeedbackTimestamp,
  makeWatchTaskKey,
  parseTaskSelectorArgs,
  parseUploadFileSpecs,
  resolveDownloadDir,
  resolveTaskSelector,
  sortFeedbackItems,
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

test('sortFeedbackItems sorts by timestamp then id', () => {
  const items: FeedbackItem[] = [
    { id: 3, createdAt: '2026-03-11T00:03:00.000Z', comment: 'c' },
    { id: 1, createdAt: '2026-03-11T00:01:00.000Z', comment: 'a' },
    { id: 2, createdAt: '2026-03-11T00:01:00.000Z', comment: 'b' },
  ];

  const sorted = sortFeedbackItems(items);
  assert.deepEqual(
    sorted.map((item) => [item.id, getFeedbackTimestamp(item)]),
    [
      [1, '2026-03-11T00:01:00.000Z'],
      [2, '2026-03-11T00:01:00.000Z'],
      [3, '2026-03-11T00:03:00.000Z'],
    ],
  );
});

test('feedbackIdentity prefers id and falls back to timestamp+text', () => {
  const withId = feedbackIdentity({
    id: 88,
    createdAt: '2026-03-11T00:00:00.000Z',
    comment: 'hello',
  } as FeedbackItem);
  assert.equal(withId, 'id:88');

  const noId = feedbackIdentity({
    id: Number.NaN as unknown as number,
    createdAt: '2026-03-11T00:00:00.000Z',
    comment: 'hello',
  } as FeedbackItem);
  assert.equal(noId, '2026-03-11T00:00:00.000Z:hello');
});

test('getFlagValues supports repeated flags and validates value presence', () => {
  const values = getFlagValues(['--file', 'a.txt', '--file', 'b.txt'], '--file');
  assert.deepEqual(values, ['a.txt', 'b.txt']);

  assert.throws(
    () => getFlagValues(['--file', '--json'], '--file'),
    /Missing value for --file/,
  );
});

test('parseUploadFileSpecs supports plain paths and explicit file keys', () => {
  const specs = parseUploadFileSpecs([
    '--file',
    './report.pdf',
    '--file',
    'file1=./demo.mp4',
  ]);
  assert.deepEqual(specs, [
    { path: './report.pdf' },
    { key: 'file1', path: './demo.mp4' },
  ]);
});

test('parseUploadFileSpecs requires at least one --file', () => {
  assert.throws(
    () => parseUploadFileSpecs(['--project-id', '101']),
    /Provide at least one --file <path>/,
  );
});
