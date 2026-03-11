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

/**
 * Cross-cutting CLI helpers:
 * - prompt/input utilities
 * - table formatting and highlighting
 * - argument parsing and selector resolution
 * - filename/path helpers
 * - watch-state diffing utilities
 */
const DEFAULT_SITE_URL = 'https://ontrack.infotech.monash.edu';

/**
 * Normalize base URL into canonical API root:
 * - prefer explicit CLI flag
 * - then ONTRACK_BASE_URL env
 * - otherwise production default
 * Always returns a `/api` URL without query/hash.
 */
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

/**
 * Parse final SSO redirect URL and extract mandatory credentials.
 * Throws when redirect URL is incomplete so login flow can fail loudly.
 */
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

/** Prompt for a visible (non-sensitive) input value. */
export async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

/** Input masking is only enabled in interactive TTY terminals. */
export function shouldMaskPromptInput(
  inputStream: Pick<NodeJS.ReadStream, 'isTTY'> = input,
  outputStream: Pick<NodeJS.WriteStream, 'isTTY'> = output,
): boolean {
  return Boolean(inputStream.isTTY && outputStream.isTTY);
}

/**
 * Secure password prompt:
 * - never echoes raw characters
 * - supports backspace editing
 * - exits cleanly on Ctrl+C
 */
export async function promptHidden(question: string): Promise<string> {
  if (!shouldMaskPromptInput()) {
    return prompt(question);
  }

  return new Promise<string>((resolvePromise, reject) => {
    const stdinStream = input;
    if (!stdinStream.isTTY) {
      resolvePromise('');
      return;
    }

    let answer = '';
    output.write(question);
    stdinStream.setRawMode(true);
    stdinStream.resume();
    stdinStream.setEncoding('utf8');

    const cleanup = (): void => {
      stdinStream.removeListener('data', onData);
      stdinStream.setRawMode(false);
      stdinStream.pause();
    };

    const onData = (chunk: string): void => {
      const data = chunk ?? '';
      if (!data) {
        return;
      }

      for (const char of data) {
        if (char === '\u0003') {
          output.write('\n');
          cleanup();
          reject(new Error('Input interrupted.'));
          return;
        }

        if (char === '\r' || char === '\n') {
          output.write('\n');
          cleanup();
          resolvePromise(answer.trim());
          return;
        }

        if (char === '\u007f' || char === '\b') {
          if (answer.length > 0) {
            answer = answer.slice(0, -1);
            output.write('\b \b');
          }
          continue;
        }

        if (char >= ' ' && char !== '\u007f') {
          answer += char;
          output.write('*');
        }
      }
    };

    stdinStream.on('data', onData);
  });
}

/** Open URL in platform-default browser without blocking current process. */
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

/** Lightweight flag detector used by all argument parsing helpers. */
export function isFlag(arg: string): boolean {
  return arg.startsWith('--');
}

/** Return the value immediately following a flag, or undefined if absent. */
export function getFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}

/**
 * Read repeated flag values (`--file a --file b`).
 * Throws for malformed invocations to keep command UX deterministic.
 */
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

/** True when a flag token exists anywhere in argv. */
export function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

/** Render date-like values as YYYY-MM-DD while preserving unknown text. */
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

/** Stable pretty JSON printer for machine-consumable output modes. */
export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

/**
 * Convert any cell value to printable text.
 * This keeps table rendering robust with mixed payload shapes.
 */
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

/** Remove ANSI color escapes for accurate visible-width calculations. */
function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE_PATTERN, '');
}

/** String length as seen by humans in terminal, not byte length. */
function visibleLength(value: string): number {
  return stripAnsi(value).length;
}

/** Decide once whether table color output should be enabled. */
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

/** Apply ANSI color code only when colors are enabled. */
function colorize(code: string, value: string): string {
  if (!COLORS_ENABLED) {
    return value;
  }
  return `\u001B[${code}m${value}\u001B[0m`;
}

/** Right-pad text while respecting ANSI escape sequences. */
function padRight(value: string, width: number): string {
  const length = visibleLength(value);
  if (length >= width) {
    return value;
  }
  return `${value}${' '.repeat(width - length)}`;
}

/** Status-specific coloring to improve scannability in dense task tables. */
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

/** Due-date coloring: overdue red, near-due yellow, otherwise default. */
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

/** Column-aware styling hook used by `printTable`. */
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

/** Render a compact ANSI-aware table with conditional highlighting. */
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

