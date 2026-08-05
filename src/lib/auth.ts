import type { AccessTokenResponse, CredentialSource, SessionData } from './types.js';

export type AuthFailureKind = 'unauthorized' | 'expired' | 'other';
export type SessionUsability =
  | { readonly state: 'usable'; readonly expiresAt: string }
  | { readonly state: 'expired'; readonly expiresAt?: string }
  | { readonly state: 'unknown' };

/** Typed protocol error so callers never need to parse HTTP error text. */
export class OnTrackHttpError extends Error {
  readonly status: number;
  readonly authFailure: AuthFailureKind;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'OnTrackHttpError';
    this.status = status;
    this.authFailure = classifyAuthFailure(status);
  }
}

/** Typed, body-free failure for requests that never received an HTTP response. */
export class OnTrackTransportError extends Error {
  constructor(cause?: unknown) {
    super('The OnTrack transport request failed.', { cause });
    this.name = 'OnTrackTransportError';
  }
}

/** Central classification for credential-related HTTP statuses. */
export function classifyAuthFailure(status: number): AuthFailureKind {
  if (status === 401) return 'unauthorized';
  if (status === 419) return 'expired';
  return 'other';
}

/** Read legacy records safely without rewriting their credential values. */
export function migrateLegacySession(session: SessionData): SessionData {
  return session.source ? { ...session } : { ...session, source: 'legacy' };
}

/** Build a lifecycle-aware local record from the verified access-token response. */
export function createSessionFromAccessToken(
  baseUrl: string,
  username: string,
  response: AccessTokenResponse,
  savedAt: string,
): SessionData {
  return {
    baseUrl,
    username,
    authToken: response.auth_token,
    user: { ...response.user },
    savedAt,
    expiresAt: response.auth_token_expiry,
    source: 'access-token' satisfies CredentialSource,
    refreshedAt: savedAt,
  };
}

/** Decide whether a credential can be used without callers interpreting dates. */
export function sessionUsability(session: SessionData, now: Date = new Date()): SessionUsability {
  if (!session.expiresAt) return { state: 'unknown' };
  const expiry = Date.parse(session.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= now.getTime()) {
    return Number.isFinite(expiry) ? { state: 'expired', expiresAt: session.expiresAt } : { state: 'expired' };
  }
  return { state: 'usable', expiresAt: session.expiresAt };
}
