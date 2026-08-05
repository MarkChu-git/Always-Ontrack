import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import type {
  FeedbackItem,
  ProjectSummary,
  TaskBatchSelector,
  TaskSelector,
  TaskSummary,
  WatchEvent,
} from './types.js';
import { getAgentOutputContext, wrapAgentOutput } from './agent-protocol.js';
import { buildStudentTaskRows } from './student-task-view.js';
import type { StudentTaskRow } from './student-task-view.js';
import { writeArtifactFile } from './artifact-safety.js';

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
  if (url.username || url.password) {
    throw new Error('OnTrack base URL must not include embedded credentials.');
  }
  const localHttp =
    url.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !localHttp) {
    throw new Error(
      'OnTrack base URL must use HTTPS (HTTP is allowed only for loopback development).',
    );
  }

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
export interface ExternalOpenCommand {
  readonly command: string;
  readonly args: readonly string[];
}

function validateExternalUrl(rawUrl: string): string {
  const candidate = rawUrl.trim();
  if (
    /[\u0000-\u001f\u007f]/u.test(candidate) ||
    /%(?:0[0-9a-f]|1[0-9a-f]|7f)/iu.test(candidate)
  ) {
    throw new Error('External URL must not contain control characters.');
  }

  const parsed = new URL(candidate);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('External URL must use HTTP(S).');
  }
  if (parsed.username || parsed.password) {
    throw new Error('External URL must not include embedded credentials.');
  }
  return parsed.toString();
}

const UNSAFE_TERMINAL_TEXT = /[\p{Cc}\p{Cf}\p{Cs}]/u;

/** Render bounded server-provided labels without terminal control characters. */
export function safeTextForHumanDisplay(
  rawText: unknown,
  fallback: string,
): string {
  const candidate = typeof rawText === 'string' ? rawText.trim() : '';
  if (!candidate || UNSAFE_TERMINAL_TEXT.test(candidate)) {
    return fallback;
  }
  return candidate.length <= 80
    ? candidate
    : `${candidate.slice(0, 77)}...`;
}

/** Render a validated URL without query or fragment data in human-facing output. */
export function safeUrlForHumanDisplay(rawUrl: unknown): string {
  if (typeof rawUrl !== 'string') {
    return '(unavailable)';
  }
  const parsed = new URL(validateExternalUrl(rawUrl));
  const displayUrl = `${parsed.origin}${parsed.pathname}`;
  return displayUrl.length <= 256
    ? displayUrl
    : `${displayUrl.slice(0, 253)}...`;
}

/** Preserve a functional SSO URL only after it passes external-URL validation. */
export function safeUrlForManualDisplay(rawUrl: unknown): string | null {
  if (typeof rawUrl !== 'string') {
    return null;
  }
  if (rawUrl.trim().length > 4096) {
    return null;
  }
  try {
    const safeUrl = validateExternalUrl(rawUrl);
    return safeUrl.length <= 4096 ? safeUrl : null;
  } catch {
    return null;
  }
}

/** Resolve a safe, shell-free platform opener command for a URL. */
export function resolveExternalOpenCommand(
  url: string,
  platform: NodeJS.Platform = process.platform,
): ExternalOpenCommand {
  const safeUrl = validateExternalUrl(url);
  if (platform === 'darwin') {
    return { command: 'open', args: [safeUrl] };
  }
  if (platform === 'win32') {
    return {
      command: 'rundll32.exe',
      args: ['url.dll,FileProtocolHandler', safeUrl],
    };
  }
  return { command: 'xdg-open', args: [safeUrl] };
}

