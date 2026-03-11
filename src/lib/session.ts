import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { SessionData } from './types.js';

/**
 * Resolve config root using platform conventions:
 * - XDG_CONFIG_HOME when explicitly provided
 * - APPDATA on Windows
 * - ~/.config as fallback
 */
function getConfigRoot(): string {
  if (process.env.XDG_CONFIG_HOME) {
    return process.env.XDG_CONFIG_HOME;
  }

  if (process.platform === 'win32' && process.env.APPDATA) {
    return process.env.APPDATA;
  }

  return join(homedir(), '.config');
}

/** Absolute path to the persisted session file used by the CLI. */
export function getSessionPath(): string {
  return join(getConfigRoot(), 'ontrack-cli', 'session.json');
}

/** Best-effort session load. Returns null when file is missing/corrupt. */
export async function loadSession(): Promise<SessionData | null> {
  try {
    const contents = await readFile(getSessionPath(), 'utf8');
    return JSON.parse(contents) as SessionData;
  } catch {
    return null;
  }
}

/** Persist session with restrictive directory/file permissions where supported. */
export async function saveSession(session: SessionData): Promise<void> {
  const sessionPath = getSessionPath();
  await mkdir(dirname(sessionPath), { recursive: true, mode: 0o700 });
  await writeFile(sessionPath, JSON.stringify(session, null, 2), 'utf8');
  await chmod(sessionPath, 0o600);
}

/** Remove local session cache. Safe to call even when file does not exist. */
export async function clearSession(): Promise<void> {
  await rm(getSessionPath(), { force: true });
}
