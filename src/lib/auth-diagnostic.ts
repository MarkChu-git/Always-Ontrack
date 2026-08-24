/** Safe, presentation-neutral authentication diagnostics. */
export interface AuthDiagnostic {
  readonly code: 'refresh_cookie_persistence_failed';
  readonly message: string;
}

export type AuthDiagnosticSink = (diagnostic: AuthDiagnostic) => void;

export const REFRESH_COOKIE_PERSISTENCE_DIAGNOSTIC: AuthDiagnostic = Object.freeze({
  code: 'refresh_cookie_persistence_failed',
  message:
    'Refresh cookie could not be persisted; the current session remains usable, but silent renewal may be unavailable.',
});

/** CLI/MCP adapter; TUI callers inject their toast sink instead. */
export const reportAuthDiagnosticToStderr: AuthDiagnosticSink = (diagnostic) => {
  process.stderr.write(`[warn] ${diagnostic.message}\n`);
};

/** Persistence is intentionally best-effort because the access token is usable. */
export function persistRefreshCookieBestEffort(
  persist: () => void,
  reportDiagnostic: AuthDiagnosticSink,
): void {
  try {
    persist();
  } catch {
    try {
      reportDiagnostic(REFRESH_COOKIE_PERSISTENCE_DIAGNOSTIC);
    } catch {
      // A presentation adapter must never invalidate an otherwise usable token.
    }
  }
}
