/**
 * Shared "captured credentials → persisted session" finalization.
 *
 * Extracted from src/cli.ts so the CLI login command and the TUI login wizard
 * persist sessions through one identical path: access-token captures become
 * lifecycle-aware records directly, legacy captures go through the observed
 * `/auth` exchange, and any observed refresh cookie is persisted best-effort.
 */
import type { OnTrackApiClient } from './api.js';
import { createSessionFromAccessToken } from './auth.js';
import {
  persistRefreshCookie,
  type LoginCredentials,
} from './auto-login.js';
import { saveSession } from './session.js';
import type {
  CredentialSource,
  RefreshCookieMaterial,
  SessionData,
  SignInResponse,
} from './types.js';

/** Convert a credential captured from the verified access-token response into a session. */
export function sessionFromAccessTokenCapture(
  baseUrl: string,
  captured: LoginCredentials,
  savedAt: string,
): SessionData {
  if (captured.contract !== 'access-token' || !captured.expiresAt) {
    throw new Error(
      'The observed access-token response is missing its required expiry.',
    );
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

/**
 * Exchange a legacy captured credential through the observed `/auth` contract
 * and persist any refresh cookie the server issues for the persistent session.
 */
export async function signInAndPersistRefreshCookie(
  api: OnTrackApiClient,
  payload: { auth_token: string; username: string; remember: boolean },
): Promise<SignInResponse> {
  const result = await api.signInWithCookieCapture(payload);
  if (result.refreshCookie) {
    try {
      persistRefreshCookie(result.refreshCookie, {
        targetOrigin: new URL(api.base).origin,
      });
    } catch {
      // Refresh-cookie persistence is best effort; the session itself is valid.
    }
  }
  return result.response;
}

/** Material captured from any SSO/browser login path, ready to persist. */
export interface CapturedLoginMaterial {
  authToken: string;
  username: string;
  expiresAt?: string;
  contract?: LoginCredentials['contract'];
  refreshCookie?: RefreshCookieMaterial;
  /**
   * Provenance recorded on the legacy-exchange session variant. The
   * access-token variant always records 'access-token' itself.
   */
  source: CredentialSource;
}

/**
 * Persist a captured login as the local session. The browser-context capture
 * paths (auto/guided SSO) never re-exchange over HTTP, so their observed
 * refresh cookie is persisted explicitly here; the legacy exchange path
 * already persisted its own Set-Cookie pair inside signInAndPersistRefreshCookie.
 */
export async function finalizeCapturedLogin(
  api: OnTrackApiClient,
  captured: CapturedLoginMaterial,
): Promise<SessionData> {
  const savedAt = new Date().toISOString();
  const session =
    captured.contract === 'access-token'
      ? sessionFromAccessTokenCapture(
          api.base,
          {
            authToken: captured.authToken,
            username: captured.username,
            expiresAt: captured.expiresAt,
            source: 'auth_response',
            contract: captured.contract,
          },
          savedAt,
        )
      : await (async (): Promise<SessionData> => {
          // Manual/legacy captures use the older exchange contract. Browser
          // access-token responses are already API credentials and never come here.
          const response = await signInAndPersistRefreshCookie(api, {
            auth_token: captured.authToken,
            username: captured.username,
            remember: true,
          });
          return {
            baseUrl: api.base,
            username: captured.username,
            authToken: response.auth_token,
            user: response.user,
            savedAt,
            expiresAt:
              response.auth_token_expiry ??
              (response.auth_token === captured.authToken
                ? captured.expiresAt
                : undefined),
            source: captured.source,
            refreshedAt: savedAt,
          };
        })();

  // Persist session for subsequent CLI/TUI commands.
  await saveSession(session);

  if (captured.refreshCookie) {
    try {
      persistRefreshCookie(captured.refreshCookie, {
        targetOrigin: new URL(api.base).origin,
      });
    } catch {
      // Refresh-cookie persistence is best effort; the session itself is valid.
    }
  }

  return session;
}
