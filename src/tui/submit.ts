/**
 * TUI submission actions: the production driver behind the submit wizard.
 * A thin composition of the auth broker (token freshness), the artifact
 * policy check, and `applySubmissionUpload` — the same shared write path as
 * `ontrack submission upload --confirm`.
 *
 * The wizard always confirms interactively, mints one idempotency key per
 * attempt (`tui:<uuid>`), and lets errors propagate for classification:
 * definitive rejections arrive as OnTrackHttpError (an auth-classified one
 * becomes `auth_required` here, so the App drops to the sign-in screen
 * instead of reporting it as a server refusal), an unknown transport
 * outcome as AgentProtocolError IDEMPOTENCY_OUTCOME_UNKNOWN (never retried
 * automatically), and preflight problems as plain Errors.
 *
 * Injectable into the App so headless smoke tests drive it with fixtures.
 */
import { inspectUploadFile } from '../lib/artifact-safety';
import { OnTrackHttpError } from '../lib/auth';
import { createOnTrackAuthBroker } from '../lib/auth-broker';
import type { AuthDiagnosticSink } from '../lib/auth-diagnostic';
import { DEFAULT_AUTH_MIN_TTL_SECONDS } from '../lib/auth-runtime';
import { createAuthenticatedApi } from '../lib/project-catalogue';
import {
  applySubmissionUpload,
  type SubmissionUploadCompleted,
} from '../lib/submission-upload';
import type { SubmissionTrigger } from '../lib/types';
import { normalizeBaseUrl } from '../lib/utils';
import type { TuiTask } from './tasks';

export interface SubmitRequest {
  task: TuiTask;
  mode: 'upload' | 'upload-new-files';
  files: { key?: string; path: string }[];
  allowExternalFile: boolean;
  trigger?: SubmissionTrigger;
  comment?: string;
  /** One key per wizard attempt; a re-confirm replays instead of re-sending. */
  idempotencyKey: string;
}

export type SubmitOutcome =
  | { kind: 'completed'; output: SubmissionUploadCompleted }
  /** A prior dispatch with the same key+input already succeeded server-side. */
  | { kind: 'replayed'; operationId: string }
  | { kind: 'auth_required' };

export interface SubmitActions {
  /** Local artifact policy check (exists, regular file, size budget). */
  inspect(path: string, allowExternal: boolean): Promise<{ size: number }>;
  run(request: SubmitRequest): Promise<SubmitOutcome>;
}

async function runSubmission(
  request: SubmitRequest,
  reportDiagnostic: AuthDiagnosticSink,
): Promise<SubmitOutcome> {
  const broker = createOnTrackAuthBroker(
    { baseUrl: normalizeBaseUrl() },
    { reportDiagnostic },
  );
  const auth = await broker.ensure({
    minTtlSeconds: DEFAULT_AUTH_MIN_TTL_SECONDS,
    interaction: 'never',
  });
  if (auth.status !== 'ready') return { kind: 'auth_required' };
  const session = await broker.currentSession();
  if (!session) return { kind: 'auth_required' };
  const api = createAuthenticatedApi(session, reportDiagnostic);
  let outcome;
  try {
    outcome = await applySubmissionUpload(api, session, {
      selector: {
        projectId: request.task.projectId,
        taskDefinitionId: request.task.taskDefinitionId,
      },
      mode: request.mode,
      files: request.files,
      allowExternalFile: request.allowExternalFile,
      trigger: request.trigger,
      comment: request.comment,
      confirm: true,
      idempotencyKey: request.idempotencyKey,
    });
  } catch (error) {
    // An auth rejection mid-dispatch is not a refusal of the submission.
    if (error instanceof OnTrackHttpError && error.authFailure !== 'other') {
      return { kind: 'auth_required' };
    }
    throw error;
  }
  if (outcome.kind === 'replayed') {
    return { kind: 'replayed', operationId: outcome.claim.operationId };
  }
  if (outcome.kind === 'preview') {
    throw new Error('Submission dispatch returned a dry-run preview.');
  }
  return { kind: 'completed', output: outcome.output };
}

export function createSubmitActions(
  reportDiagnostic: AuthDiagnosticSink,
): SubmitActions {
  return {
    inspect: async (path, allowExternal) => {
      const artifact = await inspectUploadFile(path, {
        root: process.cwd(),
        allowExternal,
      });
      return { size: artifact.size };
    },
    run: (request) => runSubmission(request, reportDiagnostic),
  };
}
