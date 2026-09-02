/**
 * TUI auth actions: the production implementations behind the login wizard
 * and the logout command. Both are thin compositions of src/lib primitives —
 * the wizard asks this-machine vs pairing vs terminal, then persists through
 * `finalizeCapturedLogin`, and logout delegates to `signOutEverywhere`, the
 * same orchestration `ontrack logout` uses.
 *
 * Pairing reuses any existing OnTrack session in the user's own browser.
 * This-machine capture opens a visible window on a display (or a hidden one
 * on headless hosts) and can keep a refresh cookie. Terminal asks for
 * username and password in the wizard and fills Okta in a hidden browser;
 * MFA stays in the TUI. Deliberate differences from the CLI login command:
 * the CLI's stored-browser-session fast path and manual paste fallback stay
 * CLI-only for now, and the browser/pairing timeouts are fixed instead of
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
  captureSsoCredentialsWithGuidedLogin,
  classifySsoFallback,
  type MfaMethodOption,
  type SsoFallbackReason,
  type SsoStep,
} from '../lib/auto-login';
import { ssoRedirectUrl } from '../lib/auth';
import type { LoginMethod } from '../lib/login-method';
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

export type { LoginMethod, MfaMethodOption, SsoStep };

/** Browser capture / pairing wait budget (fixed; the CLI's are flag-based). */
const TUI_LOGIN_TIMEOUT_MS = 300_000;

/** Same default the CLI uses for `--sso-timeout-sec`. */
const TUI_SSO_TIMEOUT_MS = 420_000;

/** Pairing session details the wizard renders while it waits. */
export interface PairingSessionInfo {
  pairingUrl: string;
  displayCode: string;
}

/** One login attempt: pairing, this-machine capture, or terminal credentials. */
export type LoginRequest =
  | { method: 'pair' }
  | { method: 'browser' }
  | { method: 'terminal'; username: string; password: string };

/** UI-facing callbacks the login flow needs while it runs. */
export interface LoginHooks {
  onPairingSession?(info: PairingSessionInfo): void;
  onDiagnostic?(diagnostic: AuthDiagnostic): void;
  onStep?(step: SsoStep): void;
  chooseMfaMethod?(options: MfaMethodOption[]): Promise<number | null>;
  requestMfaCode?(methodLabel: string): Promise<string | null>;
  onMfaNumberChallenge?(numbers: string[]): void;
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
export type LoginRunner = (
  hooks: LoginHooks,
  request: LoginRequest,
) => Promise<string>;

/**
 * Production runner: pairing, this-machine capture, or terminal guided SSO.
 * Pairing reuses any existing OnTrack session in the user's own browser.
 * A visible controlled browser window is the this-machine path.
 * Terminal types credentials in the wizard and drives a hidden browser.
 */
export const runChosenLogin: LoginRunner = async (hooks, request) => {
  const api = new OnTrackApiClient(normalizeBaseUrl());
  try {
    const redirectTo = ssoRedirectUrl(await api.getAuthMethod());
    if (!redirectTo) {
      throw new Error(
        'This server does not advertise SSO. Use `ontrack login` with manual credentials instead.',
      );
    }

    const relayUrl = resolveRelayUrl(undefined);
    if (request.method === 'pair') {
      if (!relayUrl) {
        throw new Error(
          'Pairing is disabled because the relay URL is empty; choose this-machine or terminal sign-in, or configure ONTRACK_RELAY_URL.',
        );
      }
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

    if (request.method === 'browser') {
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
    }

    const captured = await captureSsoCredentialsWithGuidedLogin(
      {
        ssoUrl: redirectTo,
        apiBaseUrl: api.base,
        username: request.username,
        password: request.password,
        timeoutMs: TUI_SSO_TIMEOUT_MS,
        headless: true,
        chooseMfaMethod: hooks.chooseMfaMethod,
        requestMfaCode: hooks.requestMfaCode,
        onMfaNumberChallenge: hooks.onMfaNumberChallenge,
      },
      hooks.onStep,
    );
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
  /** When false, the wizard hides pairing and still offers this-machine + terminal. */
  pairingAvailable?: boolean;
}

export const DEFAULT_TUI_AUTH: TuiAuthActions = {
  login: runChosenLogin,
  logout: logoutOnTrack,
  pairingAvailable: Boolean(resolveRelayUrl(undefined)),
};
