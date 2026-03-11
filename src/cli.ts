#!/usr/bin/env node

import { clearSession, loadSession, saveSession } from './lib/session.js';
import { OnTrackApiClient } from './lib/api.js';
import {
  buildPdfFilename,
  diffWatchStates,
  filterTasksByStatus,
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
  printJson,
  printTable,
  prompt,
  resolveTaskSelector,
  toWatchStateMap,
  writePdfFile,
} from './lib/utils.js';
import type {
  FeedbackItem,
  InboxTask,
  ProjectSummary,
  SessionData,
  TaskSummary,
} from './lib/types.js';
import type { WatchTaskState } from './lib/utils.js';

function help(): void {
  console.log(`ontrack

Usage:
  ontrack auth-method [--base-url URL] [--json]
  ontrack login [--base-url URL] [--redirect-url URL]
  ontrack login [--base-url URL] --auth-token TOKEN --username USERNAME
  ontrack logout
  ontrack whoami [--json]
  ontrack projects [--json]
  ontrack units [--json]
  ontrack tasks [--project-id ID] [--status STATUS] [--json]
  ontrack inbox [--unit-id ID] [--status STATUS] [--json]
  ontrack task show --project-id ID (--task-id ID | --abbr ABBR) [--json]
  ontrack feedback list --project-id ID (--task-id ID | --abbr ABBR) [--json]
  ontrack pdf task --project-id ID (--task-id ID | --abbr ABBR) [--out-dir PATH]
  ontrack pdf submission --project-id ID (--task-id ID | --abbr ABBR) [--out-dir PATH]
  ontrack watch [--unit-id ID] [--project-id ID] [--interval SEC] [--json]

Notes:
  - Default base URL is https://ontrack.infotech.monash.edu/api
  - This site currently reports SAML SSO, so the login flow opens your browser and asks for the final redirected URL.
  - PDF commands save files into ./downloads by default.
`);
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
  if (!isStaffLikeRole(session.user.role) || hasScopeFilter) {
    return;
  }

  console.log(
    `[hint] Role "${session.user.role}" running ${command} without scope filters can be expensive. Consider --unit-id and/or --project-id.`,
  );
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

  let authToken = getFlagValue(args, '--auth-token');
  let username = getFlagValue(args, '--username');

  const redirectUrl = getFlagValue(args, '--redirect-url');
  if (redirectUrl) {
    ({ authToken, username } = parseSsoRedirectUrl(redirectUrl));
  }

  if (!authToken || !username) {
    const method = await api.getAuthMethod();

    if (method.redirect_to) {
      console.log(`OnTrack uses ${method.method || 'SSO'} for authentication.`);
      console.log('Complete login in your browser, then paste the final redirected URL from the address bar.');
      console.log('Expected format: https://ontrack.infotech.monash.edu/sign_in?authToken=...&username=...');

      if (!hasFlag(args, '--no-open')) {
        const opened = openExternal(method.redirect_to);
        if (!opened) {
          console.log(`Open this URL manually:\n${method.redirect_to}`);
        }
      } else {
        console.log(`Open this URL manually:\n${method.redirect_to}`);
      }

      const pasted = await prompt('Paste final redirect URL: ');
      ({ authToken, username } = parseSsoRedirectUrl(pasted));
    } else {
      throw new Error('This server does not advertise SSO, and interactive username/password login is not implemented in this CLI yet.');
    }
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
  console.log(`Signed in as ${session.user.firstName || ''} ${session.user.lastName || ''}`.trim() || session.username);
  console.log(`Session saved to ${session.baseUrl}`);
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
      role: session.user.role ?? '-',
      firstName: session.user.firstName ?? '-',
      lastName: session.user.lastName ?? '-',
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
      tasks: project.tasks?.length ?? 0,
    })),
  );
}

async function handleUnits(args: string[]): Promise<void> {
  const session = requireSession(await loadSession());
  const api = new OnTrackApiClient(session.baseUrl);
  const units = await api.listUnits(session);

  if (hasFlag(args, '--json')) {
    printJson(units);
    return;
  }

  printTable(
    units.map((unit) => ({
      id: unit.id,
      code: unit.code ?? '-',
      name: unit.name ?? '-',
      role: unit.myRole ?? '-',
      active: unit.active ?? '-',
    })),
  );
}

async function handleTasks(args: string[]): Promise<void> {
  const session = requireSession(await loadSession());
  const api = new OnTrackApiClient(session.baseUrl);
  const projects = await api.listProjects(session);

  let tasks = flattenTasks(projects);
  const projectId = getFlagValue(args, '--project-id');
  const status = getFlagValue(args, '--status');

  if (projectId) {
    tasks = tasks.filter((task) => String(task.projectId) === projectId);
  }

  if (status) {
    tasks = filterTasksByStatus(tasks, status);
  }

  if (hasFlag(args, '--json')) {
    printJson(tasks);
    return;
  }

  printTable(
    tasks.map((task) => ({
      id: task.id,
      projectId: task.projectId,
      unitCode: task.unitCode ?? '-',
      abbr: getTaskAbbreviation(task) ?? '-',
      name: getTaskName(task) ?? '-',
      status: getTaskStatus(task) ?? '-',
      grade: task.grade ?? '-',
      due: formatDate(getTaskDueDate(task)),
      completed: formatDate(getTaskCompletionDate(task)),
    })),
  );
}

