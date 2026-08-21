/**
 * Shared "captured credentials → persisted session" finalization.
 *
 * Extracted from src/cli.ts so the CLI login command and the TUI login wizard
 * persist sessions through one identical path: credentials that are already
 * live API tokens become lifecycle-aware records directly, pending one-time
 * login tokens go through the observed `/auth` exchange, and any observed
 * refresh cookie is persisted best-effort.
 *
 * Which of the two a credential is decides whether login works at all: `POST
 * /auth` only accepts a pending one-time login token and answers 419 for an
 * active access token, so replaying a live token there throws away a working
 * credential. The browser capture paths report their contract; pairing
 * bookmarklets old enough to report nothing are resolved against the server.
 *
 * It also decides how long the session lives. Only the exchange returns a
 * refresh cookie, and only a refresh cookie lets a session renew silently, so a
 * pairing that forwards a still-pending login token is preferred over one that
 * merely mints a token that cannot outlive itself.
 */
import type { OnTrackApiClient } from './api.js';
import { classifyAuthFailure, createSessionFromAccessToken } from './auth.js';
import {
  persistRefreshCookie,
  type LoginCredentials,
} from './auto-login.js';
import { saveSession } from './session.js';
import type {
  CredentialContract,
  CredentialSource,
  RefreshCookieMaterial,
  SessionData,
  SignInResponse,
} from './types.js';

/**
 * Read-only route used to ask OnTrack whether a credential is already a live
 * API token. Every account that can sign in can read its own project list.
 */
const CREDENTIAL_VERIFICATION_ROUTE = '/api/projects';

/** Raised when OnTrack refuses a paired credential on both available paths. */
export class PairedCredentialRejectedError extends Error {
  constructor(options?: { cause?: unknown }) {
    super(
      'OnTrack rejected the paired credential. Sign in again to pair a fresh one; if that keeps failing, reinstall the pairing bookmarklet.',
      options,
    );
    this.name = 'PairedCredentialRejectedError';
  }
}

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
  contract?: CredentialContract;
  refreshCookie?: RefreshCookieMaterial;
  /**
   * A pending one-time login token the pairing bookmarklet forwarded next to
   * the credential. Exchanging it is what earns a refresh cookie, so it is
   * preferred over a token that is already live but cannot be renewed.
   */
  exchangeToken?: string;
  /**
   * Provenance recorded on the legacy-exchange session variant. The
   * access-token variant always records 'access-token' itself.
   */
  source: CredentialSource;
}

/** Persist a credential that is already a live API token, with no exchange. */
function sessionFromLiveCredential(
  baseUrl: string,
  captured: CapturedLoginMaterial,
  savedAt: string,
): SessionData {
  return {
    baseUrl,
    username: captured.username,
    authToken: captured.authToken,
    user: { username: captured.username },
    savedAt,
    // Absent when the browser side did not forward the token's expiry; callers
    // then fall back to server validation instead of a local lifecycle check.
    expiresAt: captured.expiresAt,
    source: captured.source,
    refreshedAt: savedAt,
  };
}

/** Exchange a pending one-time login token for an API session. */
async function sessionFromExchange(
  api: OnTrackApiClient,
  captured: CapturedLoginMaterial,
  savedAt: string,
): Promise<SessionData> {
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
}

/**
 * Ask OnTrack whether a credential already works as an API token. Only a
 * definite 401/419 counts as a rejection: a 403 for restricted roles, a 5xx, or
 * a transport failure leave the question open, and reading a rejection into any
 * of those would send a working token back through `POST /auth`.
 */
async function verifyLiveCredential(
  api: OnTrackApiClient,
  candidate: SessionData,
): Promise<'accepted' | 'rejected' | 'unverified'> {
  try {
    const probe = await api.probeGet(candidate, CREDENTIAL_VERIFICATION_ROUTE);
    if (probe.ok) {
      return 'accepted';
    }
    return classifyAuthFailure(probe.status) === 'other' ? 'unverified' : 'rejected';
  } catch {
    return 'unverified';
  }
}

