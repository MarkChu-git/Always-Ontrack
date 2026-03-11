#!/usr/bin/env node

import { clearSession, loadSession, saveSession } from './lib/session.js';
import { OnTrackApiClient } from './lib/api.js';
import { captureSsoCredentials } from './lib/auto-login.js';
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
  TaskDefinitionSummary,
  TaskSummary,
  UnitSummary,
} from './lib/types.js';
import type { WatchTaskState } from './lib/utils.js';

type InboxRowTask = InboxTask & { _unitId: number };

function help(): void {
  console.log(`ontrack

Usage:
  ontrack auth-method [--base-url URL] [--json]
  ontrack login [--base-url URL] [--redirect-url URL]
  ontrack login [--base-url URL] --auth-token TOKEN --username USERNAME
  ontrack login [--base-url URL] --auto [--auto-timeout-sec N]
  ontrack logout
  ontrack whoami [--json]
  ontrack projects [--json]
  ontrack units [--json]
  ontrack tasks [--project-id ID] [--status STATUS] [--json]
  ontrack doctor [--json]
  ontrack inbox [--unit-id ID] [--status STATUS] [--json]
  ontrack task show --project-id ID (--task-id ID | --abbr ABBR) [--json]
  ontrack feedback list --project-id ID (--task-id ID | --abbr ABBR) [--json]
  ontrack pdf task --project-id ID (--task-id ID | --abbr ABBR) [--out-dir PATH]
  ontrack pdf submission --project-id ID (--task-id ID | --abbr ABBR) [--out-dir PATH]
  ontrack watch [--unit-id ID] [--project-id ID] [--interval SEC] [--json]

Notes:
  - Default base URL is https://ontrack.infotech.monash.edu/api
  - This site currently reports SAML SSO.
  - Use "ontrack login --auto" for automatic credential capture, or "ontrack login" for manual redirect URL paste.
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
  const auto = hasFlag(args, '--auto');
  const autoTimeoutSec = hasFlag(args, '--auto-timeout-sec')
    ? parseIntegerFlagValue(getFlagValue(args, '--auto-timeout-sec'), '--auto-timeout-sec')
    : 300;
  if (autoTimeoutSec < 10) {
    throw new Error('--auto-timeout-sec must be >= 10 seconds.');
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
      console.log(`OnTrack uses ${method.method || 'SSO'} for authentication.`);
      console.log('Expected final redirect format: https://ontrack.infotech.monash.edu/sign_in?authToken=...&username=...');

      if (auto) {
        console.log('Starting auto SSO login in a controlled browser...');
        const captured = await captureSsoCredentials({
          ssoUrl: method.redirect_to,
          apiBaseUrl: api.base,
          timeoutMs: autoTimeoutSec * 1000,
        });
        authToken = captured.authToken;
        username = captured.username;
        console.log(`Auto login captured credentials from ${captured.source}.`);
      } else {
        console.log('Complete login in your browser, then paste the final redirected URL from the address bar.');
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
      }
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
  const fullName = `${session.user.firstName || session.user.first_name || ''} ${session.user.lastName || session.user.last_name || ''}`.trim();
  console.log(`Signed in as ${fullName || session.username}`);
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
      id: task.id,
      projectId: extractInboxProjectId(task) ?? '-',
      unitId: task._unitId,
      unitCode: unitMap.get(task._unitId)?.code ?? (task as { unitCode?: string }).unitCode ?? '-',
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
  const projects = await loadProjectsWithTaskMetadata(api, session, {
    projectId: selector.projectId,
  });
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
    case 'doctor':
      await handleDoctor(rest);
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