/** Best-effort integer normalization across numeric/string payload values. */
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

/** Trim and validate string payload values, returning undefined for empty. */
function toStringValue(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/** Parse required integer flag value and produce user-facing validation errors. */
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

/**
 * Detect whether current runtime should default to headless mode.
 * This combines explicit env overrides with CI/SSH/display heuristics.
 */
export function isHeadlessServerEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  streams: {
    stdin: Pick<NodeJS.ReadStream, 'isTTY'>;
    stdout: Pick<NodeJS.WriteStream, 'isTTY'>;
  } = {
    stdin: input,
    stdout: output,
  },
): boolean {
  if (env.ONTRACK_HEADLESS === '1' || env.ONTRACK_HEADLESS === 'true') {
    return true;
  }

  if (env.ONTRACK_HEADLESS === '0' || env.ONTRACK_HEADLESS === 'false') {
    return false;
  }

  if (env.CI && env.CI !== 'false') {
    return true;
  }

  if (env.SSH_CONNECTION || env.SSH_TTY) {
    return true;
  }

  if (process.platform === 'linux') {
    const hasDisplay = Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
    if (!hasDisplay) {
      return true;
    }
  }

  return !Boolean(streams.stdin.isTTY && streams.stdout.isTTY);
}

export type LoginMode = 'manual' | 'auto' | 'sso_guided';

/**
 * Login route decision:
 * - explicit mode flags win
 * - direct credentials / redirect URL imply manual mode
 * - otherwise guided SSO is default path
 */
export function resolveLoginMode(options: {
  auto: boolean;
  sso: boolean;
  hasAuthToken: boolean;
  hasUsername: boolean;
  hasRedirectUrl: boolean;
  isHeadless: boolean;
}): LoginMode {
  if (options.auto) {
    return 'auto';
  }
  if (options.sso) {
    return 'sso_guided';
  }

  const hasDirectCredentials = options.hasAuthToken && options.hasUsername;
  if (hasDirectCredentials) {
    return 'manual';
  }

  if (options.hasRedirectUrl) {
    return 'manual';
  }

  return 'sso_guided';
}

export const SENSITIVE_QUERY_KEYS = new Set([
  'authtoken',
  'auth_token',
  'password',
  'passcode',
  'sessiontoken',
  'code',
  'state',
  'id_token',
  'access_token',
]);

