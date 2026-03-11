import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type {
  FeedbackItem,
  ProjectSummary,
  TaskSelector,
  TaskSummary,
  WatchEvent,
} from './types.js';

const DEFAULT_SITE_URL = 'https://ontrack.infotech.monash.edu';

export function normalizeBaseUrl(raw?: string): string {
  const candidate = raw?.trim() || process.env.ONTRACK_BASE_URL?.trim() || DEFAULT_SITE_URL;
  const url = new URL(candidate);

  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    url.pathname = '/api';
  } else {
    url.pathname = '/api';
  }

  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

export function parseSsoRedirectUrl(redirectUrl: string): { authToken: string; username: string } {
  const url = new URL(redirectUrl.trim());
  const authToken = url.searchParams.get('authToken');
  const username = url.searchParams.get('username');

  if (!authToken || !username) {
    throw new Error(
      'Redirect URL does not contain both authToken and username. Expected a URL like /sign_in?authToken=...&username=...',
    );
  }

  return { authToken, username };
}

export async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

export function openExternal(url: string): boolean {
  const platform = process.platform;
  let command: string;
  let args: string[];

  if (platform === 'darwin') {
    command = 'open';
    args = [url];
  } else if (platform === 'win32') {
    command = 'cmd';
    args = ['/c', 'start', '', url];
  } else {
    command = 'xdg-open';
    args = [url];
  }

  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export function isFlag(arg: string): boolean {
  return arg.startsWith('--');
}

export function getFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}

export function getFlagValues(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== flag) {
      continue;
    }

    const value = args[index + 1];
    if (!value || isFlag(value)) {
      throw new Error(`Missing value for ${flag}.`);
    }
    values.push(value);
    index += 1;
  }
  return values;
}

export function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

export function formatDate(value?: string): string {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return value;
  }

  return date.toISOString().slice(0, 10);
}

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function toDisplayValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '-';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

const ANSI_ESCAPE_PATTERN = /\u001B\[[0-9;]*m/g;

function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE_PATTERN, '');
}

function visibleLength(value: string): number {
  return stripAnsi(value).length;
}

function shouldUseColors(): boolean {
  if (process.env.NO_COLOR !== undefined) {
    return false;
  }

  const forced = process.env.FORCE_COLOR;
  if (forced && forced !== '0') {
    return true;
  }

  return Boolean(process.stdout.isTTY);
}

const COLORS_ENABLED = shouldUseColors();

function colorize(code: string, value: string): string {
  if (!COLORS_ENABLED) {
    return value;
  }
  return `\u001B[${code}m${value}\u001B[0m`;
}

function padRight(value: string, width: number): string {
  const length = visibleLength(value);
  if (length >= width) {
    return value;
  }
  return `${value}${' '.repeat(width - length)}`;
}

function styleStatus(raw: string, padded: string): string {
  const value = raw.trim().toLowerCase();
  if (!value || value === '-') {
    return colorize('2', padded);
  }

  const map: Record<string, string> = {
    complete: '32',
    ready_for_feedback: '34',
    not_started: '2',
    working_on_it: '36',
    need_help: '33',
    fix_and_resubmit: '31',
    discuss: '35',
    assess_in_portfolio: '33',
    redo: '31',
    fail: '31',
  };

  return colorize(map[value] || '37', padded);
}

