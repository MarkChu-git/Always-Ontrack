import { sessionUsability } from './auth.js';
import { AUTH_REFRESH_LOCK_TIMEOUT } from './session.js';
import type { SessionData } from './types.js';

export type AuthInteractionMode = 'never' | 'if_required';

export interface AuthEnsureOptions {
  /** Require this many seconds of remaining validity before returning cached credentials. */
  minTtlSeconds?: number;
  /** Whether the injected adapter may begin a human verification flow. */
  interaction?: AuthInteractionMode;
  /** Ignore a locally usable access token after the server has rejected it. */
  forceRefresh?: boolean;
}

export type AuthRuntimeResult =
  | {
      readonly status: 'ready';
      readonly expiresAt: string;
      readonly refreshed: boolean;
    }
  | {
      readonly status: 'auth_required';
      readonly code: 'HUMAN_VERIFICATION_REQUIRED';
      readonly retryable: true;
    }
  | {
      readonly status: 'error';
      readonly code: 'AUTH_REFRESH_FAILED' | 'INVALID_REFRESHED_SESSION';
      readonly retryable: boolean;
    };

/**
 * Boundary adapters keep browser credentials, persistence, and lock mechanics
 * out of the runtime's public result and out of callers' model contexts.
 */
export interface AuthRuntimeAdapter {
  loadSession(): Promise<SessionData | null>;
  saveSession(session: SessionData): Promise<void>;
  withRefreshLock<T>(operation: () => Promise<T>): Promise<T>;
  /** Return a fresh session from a trusted, persisted browser context, or null when human verification is needed. */
  silentRefresh(): Promise<SessionData | null>;
  /** Begin a local human verification flow only after silent refresh reports it is needed. */
  beginInteractiveLogin(): Promise<SessionData | null>;
  now?(): Date;
}

export interface AuthRuntime {
  ensure(options?: AuthEnsureOptions): Promise<AuthRuntimeResult>;
}

/** Default expiry margin for routine commands; callers may request a longer margin explicitly. */
export const DEFAULT_AUTH_MIN_TTL_SECONDS = 60;

function isFreshEnough(
  session: SessionData | null,
  minimumTtlSeconds: number,
  now: Date,
): session is SessionData & { expiresAt: string } {
  if (!session) {
    return false;
  }
  const usability = sessionUsability(session, now);
  if (usability.state !== 'usable') {
    return false;
  }
  const expiryMs = Date.parse(usability.expiresAt);
  return expiryMs > now.getTime() + minimumTtlSeconds * 1000;
}

function ready(session: SessionData, refreshed: boolean): AuthRuntimeResult {
  if (!session.expiresAt || !Number.isFinite(Date.parse(session.expiresAt))) {
    return {
      status: 'error',
      code: 'INVALID_REFRESHED_SESSION',
      retryable: false,
    };
  }
  return {
    status: 'ready',
    expiresAt: session.expiresAt,
    refreshed,
  };
}

function credentialVersionChanged(
  before: SessionData | null,
  after: SessionData | null,
): after is SessionData {
  if (!after) {
    return false;
  }
  if (!before) {
    return true;
  }
  return (
    before.authToken !== after.authToken ||
    before.expiresAt !== after.expiresAt ||
    before.refreshedAt !== after.refreshedAt
  );
}

function authRequired(): AuthRuntimeResult {
  return {
    status: 'auth_required',
    code: 'HUMAN_VERIFICATION_REQUIRED',
    retryable: true,
  };
}

function refreshFailure(): AuthRuntimeResult {
  return {
    status: 'error',
    code: 'AUTH_REFRESH_FAILED',
    retryable: true,
  };
}

function isRefreshLockTimeout(error: unknown): boolean {
  return (
    Boolean(error) &&
    typeof error === 'object' &&
    (error as { code?: unknown }).code === AUTH_REFRESH_LOCK_TIMEOUT
  );
}

function inFlightKey(
  minTtlSeconds: number,
  interaction: AuthInteractionMode,
  forceRefresh: boolean,
): string {
  return `${minTtlSeconds}:${interaction}:${forceRefresh}`;
}

/**
 * Create one process-local auth coordinator. Concurrent callers share exactly
 * one refresh/handoff operation; the injected file lock extends that guarantee
 * to other CLI processes.
 */
export function createAuthRuntime(adapter: AuthRuntimeAdapter): AuthRuntime {
  const inFlight = new Map<string, Promise<AuthRuntimeResult>>();

  const ensure = async (options: AuthEnsureOptions = {}): Promise<AuthRuntimeResult> => {
    const minTtlSeconds = options.minTtlSeconds ?? DEFAULT_AUTH_MIN_TTL_SECONDS;
    if (!Number.isFinite(minTtlSeconds) || minTtlSeconds < 0) {
      return {
        status: 'error',
        code: 'INVALID_REFRESHED_SESSION',
        retryable: false,
      };
    }
    const interaction = options.interaction ?? 'never';
    const forceRefresh = options.forceRefresh ?? false;
    const now = adapter.now ?? (() => new Date());
    const cached = await adapter.loadSession();
    if (!forceRefresh && isFreshEnough(cached, minTtlSeconds, now())) {
      return ready(cached, false);
    }

    const key = inFlightKey(minTtlSeconds, interaction, forceRefresh);
    const active = inFlight.get(key);
    if (active) {
      return active;
    }

    let pending: Promise<AuthRuntimeResult>;
    pending = adapter.withRefreshLock(async (): Promise<AuthRuntimeResult> => {
        // A different process could have refreshed while this process waited for the lock.
        const insideLock = await adapter.loadSession();
        if (
          isFreshEnough(insideLock, minTtlSeconds, now()) &&
          (!forceRefresh || credentialVersionChanged(cached, insideLock))
        ) {
          return ready(insideLock, false);
        }

        let refreshed: SessionData | null;
        try {
          refreshed = await adapter.silentRefresh();
        } catch {
          return refreshFailure();
        }

        if (!refreshed) {
          if (interaction === 'never') {
            return authRequired();
          }
          try {
            refreshed = await adapter.beginInteractiveLogin();
          } catch {
            return refreshFailure();
          }
          if (!refreshed) {
            return authRequired();
          }
        }

        if (!isFreshEnough(refreshed, minTtlSeconds, now())) {
          return {
            status: 'error',
            code: 'INVALID_REFRESHED_SESSION',
            retryable: false,
          };
        }

        try {
          await adapter.saveSession(refreshed);
        } catch {
          return refreshFailure();
        }
        return ready(refreshed, true);
      })
      .catch(async (error) => {
        if (!isRefreshLockTimeout(error)) {
          return refreshFailure();
        }
        try {
          const afterTimeout = await adapter.loadSession();
          if (isFreshEnough(afterTimeout, minTtlSeconds, now())) {
            return ready(afterTimeout, false);
          }
          return authRequired();
        } catch {
          return refreshFailure();
        }
      })
      .finally(() => {
        if (inFlight.get(key) === pending) {
          inFlight.delete(key);
        }
      });
    inFlight.set(key, pending);
    return pending;
  };

  return { ensure };
}
