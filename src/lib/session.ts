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

/** Stable machine code for a healthy refresh lock that was not acquired in time. */
export const AUTH_REFRESH_LOCK_TIMEOUT = 'AUTH_REFRESH_LOCK_TIMEOUT';

class SessionRefreshLockTimeoutError extends Error {
  readonly code = AUTH_REFRESH_LOCK_TIMEOUT;

  constructor() {
    super('Timed out acquiring session refresh lock.');
    this.name = 'SessionRefreshLockTimeoutError';
  }
}

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
    // Session paths are trusted local operator configuration, not Agent input.
    // codeql[js/path-injection]
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
    // codeql[js/path-injection]
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
    // Both paths are nonce-suffixed children of the same private session directory.
    // codeql[js/path-injection]
    await rename(lockPath, stalePath);
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) {
      return;
    }
    throw error;
  }
  // codeql[js/path-injection]
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

  // The lock directory is derived from the trusted local session location.
  // codeql[js/path-injection]
  await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 });
  // codeql[js/path-injection]
  await chmod(dirname(lockPath), 0o700);
  while (true) {
    try {
      // codeql[js/path-injection]
      await mkdir(lockPath, { mode: 0o700 });
      try {
        // owner.json is a fixed child of the newly-created private lock directory.
        // codeql[js/path-injection]
        await writeFile(join(lockPath, 'owner.json'), JSON.stringify(owner), {
          encoding: 'utf8',
          mode: 0o600,
          flag: 'wx',
        });
      } catch (error) {
        // Only the lock directory created by this invocation is removed.
        // codeql[js/path-injection]
        await rm(lockPath, { recursive: true, force: true });
        throw error;
      }

      const isCurrentOwner = async (): Promise<boolean> => {
        try {
          // owner.json is fixed and its nonce must match before renew/release.
          // codeql[js/path-injection]
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
            // Renewal touches only a nonce-verified lock directory.
            // codeql[js/path-injection]
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
          // Release removes only a nonce-verified lock directory.
          // codeql[js/path-injection]
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
      throw new SessionRefreshLockTimeoutError();
    }
    await wait(pollIntervalMs);
  }
}

/** Best-effort session load. Returns null when file is missing/corrupt. */
export async function loadSession(options: SessionPathOptions = {}): Promise<SessionData | null> {
  try {
    // The session path is trusted local operator configuration.
    // codeql[js/path-injection]
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
  // Session paths are trusted local operator configuration.
  // codeql[js/path-injection]
  await mkdir(dirname(sessionPath), { recursive: true, mode: 0o700 });
  // codeql[js/path-injection]
  await chmod(dirname(sessionPath), 0o700);
  try {
    // Temporary names use a random nonce in the same private directory.
    // codeql[js/path-injection]
    await writeFile(temporaryPath, JSON.stringify(session, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    // codeql[js/path-injection]
    await chmod(temporaryPath, 0o600);
    // Both paths are inside the same private session directory.
    // codeql[js/path-injection]
    await rename(temporaryPath, sessionPath);
    // codeql[js/path-injection]
    await chmod(sessionPath, 0o600);
  } finally {
    // codeql[js/path-injection]
    await rm(temporaryPath, { force: true });
  }
}

/** Remove local session cache. Safe to call even when file does not exist. */
export async function clearSession(options: SessionPathOptions = {}): Promise<void> {
  // Removes only the trusted local session file; no remote or Agent input reaches this path.
  // codeql[js/path-injection]
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
