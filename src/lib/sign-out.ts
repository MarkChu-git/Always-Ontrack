/**
 * Shared sign-out orchestration used by both `ontrack logout` and the TUI:
 * remote sign-out is attempted first but never blocks local cleanup — the
 * local session file and any stored browser session state are always cleared.
 */
import { clearAllBrowserSessionState } from './auto-login.js';
import {
  reportAuthDiagnosticToStderr,
  type AuthDiagnosticSink,
} from './auth-diagnostic.js';
import { createAuthenticatedApi } from './project-catalogue.js';
import { clearSession, loadSession } from './session.js';

export interface SignOutResult {
  /** True when the remote sign-out call failed (local state was still cleared). */
  remoteSignOutFailed: boolean;
}

export async function signOutEverywhere(
  reportDiagnostic: AuthDiagnosticSink = reportAuthDiagnosticToStderr,
): Promise<SignOutResult> {
  const session = await loadSession();
  let remoteSignOutFailed = false;
  if (session) {
    try {
      await createAuthenticatedApi(session, reportDiagnostic).signOut(session);
    } catch {
      remoteSignOutFailed = true;
    }
  }
  await Promise.all([
    clearSession(),
    Promise.resolve().then(() => clearAllBrowserSessionState()),
  ]);
  return { remoteSignOutFailed };
}
