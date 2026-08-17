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
import {
  SsoFallbackError,
  captureSsoCredentials,
  classifySsoFallback,
  type SsoFallbackReason,
} from '../lib/auto-login';
import { ssoRedirectUrl } from '../lib/auth';
import { finalizeCapturedLogin } from '../lib/login-finalize';
import {
  capturedMaterialFromPairPayload,
  generatePairingSession,
  PairLoginTimeoutError,
  resolveRelayUrl,
  waitForPairedCredentials,
} from '../lib/pair-login';
import { signOutEverywhere } from '../lib/sign-out';
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
 * Production runner: a visible browser window locally, pairing on headless.
 * Passwords and MFA stay inside the real SSO pages; nothing is typed here.
 */
export const runBrowserLogin: LoginRunner = async (hooks) => {
  const api = new OnTrackApiClient(normalizeBaseUrl());
  try {
    const redirectTo = ssoRedirectUrl(await api.getAuthMethod());
    if (!redirectTo) {
      throw new Error(
        'This server does not advertise SSO. Use `ontrack login` with manual credentials instead.',
      );
    }

    if (isHeadlessServerEnvironment()) {
      const relayUrl = resolveRelayUrl(undefined);
      if (!relayUrl) {
        throw new Error(
          'Pairing is disabled (empty relay URL). Set ONTRACK_RELAY_URL, or use `ontrack login` with manual credentials.',
        );
      }
      const pairing = await generatePairingSession(relayUrl);
      hooks.onPairingSession?.({
        pairingUrl: pairing.pairingUrl,
        displayCode: pairing.displayCode,
      });
      const payload = await waitForPairedCredentials({
        session: pairing,
        timeoutMs: TUI_LOGIN_TIMEOUT_MS,
      });
      const session = await finalizeCapturedLogin(
        api,
        capturedMaterialFromPairPayload(payload),
      );
      return session.username;
    }

    const captured = await captureSsoCredentials({
      ssoUrl: redirectTo,
      apiBaseUrl: api.base,
      timeoutMs: TUI_LOGIN_TIMEOUT_MS,
      // Pop up a visible browser: the user signs in through the real SSO pages.
      headless: false,
    });
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
export async function logoutOnTrack(): Promise<void> {
  await signOutEverywhere();
}

/** Injectable auth surface for the App; production default below. */
export interface TuiAuthActions {
  login: LoginRunner;
  logout: () => Promise<void>;
}

export const DEFAULT_TUI_AUTH: TuiAuthActions = {
  login: runBrowserLogin,
  logout: logoutOnTrack,
};
