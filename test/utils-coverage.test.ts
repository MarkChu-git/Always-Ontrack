import { afterEach, test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FeedbackItem, ProjectSummary, TaskSummary } from '../src/lib/types.js';
import {
  buildPdfFilename,
  filterTasksByStatus,
  formatDate,
  getFeedbackText,
  getLatestFeedbackTimestamp,
  getTaskAbbreviation,
  getTaskCompletionDate,
  getTaskDefinitionId,
  getTaskDueDate,
  getTaskName,
  getTaskStatus,
  hasFlag,
  isFlag,
  isHeadlessServerEnvironment,
  isStaffLikeRole,
  normalizeBaseUrl,
  parseIntegerFlagValue,
  parseSsoRedirectUrl,
  parseUploadFileSpecs,
  printJson,
  printTable,
  redactSensitiveText,
  resolveLoginMode,
  resolveTaskBatchSelector,
  sanitizeFilenamePart,
  sleep,
  sortFeedbackItems,
  toRedactedError,
  writePdfFile,
} from '../src/lib/utils.js';

const originalLog = console.log;
const originalStdoutWrite = process.stdout.write;
afterEach(() => {
  console.log = originalLog;
  process.stdout.write = originalStdoutWrite;
});

test('normalization, SSO parsing, flags, and dates validate command-boundary inputs', () => {
  assert.equal(normalizeBaseUrl('https://example.test/custom?x=1#hash'), 'https://example.test/api');
  assert.equal(normalizeBaseUrl('https://example.test/api/v2'), 'https://example.test/api');
  assert.deepEqual(parseSsoRedirectUrl('https://example.test/sign_in?authToken=abc&username=mark'), {
    authToken: 'abc',
    username: 'mark',
  });
  assert.throws(() => parseSsoRedirectUrl('https://example.test/sign_in?username=mark'), /both authToken and username/);
  assert.equal(isFlag('--json'), true);
  assert.equal(isFlag('-j'), false);
  assert.equal(hasFlag(['list', '--json'], '--json'), true);
  assert.equal(parseIntegerFlagValue(' 42 ', '--project-id'), 42);
  assert.throws(() => parseIntegerFlagValue('--json', '--project-id'), /Missing value/);
  assert.throws(() => parseIntegerFlagValue('nope', '--project-id'), /Expected an integer/);
  assert.throws(() => parseIntegerFlagValue('42trailing', '--project-id'), /Expected an integer/);
  assert.throws(() => parseIntegerFlagValue('9007199254740992', '--project-id'), /Expected an integer/);
  assert.equal(formatDate('2026-08-09T23:00:00.000Z'), '2026-08-09');
  assert.equal(formatDate('not-a-date'), 'not-a-date');
  assert.equal(formatDate(), '-');
});

test('login/headless decisions honour explicit safety overrides and TTY fallback', () => {
  assert.equal(resolveLoginMode({ hasAuthToken: true, hasUsername: true, hasRedirectUrl: true }), 'manual');
  assert.equal(resolveLoginMode({ hasAuthToken: true, hasUsername: true, hasRedirectUrl: false }), 'manual');
  assert.equal(resolveLoginMode({ hasAuthToken: false, hasUsername: false, hasRedirectUrl: true }), 'manual');
  assert.equal(resolveLoginMode({ hasAuthToken: false, hasUsername: false, hasRedirectUrl: false }), 'auto');
  assert.equal(resolveLoginMode({ hasAuthToken: true, hasUsername: false, hasRedirectUrl: false }), 'auto');
  const ttys = { stdin: { isTTY: true }, stdout: { isTTY: true } } as never;
  assert.equal(isHeadlessServerEnvironment({ ONTRACK_HEADLESS: 'true' }, ttys), true);
  assert.equal(isHeadlessServerEnvironment({ ONTRACK_HEADLESS: 'false', CI: 'yes' }, ttys), false);
  assert.equal(isHeadlessServerEnvironment({ CI: '1' }, ttys), true);
  assert.equal(isHeadlessServerEnvironment({ SSH_CONNECTION: 'x' }, ttys), true);
  assert.equal(isHeadlessServerEnvironment({}, { stdin: { isTTY: false }, stdout: { isTTY: true } } as never), true);
});

test('redaction removes URL, JSON, assignment, and bearer credentials', () => {
  const canary = [
    'https://example.test/x?auth',
    'Token=abc&safe=yes pass',
    'word="pw" access_',
    'token=xyz Author',
    'ization: Bearer bearer-value',
  ].join('');
  const redacted = redactSensitiveText(canary);
  for (const leaked of ['abc', 'pw', 'xyz', 'bearer-value']) {
    assert.equal(redacted.includes(leaked), false);
  }
  assert.match(redacted, /safe=yes/);
  assert.equal(toRedactedError(new Error('auth_token=hidden')).message, 'auth_token=[REDACTED]');
});

