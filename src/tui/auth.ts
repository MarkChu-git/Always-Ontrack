/**
 * TUI auth actions: the production implementations behind the login wizard
 * and the logout command. Both are thin compositions of src/lib primitives —
 * the wizard driver pops a visible browser (or runs pairing on headless
 * environments) and persists through `finalizeCapturedLogin`, and logout
 * delegates to `signOutEverywhere`, the same orchestration `ontrack logout`
 * uses.
 *
 * No credentials are ever typed into the TUI: locally the user signs in
 * through the real SSO pages in an opened browser window, and on headless
 * environments the pairing-relay flow carries the credential end-to-end
 * encrypted. Deliberate differences from the CLI login command: the CLI's
 * stored-browser-session fast path and manual paste fallback stay CLI-only
 * for now, and the browser/pairing timeouts are fixed instead of
 * flag-configurable.
 *
 * Everything here is injectable into the App for headless smoke tests; nothing
 * in this module runs at import time.
 */
import { OnTrackApiClient } from '../lib/api';
import type { AuthDiagnostic, AuthDiagnosticSink } from '../lib/auth-diagnostic';
import {
  SsoFallbackError,
  captureSsoCredentials,
  classifySsoFallback,
  type SsoFallbackReason,
} from '../lib/auto-login';
import { ssoRedirectUrl } from '../lib/auth';
import { finalizeCapturedLogin } from '../lib/login-finalize';
import {
  pairForCredentials,
  PairLoginTimeoutError,
  resolveRelayUrl,
} from '../lib/pair-login';
import { signOutEverywhere, type SignOutResult } from '../lib/sign-out';
import {
  isHeadlessServerEnvironment,
  normalizeBaseUrl,
  redactSensitiveText,
} from '../lib/utils';

/** Browser capture / pairing wait budget (fixed; the CLI's are flag-based). */
const TUI_LOGIN_TIMEOUT_MS = 300_000;

/** Pairing session details the wizard renders while it waits. */
export interface PairingSessionInfo {
  pairingUrl: string;
  displayCode: string;
}

/** UI-facing callbacks the login flow needs while it runs. */
export interface LoginHooks {
  onPairingSession?(info: PairingSessionInfo): void;
  onDiagnostic?(diagnostic: AuthDiagnostic): void;
}

/** Classified, redacted failure shape the wizard renders. */
export interface LoginFailure {
  reason: SsoFallbackReason;
  step?: string;
  message: string;
}

export function isLoginFailure(error: unknown): error is LoginFailure {
  return (
    typeof error === 'object' &&
    error !== null &&
    'reason' in error &&
    'message' in error
  );
}

/**
 * Drives one login attempt. Resolves with the signed-in username once the
 * session is persisted; rejects with a LoginFailure otherwise.
 */
export type LoginRunner = (hooks: LoginHooks) => Promise<string>;

/**
 * Production runner: pairing first on every environment (it reuses any
 * existing OnTrack session in the user's own browser, so there is no
 * controlled browser to crash and no stale-profile auth loop). A visible
 * controlled browser window is only the fallback when pairing is disabled
 * (empty relay URL).
 */
export const runPairingLogin: LoginRunner = async (hooks) => {
  const api = new OnTrackApiClient(normalizeBaseUrl());
  try {
    const redirectTo = ssoRedirectUrl(await api.getAuthMethod());
    if (!redirectTo) {
      throw new Error(
        'This server does not advertise SSO. Use `ontrack login` with manual credentials instead.',
      );
    }

    const relayUrl = resolveRelayUrl(undefined);
    if (relayUrl) {
      const material = await pairForCredentials({
        relayUrl,
        timeoutMs: TUI_LOGIN_TIMEOUT_MS,
        onPairingSession: (pairing) => {
          hooks.onPairingSession?.({
            pairingUrl: pairing.pairingUrl,
            displayCode: pairing.displayCode,
          });
        },
      });
      const session = await finalizeCapturedLogin(
        api,
        material,
        (diagnostic) => hooks.onDiagnostic?.(diagnostic),
      );
      return session.username;
    }

    const captured = await captureSsoCredentials({
      ssoUrl: redirectTo,
      apiBaseUrl: api.base,
      timeoutMs: TUI_LOGIN_TIMEOUT_MS,
      headless: isHeadlessServerEnvironment(),
    });
    const session = await finalizeCapturedLogin(
      api,
      {
        authToken: captured.authToken,
        username: captured.username,
        expiresAt: captured.expiresAt,
        contract: captured.contract,
        refreshCookie: captured.refreshCookie,
        source: captured.contract === 'access-token' ? 'access-token' : 'browser-sso',
      },
      (diagnostic) => hooks.onDiagnostic?.(diagnostic),
    );
    return session.username;
  } catch (error) {
    const failure: LoginFailure = {
      reason:
        error instanceof PairLoginTimeoutError
          ? 'timeout'
          : classifySsoFallback(error),
      step: error instanceof SsoFallbackError ? error.step : undefined,
      message: redactSensitiveText(
        error instanceof Error ? error.message : String(error),
      ),
    };
    throw failure;
  }
};

/** Sign out through the same shared orchestration as `ontrack logout`. */
export async function logoutOnTrack(
  reportDiagnostic?: AuthDiagnosticSink,
): Promise<SignOutResult> {
  return signOutEverywhere(reportDiagnostic);
}

/** Injectable auth surface for the App; production default below. */
export interface TuiAuthActions {
  login: LoginRunner;
  logout: (reportDiagnostic?: AuthDiagnosticSink) => Promise<SignOutResult>;
}

export const DEFAULT_TUI_AUTH: TuiAuthActions = {
  login: runPairingLogin,
  logout: logoutOnTrack,
};
