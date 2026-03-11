#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { clearSession, loadSession, saveSession } from './lib/session.js';
import { OnTrackApiClient } from './lib/api.js';
import {
  SsoFallbackError,
  classifySsoFallback,
  captureSsoCredentials,
  captureSsoCredentialsWithGuidedLogin,
} from './lib/auto-login.js';
import type { MfaMethodOption } from './lib/auto-login.js';
import { discoverOnTrackSurface, probeDiscoveredApiTemplates } from './lib/discovery.js';
import { getWelcomeMenuItems, parseWelcomeSelection } from './lib/welcome.js';
import {
  buildPdfFilename,
  diffWatchStates,
  filterTasksByStatus,
  feedbackIdentity,
  formatDate,
  getFeedbackText,
  getFeedbackTimestamp,
  getFlagValue,
  getLatestFeedbackTimestamp,
  getTaskAbbreviation,
  getTaskCompletionDate,
  getTaskDefinitionId,
  getTaskDueDate,
  getTaskName,
  getTaskStatus,
  hasFlag,
  isStaffLikeRole,
  makeWatchTaskKey,
  normalizeBaseUrl,
  openExternal,
  parseIntegerFlagValue,
  parseSsoRedirectUrl,
  parseTaskSelectorArgs,
  parseUploadFileSpecs,
  printJson,
  printTable,
  prompt,
  promptHidden,
  resolveTaskSelector,
  resolveLoginMode,
  isHeadlessServerEnvironment,
  sortFeedbackItems,
  toWatchStateMap,
  toRedactedError,
  writePdfFile,
} from './lib/utils.js';
import type {
  FeedbackItem,
  InboxTask,
  ProjectSummary,
  SessionData,
  SubmissionTrigger,
  TaskDefinitionSummary,
  TaskUploadRequirement,
  TaskSummary,
  UnitSummary,
} from './lib/types.js';
import type { WelcomeMenuItem } from './lib/welcome.js';
import type { WatchTaskState } from './lib/utils.js';

type InboxRowTask = InboxTask & { _unitId: number };

function help(): void {
  console.log(`ontrack

Usage:
  ontrack
  ontrack welcome
  ontrack auth-method [--base-url URL] [--json]
  ontrack login [--base-url URL] [--redirect-url URL]
  ontrack login [--base-url URL] --auth-token TOKEN --username USERNAME
  ontrack login [--base-url URL] --auto [--auto-timeout-sec N] [--show-browser|--hide-browser]
  ontrack login [--base-url URL] [--sso] [--sso-username USERNAME] [--sso-timeout-sec N] [--show-browser|--hide-browser]
  ontrack logout
  ontrack whoami [--json]
  ontrack projects [--json]
  ontrack project show --project-id ID [--json]
  ontrack units [--json]
  ontrack unit show --unit-id ID [--json]
  ontrack unit tasks --unit-id ID [--status STATUS] [--json]
  ontrack tasks [--project-id ID] [--status STATUS] [--json]
  ontrack doctor [--json]
  ontrack discover [--site-url URL] [--base-url URL] [--probe] [--limit N] [--json]
  ontrack inbox [--unit-id ID] [--status STATUS] [--json]
  ontrack task show --project-id ID (--task-id ID | --abbr ABBR) [--json]
  ontrack feedback list --project-id ID (--task-id ID | --abbr ABBR) [--json]
  ontrack feedback watch --project-id ID (--task-id ID | --abbr ABBR) [--interval SEC] [--history N] [--json]
  ontrack pdf task --project-id ID (--task-id ID | --abbr ABBR) [--out-dir PATH]
  ontrack pdf submission --project-id ID (--task-id ID | --abbr ABBR) [--out-dir PATH]
  ontrack submission upload --project-id ID (--task-id ID | --abbr ABBR) --file PATH [--file PATH|fileN=PATH ...] [--trigger TRIGGER] [--comment TEXT] [--json]
  ontrack submission upload-new-files --project-id ID (--task-id ID | --abbr ABBR) --file PATH [--file PATH|fileN=PATH ...] [--trigger TRIGGER] [--comment TEXT] [--json]
  ontrack watch [--unit-id ID] [--project-id ID] [--interval SEC] [--json]

Notes:
  - Running "ontrack" with no command opens the interactive launcher in TTY terminals.
  - Default base URL is https://ontrack.infotech.monash.edu/api
  - This site currently reports SAML SSO.
  - "ontrack login" defaults to guided SSO (username/password + Okta Verify) with visible browser.
  - Use "ontrack login --sso" to force guided SSO, or "ontrack login --auto" for browser-only capture mode.
  - Use --hide-browser to force headless mode (recommended on servers without GUI).
  - Manual redirect URL paste is backup-only, used when guided SSO falls back or when --redirect-url is provided.
  - PDF commands save files into ./downloads by default.
  - Upload commands accept repeated --file values. You can also map explicit keys like --file file0=report.pdf.
`);
}

const DIGITAL_LOGO_LINES = [
  ' █████╗ ██╗     ██╗    ██╗ █████╗ ██╗   ██╗███████╗',
  '██╔══██╗██║     ██║    ██║██╔══██╗╚██╗ ██╔╝██╔════╝',
  '███████║██║     ██║ █╗ ██║███████║ ╚████╔╝ ███████╗',
  '██╔══██║██║     ██║███╗██║██╔══██║  ╚██╔╝  ╚════██║',
  '██║  ██║███████╗╚███╔███╔╝██║  ██║   ██║   ███████║',
  '╚═╝  ╚═╝╚══════╝ ╚══╝╚══╝ ╚═╝  ╚═╝   ╚═╝   ╚══════╝',
  ' ██████╗ ███╗   ██╗████████╗██████╗  █████╗  ██████╗██╗  ██╗',
  '██╔═══██╗████╗  ██║╚══██╔══╝██╔══██╗██╔══██╗██╔════╝██║ ██╔╝',
  '██║   ██║██╔██╗ ██║   ██║   ██████╔╝███████║██║     █████╔╝ ',
  '██║   ██║██║╚██╗██║   ██║   ██╔══██╗██╔══██║██║     ██╔═██╗ ',
  '╚██████╔╝██║ ╚████║   ██║   ██║  ██║██║  ██║╚██████╗██║  ██╗',
  ' ╚═════╝ ╚═╝  ╚═══╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝',
];

const LOGO_COLOR_CODES = [
  '38;2;0;25;110',
  '38;2;0;35;130',
  '38;2;0;47;167',
  '38;2;20;63;190',
  '38;2;35;82;212',
  '38;2;55;108;236',
  '38;2;55;108;236',
  '38;2;35;82;212',
  '38;2;20;63;190',
  '38;2;0;47;167',
  '38;2;0;35;130',
  '38;2;0;25;110',
];
const KLEIN_BLUE_TITLE = '1;38;2;55;108;236';
const KLEIN_BLUE_ACCENT = '1;38;2;0;47;167';
const KLEIN_BLUE_SOFT = '38;2;38;95;224';

function launcherColorsEnabled(): boolean {
  if (process.env.NO_COLOR !== undefined) {
    return false;
  }
  const forced = process.env.FORCE_COLOR;
  if (forced && forced !== '0') {
    return true;
  }
  return Boolean(process.stdout.isTTY);
}

function launcherColor(text: string, code: string): string {
  if (!launcherColorsEnabled()) {
    return text;
  }
  return `\u001B[${code}m${text}\u001B[0m`;
}

function formatWelcomeMenuRow(item: WelcomeMenuItem): string[] {
  const id = String(item.id).padStart(2, '0');
  const badge = item.recommended ? ` ${launcherColor('RECOMMENDED', '1;30;46')}` : '';
  const primary = `${launcherColor(`[${id}]`, '1;30;106')} ${launcherColor(item.title, '1')}${badge}`;
  const secondary = `     ${launcherColor(item.command, KLEIN_BLUE_SOFT)}  ${launcherColor(item.summary, '1;37')}`;
  return [primary, secondary];
}

function renderWelcomeScreen(items: WelcomeMenuItem[]): void {
  if (process.stdout.isTTY && process.env.TERM !== 'dumb') {
    console.clear();
  }

  console.log('');
  for (let index = 0; index < DIGITAL_LOGO_LINES.length; index += 1) {
    const color = LOGO_COLOR_CODES[index % LOGO_COLOR_CODES.length];
    console.log(launcherColor(DIGITAL_LOGO_LINES[index], color));
  }
  console.log(launcherColor('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', KLEIN_BLUE_ACCENT));
  console.log(launcherColor('ALWAYS ONTRACK COMMAND DECK', KLEIN_BLUE_TITLE));
  console.log(launcherColor('Type a number to run an action. Type 0 to exit.', KLEIN_BLUE_ACCENT));
  console.log(launcherColor('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', KLEIN_BLUE_ACCENT));
  console.log('');

  for (const item of items) {
    const [primary, secondary] = formatWelcomeMenuRow(item);
    console.log(primary);
    console.log(secondary);
  }
  console.log('');
}

