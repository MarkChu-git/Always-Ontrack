/**
 * TUI auth actions: the production implementations behind the login wizard
 * and the logout command. Both are thin compositions of src/lib primitives —
 * the wizard driver wraps `captureSsoCredentialsWithGuidedLogin` and persists
 * through `finalizeCapturedLogin` (the same path as `ontrack login`), while
 * logout mirrors `ontrack logout` (remote sign-out never blocks local cleanup).
 *
 * Everything here is injectable into the App for headless smoke tests; nothing
 * in this module runs at import time.
 */
import { OnTrackApiClient } from '../lib/api';
import {
  SsoFallbackError,
  captureSsoCredentialsWithGuidedLogin,
  classifySsoFallback,
  clearAllBrowserSessionState,
  type MfaMethodOption,
  type SsoFallbackReason,
  type SsoStep,
} from '../lib/auto-login';
import { finalizeCapturedLogin } from '../lib/login-finalize';
import { createAuthenticatedApi } from '../lib/project-catalogue';
import { clearSession, loadSession } from '../lib/session';
import { normalizeBaseUrl, redactSensitiveText } from '../lib/utils';

/** UI-facing callbacks the guided SSO flow needs while it runs. */
export interface GuidedLoginHooks {
  onStep(step: SsoStep): void;
  chooseMfaMethod(options: MfaMethodOption[]): Promise<number | null>;
  requestMfaCode(methodLabel: string): Promise<string | null>;
  onMfaNumberChallenge(numbers: string[]): void;
}

/** Classified, redacted failure shape the wizard renders. */
export interface GuidedLoginFailure {
  reason: SsoFallbackReason;
  step?: SsoStep;
  message: string;
}

export function isGuidedLoginFailure(error: unknown): error is GuidedLoginFailure {
  return (
    typeof error === 'object' &&
    error !== null &&
    'reason' in error &&
    'message' in error
  );
}

/**
 * Drives one guided login attempt. Resolves with the signed-in username once
 * the session is persisted; rejects with a GuidedLoginFailure otherwise.
 */
export type GuidedLoginRunner = (
  credentials: { username: string; password: string },
  hooks: GuidedLoginHooks,
) => Promise<string>;

/** Production runner: hidden-browser guided SSO, identical semantics to the CLI. */
export const runGuidedSsoLogin: GuidedLoginRunner = async (credentials, hooks) => {
  const api = new OnTrackApiClient(normalizeBaseUrl());
  try {
    const method = await api.getAuthMethod();
    const redirectTo =
      typeof method.redirect_to === 'string' && method.redirect_to.trim()
        ? method.redirect_to
        : null;
    if (!redirectTo) {
      throw new Error(
        'This server does not advertise SSO. Use `ontrack login` with manual credentials instead.',
      );
    }
    const captured = await captureSsoCredentialsWithGuidedLogin(
      {
        ssoUrl: redirectTo,
        apiBaseUrl: api.base,
        username: credentials.username,
        password: credentials.password,
        // Same product default as the CLI: hidden browser everywhere.
        headless: true,
        chooseMfaMethod: hooks.chooseMfaMethod,
        requestMfaCode: hooks.requestMfaCode,
        onMfaNumberChallenge: hooks.onMfaNumberChallenge,
      },
      hooks.onStep,
    );
    const session = await finalizeCapturedLogin(api, {
      authToken: captured.authToken,
      username: captured.username,
      expiresAt: captured.expiresAt,
      contract: captured.contract,
      refreshCookie: captured.refreshCookie,
      source: captured.contract === 'access-token' ? 'access-token' : 'browser-sso',
    });
    return session.username;
  } catch (error) {
    const failure: GuidedLoginFailure = {
      reason: classifySsoFallback(error),
      step: error instanceof SsoFallbackError ? error.step : undefined,
      message: redactSensitiveText(
        error instanceof Error ? error.message : String(error),
      ),
    };
    throw failure;
  }
};

/** Clear remote/local auth state exactly like `ontrack logout`. */
export async function logoutOnTrack(): Promise<void> {
  const session = await loadSession();
  if (session) {
    try {
      await createAuthenticatedApi(session).signOut(session);
    } catch {
      // Remote sign-out failure never blocks local cleanup (same as the CLI).
    }
  }
  await Promise.all([
    clearSession(),
    Promise.resolve().then(() => clearAllBrowserSessionState()),
  ]);
}

/** Injectable auth surface for the App; production default below. */
export interface TuiAuthActions {
  login: GuidedLoginRunner;
  logout: () => Promise<void>;
}

export const DEFAULT_TUI_AUTH: TuiAuthActions = {
  login: runGuidedSsoLogin,
  logout: logoutOnTrack,
};