async function handleInbox(args: string[]): Promise<void> {
  const session = requireSession(await loadSession());
  const api = new OnTrackApiClient(session.baseUrl);
  const status = getFlagValue(args, '--status');
  const unitId = parseOptionalInteger(args, '--unit-id');
  roleScopeHint(session, 'inbox', unitId !== undefined);

  const units = await api.listUnits(session);
  const unitMap = new Map(units.map((unit) => [unit.id, unit]));

  if (unitId !== undefined && !unitMap.has(unitId)) {
    throw new Error(`Unit ${unitId} was not found in your account.`);
  }

  const targetUnitIds = unitId !== undefined ? [unitId] : units.map((unit) => unit.id);
  const allTasks = (
    await Promise.all(
      targetUnitIds.map(async (id) => {
        const inbox = await api.listInboxTasks(session, id);
        return inbox.map((task) => ({
          ...task,
          _unitId: id,
        }));
      }),
    )
  ).flat();

  const filtered = filterTasksByStatus(allTasks, status);
  if (hasFlag(args, '--json')) {
    printJson(filtered);
    return;
  }

  printTable(
    filtered.map((task) => ({
      id: task.id,
      projectId: extractInboxProjectId(task) ?? '-',
      unitId: task._unitId,
      unitCode: unitMap.get(task._unitId)?.code ?? '-',
      abbr: getTaskAbbreviation(task) ?? '-',
      name: getTaskName(task) ?? '-',
      status: getTaskStatus(task) ?? '-',
      due: formatDate(getTaskDueDate(task)),
    })),
  );
}

async function handleTaskShow(args: string[]): Promise<void> {
  const session = requireSession(await loadSession());
  const api = new OnTrackApiClient(session.baseUrl);
  const selector = parseTaskSelectorArgs(args);
  const projects = await api.listProjects(session);
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
      projectId: payload.projectId,
      unitCode: payload.unitCode ?? '-',
      taskId: payload.taskId,
      taskDefId: payload.taskDefId,
      abbr: payload.abbr,
      name: payload.name ?? '-',
      status: payload.status ?? '-',
      due: formatDate(payload.dueDate),
      completed: formatDate(payload.completionDate),
      grade: payload.grade ?? '-',
      qualityPts: payload.qualityPts ?? '-',
    },
  ]);
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

async function handleFeedbackList(args: string[]): Promise<void> {
  const session = requireSession(await loadSession());
  const api = new OnTrackApiClient(session.baseUrl);
  const selector = parseTaskSelectorArgs(args);
  const projects = await api.listProjects(session);
  const resolved = resolveTaskSelector(projects, selector);
  const comments = await api.listTaskComments(session, resolved.project.id, resolved.taskDefId);

  if (hasFlag(args, '--json')) {
    printJson(comments);
    return;
  }

  printTable(
    comments.map((comment) => {
      const text = getFeedbackText(comment);
      const preview = text.length > 120 ? `${text.slice(0, 117)}...` : text || '-';
      return {
        id: comment.id,
        type: comment.type ?? '-',
        author: feedbackAuthor(comment),
        createdAt: formatDate(getFeedbackTimestamp(comment)),
        isNew: comment.isNew ?? comment.is_new ?? '-',
        preview,
      };
    }),
  );
}

async function handlePdfDownload(args: string[], type: 'task' | 'submission'): Promise<void> {
  const session = requireSession(await loadSession());
  const api = new OnTrackApiClient(session.baseUrl);
  const selector = parseTaskSelectorArgs(args);
  const projects = await api.listProjects(session);
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
  const projects = filterProjectsForWatch(await api.listProjects(session), projectId, unitId);
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
        projectId: task.projectId,
        unitCode: task.unitCode ?? '-',
        abbr: task.abbr ?? '-',
        status: task.status ?? '-',
        due: formatDate(task.dueDate),
        comments: task.commentCount,
        lastCommentAt: task.lastCommentAt ? formatDate(task.lastCommentAt) : '-',
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

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const rest = args.slice(1);

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    help();
    return;
  }

  switch (command) {
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
    case 'units':
      await handleUnits(rest);
      return;
    case 'tasks':
      await handleTasks(rest);
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
    case 'watch':
      await handleWatch(rest);
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

main().catch((error) => {
  console.error(`Error: ${(error as Error).message}`);
  process.exitCode = 1;
});