function renderLoginSuccessPanel(session: SessionData): void {
  const fullName = `${session.user.firstName || session.user.first_name || ''} ${
    session.user.lastName || session.user.last_name || ''
  }`.trim();
  const role = resolveUserRole(session) ?? '-';
  const displayName = fullName || session.username;

  if (!process.stdout.isTTY || process.env.TERM === 'dumb') {
    console.log(`Signed in as ${displayName}`);
    console.log(`Role: ${role}`);
    console.log(`Session saved to ${session.baseUrl}`);
    return;
  }

  const width = 70;
  const top = `┏${'━'.repeat(width - 2)}┓`;
  const bottom = `┗${'━'.repeat(width - 2)}┛`;
  const divider = `┣${'━'.repeat(width - 2)}┫`;
  const row = (text: string): string => {
    const plain = text.slice(0, width - 4);
    const padding = ' '.repeat(Math.max(0, width - 4 - plain.length));
    return `┃ ${plain}${padding} ┃`;
  };

  const quickActions = [
    '1) ontrack',
    '2) ontrack inbox',
    '3) ontrack tasks --status ready_for_feedback',
  ];

  console.log('');
  console.log(launcherColor(top, KLEIN_BLUE_ACCENT));
  console.log(launcherColor(row('ALWAYS ONTRACK | LOGIN SUCCESS'), KLEIN_BLUE_TITLE));
  console.log(launcherColor(row('Your session is active and ready.'), KLEIN_BLUE_SOFT));
  console.log(launcherColor(divider, KLEIN_BLUE_ACCENT));
  console.log(row(`Account : ${displayName}`));
  console.log(row(`Username: ${session.username}`));
  console.log(row(`Role    : ${role}`));
  console.log(row(`API     : ${session.baseUrl}`));
  console.log(launcherColor(divider, KLEIN_BLUE_ACCENT));
  console.log(launcherColor(row('Quick start:'), KLEIN_BLUE_SOFT));
  for (const action of quickActions) {
    console.log(launcherColor(row(`  ${action}`), KLEIN_BLUE_SOFT));
  }
  console.log(launcherColor(bottom, KLEIN_BLUE_ACCENT));
  console.log('');
}

function optionalFlagArgs(flag: string, value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }
  return [flag, trimmed];
}

async function promptRequired(label: string): Promise<string> {
  while (true) {
    const value = (await prompt(label)).trim();
    if (value) {
      return value;
    }
    console.log('[warn] This field is required.');
  }
}

async function promptTaskSelectorFlags(): Promise<string[]> {
  const projectId = await promptRequired('Project ID: ');
  const abbr = (await prompt('Task abbreviation (preferred, e.g. P1/D4). Leave empty to use task id: ')).trim();
  if (abbr) {
    return ['--project-id', projectId, '--abbr', abbr];
  }

  const taskId = await promptRequired('Task ID: ');
  return ['--project-id', projectId, '--task-id', taskId];
}

async function runWelcomeAction(actionId: number): Promise<void> {
  switch (actionId) {
    case 1:
      await handleLogin([]);
      return;
    case 2:
      await handleWhoAmI([]);
      return;
    case 3:
      await handleProjects([]);
      return;
    case 4:
      await handleUnits([]);
      return;
    case 5:
      await handleTasks([]);
      return;
    case 6:
      await handleInbox([]);
      return;
    case 7: {
      const selector = await promptTaskSelectorFlags();
      await handleTaskShow(selector);
      return;
    }
    case 8: {
      const selector = await promptTaskSelectorFlags();
      await handleFeedbackList(selector);
      return;
    }
    case 9: {
      const selector = await promptTaskSelectorFlags();
      const intervalSec = await prompt('Polling interval seconds (default 15): ');
      const historyCount = await prompt('History count on startup (default 20): ');
      const args = [
        ...selector,
        ...optionalFlagArgs('--interval', intervalSec),
        ...optionalFlagArgs('--history', historyCount),
      ];
      await handleFeedbackWatch(args);
      return;
    }
    case 10: {
      const unitId = await prompt('Unit ID filter (optional): ');
      const projectId = await prompt('Project ID filter (optional): ');
      const intervalSec = await prompt('Polling interval seconds (default 60): ');
      const args = [
        ...optionalFlagArgs('--unit-id', unitId),
        ...optionalFlagArgs('--project-id', projectId),
        ...optionalFlagArgs('--interval', intervalSec),
      ];
      await handleWatch(args);
      return;
    }
    case 11: {
      const selector = await promptTaskSelectorFlags();
      const outDir = await prompt('Output directory (default ./downloads): ');
      await handlePdfDownload([...selector, ...optionalFlagArgs('--out-dir', outDir)], 'task');
      return;
    }
    case 12: {
      const selector = await promptTaskSelectorFlags();
      const outDir = await prompt('Output directory (default ./downloads): ');
      await handlePdfDownload([...selector, ...optionalFlagArgs('--out-dir', outDir)], 'submission');
      return;
    }
    case 13: {
      const selector = await promptTaskSelectorFlags();
      const filePath = await promptRequired('File path: ');
      const trigger = await prompt('Trigger (need_help/ready_for_feedback, optional): ');
      const comment = await prompt('Comment (optional): ');
      const args = [
        ...selector,
        '--file',
        filePath,
        ...optionalFlagArgs('--trigger', trigger),
        ...optionalFlagArgs('--comment', comment),
      ];
      await handleSubmissionUpload(args, 'upload');
      return;
    }
    case 14: {
      const selector = await promptTaskSelectorFlags();
      const filePath = await promptRequired('File path: ');
      const trigger = await prompt('Trigger (need_help/ready_for_feedback, optional): ');
      const comment = await prompt('Comment (optional): ');
      const args = [
        ...selector,
        '--file',
        filePath,
        ...optionalFlagArgs('--trigger', trigger),
        ...optionalFlagArgs('--comment', comment),
      ];
      await handleSubmissionUpload(args, 'upload-new-files');
      return;
    }
    case 15:
      await handleLogout();
      return;
    case 16:
      help();
      return;
    default:
      throw new Error(`Unknown launcher action id: ${actionId}`);
  }
}

async function handleWelcome(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    help();
    return;
  }

  const items = getWelcomeMenuItems();
  const allowedIds = items.map((item) => item.id);

  while (true) {
    renderWelcomeScreen(items);

    const selectedRaw = await prompt('Select action number (0 to exit): ');
    const selection = parseWelcomeSelection(selectedRaw, allowedIds);
    if (selection === 0) {
      console.log('Exiting Always Ontrack launcher.');
      return;
    }

    if (selection === null) {
      console.log('[warn] Invalid selection. Enter a valid menu number.');
      await prompt('Press Enter to continue...');
      continue;
    }

    try {
      await runWelcomeAction(selection);
    } catch (error) {
      const redacted = toRedactedError(error);
      console.error(`Error: ${redacted.message}`);
    }

    const next = await prompt('Press Enter to return to launcher, or type q to quit: ');
    if (/^(q|quit|exit)$/i.test(next.trim())) {
      console.log('Exiting Always Ontrack launcher.');
      return;
    }
  }
}

function requireSession(session: SessionData | null): SessionData {
  if (!session) {
    throw new Error('No saved session found. Run `ontrack login` first.');
  }
  return session;
}

function flattenTasks(projects: ProjectSummary[]): Array<
  TaskSummary & {
    projectId: number;
    unitId?: number;
    unitCode?: string;
    unitName?: string;
  }
> {
  return projects.flatMap((project) =>
    (project.tasks || []).map((task) => ({
      ...task,
      projectId: project.id,
      unitId: project.unit?.id,
      unitCode: project.unit?.code,
      unitName: project.unit?.name,
    })),
  );
}

function parseOptionalInteger(args: string[], flag: string): number | undefined {
  if (!hasFlag(args, flag)) {
    return undefined;
  }

  return parseIntegerFlagValue(getFlagValue(args, flag), flag);
}

function parseOptionalString(args: string[], flag: string): string | undefined {
  if (!hasFlag(args, flag)) {
    return undefined;
  }

  const raw = getFlagValue(args, flag);
  if (!raw || raw.startsWith('--')) {
    throw new Error(`Missing value for ${flag}.`);
  }

  const value = raw.trim();
  if (!value) {
    throw new Error(`Missing value for ${flag}.`);
  }

  return value;
}

function extractInboxProjectId(task: InboxTask): number | undefined {
  if (typeof task.projectId === 'number') {
    return task.projectId;
  }

  if (typeof task.project_id === 'number') {
    return task.project_id;
  }

  return undefined;
}

function roleScopeHint(session: SessionData, command: string, hasScopeFilter: boolean): void {
  if (!isStaffLikeRole(resolveUserRole(session)) || hasScopeFilter) {
    return;
  }

  console.log(
    `[hint] Role "${resolveUserRole(session)}" running ${command} without scope filters can be expensive. Consider --unit-id and/or --project-id.`,
  );
}

function resolveUserRole(session: SessionData): string | undefined {
  const user = session.user as Record<string, unknown>;
  const role = user.role;
  if (typeof role === 'string' && role.trim()) {
    return role;
  }

  const systemRole = user.system_role;
  if (typeof systemRole === 'string' && systemRole.trim()) {
    return systemRole;
  }

  return undefined;
}

function getUnitRole(unit: UnitSummary): string | undefined {
  return unit.myRole || unit.my_role;
}

function isForbiddenError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b403\b/.test(message);
}

function deriveUnitsFromProjects(projects: ProjectSummary[]): UnitSummary[] {
  const map = new Map<number, UnitSummary>();
  for (const project of projects) {
    const unit = project.unit;
    if (!unit || typeof unit.id !== 'number' || map.has(unit.id)) {
      continue;
    }
    map.set(unit.id, {
      id: unit.id,
      code: unit.code,
      name: unit.name,
      myRole: getUnitRole(unit),
      active: unit.active,
    });
  }

  return [...map.values()];
}

