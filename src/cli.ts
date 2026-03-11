#!/usr/bin/env node

import { clearSession, loadSession, saveSession } from './lib/session.js';
import { OnTrackApiClient } from './lib/api.js';
import {
  formatDate,
  getFlagValue,
  hasFlag,
  normalizeBaseUrl,
  openExternal,
  parseSsoRedirectUrl,
  printJson,
  printTable,
  prompt,
} from './lib/utils.js';
import type { ProjectSummary, SessionData, TaskSummary } from './lib/types.js';

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

Notes:
  - Default base URL is https://ontrack.infotech.monash.edu/api
  - This site currently reports SAML SSO, so the login flow opens your browser and asks for the final redirected URL.
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
    unitCode?: string;
    unitName?: string;
  }
> {
  return projects.flatMap((project) =>
    (project.tasks || []).map((task) => ({
      ...task,
      projectId: project.id,
      unitCode: project.unit?.code,
      unitName: project.unit?.name,
    })),
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
    const normalized = status.toLowerCase();
    tasks = tasks.filter((task) => (task.status || '').toLowerCase() === normalized);
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
      abbr: task.definition?.abbreviation ?? '-',
      name: task.definition?.name ?? '-',
      status: task.status ?? '-',
      grade: task.grade ?? '-',
      due: formatDate(task.dueDate),
      completed: formatDate(task.completionDate),
    })),
  );
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
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

main().catch((error) => {
  console.error(`Error: ${(error as Error).message}`);
  process.exitCode = 1;
});

