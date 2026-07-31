import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { SessionData } from './types.js';
import { migrateLegacySession } from './auth.js';

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

export interface SessionPathOptions {
  /** Override the default path for isolated adapters and tests. */
  sessionPath?: string;
}

export interface SessionRefreshLockOptions extends SessionPathOptions {
  /** Override the lock path when a caller owns multiple credential stores. */
  lockPath?: string;
  /** Maximum time to wait for another process's refresh operation. */
  timeoutMs?: number;
  /** A lock older than this lease is reclaimed after an owner crash. */
  staleMs?: number;
  /** Poll interval while another process owns a healthy lock. */
  pollIntervalMs?: number;
}

interface SessionLockOwner {
  readonly id: string;
  readonly createdAt: string;
}

const DEFAULT_LOCK_TIMEOUT_MS = 15_000;
const DEFAULT_LOCK_STALE_MS = 120_000;
const DEFAULT_LOCK_POLL_INTERVAL_MS = 50;

function resolveSessionPath(options: SessionPathOptions = {}): string {
  return options.sessionPath ?? getSessionPath();
}

function resolveSessionRefreshLockPath(options: SessionRefreshLockOptions = {}): string {
  return options.lockPath ?? `${resolveSessionPath(options)}.refresh.lock`;
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isNodeError(error: unknown, code: string): boolean {
  return Boolean(error) && typeof error === 'object' && (error as NodeJS.ErrnoException).code === code;
}

async function recoverStaleRefreshLock(lockPath: string, staleMs: number): Promise<void> {
  let observed: Awaited<ReturnType<typeof stat>>;
  try {
    observed = await stat(lockPath);
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) {
      return;
    }
    throw error;
  }

  if (Date.now() - observed.mtimeMs <= staleMs) {
    return;
  }

  // Re-read immediately before the atomic rename so a freshly renewed lock is
  // never deliberately reclaimed based on an old observation.
  let current: Awaited<ReturnType<typeof stat>>;
  try {
    current = await stat(lockPath);
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) {
      return;
    }
    throw error;
  }
  if (
    current.mtimeMs !== observed.mtimeMs ||
    current.ino !== observed.ino ||
    Date.now() - current.mtimeMs <= staleMs
  ) {
    return;
  }

  const stalePath = `${lockPath}.stale-${randomUUID()}`;
  try {
    await rename(lockPath, stalePath);
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) {
      return;
    }
    throw error;
  }
  await rm(stalePath, { recursive: true, force: true });
}

interface AcquiredSessionRefreshLock {
  readonly renew: () => Promise<void>;
  readonly release: () => Promise<void>;
  readonly heartbeatMs: number;
}

async function acquireSessionRefreshLock(
  options: SessionRefreshLockOptions,
): Promise<AcquiredSessionRefreshLock> {
  const lockPath = resolveSessionRefreshLockPath(options);
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const staleMs = options.staleMs ?? DEFAULT_LOCK_STALE_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_LOCK_POLL_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;
  const owner: SessionLockOwner = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  };

  await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 });
  await chmod(dirname(lockPath), 0o700);
  while (true) {
    try {
      await mkdir(lockPath, { mode: 0o700 });
      try {
        await writeFile(join(lockPath, 'owner.json'), JSON.stringify(owner), {
          encoding: 'utf8',
          mode: 0o600,
          flag: 'wx',
        });
      } catch (error) {
        await rm(lockPath, { recursive: true, force: true });
        throw error;
      }

      const isCurrentOwner = async (): Promise<boolean> => {
        try {
          const stored = JSON.parse(await readFile(join(lockPath, 'owner.json'), 'utf8')) as Partial<SessionLockOwner>;
          return stored.id === owner.id;
        } catch (error) {
          if (isNodeError(error, 'ENOENT')) {
            return false;
          }
          throw error;
        }
      };

      return {
        heartbeatMs: Math.max(1, Math.floor(staleMs / 3)),
        renew: async (): Promise<void> => {
          if (!(await isCurrentOwner())) {
            return;
          }
          const now = new Date();
          try {
            await utimes(lockPath, now, now);
          } catch (error) {
            if (!isNodeError(error, 'ENOENT')) {
              throw error;
            }
          }
        },
        release: async (): Promise<void> => {
          if (!(await isCurrentOwner())) {
            return;
          }
          await rm(lockPath, { recursive: true, force: true });
        },
      };
    } catch (error) {
      if (!isNodeError(error, 'EEXIST')) {
        throw error;
      }
    }

    await recoverStaleRefreshLock(lockPath, staleMs);
    if (Date.now() >= deadline) {
      throw new Error('Timed out acquiring session refresh lock.');
    }
    await wait(pollIntervalMs);
  }
}

/** Best-effort session load. Returns null when file is missing/corrupt. */
export async function loadSession(options: SessionPathOptions = {}): Promise<SessionData | null> {
  try {
    const contents = await readFile(resolveSessionPath(options), 'utf8');
    return migrateLegacySession(JSON.parse(contents) as SessionData);
  } catch {
    return null;
  }
}

/** Persist session with restrictive directory/file permissions where supported. */
export async function saveSession(session: SessionData, options: SessionPathOptions = {}): Promise<void> {
  const sessionPath = resolveSessionPath(options);
  const temporaryPath = join(
    dirname(sessionPath),
    `.${basename(sessionPath)}.tmp-${randomUUID()}`,
  );
  await mkdir(dirname(sessionPath), { recursive: true, mode: 0o700 });
  await chmod(dirname(sessionPath), 0o700);
  try {
    await writeFile(temporaryPath, JSON.stringify(session, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, sessionPath);
    await chmod(sessionPath, 0o600);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

/** Remove local session cache. Safe to call even when file does not exist. */
export async function clearSession(options: SessionPathOptions = {}): Promise<void> {
  await rm(resolveSessionPath(options), { force: true });
}

/**
 * Serialize refresh work across CLI processes using a private lock directory.
 * The lock is released even when the protected operation rejects.
 */
export async function withSessionRefreshLock<T>(
  operation: () => Promise<T>,
  options: SessionRefreshLockOptions = {},
): Promise<T> {
  const lock = await acquireSessionRefreshLock(options);
  const heartbeat = setInterval(() => {
    void lock.renew().catch(() => {
      // The protected operation remains authoritative. A failed best-effort
      // renewal is re-checked through owner identity during final release.
    });
  }, lock.heartbeatMs);
  heartbeat.unref();
  try {
    return await operation();
  } finally {
    clearInterval(heartbeat);
    await lock.release();
  }
}