function dedupeInboxTasks(tasks: InboxRowTask[]): InboxRowTask[] {
  const map = new Map<string, InboxRowTask>();
  for (const task of tasks) {
    const key = `${extractInboxProjectId(task) ?? '-'}:${task._unitId}:${task.id}`;
    map.set(key, task);
  }
  return [...map.values()];
}

function getUnitTaskDefinitions(unit: UnitSummary | undefined): TaskDefinitionSummary[] {
  if (!unit) {
    return [];
  }
  const defs = unit.taskDefinitions ?? unit.task_definitions;
  if (!Array.isArray(defs)) {
    return [];
  }
  return defs;
}

type UploadFileInput = {
  key?: string;
  path: string;
};

type UploadFileAssignment = {
  key: string;
  path: string;
};

function getTaskUploadRequirements(task: TaskSummary): TaskUploadRequirement[] {
  const definition = task.definition as Record<string, unknown> | undefined;
  const candidates = [
    definition?.uploadRequirements,
    definition?.upload_requirements,
    task.uploadRequirements,
    task.upload_requirements,
  ];

  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) {
      continue;
    }

    return candidate.filter(
      (item): item is TaskUploadRequirement => typeof item === 'object' && item !== null,
    );
  }

  return [];
}

function getUploadRequirementKeys(task: TaskSummary): string[] {
  const requirements = getTaskUploadRequirements(task);
  return requirements.map((requirement, index) => {
    const key =
      typeof requirement.key === 'string' ? requirement.key.trim() : '';
    return key || `file${index}`;
  });
}

function deriveDefaultSubmissionTrigger(task: TaskSummary): SubmissionTrigger | undefined {
  const status = (getTaskStatus(task) || '').trim().toLowerCase();
  if (status === 'working_on_it' || status === 'need_help') {
    return 'need_help';
  }
  return undefined;
}

function parseSubmissionTrigger(raw: string | undefined): SubmissionTrigger | undefined {
  if (!raw) {
    return undefined;
  }

  const value = raw.trim().toLowerCase();
  if (value === 'need_help' || value === 'ready_for_feedback') {
    return value;
  }

  throw new Error('--trigger must be one of: need_help, ready_for_feedback.');
}

function assignUploadFileKeys(
  inputs: UploadFileInput[],
  requirementKeys: string[],
): UploadFileAssignment[] {
  const explicit = new Map<string, string>();
  const queuedPaths: string[] = [];

  for (const input of inputs) {
    if (!input.path.trim()) {
      throw new Error('Upload file path cannot be empty.');
    }

    if (!input.key) {
      queuedPaths.push(input.path);
      continue;
    }

    if (explicit.has(input.key)) {
      throw new Error(`Duplicate upload key "${input.key}".`);
    }
    explicit.set(input.key, input.path);
  }

  if (requirementKeys.length > 0) {
    if (inputs.length !== requirementKeys.length) {
      throw new Error(
        `This task expects ${requirementKeys.length} file(s) (${requirementKeys.join(', ')}), but received ${inputs.length}.`,
      );
    }

    for (const key of explicit.keys()) {
      if (!requirementKeys.includes(key)) {
        throw new Error(
          `Upload key "${key}" is not valid for this task. Expected keys: ${requirementKeys.join(', ')}.`,
        );
      }
    }

    const remainingKeys = requirementKeys.filter((key) => !explicit.has(key));
    if (queuedPaths.length !== remainingKeys.length) {
      throw new Error(
        `Unable to map files to required keys (${requirementKeys.join(', ')}). Use --file fileN=PATH to map explicitly.`,
      );
    }

    const assignments: UploadFileAssignment[] = [];
    let queueIndex = 0;
    for (const key of requirementKeys) {
      const path = explicit.get(key) ?? queuedPaths[queueIndex++];
      assignments.push({ key, path });
    }
    return assignments;
  }

  const assignments: UploadFileAssignment[] = [];
  const used = new Set(explicit.keys());
  let autoIndex = 0;
  for (const input of inputs) {
    if (input.key) {
      assignments.push({
        key: input.key,
        path: input.path,
      });
      continue;
    }

    let key = `file${autoIndex}`;
    while (used.has(key)) {
      autoIndex += 1;
      key = `file${autoIndex}`;
    }
    autoIndex += 1;
    used.add(key);
    assignments.push({
      key,
      path: input.path,
    });
  }

  return assignments;
}

async function readUploadFiles(assignments: UploadFileAssignment[]): Promise<
  Array<{
    key: string;
    filename: string;
    content: Buffer;
  }>