test('task shape adapters preserve only explicit task-definition identity', () => {
  const task = {
    id: 9,
    definition: { id: '501' as unknown as number, abbreviation: ' T1 ', name: ' Task one ' },
    due_date: '2026-08-10',
    completion_date: '2026-08-12',
    status: ' complete ',
  } as TaskSummary;
  assert.equal(getTaskDefinitionId(task), 501);
  assert.equal(getTaskAbbreviation(task), 'T1');
  assert.equal(getTaskName(task), 'Task one');
  assert.equal(getTaskDueDate(task), '2026-08-10');
  assert.equal(getTaskCompletionDate(task), '2026-08-12');
  assert.equal(getTaskStatus(task), 'complete');
  assert.equal(getTaskDefinitionId({ id: 123 } as TaskSummary), undefined);
  assert.equal(getTaskAbbreviation({ abbreviation: ' A ' } as TaskSummary), 'A');
  assert.equal(getTaskName({ name: ' Title ' } as TaskSummary), 'Title');
  assert.equal(getTaskDueDate({ dueDate: '2026-01-01' } as TaskSummary), '2026-01-01');
  assert.equal(getTaskCompletionDate({ completionDate: '2026-01-02' } as TaskSummary), '2026-01-02');
});

test('batch selector reports missing projects, tasks, and ambiguous abbreviations', () => {
  const projects: ProjectSummary[] = [{
    id: 1,
    target_grade: 0,
    unit: {
      id: 2,
      task_definitions: [
        { id: 101, abbreviation: 'A', target_grade: 0 },
        { id: 102, abbreviation: 'A', target_grade: 0 },
      ],
    },
    tasks: [
      { id: 11, task_definition_id: 101, abbreviation: 'A' },
      { id: 12, task_definition_id: 102, abbreviation: 'A' },
    ],
  }];
  assert.throws(() => resolveTaskBatchSelector(projects, { projectId: 99, taskIds: [], abbrs: [], allTasks: true }), /Project 99 not found/);
  assert.throws(
    () => resolveTaskBatchSelector(projects, { projectId: 1, taskIds: [999], abbrs: [], allTasks: false }),
    /(?:Task|Legacy task) id 999/,
  );
  assert.throws(() => resolveTaskBatchSelector(projects, { projectId: 1, taskIds: [], abbrs: ['a'], allTasks: false }), /ambiguous/);
});

test('status, role, filename, upload and feedback helpers cover fallbacks', async () => {
  assert.deepEqual(filterTasksByStatus([{ status: 'Complete' }, { status: 'working' }], ' complete '), [{ status: 'Complete' }]);
  assert.equal(filterTasksByStatus([{ status: 'Complete' }]).length, 1);
  assert.equal(isStaffLikeRole(' Tutor '), true);
  assert.equal(isStaffLikeRole('student'), false);
  assert.equal(sanitizeFilenamePart(' ../weird name! ', 'fallback'), '.._weird_name');
  assert.equal(sanitizeFilenamePart('   ', 'fallback'), 'fallback');
  assert.equal(buildPdfFilename(undefined, undefined, 'submission'), 'unit_task_submission.pdf');
  assert.deepEqual(parseUploadFileSpecs(['--file', 'bad=./x', '--file', 'file2= ./two.pdf ']), [
    { path: 'bad=./x' },
    { key: 'file2', path: './two.pdf' },
  ]);
  const feedback = [
    { created_at: 'raw-date', text: 'fallback' },
    { id: '2' as unknown as number, createdAt: '2026-01-01T00:00:00.000Z', comment: 'two' },
    { id: '1' as unknown as number, createdAt: '2026-01-01T00:00:00.000Z', comment: 'one' },
  ] as FeedbackItem[];
  assert.equal(getFeedbackText(feedback[0]), 'fallback');
  assert.deepEqual(sortFeedbackItems(feedback).map((item) => item.id), ['1', '2', undefined]);
  assert.equal(getLatestFeedbackTimestamp(feedback), '2026-01-01T00:00:00.000Z');
  assert.equal(getLatestFeedbackTimestamp([{ created_at: 'not-a-date' } as FeedbackItem]), 'not-a-date');
  const dir = await mkdtemp(join(tmpdir(), 'ontrack-utils-'));
  try {
    const path = await writePdfFile(Buffer.from('pdf'), 'file.pdf', '.', dir);
    assert.equal(await readFile(path, 'utf8'), 'pdf');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  await sleep(0);
});

test('human output helpers produce structured JSON/table output including empty tables', () => {
  const output: string[] = [];
  console.log = ((value: unknown) => output.push(String(value))) as typeof console.log;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output.push(String(chunk).trimEnd());
    return true;
  }) as typeof process.stdout.write;
  printJson({ a: 1 });
  printTable([]);
  printTable([{ unit: 'FIT', task: 'T1', status: 'complete', due: 'bad-date', extra: { x: 1 } }]);
  assert.equal(output[0], '{\n  "a": 1\n}');
  assert.equal(output[1], 'No results.');
  assert.match(output[2], /\(index\)/);
  assert.match(output[2], /FIT/);
});