export function openExternal(url: string): boolean {
  let opener: ExternalOpenCommand;
  try {
    opener = resolveExternalOpenCommand(url);
  } catch {
    return false;
  }

  try {
    const child = spawn(opener.command, [...opener.args], {
      detached: true,
      stdio: 'ignore',
      shell: false,
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
  const context = getAgentOutputContext();
  output.write(
    `${JSON.stringify(wrapAgentOutput(value), null, context?.streaming ? undefined : 2)}\n`,
  );
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
  'auth-token',
  'auth_token',
  'authorization',
  'password',
  'passcode',
  'sessiontoken',
  'code',
  'state',
  'id_token',
  'access_token',
  'api_key',
  'apikey',
  'email',
  'username',
  'phone',
  'mobile',
  'cookie',
  'secret',
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
const SENSITIVE_FIELD_NAME =
  'auth[-_]?token|password|passcode|session[-_]?token|id[-_]?token|access[-_]?token|api[-_]?key|cookie|secret|email|username|phone|mobile|address|code|state';
const QUOTED_SENSITIVE_FIELD_PATTERN = new RegExp(
  `("(?:${SENSITIVE_FIELD_NAME})"\\s*:\\s*)"(?:\\\\.|[^"\\\\])*"`,
  'gi',
);
const UNQUOTED_SENSITIVE_FIELD_PATTERN = new RegExp(
  `\\b((?:${SENSITIVE_FIELD_NAME})\\b\\s*[:=]\\s*)(?!\\[REDACTED\\])([^\\s,;}&\\]]+)`,
  'gi',
);
const AUTHORIZATION_PATTERN =
  /\b(authorization\s*:\s*)(?:bearer|basic)\s+[^\s,;]+/gi;
const EMAIL_PATTERN = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi;
const PHONE_PATTERN = /\+?\d(?:[\s().-]*\d){9,}/g;
const PRIVATE_KEY_BLOCK_PATTERN =
  /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----[\s\S]*?(?:-----END(?: [A-Z0-9]+)* PRIVATE KEY-----|$)/gi;

/**
 * Redact token/password fields from free-form error strings.
 * Used before printing any external error to terminal.
 */
export function redactSensitiveText(value: string): string {
  let output = value;
  output = output.replace(URL_PATTERN, (match) => redactQueryParams(match));
  output = output.replace(PRIVATE_KEY_BLOCK_PATTERN, '[REDACTED]');
  output = output.replace(AUTHORIZATION_PATTERN, '$1[REDACTED]');
  output = output.replace(QUOTED_SENSITIVE_FIELD_PATTERN, '$1"[REDACTED]"');
  output = output.replace(UNQUOTED_SENSITIVE_FIELD_PATTERN, '$1[REDACTED]');
  output = output.replace(EMAIL_PATTERN, '[REDACTED]');
  output = output.replace(PHONE_PATTERN, '[REDACTED]');
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
type TaskLike = Partial<TaskSummary>;

export function getTaskDefinitionId(task: TaskLike): number | undefined {
  return (
    toInteger(task.definition?.id) ??
    toInteger(task.taskDefinitionId) ??
    toInteger(task.task_definition_id)
  );
}

/** Resolve task abbreviation across both normalized and raw payload forms. */
export function getTaskAbbreviation(task: TaskLike): string | undefined {
  return (
    toStringValue(task.definition?.abbreviation) ??
    toStringValue(task.abbreviation) ??
    toStringValue(task.abbr)
  );
}

/** Resolve human-readable task name with fallback between definition/name fields. */
export function getTaskName(task: TaskLike): string | undefined {
  return toStringValue(task.definition?.name) ?? toStringValue(task.name);
}

/** Resolve due date string from mixed camelCase/snake_case payloads. */
export function getTaskDueDate(task: TaskLike): string | undefined {
  return toStringValue(task.dueDate) ?? toStringValue(task.due_date);
}

/** Resolve completion date string from mixed payload variants. */
export function getTaskCompletionDate(task: TaskLike): string | undefined {
  return toStringValue(task.completionDate) ?? toStringValue(task.completion_date);
}

/** Resolve canonical task status text. */
export function getTaskStatus(task: TaskLike): string | undefined {
  return toStringValue(task.status);
}

/** Compare tasks only by explicit task-definition identity. */
function isSameTask(left: TaskLike, right: TaskLike): boolean {
  const leftDefId = getTaskDefinitionId(left);
  const rightDefId = getTaskDefinitionId(right);
  return leftDefId !== undefined && rightDefId !== undefined && leftDefId === rightDefId;
}

/** Locate a task by explicit task-definition id. */
function findTaskByDefinitionId(
  tasks: StudentTaskRow[],
  taskDefinitionId: number,
): StudentTaskRow | undefined {
  return tasks.find((task) => getTaskDefinitionId(task) === taskDefinitionId);
}

/**
 * Resolve the deprecated --task-id compatibility selector without allowing
 * definition and instance identities to silently select different tasks.
 */
function findTaskByLegacyId(
  tasks: StudentTaskRow[],
  legacyTaskId: number,
): StudentTaskRow | undefined {
  const matches = tasks.filter(
    (task) =>
      getTaskDefinitionId(task) === legacyTaskId ||
      task.taskInstanceId === legacyTaskId,
  );
  const byDefinition = new Map(
    matches.map((task) => [getTaskDefinitionId(task), task]),
  );
  if (byDefinition.size > 1) {
    throw new Error(
      `Legacy task id ${legacyTaskId} is ambiguous between task definition and instance identities. Use --task-definition-id.`,
    );
  }
  return matches[0];
}

/** Locate a task by abbreviation and guard against ambiguous duplicates. */
function findTaskByAbbr(tasks: StudentTaskRow[], abbr: string): StudentTaskRow | undefined {
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
  task: StudentTaskRow;
  taskDefId: number;
  taskInstanceId?: number;
  abbr: string;
  unitId?: number;
  unitCode?: string;
}

/** Parse one or more values from repeated/comma-separated task selector flags. */
function parseSelectorValues(
  args: string[],
  flag: '--task-definition-id' | '--task-id' | '--abbr',
): string[] {
  const rawValues = getFlagValues(args, flag);
  const values: string[] = [];
  for (const raw of rawValues) {
    const split = raw
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    values.push(...split);
  }
  return values;
}

/**
 * Parse batch task selector arguments.
 *
 * Supported forms:
 * - repeated: `--abbr P1 --abbr D4`
 * - comma list: `--abbr P1,D4`
 * - mixed with ids: `--task-id 501 --abbr P1`
 * - all tasks: `--all-tasks`
 */
export function parseTaskBatchSelectorArgs(args: string[]): TaskBatchSelector {
  const projectId = parseIntegerFlagValue(getFlagValue(args, '--project-id'), '--project-id');
  const allTasks = hasFlag(args, '--all-tasks');
  const taskDefinitionIdTokens = parseSelectorValues(args, '--task-definition-id');
  const taskIdTokens = parseSelectorValues(args, '--task-id');
  const abbrTokens = parseSelectorValues(args, '--abbr');

  if (taskIdTokens.length > 0) {
    console.error(
      '[deprecated] --task-id is deprecated because it mixes task definition and instance identity. Use --task-definition-id.',
    );
  }

  if (
    allTasks &&
    (taskDefinitionIdTokens.length > 0 || taskIdTokens.length > 0 || abbrTokens.length > 0)
  ) {
    throw new Error(
      'Do not combine --all-tasks with --task-definition-id/--task-id/--abbr selectors.',
    );
  }

  const taskDefinitionIds = [
    ...new Set(
      taskDefinitionIdTokens.map((raw) =>
        parseIntegerFlagValue(raw, '--task-definition-id'),
      ),
    ),
  ];
  const taskIds = [...new Set(taskIdTokens.map((raw) => parseIntegerFlagValue(raw, '--task-id')))];
  const abbrs = [...new Set(abbrTokens.map((abbr) => abbr.trim()).filter((abbr) => abbr.length > 0))];

  if (
    !allTasks &&
    taskDefinitionIds.length === 0 &&
    taskIds.length === 0 &&
    abbrs.length === 0
  ) {
    throw new Error(
      'Task-level commands require --all-tasks, or at least one --task-definition-id <id> / --task-id <legacy-id> / --abbr <abbr> selector.',
    );
  }

  return {
    projectId,
    taskDefinitionIds,
    taskIds,
    abbrs,
    allTasks,
  };
}

/** Parse strict single-task selector (`--task-id` or `--abbr`) for mutating commands. */
export function parseTaskSelectorArgs(args: string[]): TaskSelector {
  const parsed = parseTaskBatchSelectorArgs(args);
  if (
    parsed.allTasks ||
    parsed.taskDefinitionIds.length + parsed.taskIds.length > 1 ||
    parsed.abbrs.length > 1
  ) {
    throw new Error(
      'This command expects a single task selector set. Use one --task-definition-id, one legacy --task-id, one --abbr, or one id plus a matching abbreviation.',
    );
  }

  return {
    projectId: parsed.projectId,
    taskDefinitionId: parsed.taskDefinitionIds[0],
    taskId: parsed.taskIds[0],
    abbr: parsed.abbrs[0],
  };
}

/** Build normalized resolved selector payload from project + concrete task match. */
function toResolvedTaskSelector(
  project: ProjectSummary,
  task: StudentTaskRow,
  selector: TaskSelector,
): ResolvedTaskSelector {
  const taskDefId = getTaskDefinitionId(task);
  if (taskDefId === undefined) {
    throw new Error('Resolved task does not contain a task definition id.');
  }

  const taskInstanceId = toInteger(task.taskInstanceId) ?? toInteger(task.id);

  return {
    selector,
    project,
    task,
    taskDefId,
    taskInstanceId:
      task.isInstantiated === false ? undefined : taskInstanceId,
    abbr: getTaskAbbreviation(task) || selector.abbr || String(taskDefId),
    unitId: toInteger(project.unit?.id),
    unitCode: toStringValue(project.unit?.code),
  };
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

  const tasks = buildStudentTaskRows([project], {
    includeBeyondTarget: true,
    includeTutorialMismatches: true,
    includeUnknown: true,
  });
  if (tasks.length === 0) {
    throw new Error(`Project ${selector.projectId} has no tasks.`);
  }

  const byTaskDefinitionId =
    selector.taskDefinitionId !== undefined
      ? findTaskByDefinitionId(tasks, selector.taskDefinitionId)
      : undefined;
  if (selector.taskDefinitionId !== undefined && !byTaskDefinitionId) {
    throw new Error(
      `Task definition id ${selector.taskDefinitionId} was not found in project ${selector.projectId}.`,
    );
  }

  const byTaskId =
    selector.taskId !== undefined ? findTaskByLegacyId(tasks, selector.taskId) : undefined;
  if (selector.taskId !== undefined && !byTaskId) {
    throw new Error(
      `Legacy task id ${selector.taskId} was not found in project ${selector.projectId}.`,
    );
  }

  const byAbbr = selector.abbr ? findTaskByAbbr(tasks, selector.abbr) : undefined;
  if (selector.abbr && !byAbbr) {
    throw new Error(`Task abbreviation "${selector.abbr}" was not found in project ${selector.projectId}.`);
  }

  const idMatch = byTaskDefinitionId ?? byTaskId;
  if (idMatch && byAbbr && !isSameTask(idMatch, byAbbr)) {
    throw new Error(
      `${byTaskDefinitionId ? '--task-definition-id' : '--task-id'} and --abbr refer to different tasks. Please provide matching values.`,
    );
  }

  const task = idMatch ?? byAbbr;
  if (!task) {
    throw new Error(`Unable to resolve task for project ${selector.projectId}.`);
  }

  return toResolvedTaskSelector(project, task, selector);
}

/** Resolve batch selector to a deduplicated list of concrete project tasks. */
export function resolveTaskBatchSelector(
  projects: ProjectSummary[],
  selector: TaskBatchSelector,
): ResolvedTaskSelector[] {
  const project = projects.find((item) => toInteger(item.id) === selector.projectId);
  if (!project) {
    throw new Error(`Project ${selector.projectId} not found.`);
  }

  const tasks = buildStudentTaskRows([project], {
    includeBeyondTarget: true,
    includeTutorialMismatches: true,
    includeUnknown: true,
  });
  if (tasks.length === 0) {
    throw new Error(`Project ${selector.projectId} has no tasks.`);
  }

  const resolved: ResolvedTaskSelector[] = [];
  const seen = new Set<string>();
  const pushResolved = (task: StudentTaskRow, taskSelector: TaskSelector): void => {
    const item = toResolvedTaskSelector(project, task, taskSelector);
    const key = String(item.taskDefId);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    resolved.push(item);
  };

  if (selector.allTasks) {
    for (const task of tasks) {
      pushResolved(task, {
        projectId: selector.projectId,
        taskDefinitionId: getTaskDefinitionId(task),
      });
    }
    return resolved;
  }

  for (const taskDefinitionId of selector.taskDefinitionIds ?? []) {
    const matched = findTaskByDefinitionId(tasks, taskDefinitionId);
    if (!matched) {
      throw new Error(
        `Task definition id ${taskDefinitionId} was not found in project ${selector.projectId}.`,
      );
    }
    pushResolved(matched, { projectId: selector.projectId, taskDefinitionId });
  }

  for (const taskId of selector.taskIds) {
    const matched = findTaskByLegacyId(tasks, taskId);
    if (!matched) {
      throw new Error(`Legacy task id ${taskId} was not found in project ${selector.projectId}.`);
    }
    pushResolved(matched, { projectId: selector.projectId, taskId });
  }

  for (const abbr of selector.abbrs) {
    const matched = findTaskByAbbr(tasks, abbr);
    if (!matched) {
      throw new Error(`Task abbreviation "${abbr}" was not found in project ${selector.projectId}.`);
    }
    pushResolved(matched, { projectId: selector.projectId, abbr });
  }

  if (resolved.length === 0) {
    throw new Error(`Unable to resolve tasks for project ${selector.projectId}.`);
  }

  return resolved;
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

/** Check a cumulative byte budget without overflowing an intermediate sum. */
export function exceedsByteBudget(
  usedBytes: number,
  nextBytes: number,
  maxBytes: number,
): boolean {
  return nextBytes > maxBytes - usedBytes;
}

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

/** Build the stable task-resource archive name used by the OnTrack student UI. */
export function buildTaskResourceFilename(
  unitCode: string | undefined,
  abbr: string | undefined,
): string {
  const safeUnit = sanitizeFilenamePart(unitCode, 'unit').slice(0, 80);
  const safeTask = sanitizeFilenamePart(abbr, 'task').slice(0, 80);
  return `${safeUnit}-${safeTask}-TaskResources.zip`;
}

/** Resolve download directory from user override or default location. */
export function resolveDownloadDir(outDir?: string, cwd: string = process.cwd()): string {
  const target = outDir?.trim() ? outDir : DEFAULT_DOWNLOAD_DIR;
  return resolve(cwd, target);
}

/** Ensure output directory exists, then persist binary PDF bytes to disk. */
export interface PdfWriteOptions {
  readonly allowExternalDir?: boolean;
  readonly maxBytes?: number;
}

export async function writePdfFile(
  buffer: Buffer,
  filename: string,
  outDir?: string,
  cwd: string = process.cwd(),
  options: PdfWriteOptions = {},
): Promise<string> {
  return writeArtifactFile(buffer, filename, {
    root: cwd,
    outDir,
    allowExternal: options.allowExternalDir,
    maxBytes: options.maxBytes,
  });
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
  taskDefinitionId: number;
  unitCode?: string;
  abbr?: string;
  status?: string;
  dueDate?: string;
  commentCount: number;
  lastCommentAt?: string;
}

/** Build stable map key for watch state by project + task-definition identity. */
export function makeWatchTaskKey(projectId: number, taskDefinitionId: number): string {
  return `${projectId}:${taskDefinitionId}`;
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
        taskDefinitionId: next.taskDefinitionId,
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
        taskDefinitionId: next.taskDefinitionId,
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
        taskDefinitionId: next.taskDefinitionId,
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