> {
  return Promise.all(
    assignments.map(async (assignment) => {
      const absolutePath = resolve(process.cwd(), assignment.path);
      try {
        const content = await readFile(absolutePath);
        return {
          key: assignment.key,
          filename: basename(absolutePath),
          content,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to read upload file "${assignment.path}": ${message}`);
      }
    }),
  );
}

function projectMatchesScope(
  project: ProjectSummary,
  scope: { projectId?: number; unitId?: number },
): boolean {
  if (scope.projectId !== undefined && project.id !== scope.projectId) {
    return false;
  }
  if (scope.unitId !== undefined && project.unit?.id !== scope.unitId) {
    return false;
  }
  return true;
}

async function loadProjectsWithTaskMetadata(
  api: OnTrackApiClient,
  session: SessionData,
  scope: { projectId?: number; unitId?: number } = {},
): Promise<ProjectSummary[]> {
  const overview = await api.listProjects(session);
  const scopedOverview = overview.filter((project) => projectMatchesScope(project, scope));
  if (scopedOverview.length === 0) {
    return [];
  }

  const detailedResults = await Promise.allSettled(
    scopedOverview.map(async (project) => api.getProject(session, project.id)),
  );

  const projects: ProjectSummary[] = [];
  for (let index = 0; index < detailedResults.length; index += 1) {
    const result = detailedResults[index];
    if (result.status === 'fulfilled') {
      projects.push(result.value);
      continue;
    }

    // fallback to overview when project detail endpoint is unavailable
    projects.push(scopedOverview[index]);
  }

  const unitIds = [
    ...new Set(
      projects
        .map((project) => project.unit?.id)
        .filter((id): id is number => typeof id === 'number'),
    ),
  ];

  const unitResults = await Promise.allSettled(
    unitIds.map(async (unitId) => api.getUnit(session, unitId)),
  );

  const unitMap = new Map<number, UnitSummary>();
  const unitDefinitionMap = new Map<number, Map<number, TaskDefinitionSummary>>();
  for (let index = 0; index < unitResults.length; index += 1) {
    const result = unitResults[index];
    if (result.status !== 'fulfilled') {
      continue;
    }

    const unit = result.value;
    unitMap.set(unit.id, unit);
    unitDefinitionMap.set(
      unit.id,
      new Map(
        getUnitTaskDefinitions(unit)
          .filter((definition) => typeof definition.id === 'number')
          .map((definition) => [definition.id as number, definition]),
      ),
    );
  }

  return projects.map((project) => {
    const unitId = project.unit?.id;
    const fullUnit = unitId !== undefined ? unitMap.get(unitId) : undefined;
    const taskDefinitions = unitId !== undefined ? unitDefinitionMap.get(unitId) : undefined;

    const mergedUnit = fullUnit
      ? {
          ...fullUnit,
          ...project.unit,
        }
      : project.unit;

    const mergedTasks = (project.tasks || []).map((task) => {
      const taskDefId = getTaskDefinitionId(task);
      const taskDefinition =
        taskDefId !== undefined ? taskDefinitions?.get(taskDefId) : undefined;
      return {
        ...task,
        definition: {
          id: taskDefId,
          abbreviation: task.definition?.abbreviation ?? taskDefinition?.abbreviation,
          name: task.definition?.name ?? taskDefinition?.name,
          targetGrade: task.definition?.targetGrade ?? taskDefinition?.targetGrade,
          uploadRequirements:
            task.definition?.uploadRequirements ??
            task.definition?.upload_requirements ??
            taskDefinition?.uploadRequirements ??
            taskDefinition?.upload_requirements,
          upload_requirements:
            task.definition?.upload_requirements ??
            task.definition?.uploadRequirements ??
            taskDefinition?.upload_requirements ??
            taskDefinition?.uploadRequirements,
        },
      };
    });

    return {
      ...project,
      unit: mergedUnit,
      tasks: mergedTasks,
    };
  });
}

async function buildInboxFallbackTasksFromProjectDetails(
  api: OnTrackApiClient,
  session: SessionData,
  candidateUnitIds: number[],
): Promise<InboxRowTask[]> {
  const unitFilter = new Set(candidateUnitIds);
  const projects = await loadProjectsWithTaskMetadata(api, session);
  const tasks = flattenTasks(projects)
    .filter((task) => task.unitId !== undefined && unitFilter.has(task.unitId))
    .map(
      (task): InboxRowTask => ({
        ...task,
        projectId: task.projectId,
        unitId: task.unitId,
        _unitId: task.unitId ?? -1,
      }),
    );

  return tasks;
}

async function listUnitsWithFallback(
  api: OnTrackApiClient,
  session: SessionData,
): Promise<{ units: UnitSummary[]; fallbackUsed: boolean }> {
  try {
    return {
      units: await api.listUnits(session),
      fallbackUsed: false,
    };
  } catch (error) {
    if (!isForbiddenError(error)) {
      throw error;
    }

    const projects = await api.listProjects(session);
    const units = deriveUnitsFromProjects(projects);
    if (units.length === 0) {
      throw error;
    }

    return {
      units,
      fallbackUsed: true,
    };
  }
}

async function handleAuthMethod(args: string[]): Promise<void> {
  const api = new OnTrackApiClient(normalizeBaseUrl(getFlagValue(args, '--base-url')));
  const method = await api.getAuthMethod();
  if (hasFlag(args, '--json')) {
    printJson(method);
    return;
  }

  console.log(`Base URL: ${api.base}`);
  console.log(`Method: ${method.method || 'unknown'}`);
  if (method.redirect_to) {
    console.log(`SSO redirect: ${method.redirect_to}`);
  }
}

async function handleLogin(args: string[]): Promise<void> {
  const api = new OnTrackApiClient(normalizeBaseUrl(getFlagValue(args, '--base-url')));
  if (hasFlag(args, '--password') || hasFlag(args, '--sso-password')) {
    throw new Error('Password must be entered interactively. Command-line password flags are not supported.');
  }
  const auto = hasFlag(args, '--auto');
  const sso = hasFlag(args, '--sso');
  const showBrowserFlag = hasFlag(args, '--show-browser');
  const hideBrowserFlag = hasFlag(args, '--hide-browser');
  if (showBrowserFlag && hideBrowserFlag) {
    throw new Error('Use either --show-browser or --hide-browser, not both.');
  }
  const showBrowser = showBrowserFlag || (!hideBrowserFlag && !auto);
  const autoTimeoutSec = hasFlag(args, '--auto-timeout-sec')
    ? parseIntegerFlagValue(getFlagValue(args, '--auto-timeout-sec'), '--auto-timeout-sec')
    : 300;
  if (autoTimeoutSec < 10) {
    throw new Error('--auto-timeout-sec must be >= 10 seconds.');
  }
  const ssoTimeoutSec = hasFlag(args, '--sso-timeout-sec')
    ? parseIntegerFlagValue(getFlagValue(args, '--sso-timeout-sec'), '--sso-timeout-sec')
    : 420;
  if (ssoTimeoutSec < 60) {
    throw new Error('--sso-timeout-sec must be >= 60 seconds.');
  }
  if (auto && sso) {
    throw new Error('Use either --auto or --sso, not both.');
  }

  let authToken = getFlagValue(args, '--auth-token');
  let username = getFlagValue(args, '--username');

  const redirectUrl = getFlagValue(args, '--redirect-url');
  if (redirectUrl) {
    ({ authToken, username } = parseSsoRedirectUrl(redirectUrl));
  }

  if (!authToken || !username) {
    const method = await api.getAuthMethod();

    if (method.redirect_to) {
      const redirectTo = method.redirect_to;
      console.log(`OnTrack uses ${method.method || 'SSO'} for authentication.`);
      console.log('Expected final redirect format: https://ontrack.infotech.monash.edu/sign_in?authToken=...&username=...');
      const isHeadless = isHeadlessServerEnvironment();
      const loginMode = resolveLoginMode({
        auto,
        sso,
        hasAuthToken: Boolean(authToken),
        hasUsername: Boolean(username),
        hasRedirectUrl: Boolean(redirectUrl),
        isHeadless,
      });

      const manualRedirectCapture = async (): Promise<void> => {
        console.log('Complete login in your browser, then paste the final redirected URL from the address bar.');
        if (!hasFlag(args, '--no-open')) {
          const opened = openExternal(redirectTo);
          if (!opened) {
            console.log(`Open this URL manually:\n${redirectTo}`);
          }
        } else {
          console.log(`Open this URL manually:\n${redirectTo}`);
        }
        const pasted = await prompt('Paste final redirect URL: ');
        ({ authToken, username } = parseSsoRedirectUrl(pasted));
      };

      if (loginMode === 'auto') {
        console.log('Starting auto SSO login in a controlled browser...');
        const captured = await captureSsoCredentials({
          ssoUrl: redirectTo,
          apiBaseUrl: api.base,
          timeoutMs: autoTimeoutSec * 1000,
          headless: isHeadless && !showBrowser,
        });
        authToken = captured.authToken;
        username = captured.username;
        console.log(`Auto login captured credentials from ${captured.source}.`);
      } else if (loginMode === 'sso_guided') {
        let guidedUsername = parseOptionalString(args, '--sso-username');
        if (!guidedUsername) {
          guidedUsername = await prompt('Monash username: ');
        }
        if (!guidedUsername.trim()) {
          throw new Error('Username cannot be empty.');
        }

        let password = await promptHidden('Password: ');
        if (!password) {
          throw new Error('Password cannot be empty.');
        }

        const stepLabels: Record<string, string> = {
          username: 'Submitting username...',
          password: 'Submitting password...',
          mfa_select: 'Multiple MFA options detected. Please choose one in CLI.',
          mfa_wait: 'Waiting for Okta Verify push/number approval on your phone...',
          completed: 'SSO flow completed.',
        };

        const renderChallengeNumbers = (numbers: string[]): string =>
          numbers
            .map((number) => launcherColor(` ${number} `, '1;30;103'))
            .join(launcherColor('  ', KLEIN_BLUE_SOFT));

        const chooseMfaMethod = async (
          options: MfaMethodOption[],
        ): Promise<number> => {
          if (options.length === 0) {
            return 1;
          }

          const recommendedOption =
            options.find((option) => option.recommended) ?? options[0];

          console.log('');
          console.log('Select a security method:');
          for (const option of options) {
            const suffix = option.id === recommendedOption.id ? ' (Recommended)' : '';
            console.log(`  ${option.id}. ${option.label}${suffix}`);
          }

          const raw = await prompt(`Choose method [${recommendedOption.id}]: `);
          if (!raw.trim()) {
            return recommendedOption.id;
          }

          const selected = Number.parseInt(raw.trim(), 10);
          if (Number.isFinite(selected) && options.some((option) => option.id === selected)) {
            return selected;
          }

          console.log(
            `[warn] Invalid selection "${raw.trim()}". Using recommended method ${recommendedOption.id}.`,
          );
          return recommendedOption.id;
        };

        try {
          console.log('Starting guided Monash SSO login...');
          const captured = await captureSsoCredentialsWithGuidedLogin(
            {
              ssoUrl: redirectTo,
              apiBaseUrl: api.base,
              username: guidedUsername,
              password,
              timeoutMs: ssoTimeoutSec * 1000,
              headless: isHeadless && !showBrowser,
              chooseMfaMethod,
              onMfaNumberChallenge: (numbers) => {
                if (numbers.length === 0) {
                  return;
                }
                console.log(
                  `[mfa] Number challenge on page: ${renderChallengeNumbers(numbers)}`,
                );
                console.log('[mfa] Tap the matching number in Okta Verify.');
              },
            },
            (step) => {
              const message = stepLabels[step];
              if (message) {
                console.log(message);
              }
            },
          );
          authToken = captured.authToken;
          username = captured.username;
          console.log(`Guided SSO captured credentials from ${captured.source}.`);
        } catch (error) {
          const reason = classifySsoFallback(error);
          const detail = toRedactedError(error).message;
          if (error instanceof SsoFallbackError) {
            console.log(
              `[warn] Guided SSO fallback (${error.reason}) at step ${error.step}: ${detail}`,
            );
          } else {
            console.log(`[warn] Guided SSO fallback (${reason}): ${detail}`);
          }

          try {
            console.log(
              '[info] Switching to browser-assisted SSO mode. Complete login in the opened browser window; credentials will be captured automatically.',
            );
            const captured = await captureSsoCredentials({
              ssoUrl: redirectTo,
              apiBaseUrl: api.base,
              timeoutMs: ssoTimeoutSec * 1000,
              headless: false,
            });
            authToken = captured.authToken;
            username = captured.username;
            console.log(`Browser-assisted SSO captured credentials from ${captured.source}.`);
          } catch (assistedError) {
            const assistedDetail = toRedactedError(assistedError).message;
            console.log(`[warn] Browser-assisted SSO failed: ${assistedDetail}`);
            console.log('[info] Falling back to manual redirect URL flow (last-resort).');
            await manualRedirectCapture();
          }
        } finally {
          password = '';
        }
      } else {
        await manualRedirectCapture();
      }
    } else {
      throw new Error('This server does not advertise SSO, and interactive username/password login is not implemented in this CLI yet.');
    }
  }

  if (!authToken || !username) {
    throw new Error('Unable to obtain login credentials. Retry login with --sso, --auto, or --redirect-url.');
  }

  const response = await api.signIn({
    auth_token: authToken,
    username,
    remember: true,
  });

  const session: SessionData = {
    baseUrl: api.base,
    username,
    authToken: response.auth_token,
    user: response.user,
    savedAt: new Date().toISOString(),
  };

  await saveSession(session);
  renderLoginSuccessPanel(session);
}

async function handleLogout(): Promise<void> {
  const session = requireSession(await loadSession());
  const api = new OnTrackApiClient(session.baseUrl);

  try {
    await api.signOut(session);
  } catch (error) {
    console.error(`Remote sign-out failed: ${(error as Error).message}`);
  }

  await clearSession();
  console.log('Session cleared.');
}

async function handleWhoAmI(args: string[]): Promise<void> {
  const session = requireSession(await loadSession());
  if (hasFlag(args, '--json')) {
    printJson(session);
    return;
  }

  printTable([
    {
      username: session.username,
      id: session.user.id ?? '-',
      role: resolveUserRole(session) ?? '-',
      firstName: session.user.firstName ?? session.user.first_name ?? '-',
      lastName: session.user.lastName ?? session.user.last_name ?? '-',
      email: session.user.email ?? '-',
      savedAt: session.savedAt,
    },
  ]);
}

async function handleProjects(args: string[]): Promise<void> {
  const session = requireSession(await loadSession());
  const api = new OnTrackApiClient(session.baseUrl);
  const projects = await api.listProjects(session);

  if (hasFlag(args, '--json')) {
    printJson(projects);
    return;
  }

  printTable(
    projects.map((project) => ({
      id: project.id,
      unitCode: project.unit?.code ?? '-',
      unitName: project.unit?.name ?? '-',
      enrolled: project.enrolled ?? '-',
      targetGrade: project.targetGrade ?? '-',
      submittedGrade: project.submittedGrade ?? '-',
      tasks: Array.isArray(project.tasks) ? project.tasks.length : '-',
    })),
  );
}

function countTasksByStatus(tasks: TaskSummary[]): string {
  if (tasks.length === 0) {
    return '-';
  }

  const counts = new Map<string, number>();
  for (const task of tasks) {
    const status = getTaskStatus(task) || 'unknown';
    counts.set(status, (counts.get(status) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([status, count]) => `${status}:${count}`)
    .join(', ');
}

async function handleProjectShow(args: string[]): Promise<void> {
  const session = requireSession(await loadSession());
  const api = new OnTrackApiClient(session.baseUrl);
  const projectId = parseIntegerFlagValue(getFlagValue(args, '--project-id'), '--project-id');
  const projects = await loadProjectsWithTaskMetadata(api, session, { projectId });
  const project = projects[0];
  if (!project) {
    throw new Error(`Project ${projectId} not found.`);
  }

  if (hasFlag(args, '--json')) {
    printJson(project);
    return;
  }

  const tasks = project.tasks || [];
  printTable([
    {
      id: project.id,
      unitId: project.unit?.id ?? '-',
      unitCode: project.unit?.code ?? '-',
      unitName: project.unit?.name ?? '-',
      enrolled: project.enrolled ?? '-',
      targetGrade: project.targetGrade ?? '-',
      submittedGrade: project.submittedGrade ?? '-',
      tasks: tasks.length,
      byStatus: countTasksByStatus(tasks),
    },
  ]);
}

async function handleUnits(args: string[]): Promise<void> {
  const session = requireSession(await loadSession());
  const api = new OnTrackApiClient(session.baseUrl);
  const { units, fallbackUsed } = await listUnitsWithFallback(api, session);

  if (hasFlag(args, '--json')) {
    printJson(units);
    return;
  }

  if (fallbackUsed) {
    console.error('[info] /units is not accessible for this account; showing units derived from /projects.');
  }

  printTable(
    units.map((unit) => ({
      id: unit.id,
      code: unit.code ?? '-',
      name: unit.name ?? '-',
      role: getUnitRole(unit) ?? '-',
      active: unit.active ?? '-',
    })),
  );
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

async function handleUnitShow(args: string[]): Promise<void> {
  const session = requireSession(await loadSession());
  const api = new OnTrackApiClient(session.baseUrl);
  const unitId = parseIntegerFlagValue(getFlagValue(args, '--unit-id'), '--unit-id');
  const unit = await api.getUnit(session, unitId);

  if (hasFlag(args, '--json')) {
    printJson(unit);
    return;
  }

  const rawUnit = unit as Record<string, unknown>;
  printTable([
    {
      id: unit.id,
      code: unit.code ?? '-',
      name: unit.name ?? '-',
      role: getUnitRole(unit) ?? '-',
      active: unit.active ?? '-',
      teachingPeriodId: rawUnit.teaching_period_id ?? '-',
      startDate: rawUnit.start_date ?? '-',
      endDate: rawUnit.end_date ?? '-',
      taskDefinitions: getUnitTaskDefinitions(unit).length,
      tutorials: arrayLength(rawUnit.tutorials),
      tutorialStreams: arrayLength(rawUnit.tutorial_streams),
      ilos: arrayLength(rawUnit.ilos),
      groups: arrayLength(rawUnit.groups),
    },
  ]);
}

async function handleUnitTasks(args: string[]): Promise<void> {
  const session = requireSession(await loadSession());
  const api = new OnTrackApiClient(session.baseUrl);
  const unitId = parseIntegerFlagValue(getFlagValue(args, '--unit-id'), '--unit-id');
  const status = getFlagValue(args, '--status');
  const projects = await loadProjectsWithTaskMetadata(api, session, { unitId });

  let tasks = flattenTasks(projects);
  if (status) {
    tasks = filterTasksByStatus(tasks, status);
  }

  if (hasFlag(args, '--json')) {
    printJson(tasks);
    return;
  }

  printTable(
    tasks.map((task) => ({
      unit: task.unitCode ?? '-',
      task: getTaskAbbreviation(task) ?? '-',
      title: getTaskName(task) ?? '-',
      status: getTaskStatus(task) ?? '-',
      due: formatDate(getTaskDueDate(task)),
      completed: formatDate(getTaskCompletionDate(task)),
      taskId: task.id,
      projectId: task.projectId,
    })),
  );
}

async function handleTasks(args: string[]): Promise<void> {
  const session = requireSession(await loadSession());
  const api = new OnTrackApiClient(session.baseUrl);
  const projectId = parseOptionalInteger(args, '--project-id');
  const projects = await loadProjectsWithTaskMetadata(api, session, { projectId });

  let tasks = flattenTasks(projects);
  const status = getFlagValue(args, '--status');

  if (status) {
    tasks = filterTasksByStatus(tasks, status);
  }

  if (hasFlag(args, '--json')) {
    printJson(tasks);
    return;
  }

  printTable(
    tasks.map((task) => ({
      unit: task.unitCode ?? '-',
      task: getTaskAbbreviation(task) ?? '-',
      title: getTaskName(task) ?? '-',
      status: getTaskStatus(task) ?? '-',
      grade: task.grade ?? '-',
      due: formatDate(getTaskDueDate(task)),
      completed: formatDate(getTaskCompletionDate(task)),
      taskId: task.id,
      projectId: task.projectId,
    })),
  );
}

type DoctorCheck = {
  key: string;
  endpoint: string;
  status: 'ok' | 'error' | 'skip';
  detail: string;
};

function parseStatusCodeFromError(error: unknown): number | undefined {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/\b(\d{3})\b/);
  if (!match) {
    return undefined;
  }
  const code = Number.parseInt(match[1], 10);
  return Number.isFinite(code) ? code : undefined;
}

function shortError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 140 ? `${message.slice(0, 137)}...` : message;
}

async function runDoctorCheck(
  key: string,
  endpoint: string,
  fn: () => Promise<unknown>,
): Promise<DoctorCheck> {
  try {
    await fn();
    return {
      key,
      endpoint,
      status: 'ok',
      detail: 'ok',
    };
  } catch (error) {
    const code = parseStatusCodeFromError(error);
    return {
      key,
      endpoint,
      status: 'error',
      detail: code ? `${code} ${shortError(error)}` : shortError(error),
    };
  }
}

async function handleDoctor(args: string[]): Promise<void> {
  const session = requireSession(await loadSession());
  const api = new OnTrackApiClient(session.baseUrl);

  const checks: DoctorCheck[] = [];
  checks.push(
    await runDoctorCheck('auth_method', 'GET /auth/method', async () => {
      await api.getAuthMethod();
    }),
  );

  let projects: ProjectSummary[] = [];
  const projectsCheck = await runDoctorCheck('projects', 'GET /projects', async () => {
    projects = await api.listProjects(session);
  });
  checks.push(projectsCheck);

  const firstProject = projects[0];
  if (!firstProject) {
    checks.push({
      key: 'project_detail',
      endpoint: 'GET /projects/:projectId',
      status: 'skip',
      detail: 'No project available for this account.',
    });
  } else {
    checks.push(
      await runDoctorCheck('project_detail', `GET /projects/${firstProject.id}`, async () => {
        const detailedProject = await api.getProject(session, firstProject.id);
        firstProject.tasks = detailedProject.tasks;
      }),
    );
  }

  let firstUnitId = firstProject?.unit?.id;
  const unitsCheck = await runDoctorCheck('units', 'GET /units', async () => {
    const units = await api.listUnits(session);
    if (!firstUnitId) {
      firstUnitId = units[0]?.id;
    }
  });
  checks.push(unitsCheck);

  if (!firstUnitId) {
    checks.push({
      key: 'unit_detail',
      endpoint: 'GET /units/:unitId',
      status: 'skip',
      detail: 'No unit id available.',
    });
    checks.push({
      key: 'inbox',
      endpoint: 'GET /units/:unitId/tasks/inbox',
      status: 'skip',
      detail: 'No unit id available.',
    });
  } else {
    checks.push(
      await runDoctorCheck('unit_detail', `GET /units/${firstUnitId}`, async () => {
        await api.getUnit(session, firstUnitId as number);
      }),
    );
    checks.push(
      await runDoctorCheck('inbox', `GET /units/${firstUnitId}/tasks/inbox`, async () => {
        await api.listInboxTasks(session, firstUnitId as number);
      }),
    );
  }

  const firstTaskDefId = firstProject?.tasks?.[0]
    ? getTaskDefinitionId(firstProject.tasks[0])
    : undefined;
  const projectId = firstProject?.id;
  if (!projectId || !firstTaskDefId) {
    checks.push({
      key: 'feedback',
      endpoint: 'GET /projects/:projectId/task_def_id/:taskDefId/comments',
      status: 'skip',
      detail: 'No project/task available.',
    });
    checks.push({
      key: 'task_pdf',
      endpoint: 'GET /units/:unitId/task_definitions/:taskDefId/task_pdf.json',
      status: 'skip',
      detail: 'No project/task available.',
    });
    checks.push({
      key: 'submission_pdf',
      endpoint: 'GET /projects/:projectId/task_def_id/:taskDefId/submission',
      status: 'skip',
      detail: 'No project/task available.',
    });
  } else {
    checks.push(
      await runDoctorCheck(
        'feedback',
        `GET /projects/${projectId}/task_def_id/${firstTaskDefId}/comments`,
        async () => {
          await api.listTaskComments(session, projectId, firstTaskDefId);
        },
      ),
    );
    if (firstUnitId) {
      checks.push(
        await runDoctorCheck(
          'task_pdf',
          `GET /units/${firstUnitId}/task_definitions/${firstTaskDefId}/task_pdf.json`,
          async () => {
            await api.downloadTaskPdf(session, firstUnitId as number, firstTaskDefId);
          },
        ),
      );
    } else {
      checks.push({
        key: 'task_pdf',
        endpoint: 'GET /units/:unitId/task_definitions/:taskDefId/task_pdf.json',
        status: 'skip',
        detail: 'No unit id available.',
      });
    }
    checks.push(
      await runDoctorCheck(
        'submission_pdf',
        `GET /projects/${projectId}/task_def_id/${firstTaskDefId}/submission`,
        async () => {
          await api.downloadSubmissionPdf(session, projectId, firstTaskDefId);
        },
      ),
    );
  }

  if (hasFlag(args, '--json')) {
    printJson(checks);
    return;
  }

  printTable(
    checks.map((check) => ({
      check: check.key,
      status: check.status,
      endpoint: check.endpoint,
      detail: check.detail,
    })),
  );
}

function defaultSiteUrlFromBase(baseUrl: string): string {
  const parsed = new URL(baseUrl);
  return new URL('/home', `${parsed.origin}/`).toString();
}

function applyLimit<T>(items: T[], limit?: number): T[] {
  if (limit === undefined) {
    return items;
  }
  return items.slice(0, limit);
}

async function handleDiscover(args: string[]): Promise<void> {
  const probe = hasFlag(args, '--probe');
  const limit = hasFlag(args, '--limit')
    ? parseIntegerFlagValue(getFlagValue(args, '--limit'), '--limit')
    : undefined;

  if (limit !== undefined && limit < 1) {
    throw new Error('--limit must be at least 1.');
  }

  if (probe) {
    const session = requireSession(await loadSession());
    const api = new OnTrackApiClient(session.baseUrl);
    const siteUrl = getFlagValue(args, '--site-url') || defaultSiteUrlFromBase(session.baseUrl);
    const discovery = await discoverOnTrackSurface(siteUrl);
    const apiTemplates = applyLimit(discovery.apiTemplates, limit);
    const projects = await loadProjectsWithTaskMetadata(api, session);
    const firstProject = projects[0];
    const probeContext = firstProject
      ? {
          projectId: firstProject.id,
          unitId: firstProject.unit?.id,
          taskDefId: firstProject.tasks?.length
            ? getTaskDefinitionId(firstProject.tasks[0])
            : undefined,
        }
      : undefined;
    const probeItems = await probeDiscoveredApiTemplates(api, session, apiTemplates, probeContext);

    if (hasFlag(args, '--json')) {
      printJson({
        ...discovery,
        apiTemplates,
        probe: probeItems,
      });
      return;
    }

    console.log(`Discovered ${discovery.uiRoutes.length} route(s) and ${discovery.apiTemplates.length} API template(s) from ${discovery.assets.length} JS asset(s).`);
    printTable(
      discovery.assets.map((asset) => ({
        asset: asset.url,
        status: asset.status,
        detail: asset.detail ?? '-',
      })),
    );
    printTable(discovery.uiRoutes.map((path) => ({ route: path })));
    printTable(apiTemplates.map((template) => ({ apiTemplate: template })));
    printTable(
      probeItems.map((item) => ({
        template: item.template,
        endpoint: item.endpoint ?? '-',
        status: item.status,
        detail: item.detail,
      })),
    );
    return;
  }

  const baseUrl = normalizeBaseUrl(getFlagValue(args, '--base-url'));
  const siteUrl = getFlagValue(args, '--site-url') || defaultSiteUrlFromBase(baseUrl);
  const discovery = await discoverOnTrackSurface(siteUrl);
  const uiRoutes = applyLimit(discovery.uiRoutes, limit);
  const apiTemplates = applyLimit(discovery.apiTemplates, limit);

  if (hasFlag(args, '--json')) {
    printJson({
      ...discovery,
      uiRoutes,
      apiTemplates,
    });
    return;
  }

  console.log(`Discovered ${discovery.uiRoutes.length} route(s) and ${discovery.apiTemplates.length} API template(s) from ${discovery.assets.length} JS asset(s).`);
  printTable(
    discovery.assets.map((asset) => ({
      asset: asset.url,
      status: asset.status,
      detail: asset.detail ?? '-',
    })),
  );
  printTable(uiRoutes.map((path) => ({ route: path })));
  printTable(apiTemplates.map((template) => ({ apiTemplate: template })));
}

async function handleInbox(args: string[]): Promise<void> {
  const session = requireSession(await loadSession());
  const api = new OnTrackApiClient(session.baseUrl);
  const status = getFlagValue(args, '--status');
  const unitId = parseOptionalInteger(args, '--unit-id');
  roleScopeHint(session, 'inbox', unitId !== undefined);

  const { units, fallbackUsed } = await listUnitsWithFallback(api, session);
  const unitMap = new Map(units.map((unit) => [unit.id, unit]));

  if (unitId !== undefined && !unitMap.has(unitId)) {
    throw new Error(`Unit ${unitId} was not found in your account.`);
  }

  if (fallbackUsed && !hasFlag(args, '--json')) {
    console.error('[info] /units is not accessible for this account; using units derived from /projects.');
  }

  const targetUnitIds = unitId !== undefined ? [unitId] : units.map((unit) => unit.id);
  const settled = await Promise.allSettled(
    targetUnitIds.map(async (id): Promise<InboxRowTask[]> => {
      const inbox = await api.listInboxTasks(session, id);
      return inbox.map((task) => ({
        ...task,
        _unitId: id,
      }));
    }),
  );

  const allTasks: InboxRowTask[] = [];
  const failedUnitIds: number[] = [];
  for (let index = 0; index < settled.length; index += 1) {
    const result = settled[index];
    if (result.status === 'fulfilled') {
      allTasks.push(...result.value);
    } else {
      failedUnitIds.push(targetUnitIds[index]);
    }
  }

  if (failedUnitIds.length > 0) {
    const fallbackTasks = await buildInboxFallbackTasksFromProjectDetails(
      api,
      session,
      failedUnitIds,
    );
    allTasks.push(...fallbackTasks);

    if (!hasFlag(args, '--json')) {
      console.error(
        `[info] Loaded ${fallbackTasks.length} fallback task(s) from /projects for ${failedUnitIds.length} unit(s) where inbox endpoint is unavailable.`,
      );
    }
  }

  const dedupedTasks = dedupeInboxTasks(allTasks);
  if (dedupedTasks.length === 0 && failedUnitIds.length > 0) {
    throw new Error(
      'Unable to load inbox tasks for selected units (permission denied or endpoint unavailable).',
    );
  }

  if (failedUnitIds.length > 0 && !hasFlag(args, '--json')) {
    console.error(
      `[info] Inbox endpoint unavailable for unit(s): ${failedUnitIds.join(', ')}. Showing fallback task list.`,
    );
  }

  const filtered = filterTasksByStatus(dedupedTasks, status);
  if (hasFlag(args, '--json')) {
    printJson(filtered);
    return;
  }

  printTable(
    filtered.map((task) => ({
      unit: unitMap.get(task._unitId)?.code ?? (task as { unitCode?: string }).unitCode ?? '-',
      task: getTaskAbbreviation(task) ?? '-',
      title: getTaskName(task) ?? '-',
      status: getTaskStatus(task) ?? '-',
      due: formatDate(getTaskDueDate(task)),
      taskId: task.id,
      projectId: extractInboxProjectId(task) ?? '-',
      unitId: task._unitId,
    })),
  );
}

async function handleTaskShow(args: string[]): Promise<void> {
  const session = requireSession(await loadSession());
  const api = new OnTrackApiClient(session.baseUrl);
  const selector = parseTaskSelectorArgs(args);
  const projects = await loadProjectsWithTaskMetadata(api, session, {
    projectId: selector.projectId,
  });
  const resolved = resolveTaskSelector(projects, selector);

  const payload = {
    projectId: resolved.project.id,
    unitId: resolved.unitId,
    unitCode: resolved.unitCode,
    taskId: resolved.taskId,
    taskDefId: resolved.taskDefId,
    abbr: resolved.abbr,
    name: getTaskName(resolved.task),
    status: getTaskStatus(resolved.task),
    dueDate: getTaskDueDate(resolved.task),
    completionDate: getTaskCompletionDate(resolved.task),
    grade: resolved.task.grade,
    qualityPts: resolved.task.qualityPts,
    raw: resolved.task,
  };

  if (hasFlag(args, '--json')) {
    printJson(payload);
    return;
  }

  printTable([
    {
      task: payload.abbr,
      title: payload.name ?? '-',
      status: payload.status ?? '-',
      due: formatDate(payload.dueDate),
      completed: formatDate(payload.completionDate),
      grade: payload.grade ?? '-',
      qualityPts: payload.qualityPts ?? '-',
      unit: payload.unitCode ?? '-',
      taskId: payload.taskId,
      taskDefId: payload.taskDefId,
      projectId: payload.projectId,
      unitId: payload.unitId ?? '-',
    },
  ]);
}

async function handleProjectCommand(args: string[]): Promise<void> {
  const subcommand = args[0];
  const rest = args.slice(1);
  if (subcommand === 'show') {
    await handleProjectShow(rest);
    return;
  }
  throw new Error(`Unknown project subcommand: ${subcommand || '(missing)'}`);
}

async function handleUnitCommand(args: string[]): Promise<void> {
  const subcommand = args[0];
  const rest = args.slice(1);
  if (subcommand === 'show') {
    await handleUnitShow(rest);
    return;
  }
  if (subcommand === 'tasks') {
    await handleUnitTasks(rest);
    return;
  }
  throw new Error(`Unknown unit subcommand: ${subcommand || '(missing)'}`);
}

function feedbackAuthor(comment: FeedbackItem): string {
  if (!comment.author) {
    return '-';
  }

  const first = comment.author.firstName || '';
  const last = comment.author.lastName || '';
  const full = `${first} ${last}`.trim();
  return full || comment.author.username || '-';
}

function formatDateTime(value?: string): string {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return value;
  }

  return date.toISOString().replace('T', ' ').slice(0, 16);
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function feedbackMessage(comment: FeedbackItem): string {
  const text = getFeedbackText(comment).trim();
  if (text) {
    return text;
  }

  const record = comment as Record<string, unknown>;
  const fromStatus = firstString(record, ['from_status', 'previous_status', 'old_status']);
  const toStatus = firstString(record, ['to_status', 'new_status', 'status']);
  if (fromStatus && toStatus) {
    return `Status: ${fromStatus} -> ${toStatus}`;
  }
  if (toStatus) {
    return `Status: ${toStatus}`;
  }

  if (typeof comment.type === 'string' && comment.type.trim()) {
    return `[${comment.type.trim()}]`;
  }

  return '-';
}

function feedbackKind(comment: FeedbackItem): string {
  const type = typeof comment.type === 'string' ? comment.type.trim() : '';
  if (type) {
    return type;
  }
  return getFeedbackText(comment).trim() ? 'message' : 'event';
}

function presentFeedbackRows(comments: FeedbackItem[]): Array<Record<string, unknown>> {
  return comments.map((comment) => {
    const message = feedbackMessage(comment);
    const preview = message.length > 160 ? `${message.slice(0, 157)}...` : message;

    return {
      at: formatDateTime(getFeedbackTimestamp(comment)),
      author: feedbackAuthor(comment),
      kind: feedbackKind(comment),
      message: preview,
      commentId: comment.id ?? '-',
    };
  });
}

async function handleFeedbackList(args: string[]): Promise<void> {
  const session = requireSession(await loadSession());
  const api = new OnTrackApiClient(session.baseUrl);
  const selector = parseTaskSelectorArgs(args);
  const projects = await loadProjectsWithTaskMetadata(api, session, {
    projectId: selector.projectId,
  });
  const resolved = resolveTaskSelector(projects, selector);
  const comments = await api.listTaskComments(session, resolved.project.id, resolved.taskDefId);

  if (hasFlag(args, '--json')) {
    printJson(comments);
    return;
  }

  const sortedComments = sortFeedbackItems(comments);
  printTable(
    presentFeedbackRows(sortedComments).map((row, index) => ({
      ...row,
      isNew: sortedComments[index]?.isNew ?? sortedComments[index]?.is_new ?? '-',
    })),
  );
}

async function handleFeedbackWatch(args: string[]): Promise<void> {
  const session = requireSession(await loadSession());
  const api = new OnTrackApiClient(session.baseUrl);
  const selector = parseTaskSelectorArgs(args);
  const interval = hasFlag(args, '--interval')
    ? parseIntegerFlagValue(getFlagValue(args, '--interval'), '--interval')
    : 15;
  const history = hasFlag(args, '--history')
    ? parseIntegerFlagValue(getFlagValue(args, '--history'), '--history')
    : 30;
  const asJson = hasFlag(args, '--json');

  if (interval < 1) {
    throw new Error('--interval must be at least 1 second.');
  }
  if (history < 0) {
    throw new Error('--history must be >= 0.');
  }

  const projects = await loadProjectsWithTaskMetadata(api, session, {
    projectId: selector.projectId,
  });
  const resolved = resolveTaskSelector(projects, selector);

  const initialComments = sortFeedbackItems(
    await api.listTaskComments(session, resolved.project.id, resolved.taskDefId),
  );
  const baselineComments = history === 0 ? [] : initialComments.slice(-history);
  const seen = new Set(initialComments.map((comment) => feedbackIdentity(comment)));
  const startedAt = new Date().toISOString();

  if (asJson) {
    printJson({
      type: 'baseline',
      at: startedAt,
      projectId: resolved.project.id,
      task: resolved.abbr,
      intervalSec: interval,
      totalComments: initialComments.length,
      comments: baselineComments,
    });
  } else {
    console.log(
      `Feedback watch started for ${resolved.unitCode ?? '-'} ${resolved.abbr} (project ${resolved.project.id}). Polling every ${interval}s. Press Ctrl+C to stop.`,
    );
    if (baselineComments.length === 0) {
      console.log('No baseline comments.');
    } else {
      printTable(presentFeedbackRows(baselineComments));
    }
  }

  let stopped = false;
  let interruptWait: (() => void) | undefined;
  const onSigint = (): void => {
    stopped = true;
    if (interruptWait) {
      interruptWait();
    }
  };
  process.once('SIGINT', onSigint);

  try {
    while (!stopped) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          interruptWait = undefined;
          resolve();
        }, interval * 1000);

        interruptWait = () => {
          clearTimeout(timer);
          interruptWait = undefined;
          resolve();
        };
      });

      if (stopped) {
        break;
      }

      let comments: FeedbackItem[];
      try {
        comments = sortFeedbackItems(
          await api.listTaskComments(session, resolved.project.id, resolved.taskDefId),
        );
      } catch (error) {
        if (asJson) {
          printJson({
            type: 'error',
            at: new Date().toISOString(),
            message: (error as Error).message,
          });
        } else {
          console.error(`[feedback-watch] ${(error as Error).message}`);
        }
        continue;
      }

      const fresh = comments.filter((comment) => {
        const key = feedbackIdentity(comment);
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });

      if (fresh.length === 0) {
        continue;
      }

      if (asJson) {
        printJson({
          type: 'comments',
          at: new Date().toISOString(),
          projectId: resolved.project.id,
          task: resolved.abbr,
          comments: fresh,
        });
      } else {
        printTable(presentFeedbackRows(fresh));
      }
    }
  } finally {
    process.removeListener('SIGINT', onSigint);
    if (!asJson) {
      console.log('Feedback watch stopped.');
    }
  }
}

async function handlePdfDownload(args: string[], type: 'task' | 'submission'): Promise<void> {
  const session = requireSession(await loadSession());
  const api = new OnTrackApiClient(session.baseUrl);
  const selector = parseTaskSelectorArgs(args);
  const projects = await loadProjectsWithTaskMetadata(api, session, {
    projectId: selector.projectId,
  });
  const resolved = resolveTaskSelector(projects, selector);
  const outDir = getFlagValue(args, '--out-dir');

  const download =
    type === 'task'
      ? await api.downloadTaskPdf(
          session,
          resolved.unitId ??
            (() => {
              throw new Error('Unit id not found for task PDF download.');
            })(),
          resolved.taskDefId,
        )
      : await api.downloadSubmissionPdf(session, resolved.project.id, resolved.taskDefId);

  const filename = buildPdfFilename(resolved.unitCode, resolved.abbr, type);
  const filePath = await writePdfFile(download.buffer, filename, outDir);
  console.log(`Saved ${type} PDF to ${filePath}`);
}

async function handleSubmissionUpload(
  args: string[],
  mode: 'upload' | 'upload-new-files',
): Promise<void> {
  const session = requireSession(await loadSession());
  const api = new OnTrackApiClient(session.baseUrl);
  const selector = parseTaskSelectorArgs(args);
  const projects = await loadProjectsWithTaskMetadata(api, session, {
    projectId: selector.projectId,
  });
  const resolved = resolveTaskSelector(projects, selector);
  const fileInputs = parseUploadFileSpecs(args) as UploadFileInput[];
  const explicitTrigger = parseSubmissionTrigger(parseOptionalString(args, '--trigger'));
  const trigger =
    explicitTrigger ??
    (mode === 'upload' ? deriveDefaultSubmissionTrigger(resolved.task) : undefined);
  const comment = parseOptionalString(args, '--comment');

  const requirementKeys = getUploadRequirementKeys(resolved.task);
  const assignments = assignUploadFileKeys(fileInputs, requirementKeys);
  const files = await readUploadFiles(assignments);

  const upload = await api.uploadTaskSubmission(
    session,
    resolved.project.id,
    resolved.taskDefId,
    files,
    {
      trigger,
    },
  );

  let commentResult: FeedbackItem | undefined;
  if (comment) {
    commentResult = await api.addTaskComment(
      session,
      resolved.project.id,
      resolved.taskDefId,
      comment,
    );
  }

  if (hasFlag(args, '--json')) {
    printJson({
      command: `submission ${mode}`,
      projectId: resolved.project.id,
      unitCode: resolved.unitCode,
      task: resolved.abbr,
      taskDefId: resolved.taskDefId,
      trigger: trigger ?? null,
      files: files.map((file) => ({
        key: file.key,
        filename: file.filename,
        bytes: file.content.length,
      })),
      upload,
      comment: commentResult ?? null,
    });
    return;
  }

  console.log(
    `Uploaded ${files.length} file(s) for ${resolved.unitCode ?? '-'} ${resolved.abbr} (project ${resolved.project.id}).`,
  );
  console.log(`File keys: ${assignments.map((item) => `${item.key}=${item.path}`).join(', ')}`);
  console.log(`Trigger: ${trigger ?? 'ready_for_feedback (server default)'}`);
  if (commentResult) {
    console.log(`Comment posted: ${commentResult.id ?? 'ok'}`);
  }
}

function filterProjectsForWatch(
  projects: ProjectSummary[],
  projectId?: number,
  unitId?: number,
): ProjectSummary[] {
  let scoped = projects;
  if (projectId !== undefined) {
    scoped = scoped.filter((project) => project.id === projectId);
  }
  if (unitId !== undefined) {
    scoped = scoped.filter((project) => project.unit?.id === unitId);
  }
  return scoped;
}

async function buildWatchSnapshot(
  api: OnTrackApiClient,
  session: SessionData,
  projectId?: number,
  unitId?: number,
): Promise<WatchTaskState[]> {
  const projects = filterProjectsForWatch(
    await loadProjectsWithTaskMetadata(api, session, { projectId, unitId }),
    projectId,
    unitId,
  );
  const tasks = flattenTasks(projects);

  const states: Array<WatchTaskState | null> = await Promise.all(
    tasks.map(async (task): Promise<WatchTaskState | null> => {
      const taskId = getTaskDefinitionId(task);
      if (!taskId) {
        return null;
      }

      let comments: FeedbackItem[] = [];
      try {
        comments = await api.listTaskComments(session, task.projectId, taskId);
      } catch {
        comments = [];
      }

      return {
        taskKey: makeWatchTaskKey(task.projectId, taskId),
        projectId: task.projectId,
        taskId,
        unitCode: task.unitCode,
        abbr: getTaskAbbreviation(task) ?? String(taskId),
        status: getTaskStatus(task),
        dueDate: getTaskDueDate(task),
        commentCount: comments.length,
        lastCommentAt: getLatestFeedbackTimestamp(comments),
      } satisfies WatchTaskState;
    }),
  );

  return states.filter((state): state is WatchTaskState => state !== null);
}

function describeWatchEvent(event: {
  type: string;
  at: string;
  unitCode?: string;
  abbr?: string;
  projectId: number;
  previous?: string | number | null;
  current?: string | number | null;
  deltaComments?: number;
}): string {
  const target = `${event.unitCode || '-'} ${event.abbr || '-'} (project ${event.projectId})`;
  if (event.type === 'status_changed') {
    return `[${event.at}] status_changed ${target}: ${event.previous || '-'} -> ${event.current || '-'}`;
  }
  if (event.type === 'due_changed') {
    return `[${event.at}] due_changed ${target}: ${formatDate(String(event.previous || ''))} -> ${formatDate(String(event.current || ''))}`;
  }
  return `[${event.at}] new_feedback ${target}: +${event.deltaComments ?? 0} comment(s), latest=${event.current || '-'}`;
}

async function handleWatch(args: string[]): Promise<void> {
  const session = requireSession(await loadSession());
  const api = new OnTrackApiClient(session.baseUrl);
  const unitId = parseOptionalInteger(args, '--unit-id');
  const projectId = parseOptionalInteger(args, '--project-id');
  const interval = hasFlag(args, '--interval')
    ? parseIntegerFlagValue(getFlagValue(args, '--interval'), '--interval')
    : 60;
  const asJson = hasFlag(args, '--json');

  if (interval < 1) {
    throw new Error('--interval must be at least 1 second.');
  }

  roleScopeHint(session, 'watch', unitId !== undefined || projectId !== undefined);

  let baseline = await buildWatchSnapshot(api, session, projectId, unitId);
  const startedAt = new Date().toISOString();

  if (asJson) {
    printJson({
      type: 'baseline',
      at: startedAt,
      intervalSec: interval,
      tasks: baseline,
    });
  } else {
    console.log(`Watch started at ${startedAt}. Polling every ${interval}s. Press Ctrl+C to stop.`);
    printTable(
      baseline.map((task) => ({
        task: task.abbr ?? '-',
        status: task.status ?? '-',
        due: formatDate(task.dueDate),
        comments: task.commentCount,
        lastCommentAt: task.lastCommentAt ? formatDate(task.lastCommentAt) : '-',
        unit: task.unitCode ?? '-',
        projectId: task.projectId,
      })),
    );
  }

  let previous = toWatchStateMap(baseline);
  let stopped = false;
  let interruptWait: (() => void) | undefined;
  const onSigint = (): void => {
    stopped = true;
    if (interruptWait) {
      interruptWait();
    }
  };
  process.once('SIGINT', onSigint);

  try {
    while (!stopped) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          interruptWait = undefined;
          resolve();
        }, interval * 1000);

        interruptWait = () => {
          clearTimeout(timer);
          interruptWait = undefined;
          resolve();
        };
      });

      if (stopped) {
        break;
      }

      let currentSnapshot: WatchTaskState[];
      try {
        currentSnapshot = await buildWatchSnapshot(api, session, projectId, unitId);
      } catch (error) {
        if (asJson) {
          printJson({
            type: 'error',
            at: new Date().toISOString(),
            message: (error as Error).message,
          });
        } else {
          console.error(`[watch] ${(error as Error).message}`);
        }
        continue;
      }

      const now = new Date().toISOString();
      const current = toWatchStateMap(currentSnapshot);
      const events = diffWatchStates(previous, current, now);

      if (events.length > 0) {
        if (asJson) {
          printJson({
            type: 'events',
            at: now,
            events,
          });
        } else {
          for (const event of events) {
            console.log(describeWatchEvent(event));
          }
        }
      }

      baseline = currentSnapshot;
      previous = current;
    }
  } finally {
    process.removeListener('SIGINT', onSigint);
    if (!asJson) {
      console.log('Watch stopped.');
    }
  }
}

async function handleTaskCommand(args: string[]): Promise<void> {
  const subcommand = args[0];
  const rest = args.slice(1);
  if (subcommand === 'show') {
    await handleTaskShow(rest);
    return;
  }
  throw new Error(`Unknown task subcommand: ${subcommand || '(missing)'}`);
}

async function handleFeedbackCommand(args: string[]): Promise<void> {
  const subcommand = args[0];
  const rest = args.slice(1);
  if (subcommand === 'list') {
    await handleFeedbackList(rest);
    return;
  }
  if (subcommand === 'watch') {
    await handleFeedbackWatch(rest);
    return;
  }
  throw new Error(`Unknown feedback subcommand: ${subcommand || '(missing)'}`);
}

async function handlePdfCommand(args: string[]): Promise<void> {
  const subcommand = args[0];
  const rest = args.slice(1);
  if (subcommand === 'task') {
    await handlePdfDownload(rest, 'task');
    return;
  }
  if (subcommand === 'submission') {
    await handlePdfDownload(rest, 'submission');
    return;
  }
  throw new Error(`Unknown pdf subcommand: ${subcommand || '(missing)'}`);
}

async function handleSubmissionCommand(args: string[]): Promise<void> {
  const subcommand = args[0];
  const rest = args.slice(1);
  if (subcommand === 'upload') {
    await handleSubmissionUpload(rest, 'upload');
    return;
  }
  if (subcommand === 'upload-new-files') {
    await handleSubmissionUpload(rest, 'upload-new-files');
    return;
  }
  throw new Error(`Unknown submission subcommand: ${subcommand || '(missing)'}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const rest = args.slice(1);

  if (!command) {
    await handleWelcome();
    return;
  }

  if (command === 'help' || command === '--help' || command === '-h') {
    help();
    return;
  }

  switch (command) {
    case 'welcome':
      await handleWelcome();
      return;
    case 'auth-method':
      await handleAuthMethod(rest);
      return;
    case 'login':
      await handleLogin(rest);
      return;
    case 'logout':
      await handleLogout();
      return;
    case 'whoami':
      await handleWhoAmI(rest);
      return;
    case 'projects':
      await handleProjects(rest);
      return;
    case 'project':
      await handleProjectCommand(rest);
      return;
    case 'units':
      await handleUnits(rest);
      return;
    case 'unit':
      await handleUnitCommand(rest);
      return;
    case 'tasks':
      await handleTasks(rest);
      return;
    case 'doctor':
      await handleDoctor(rest);
      return;
    case 'discover':
      await handleDiscover(rest);
      return;
    case 'inbox':
      await handleInbox(rest);
      return;
    case 'task':
      await handleTaskCommand(rest);
      return;
    case 'feedback':
      await handleFeedbackCommand(rest);
      return;
    case 'pdf':
      await handlePdfCommand(rest);
      return;
    case 'submission':
      await handleSubmissionCommand(rest);
      return;
    case 'watch':
      await handleWatch(rest);
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

main().catch((error) => {
  const redacted = toRedactedError(error);
  console.error(`Error: ${redacted.message}`);
  process.exitCode = 1;
});
