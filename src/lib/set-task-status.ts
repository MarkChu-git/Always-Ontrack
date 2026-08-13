/**
 * Shared student status-trigger write path, extracted from
 * `ontrack task set-status` so the CLI and the TUI apply transitions through
 * one identical implementation.
 *
 * The OnTrack task endpoint answers 200 with the task entity even when it
 * refuses a trigger, and may remap a requested trigger to a different
 * resulting status — callers must always render the *returned* status, never
 * an optimistic value. Unknown transport outcomes are surfaced as `unknown`
 * and must not be retried automatically (unknown-outcome rule).
 */
import type { OnTrackApiClient } from './api.js';
import { OnTrackHttpError } from './auth.js';
import type { SessionData, StudentStatusTrigger } from './types.js';

export interface ApplyStatusTriggerInput {
  projectId: number;
  taskDefinitionId: number;
  trigger: StudentStatusTrigger;
  /** Status observed before the write; detects a 200-level refusal. */
  before: string | null;
}

export type ApplyStatusTriggerOutcome =
  /** Server applied exactly the requested trigger. */
  | { kind: 'applied'; before: string | null; after: string }
  /** Server answered 200 but mapped the request to a different final status. */
  | { kind: 'remapped'; before: string | null; requested: StudentStatusTrigger; after: string }
  /** Server answered 200 with the status unchanged: transition locked/tutor-only. */
  | { kind: 'refused'; before: string | null }
  /** Definitive HTTP rejection (4xx except 408/425); the original error travels. */
  | { kind: 'rejected'; error: OnTrackHttpError }
  /** Dispatch happened but the outcome is unknown; do not auto-retry. */
  | { kind: 'unknown'; summary: string; cause?: unknown };

/** Definitive rejections are 4xx responses minus the ambiguous timeout-ish ones. */
export function isDefinitiveWriteRejection(error: unknown): error is OnTrackHttpError {
  return (
    error instanceof OnTrackHttpError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408 &&
    error.status !== 425
  );
}

/** Apply one student status trigger and classify exactly what the server did. */
export async function applyStudentStatusTrigger(
  api: OnTrackApiClient,
  session: SessionData,
  input: ApplyStatusTriggerInput,
): Promise<ApplyStatusTriggerOutcome> {
  let response: { status?: string };
  try {
    response = await api.updateTaskStatus(
      session,
      input.projectId,
      input.taskDefinitionId,
      input.trigger,
    );
  } catch (error) {
    if (isDefinitiveWriteRejection(error)) {
      return { kind: 'rejected', error };
    }
    return {
      kind: 'unknown',
      summary: 'The status-change request was dispatched, but its outcome is unknown.',
      cause: error,
    };
  }

  const after =
    typeof response.status === 'string' && response.status.trim()
      ? response.status.trim()
      : null;
  if (!after) {
    return {
      kind: 'unknown',
      summary: 'The status-change response did not include the resulting status.',
    };
  }
  if (after !== input.trigger && after === input.before) {
    // A refused transition comes back as 200 with the unchanged task entity.
    return { kind: 'refused', before: input.before };
  }
  if (after === input.trigger) {
    return { kind: 'applied', before: input.before, after };
  }
  return { kind: 'remapped', before: input.before, requested: input.trigger, after };
}
