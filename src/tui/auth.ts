/**
 * TUI auth actions: the production implementations behind the login wizard
 * and the logout command. Both are thin compositions of src/lib primitives —
 * the wizard driver wraps `captureSsoCredentialsWithGuidedLogin` and persists
 * through `finalizeCapturedLogin`, and logout delegates to `signOutEverywhere`,
 * the same orchestration `ontrack logout` uses.
 *
 * Deliberate differences from the CLI login command: the wizard always runs
 * the guided flow (the CLI's stored-browser-session fast path and manual
 * paste fallback stay CLI-only for now), and the SSO timeout is fixed at the
 * CLI's default 420s instead of being flag-configurable.
 *
 * Everything here is injectable into the App for headless smoke tests; nothing
 * in this module runs at import time.
 */
import { OnTrackApiClient } from '../lib/api';
import {
  SsoFallbackError,
  captureSsoCredentialsWithGuidedLogin,
  classifySsoFallback,
  type MfaMethodOption,
  type SsoFallbackReason,
  type SsoStep,
} from '../lib/auto-login';
import { ssoRedirectUrl } from '../lib/auth';
import { finalizeCapturedLogin } from '../lib/login-finalize';
import { signOutEverywhere } from '../lib/sign-out';
import { normalizeBaseUrl, redactSensitiveText } from '../lib/utils';

/** Same default the CLI uses for `--sso-timeout-sec`. */
const TUI_SSO_TIMEOUT_MS = 420_000;

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

/** Production runner: hidden-browser guided SSO through the shared lib path. */
export const runGuidedSsoLogin: GuidedLoginRunner = async (credentials, hooks) => {
  const api = new OnTrackApiClient(normalizeBaseUrl());
  try {
    const redirectTo = ssoRedirectUrl(await api.getAuthMethod());
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
        timeoutMs: TUI_SSO_TIMEOUT_MS,
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

/** Sign out through the same shared orchestration as `ontrack logout`. */
export async function logoutOnTrack(): Promise<void> {
  await signOutEverywhere();
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