function styleDue(raw: string, padded: string): string {
  const value = raw.trim();
  if (!value || value === '-') {
    return colorize('2', padded);
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return padded;
  }

  const due = new Date(parsed);
  due.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const days = Math.floor((due.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) {
    return colorize('31', padded);
  }
  if (days <= 3) {
    return colorize('33', padded);
  }
  return padded;
}

function styleCell(column: string, raw: string, padded: string): string {
  switch (column) {
    case '(index)':
      return colorize('2', padded);
    case 'unit':
    case 'unitCode':
      return colorize('36', padded);
    case 'task':
      return colorize('1', padded);
    case 'status':
      return styleStatus(raw, padded);
    case 'due':
      return styleDue(raw, padded);
    default:
      return padded;
  }
}

export function printTable(rows: Array<Record<string, unknown>>): void {
  if (rows.length === 0) {
    console.log('No results.');
    return;
  }

  const indexedRows: Array<Record<string, unknown>> = rows.map((row, index) => ({
    '(index)': index,
    ...row,
  }));

  const columns: string[] = [];
  for (const row of indexedRows) {
    for (const key of Object.keys(row)) {
      if (!columns.includes(key)) {
        columns.push(key);
      }
    }
  }

  const matrix = indexedRows.map((row) => columns.map((column) => toDisplayValue(row[column])));
  const widths = columns.map((column, columnIndex) =>
    Math.max(column.length, ...matrix.map((cells) => cells[columnIndex].length)),
  );

  const top = `┌${widths.map((width) => '─'.repeat(width + 2)).join('┬')}┐`;
  const separator = `├${widths.map((width) => '─'.repeat(width + 2)).join('┼')}┤`;
  const bottom = `└${widths.map((width) => '─'.repeat(width + 2)).join('┴')}┘`;

  const header = `│ ${columns
    .map((column, index) => colorize('1;36', padRight(column, widths[index])))
    .join(' │ ')} │`;
  const lines = matrix.map(
    (cells) =>
      `│ ${cells
        .map((cell, index) => {
          const padded = padRight(cell, widths[index]);
          return styleCell(columns[index], cell, padded);
        })
        .join(' │ ')} │`,
  );

  console.log([top, header, separator, ...lines, bottom].join('\n'));
}

function toInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function toStringValue(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function parseIntegerFlagValue(raw: string | undefined, flag: string): number {
  if (!raw || isFlag(raw)) {
    throw new Error(`Missing value for ${flag}.`);
  }

  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) {
    throw new Error(`Expected an integer for ${flag}, got "${raw}".`);
  }
  return value;
}

export function getTaskDefinitionId(task: TaskSummary): number | undefined {
  return (
    toInteger(task.definition?.id) ??
    toInteger(task.taskDefinitionId) ??
    toInteger(task.task_definition_id) ??
    toInteger(task.id)
  );
}

export function getTaskAbbreviation(task: TaskSummary): string | undefined {
  return (
    toStringValue(task.definition?.abbreviation) ??
    toStringValue(task.abbreviation) ??
    toStringValue(task.abbr)
  );
}

export function getTaskName(task: TaskSummary): string | undefined {
  return toStringValue(task.definition?.name) ?? toStringValue(task.name);
}

export function getTaskDueDate(task: TaskSummary): string | undefined {
  return toStringValue(task.dueDate) ?? toStringValue(task.due_date);
}

export function getTaskCompletionDate(task: TaskSummary): string | undefined {
  return toStringValue(task.completionDate) ?? toStringValue(task.completion_date);
}

export function getTaskStatus(task: TaskSummary): string | undefined {
  return toStringValue(task.status);
}

function isSameTask(left: TaskSummary, right: TaskSummary): boolean {
  const leftTaskId = toInteger(left.id);
  const rightTaskId = toInteger(right.id);
  if (leftTaskId !== undefined && rightTaskId !== undefined && leftTaskId === rightTaskId) {
    return true;
  }

  const leftDefId = getTaskDefinitionId(left);
  const rightDefId = getTaskDefinitionId(right);
  return leftDefId !== undefined && rightDefId !== undefined && leftDefId === rightDefId;
}

function findTaskById(tasks: TaskSummary[], taskId: number): TaskSummary | undefined {
  return tasks.find((task) => {
    const rawId = toInteger(task.id);
    const taskDefId = getTaskDefinitionId(task);
    return rawId === taskId || taskDefId === taskId;
  });
}

function findTaskByAbbr(tasks: TaskSummary[], abbr: string): TaskSummary | undefined {
  const normalized = abbr.toLowerCase();
  const matches = tasks.filter((task) => (getTaskAbbreviation(task) || '').toLowerCase() === normalized);

  if (matches.length > 1) {
    throw new Error(`Task abbreviation "${abbr}" is ambiguous in this project.`);
  }

  return matches[0];
}

export interface ResolvedTaskSelector {
  selector: TaskSelector;
  project: ProjectSummary;
  task: TaskSummary;
  taskDefId: number;
  taskId: number;
  abbr: string;
  unitId?: number;
  unitCode?: string;
}

export function parseTaskSelectorArgs(args: string[]): TaskSelector {
  const projectId = parseIntegerFlagValue(getFlagValue(args, '--project-id'), '--project-id');
  const taskIdRaw = getFlagValue(args, '--task-id');
  const abbr = toStringValue(getFlagValue(args, '--abbr'));
  const taskId = taskIdRaw ? parseIntegerFlagValue(taskIdRaw, '--task-id') : undefined;

  if (taskId === undefined && !abbr) {
    throw new Error('Task-level commands require either --task-id <id> or --abbr <abbr>.');
  }

  return { projectId, taskId, abbr };
}

export function resolveTaskSelector(
  projects: ProjectSummary[],
  selector: TaskSelector,
): ResolvedTaskSelector {
  const project = projects.find((item) => toInteger(item.id) === selector.projectId);
  if (!project) {
    throw new Error(`Project ${selector.projectId} not found.`);
  }

  const tasks = project.tasks || [];
  if (tasks.length === 0) {
    throw new Error(`Project ${selector.projectId} has no tasks.`);
  }

  const byTaskId =
    selector.taskId !== undefined ? findTaskById(tasks, selector.taskId) : undefined;
  if (selector.taskId !== undefined && !byTaskId) {
    throw new Error(`Task id ${selector.taskId} was not found in project ${selector.projectId}.`);
  }

  const byAbbr = selector.abbr ? findTaskByAbbr(tasks, selector.abbr) : undefined;
  if (selector.abbr && !byAbbr) {
    throw new Error(`Task abbreviation "${selector.abbr}" was not found in project ${selector.projectId}.`);
  }

  if (byTaskId && byAbbr && !isSameTask(byTaskId, byAbbr)) {
    throw new Error('--task-id and --abbr refer to different tasks. Please provide matching values.');
  }

  const task = byTaskId || byAbbr;
  if (!task) {
    throw new Error(`Unable to resolve task for project ${selector.projectId}.`);
  }

  const taskDefId = getTaskDefinitionId(task);
  if (taskDefId === undefined) {
    throw new Error('Resolved task does not contain a task definition id.');
  }

  const taskId = toInteger(task.id);
  if (taskId === undefined) {
    throw new Error('Resolved task does not contain a task id.');
  }

  return {
    selector,
    project,
    task,
    taskDefId,
    taskId,
    abbr: getTaskAbbreviation(task) || selector.abbr || String(taskDefId),
    unitId: toInteger(project.unit?.id),
    unitCode: toStringValue(project.unit?.code),
  };
}

export function filterTasksByStatus<T extends { status?: unknown }>(
  tasks: T[],
  status?: string,
): T[] {
  if (!status) {
    return tasks;
  }

  const normalized = status.toLowerCase().trim();
  return tasks.filter((task) => String(task.status || '').toLowerCase() === normalized);
}

export function isStaffLikeRole(role?: string): boolean {
  const normalized = role?.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return ['tutor', 'convenor', 'admin', 'auditor'].includes(normalized);
}

export const DEFAULT_DOWNLOAD_DIR = './downloads';

export function sanitizeFilenamePart(value: string | undefined, fallback: string): string {
  const cleaned = (value || '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

export function buildPdfFilename(
  unitCode: string | undefined,
  abbr: string | undefined,
  type: 'task' | 'submission',
): string {
  const safeUnit = sanitizeFilenamePart(unitCode, 'unit');
  const safeTask = sanitizeFilenamePart(abbr, 'task');
  return `${safeUnit}_${safeTask}_${type}.pdf`;
}

export function resolveDownloadDir(outDir?: string, cwd: string = process.cwd()): string {
  const target = outDir?.trim() ? outDir : DEFAULT_DOWNLOAD_DIR;
  return resolve(cwd, target);
}

export async function writePdfFile(
  buffer: Buffer,
  filename: string,
  outDir?: string,
  cwd: string = process.cwd(),
): Promise<string> {
  const dir = resolveDownloadDir(outDir, cwd);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, filename);
  await writeFile(filePath, buffer);
  return filePath;
}

export function getFeedbackTimestamp(feedback: FeedbackItem): string | undefined {
  return toStringValue(feedback.createdAt) ?? toStringValue(feedback.created_at);
}

export function getFeedbackText(feedback: FeedbackItem): string {
  return (
    toStringValue(feedback.comment) ??
    toStringValue(feedback.text) ??
    ''
  );
}

function feedbackIdValue(feedback: FeedbackItem): number | undefined {
  const rawId = feedback.id as unknown;

  if (typeof rawId === 'number' && Number.isFinite(rawId)) {
    return rawId;
  }

  if (typeof rawId === 'string' && rawId.trim()) {
    const parsed = Number.parseInt(rawId, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

export function feedbackIdentity(feedback: FeedbackItem): string {
  const id = feedbackIdValue(feedback);
  if (id !== undefined) {
    return `id:${id}`;
  }

  const timestamp = getFeedbackTimestamp(feedback) || '-';
  const text = getFeedbackText(feedback) || '-';
  return `${timestamp}:${text}`;
}

export function sortFeedbackItems(feedback: FeedbackItem[]): FeedbackItem[] {
  return [...feedback].sort((left, right) => {
    const leftTimestamp = getFeedbackTimestamp(left);
    const rightTimestamp = getFeedbackTimestamp(right);
    const leftMs = leftTimestamp ? Date.parse(leftTimestamp) : Number.NaN;
    const rightMs = rightTimestamp ? Date.parse(rightTimestamp) : Number.NaN;

    if (Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs !== rightMs) {
      return leftMs - rightMs;
    }

    if (leftTimestamp && rightTimestamp && leftTimestamp !== rightTimestamp) {
      return leftTimestamp.localeCompare(rightTimestamp);
    }

    const leftId = feedbackIdValue(left);
    const rightId = feedbackIdValue(right);
    if (leftId !== undefined && rightId !== undefined && leftId !== rightId) {
      return leftId - rightId;
    }

    return feedbackIdentity(left).localeCompare(feedbackIdentity(right));
  });
}

export function getLatestFeedbackTimestamp(feedback: FeedbackItem[]): string | undefined {
  let latestMs = -1;
  let latestRaw: string | undefined;

  for (const item of feedback) {
    const raw = getFeedbackTimestamp(item);
    if (!raw) {
      continue;
    }

    const ms = Date.parse(raw);
    if (Number.isNaN(ms)) {
      if (!latestRaw) {
        latestRaw = raw;
      }
      continue;
    }

    if (ms > latestMs) {
      latestMs = ms;
      latestRaw = new Date(ms).toISOString();
    }
  }

  return latestRaw;
}

export interface WatchTaskState {
  taskKey: string;
  projectId: number;
  taskId: number;
  unitCode?: string;
  abbr?: string;
  status?: string;
  dueDate?: string;
  commentCount: number;
  lastCommentAt?: string;
}

export function makeWatchTaskKey(projectId: number, taskId: number): string {
  return `${projectId}:${taskId}`;
}

export function toWatchStateMap(states: WatchTaskState[]): Map<string, WatchTaskState> {
  return new Map(states.map((state) => [state.taskKey, state]));
}

export function diffWatchStates(
  previous: Map<string, WatchTaskState>,
  current: Map<string, WatchTaskState>,
  at: string = new Date().toISOString(),
): WatchEvent[] {
  const events: WatchEvent[] = [];

  for (const [taskKey, next] of current.entries()) {
    const prev = previous.get(taskKey);
    if (!prev) {
      continue;
    }

    if ((prev.status || '') !== (next.status || '')) {
      events.push({
        type: 'status_changed',
        taskKey,
        projectId: next.projectId,
        taskId: next.taskId,
        unitCode: next.unitCode,
        abbr: next.abbr,
        previous: prev.status || null,
        current: next.status || null,
        at,
      });
    }

    if ((prev.dueDate || '') !== (next.dueDate || '')) {
      events.push({
        type: 'due_changed',
        taskKey,
        projectId: next.projectId,
        taskId: next.taskId,
        unitCode: next.unitCode,
        abbr: next.abbr,
        previous: prev.dueDate || null,
        current: next.dueDate || null,
        at,
      });
    }

    const commentDelta = next.commentCount - prev.commentCount;
    const timestampChanged =
      (next.lastCommentAt || '') !== (prev.lastCommentAt || '') && Boolean(next.lastCommentAt);
    if (commentDelta > 0 || timestampChanged) {
      events.push({
        type: 'new_feedback',
        taskKey,
        projectId: next.projectId,
        taskId: next.taskId,
        unitCode: next.unitCode,
        abbr: next.abbr,
        previous: prev.lastCommentAt || null,
        current: next.lastCommentAt || null,
        deltaComments: commentDelta > 0 ? commentDelta : undefined,
        at,
      });
    }
  }

  return events;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

export interface UploadFileSpec {
  key?: string;
  path: string;
}

export function parseUploadFileSpecs(args: string[], flag: string = '--file'): UploadFileSpec[] {
  const values = getFlagValues(args, flag);
  if (values.length === 0) {
    throw new Error(`Provide at least one ${flag} <path>.`);
  }

  return values.map((value) => {
    const equalIndex = value.indexOf('=');
    if (equalIndex > 0) {
      const maybeKey = value.slice(0, equalIndex).trim();
      const path = value.slice(equalIndex + 1).trim();
      if (/^file\d+$/.test(maybeKey) && path) {
        return {
          key: maybeKey,
          path,
        };
      }
    }

    return {
      path: value.trim(),
    };
  });
}
