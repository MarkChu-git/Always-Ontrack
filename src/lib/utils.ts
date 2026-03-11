import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { spawn } from 'node:child_process';

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

export function printTable(rows: Array<Record<string, unknown>>): void {
  if (rows.length === 0) {
    console.log('No results.');
    return;
  }

  console.table(rows);
}

