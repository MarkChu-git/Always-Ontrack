import {
  createAuthRuntime,
  type AuthEnsureOptions,
  type AuthRuntime,
  type AuthRuntimeResult,
} from './auth-runtime.js';
import { createSessionFromAccessToken, sessionUsability } from './auth.js';
import {
  captureCredentialsFromStoredBrowserSession,
  captureSsoCredentials,
  type AutoLoginOptions,
  type LoginCredentials,
} from './auto-login.js';
import { OnTrackApiClient } from './api.js';
import {
  loadSession,
  saveSession,
  withSessionRefreshLock,
} from './session.js';
import { normalizeBaseUrl } from './utils.js';
import type {
  AuthMethodResponse,
  SessionData,
  SignInResponse,
} from './types.js';

export interface OnTrackAuthBrokerOptions {
  readonly baseUrl: string;
  readonly silentTimeoutMs?: number;
  readonly interactiveTimeoutMs?: number;
}

export interface OnTrackAuthBrokerDependencies {
  loadSession(): Promise<SessionData | null>;
  saveSession(session: SessionData): Promise<void>;
  withRefreshLock<T>(operation: () => Promise<T>): Promise<T>;
  getAuthMethod(baseUrl: string): Promise<AuthMethodResponse>;
  captureStoredSession(options: AutoLoginOptions): Promise<LoginCredentials | null>;
  captureInteractiveSession(options: AutoLoginOptions): Promise<LoginCredentials>;
  exchangeLegacyCredential(
    baseUrl: string,
    captured: LoginCredentials,
  ): Promise<SignInResponse>;
  now(): Date;
}

export interface AuthStatusView {
  readonly status: 'signed_out' | 'usable' | 'expired' | 'unknown';
  readonly source?: SessionData['source'];
  readonly expiresAt?: string;
  readonly baseUrl: string;
}

export interface OnTrackAuthBroker {
  ensure(options?: AuthEnsureOptions): Promise<AuthRuntimeResult>;
  status(): Promise<AuthStatusView>;
  currentSession(): Promise<SessionData | null>;
}

function defaultDependencies(): OnTrackAuthBrokerDependencies {
  return {
    loadSession: () => loadSession(),
    saveSession: (session) => saveSession(session),
    withRefreshLock: (operation) => withSessionRefreshLock(operation),
    getAuthMethod: (baseUrl) => new OnTrackApiClient(baseUrl).getAuthMethod(),
    captureStoredSession: (options) =>
      captureCredentialsFromStoredBrowserSession(options),
    captureInteractiveSession: (options) => captureSsoCredentials(options),
    exchangeLegacyCredential: (baseUrl, captured) =>
      new OnTrackApiClient(baseUrl).signIn({
        auth_token: captured.authToken,
        username: captured.username,
        remember: true,
      }),
    now: () => new Date(),
  };
}

async function sessionFromCapture(
  baseUrl: string,
  captured: LoginCredentials,
  dependencies: OnTrackAuthBrokerDependencies,
): Promise<SessionData> {
  const savedAt = dependencies.now().toISOString();
  if (captured.contract === 'access-token') {
    if (!captured.expiresAt) {
      throw new Error('The access-token response did not include an expiry.');
    }
    return createSessionFromAccessToken(
      baseUrl,
      captured.username,
      {
        auth_token: captured.authToken,
        auth_token_expiry: captured.expiresAt,
        user: { username: captured.username },
      },
      savedAt,
    );
  }

  const response = await dependencies.exchangeLegacyCredential(baseUrl, captured);
  return {
    baseUrl,
    username: captured.username,
    authToken: response.auth_token,
    user: { ...response.user },
    savedAt,
    expiresAt:
      response.auth_token_expiry ??
      (response.auth_token === captured.authToken ? captured.expiresAt : undefined),
    source: 'browser-sso',
    refreshedAt: savedAt,
  };
}

/**
 * Create one credential coordinator shared by CLI and Auth MCP callers. Secret
 * material stays in injected adapters and SessionData, never in public results.
 */
export function createOnTrackAuthBroker(
  options: OnTrackAuthBrokerOptions,
  overrides: Partial<OnTrackAuthBrokerDependencies> = {},
): OnTrackAuthBroker {
  const dependencies = { ...defaultDependencies(), ...overrides };
  const targetBaseUrl = normalizeBaseUrl(options.baseUrl);
  const loadScopedSession = async (): Promise<SessionData | null> => {
    const session = await dependencies.loadSession();
    if (!session) {
      return null;
    }
    try {
      return normalizeBaseUrl(session.baseUrl) === targetBaseUrl ? session : null;
    } catch {
      return null;
    }
  };

  const refresh = async (interactive: boolean): Promise<SessionData | null> => {
    const current = await loadScopedSession();
    const baseUrl = targetBaseUrl;
    let method: AuthMethodResponse;
    try {
      method = await dependencies.getAuthMethod(baseUrl);
    } catch {
      return null;
    }
    if (!method.redirect_to) {
      return null;
    }

    const captureOptions: AutoLoginOptions = {
      ssoUrl: method.redirect_to,
      apiBaseUrl: baseUrl,
      timeoutMs: interactive
        ? (options.interactiveTimeoutMs ?? 5 * 60 * 1000)
        : (options.silentTimeoutMs ?? 12_000),
      headless: !interactive,
    };

    let captured: LoginCredentials | null;
    try {
      captured = interactive
        ? await dependencies.captureInteractiveSession(captureOptions)
        : await dependencies.captureStoredSession(captureOptions);
    } catch {
      return null;
    }
    if (!captured) {
      return null;
    }
    try {
      return await sessionFromCapture(baseUrl, captured, dependencies);
    } catch {
      return null;
    }
  };

  const runtime: AuthRuntime = createAuthRuntime({
    loadSession: loadScopedSession,
    saveSession: dependencies.saveSession,
    withRefreshLock: dependencies.withRefreshLock,
    silentRefresh: () => refresh(false),
    beginInteractiveLogin: () => refresh(true),
    now: dependencies.now,
  });

  return {
    ensure: (ensureOptions) => runtime.ensure(ensureOptions),
    currentSession: loadScopedSession,
    status: async (): Promise<AuthStatusView> => {
      const session = await loadScopedSession();
      if (!session) {
        return { status: 'signed_out', baseUrl: targetBaseUrl };
      }
      const usability = sessionUsability(session, dependencies.now());
      return {
        status: usability.state,
        source: session.source,
        ...(usability.state === 'usable' || usability.state === 'expired'
          ? usability.expiresAt
            ? { expiresAt: usability.expiresAt }
            : {}
          : {}),
        baseUrl: targetBaseUrl,
      };
    },
  };
}
