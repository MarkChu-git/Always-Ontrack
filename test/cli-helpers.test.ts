import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import type { FeedbackItem, ProjectSummary } from '../src/lib/types.js';
import {
  buildPdfFilename,
  buildTaskResourceFilename,
  diffWatchStates,
  exceedsByteBudget,
  feedbackIdentity,
  getFlagValues,
  getFeedbackTimestamp,
  makeWatchTaskKey,
  parseTaskBatchSelectorArgs,
  parseTaskSelectorArgs,
  parseUploadFileSpecs,
  resolveDownloadDir,
  resolveTaskBatchSelector,
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
    taskDefinitionId: undefined,
    abbr: undefined,
  });
});

test('parseTaskSelectorArgs supports explicit --task-definition-id', () => {
  const selector = parseTaskSelectorArgs([
    '--project-id',
    '101',
    '--task-definition-id',
    '501',
  ]);
  assert.deepEqual(selector, {
    projectId: 101,
    taskId: undefined,
    taskDefinitionId: 501,
    abbr: undefined,
  });
});

test('parseTaskSelectorArgs supports --abbr', () => {
  const selector = parseTaskSelectorArgs(['--project-id', '101', '--abbr', 'T1']);
  assert.deepEqual(selector, {
    projectId: 101,
    taskId: undefined,
    taskDefinitionId: undefined,
    abbr: 'T1',
  });
});

test('parseTaskSelectorArgs requires an explicit, legacy, or abbreviation selector', () => {
  assert.throws(
    () => parseTaskSelectorArgs(['--project-id', '101']),
    /at least one --task-definition-id <id> \/ --task-id <legacy-id> \/ --abbr <abbr>/,
  );
});

test('parseTaskSelectorArgs rejects multi-selector inputs', () => {
  assert.throws(
    () => parseTaskSelectorArgs(['--project-id', '101', '--abbr', 'T1', '--abbr', 'T2']),
    /expects a single task selector set/,
  );
});

test('parseTaskBatchSelectorArgs supports repeated and comma-separated selectors', () => {
  const parsed = parseTaskBatchSelectorArgs([
    '--project-id',
    '101',
    '--abbr',
    'T1,T2',
    '--abbr',
    'T3',
    '--task-id',
    '501,502',
  ]);

  assert.deepEqual(parsed, {
    projectId: 101,
    taskIds: [501, 502],
    taskDefinitionIds: [],
    abbrs: ['T1', 'T2', 'T3'],
    allTasks: false,
  });
});

test('parseTaskBatchSelectorArgs supports --all-tasks and validates conflicts', () => {
  const all = parseTaskBatchSelectorArgs(['--project-id', '101', '--all-tasks']);
  assert.deepEqual(all, {
    projectId: 101,
    taskIds: [],
    taskDefinitionIds: [],
    abbrs: [],
    allTasks: true,
  });

  assert.throws(
    () => parseTaskBatchSelectorArgs(['--project-id', '101', '--all-tasks', '--abbr', 'T1']),
    /Do not combine --all-tasks/,
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

test('resolveTaskSelector keeps unique legacy instance ids at the CLI compatibility seam', () => {
  const resolved = resolveTaskSelector(sampleProjects, {
    projectId: 101,
    taskId: 11,
  });

  assert.equal(resolved.taskDefId, 501);
  assert.equal(resolved.taskInstanceId, 11);
});

test('resolveTaskSelector rejects a legacy id that matches different definition and instance identities', () => {
  const projects = structuredClone(sampleProjects);
  projects[0].tasks!.push({
    id: 501,
    status: 'not_started',
    definition: {
      id: 503,
      abbreviation: 'T3',
      name: 'Task 3',
    },
  });

  assert.throws(
    () => resolveTaskSelector(projects, { projectId: 101, taskId: 501 }),
    /ambiguous.*--task-definition-id/i,
  );
});

test('resolveTaskBatchSelector resolves all selected tasks with dedupe', () => {
  const resolved = resolveTaskBatchSelector(sampleProjects, {
    projectId: 101,
    taskDefinitionIds: [],
    taskIds: [501],
    abbrs: ['T1', 'T2'],
    allTasks: false,
  });

  assert.deepEqual(
    resolved.map((item) => item.abbr),
    ['T1', 'T2'],
  );
});

test('resolveTaskBatchSelector resolves --all-tasks', () => {
  const resolved = resolveTaskBatchSelector(sampleProjects, {
    projectId: 101,
    taskDefinitionIds: [],
    taskIds: [],
    abbrs: [],
    allTasks: true,
  });

  assert.equal(resolved.length, 2);
  assert.deepEqual(
    resolved.map((item) => item.abbr),
    ['T1', 'T2'],
  );
});

test('resolveTaskSelector derives an uninstantiated task from unit definitions', () => {
  const projects: ProjectSummary[] = [
    {
      id: 202,
      target_grade: 0,
      tasks: [],
      unit: {
        id: 77,
        code: 'FIT0002',
        task_definitions: [
          {
            id: 700,
            abbreviation: 'P1',
            name: 'Definition-only task',
            target_grade: 0,
          },
        ],
      },
    },
  ];

  const resolved = resolveTaskSelector(projects, {
    projectId: 202,
    taskDefinitionId: 700,
  });

  assert.equal(resolved.taskDefId, 700);
  assert.equal(resolved.taskInstanceId, undefined);
  assert.equal(resolved.abbr, 'P1');
});

test('buildPdfFilename and resolveDownloadDir follow defaults', () => {
  const filename = buildPdfFilename('FIT2004', 'T1', 'task');
  assert.equal(filename, 'FIT2004_T1_task.pdf');

  const sanitized = buildPdfFilename('FIT 2004', 'Task 1', 'submission');
  assert.equal(sanitized, 'FIT_2004_Task_1_submission.pdf');

  const outDir = resolveDownloadDir(undefined, '/tmp/workspace');
  assert.equal(outDir, resolve('/tmp/workspace/downloads'));
});

test('buildTaskResourceFilename follows the OnTrack student download naming contract', () => {
  assert.equal(
    buildTaskResourceFilename('FIT2004', 'T1'),
    'FIT2004-T1-TaskResources.zip',
  );
  assert.equal(
    buildTaskResourceFilename('FIT 2004', 'Task 1'),
    'FIT_2004-Task_1-TaskResources.zip',
  );
  const bounded = buildTaskResourceFilename('U'.repeat(500), 'T'.repeat(500));
  assert.equal(bounded.length <= 255, true);
  assert.equal(
    buildTaskResourceFilename('FIT\u001b[31m', 'P1').includes('\u001b'),
    false,
  );
});

test('exceedsByteBudget enforces an aggregate download cap', () => {
  assert.equal(exceedsByteBudget(4, 5, 10), false);
  assert.equal(exceedsByteBudget(4, 6, 10), false);
  assert.equal(exceedsByteBudget(4, 7, 10), true);
});

test('diffWatchStates emits status/due/new_feedback deltas', () => {
  const key = makeWatchTaskKey(101, 501);
  const previous = toWatchStateMap([
    {
      taskKey: key,
      projectId: 101,
      taskDefinitionId: 501,
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
      taskDefinitionId: 501,
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
      taskDefinitionId: 501,
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
      taskDefinitionId: 501,
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