/** Redact sensitive query params in a URL while preserving non-sensitive context. */
function redactQueryParams(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    for (const [key] of url.searchParams.entries()) {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
        url.searchParams.set(key, '[REDACTED]');
      }
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

const URL_PATTERN = /https?:\/\/[^\s)"']+/gi;

/**
 * Redact token/password fields from free-form error strings.
 * Used before printing any external error to terminal.
 */
export function redactSensitiveText(value: string): string {
  let output = value;
  output = output.replace(URL_PATTERN, (match) => redactQueryParams(match));
  output = output.replace(
    /\b(authToken|auth_token|password|passcode|sessionToken|id_token|access_token|code|state)=([^&\s]+)/gi,
    '$1=[REDACTED]',
  );
  output = output.replace(
    /("?(?:authToken|auth_token|password|passcode|sessionToken|id_token|access_token|code|state)"?\s*[:=]\s*")([^"]*)(")/gi,
    '$1[REDACTED]$3',
  );
  return output;
}

export interface RedactedError {
  message: string;
}

/** Normalize unknown errors into safe, redacted message payloads. */
export function toRedactedError(error: unknown): RedactedError {
  const message = error instanceof Error ? error.message : String(error);
  return {
    message: redactSensitiveText(message),
  };
}

/** Resolve task definition id across schema variants and fallback fields. */
export function getTaskDefinitionId(task: TaskSummary): number | undefined {
  return (
    toInteger(task.definition?.id) ??
    toInteger(task.taskDefinitionId) ??
    toInteger(task.task_definition_id) ??
    toInteger(task.id)
  );
}

/** Resolve task abbreviation across both normalized and raw payload forms. */
export function getTaskAbbreviation(task: TaskSummary): string | undefined {
  return (
    toStringValue(task.definition?.abbreviation) ??
    toStringValue(task.abbreviation) ??
    toStringValue(task.abbr)
  );
}

/** Resolve human-readable task name with fallback between definition/name fields. */
export function getTaskName(task: TaskSummary): string | undefined {
  return toStringValue(task.definition?.name) ?? toStringValue(task.name);
}

/** Resolve due date string from mixed camelCase/snake_case payloads. */
export function getTaskDueDate(task: TaskSummary): string | undefined {
  return toStringValue(task.dueDate) ?? toStringValue(task.due_date);
}

/** Resolve completion date string from mixed payload variants. */
export function getTaskCompletionDate(task: TaskSummary): string | undefined {
  return toStringValue(task.completionDate) ?? toStringValue(task.completion_date);
}

/** Resolve canonical task status text. */
export function getTaskStatus(task: TaskSummary): string | undefined {
  return toStringValue(task.status);
}

/** Compare two task payloads by task id first, then task-definition id fallback. */
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

/** Locate a task by raw task id or task definition id. */
function findTaskById(tasks: TaskSummary[], taskId: number): TaskSummary | undefined {
  return tasks.find((task) => {
    const rawId = toInteger(task.id);
    const taskDefId = getTaskDefinitionId(task);
    return rawId === taskId || taskDefId === taskId;
  });
}

/** Locate a task by abbreviation and guard against ambiguous duplicates. */
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

/** Parse `--project-id` plus task selector (`--task-id` or `--abbr`). */
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

/** Resolve user-provided task selector to an exact project+task pair. */
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

/** Case-insensitive status filter used by tasks/inbox/unit-task commands. */
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

/** Staff-like roles typically need explicit scoping hints for large datasets. */
export function isStaffLikeRole(role?: string): boolean {
  const normalized = role?.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return ['tutor', 'convenor', 'admin', 'auditor'].includes(normalized);
}

export const DEFAULT_DOWNLOAD_DIR = './downloads';

/** Clean path fragments into filesystem-safe filename segments. */
export function sanitizeFilenamePart(value: string | undefined, fallback: string): string {
  const cleaned = (value || '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

/** Build consistent PDF output filename: `<unit>_<task>_<type>.pdf`. */
export function buildPdfFilename(
  unitCode: string | undefined,
  abbr: string | undefined,
  type: 'task' | 'submission',
): string {
  const safeUnit = sanitizeFilenamePart(unitCode, 'unit');
  const safeTask = sanitizeFilenamePart(abbr, 'task');
  return `${safeUnit}_${safeTask}_${type}.pdf`;
}

/** Resolve download directory from user override or default location. */
export function resolveDownloadDir(outDir?: string, cwd: string = process.cwd()): string {
  const target = outDir?.trim() ? outDir : DEFAULT_DOWNLOAD_DIR;
  return resolve(cwd, target);
}

/** Ensure output directory exists, then persist binary PDF bytes to disk. */
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

/** Resolve feedback timestamp from known API field variants. */
export function getFeedbackTimestamp(feedback: FeedbackItem): string | undefined {
  return toStringValue(feedback.createdAt) ?? toStringValue(feedback.created_at);
}

/** Resolve textual feedback body, preferring comment then text fallback. */
export function getFeedbackText(feedback: FeedbackItem): string {
  return (
    toStringValue(feedback.comment) ??
    toStringValue(feedback.text) ??
    ''
  );
}

/** Best-effort parse of numeric feedback id from mixed API payload shapes. */
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

/** Build stable feedback identity key for dedupe/watch processing. */
export function feedbackIdentity(feedback: FeedbackItem): string {
  const id = feedbackIdValue(feedback);
  if (id !== undefined) {
    return `id:${id}`;
  }

  const timestamp = getFeedbackTimestamp(feedback) || '-';
  const text = getFeedbackText(feedback) || '-';
  return `${timestamp}:${text}`;
}

/** Stable chronological sort for mixed feedback payload quality. */
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

/** Find newest feedback timestamp (ISO when parseable) across a comment list. */
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

/** Build stable map key for watch state by project + task-definition identity. */
export function makeWatchTaskKey(projectId: number, taskId: number): string {
  return `${projectId}:${taskId}`;
}

/** Convert task-state array into key-addressable map for diffing. */
export function toWatchStateMap(states: WatchTaskState[]): Map<string, WatchTaskState> {
  return new Map(states.map((state) => [state.taskKey, state]));
}

/**
 * Compute watch deltas between polling snapshots.
 * Emits events for status changes, due-date changes, and feedback growth.
 */
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

/** Simple promise-based delay helper for polling loops. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

export interface UploadFileSpec {
  key?: string;
  path: string;
}

/**
 * Parse upload file specs from repeated `--file` flags.
 * Supports:
 * - `--file ./report.pdf`
 * - `--file file0=./report.pdf`
 */
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
