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
  persistRefreshCookie,
  readStoredRefreshCookie,
  type AutoLoginOptions,
  type LoginCredentials,
} from './auto-login.js';
import { OnTrackApiClient } from './api.js';
import type { CapturedSignIn } from './api.js';
import {
  loadSession,
  saveSession,
  withSessionRefreshLock,
} from './session.js';
import { normalizeBaseUrl } from './utils.js';
import type {
  AuthMethodResponse,
  RefreshCookieMaterial,
  SessionData,
} from './types.js';
import {
  persistRefreshCookieBestEffort,
  reportAuthDiagnosticToStderr,
  type AuthDiagnosticSink,
} from './auth-diagnostic.js';

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
  ): Promise<CapturedSignIn>;
  readStoredRefreshCookie(baseUrl: string): RefreshCookieMaterial | null;
  httpRefreshAccessToken(
    baseUrl: string,
    cookie: RefreshCookieMaterial,
  ): Promise<CapturedSignIn | null>;
  persistRefreshCookie(cookie: RefreshCookieMaterial, baseUrl: string): void;
  reportDiagnostic: AuthDiagnosticSink;
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
      new OnTrackApiClient(baseUrl).signInWithCookieCapture({
        auth_token: captured.authToken,
        username: captured.username,
        remember: true,
      }),
    readStoredRefreshCookie: (baseUrl) =>
      readStoredRefreshCookie({ targetOrigin: new URL(baseUrl).origin }),
    httpRefreshAccessToken: (baseUrl, cookie) =>
      new OnTrackApiClient(baseUrl).refreshAccessTokenWithCookieCapture(cookie),
    persistRefreshCookie: (cookie, baseUrl) =>
      persistRefreshCookie(cookie, { targetOrigin: new URL(baseUrl).origin }),
    reportDiagnostic: reportAuthDiagnosticToStderr,
    now: () => new Date(),
  };
}

function persistCapturedRefreshCookie(
  dependencies: OnTrackAuthBrokerDependencies,
  cookie: RefreshCookieMaterial | null,
  baseUrl: string,
): void {
  if (!cookie) return;
  persistRefreshCookieBestEffort(
    () => dependencies.persistRefreshCookie(cookie, baseUrl),
    dependencies.reportDiagnostic,
  );
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
    // This path never re-exchanges over HTTP, so persist the refresh cookie
    // observed in the browser context explicitly.
    persistCapturedRefreshCookie(dependencies, captured.refreshCookie ?? null, baseUrl);
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

  const exchange = await dependencies.exchangeLegacyCredential(baseUrl, captured);
  persistCapturedRefreshCookie(dependencies, exchange.refreshCookie, baseUrl);
  const response = exchange.response;
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

async function sessionFromHttpRefresh(
  baseUrl: string,
  cookie: RefreshCookieMaterial,
  dependencies: OnTrackAuthBrokerDependencies,
): Promise<SessionData | null> {
  try {
    const renewed = await dependencies.httpRefreshAccessToken(baseUrl, cookie);
    const token = renewed?.response;
    if (!token?.auth_token || !token.auth_token_expiry) return null;
    persistCapturedRefreshCookie(dependencies, renewed?.refreshCookie ?? null, baseUrl);
    return createSessionFromAccessToken(
      baseUrl,
      token.user?.username ?? cookie.username,
      {
        auth_token: token.auth_token,
        auth_token_expiry: token.auth_token_expiry,
        user: token.user ?? { username: cookie.username },
      },
      dependencies.now().toISOString(),
    );
  } catch {
    return null;
  }
}

interface AuthBrokerContext {
  readonly dependencies: OnTrackAuthBrokerDependencies;
  readonly options: OnTrackAuthBrokerOptions;
  readonly targetBaseUrl: string;
}

async function loadScopedSession(context: AuthBrokerContext): Promise<SessionData | null> {
  const session = await context.dependencies.loadSession();
  if (!session) return null;
  try {
    return normalizeBaseUrl(session.baseUrl) === context.targetBaseUrl ? session : null;
  } catch {
    return null;
  }
}

async function captureSession(
  context: AuthBrokerContext,
  interactive: boolean,
): Promise<SessionData | null> {
  const { dependencies, options, targetBaseUrl } = context;
  let method: AuthMethodResponse;
  try {
    method = await dependencies.getAuthMethod(targetBaseUrl);
  } catch {
    return null;
  }
  if (!method.redirect_to) return null;
  const captureOptions: AutoLoginOptions = {
    ssoUrl: method.redirect_to,
    apiBaseUrl: targetBaseUrl,
    timeoutMs: interactive
      ? (options.interactiveTimeoutMs ?? 5 * 60 * 1000)
      : (options.silentTimeoutMs ?? 12_000),
    headless: !interactive,
  };
  try {
    const captured = interactive
      ? await dependencies.captureInteractiveSession(captureOptions)
      : await dependencies.captureStoredSession(captureOptions);
    return captured
      ? await sessionFromCapture(targetBaseUrl, captured, dependencies)
      : null;
  } catch {
    return null;
  }
}

async function refreshSession(
  context: AuthBrokerContext,
  interactive: boolean,
): Promise<SessionData | null> {
  const { dependencies, targetBaseUrl } = context;
  if (!interactive) {
    const cookie = dependencies.readStoredRefreshCookie(targetBaseUrl);
    if (cookie) {
      const renewed = await sessionFromHttpRefresh(targetBaseUrl, cookie, dependencies);
      if (renewed) return renewed;
    }
  }
  return captureSession(context, interactive);
}

async function brokerStatus(context: AuthBrokerContext): Promise<AuthStatusView> {
  const session = await loadScopedSession(context);
  if (!session) return { status: 'signed_out', baseUrl: context.targetBaseUrl };
  const usability = sessionUsability(session, context.dependencies.now());
  return {
    status: usability.state,
    source: session.source,
    ...(usability.state === 'usable' || usability.state === 'expired'
      ? usability.expiresAt
        ? { expiresAt: usability.expiresAt }
        : {}
      : {}),
    baseUrl: context.targetBaseUrl,
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
  const context: AuthBrokerContext = {
    dependencies: { ...defaultDependencies(), ...overrides },
    options: { ...options },
    targetBaseUrl: normalizeBaseUrl(options.baseUrl),
  };
  const runtime: AuthRuntime = createAuthRuntime({
    loadSession: () => loadScopedSession(context),
    saveSession: context.dependencies.saveSession,
    withRefreshLock: context.dependencies.withRefreshLock,
    silentRefresh: () => refreshSession(context, false),
    beginInteractiveLogin: () => refreshSession(context, true),
    now: context.dependencies.now,
  });
  return {
    ensure: (ensureOptions) => runtime.ensure(ensureOptions),
    currentSession: () => loadScopedSession(context),
    status: () => brokerStatus(context),
  };
}