/**
 * Spend the pending one-time login token the browser side forwarded next to the
 * credential, if it still works. This is the only pairing path that ends with a
 * refresh cookie, and therefore the only one whose session can renew silently
 * instead of dying with its token. Failure is expected and cheap: the web app
 * usually spends the landing-URL token first, and a rejection here leaves the
 * minted credential untouched for the caller to fall back on.
 */
async function sessionFromExchangeCandidate(
  api: OnTrackApiClient,
  captured: CapturedLoginMaterial,
  savedAt: string,
): Promise<SessionData | null> {
  const exchangeToken = captured.exchangeToken;
  if (!exchangeToken || exchangeToken === captured.authToken) {
    return null;
  }
  try {
    // Deliberately not spreading `captured`: its expiry and contract describe
    // the minted token, and carrying them onto a different credential would
    // record a lifetime this session does not have.
    return await sessionFromExchange(
      api,
      {
        authToken: exchangeToken,
        username: captured.username,
        source: captured.source,
      },
      savedAt,
    );
  } catch {
    // Every failure degrades the same way, including a 5xx or a lost response
    // that leaves the outcome unknown: this exchange only ever buys a longer
    // session, so the caller still has a credential to fall back on and no
    // failure here is worth failing the login over. The cost of an unknown
    // outcome is a spare that may have been spent for a session nobody kept.
    return null;
  }
}

/**
 * Persist a credential that arrived through the pairing relay. The bookmarklet
 * mints it from `POST /auth/access-token`, so it is normally already a live API
 * token and must not be replayed through `POST /auth`. One authenticated read
 * confirms that before anything is written, so a dead credential is reported at
 * login instead of failing every later command. Only a rejected credential that
 * declared nothing is worth trying as a pending one-time login token — that is
 * what a bookmarklet predating the contract field may have caught from the
 * `sign_in` landing URL.
 */
async function sessionFromPairedCredential(
  api: OnTrackApiClient,
  captured: CapturedLoginMaterial,
  savedAt: string,
): Promise<SessionData> {
  const renewable = await sessionFromExchangeCandidate(api, captured, savedAt);
  if (renewable) {
    return renewable;
  }
  if (captured.contract === 'legacy-auth') {
    try {
      return await sessionFromExchange(api, captured, savedAt);
    } catch (error) {
      // A spent landing-URL token answers 419 here. Reporting that verbatim is
      // the raw expiry message this whole path exists to translate.
      throw new PairedCredentialRejectedError({ cause: error });
    }
  }
  const candidate = sessionFromLiveCredential(api.base, captured, savedAt);
  if ((await verifyLiveCredential(api, candidate)) !== 'rejected') {
    return candidate;
  }
  if (captured.contract === 'access-token') {
    // A minted token is a live credential by definition, so a rejection means
    // it is dead rather than pending. Offering it to `POST /auth` would be the
    // 419 this path exists to avoid.
    throw new PairedCredentialRejectedError();
  }
  try {
    return await sessionFromExchange(api, captured, savedAt);
  } catch (error) {
    throw new PairedCredentialRejectedError({ cause: error });
  }
}

/**
 * Persist a captured login as the local session. The browser-context capture
 * paths (auto/guided SSO) never re-exchange over HTTP, so their observed
 * refresh cookie is persisted explicitly here; the exchange path already
 * persisted its own Set-Cookie pair inside signInAndPersistRefreshCookie.
 */
export async function finalizeCapturedLogin(
  api: OnTrackApiClient,
  captured: CapturedLoginMaterial,
): Promise<SessionData> {
  const savedAt = new Date().toISOString();
  const session =
    captured.source === 'pair-relay'
      ? await sessionFromPairedCredential(api, captured, savedAt)
      : captured.contract === 'access-token'
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
        : await sessionFromExchange(api, captured, savedAt);

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
