/**
 * Shared submission write path, extracted from `ontrack submission upload`
 * so the CLI and the TUI dispatch evidence files through one identical
 * implementation.
 *
 * Guarantees preserved from the original handler:
 * - the non-idempotent upload request is dispatched exactly once per confirm;
 * - a dry run (`confirm: false`) never touches the network write endpoint;
 * - definitive 4xx rejections rethrow the original error after journalling;
 * - an unknown transport outcome never auto-retries — it journals
 *   `outcome_unknown` (when claimed) and throws `IDEMPOTENCY_OUTCOME_UNKNOWN`
 *   pointing at `submission.status`.
 */
import { createHash, randomUUID } from 'node:crypto';
import { AgentProtocolError } from './agent-protocol.js';
import type { OnTrackApiClient } from './api.js';
import {
  ArtifactSafetyError,
  inspectUploadFile,
  readUploadArtifact,
} from './artifact-safety.js';
import {
  claimExecution,
  updateExecution,
  type ExecutionClaim,
} from './execution-journal.js';
import { loadProjectsWithTaskMetadata } from './project-catalogue.js';
import {
  createSubmissionAttempt,
  isSubmissionObserved,
  parseSubmissionDetails,
  prepareSubmission,
  transitionSubmissionAttempt,
  validateSubmissionMode,
  type SubmissionAttemptState,
} from './submission-lifecycle.js';
import {
  isDefinitiveWriteRejection,
} from './set-task-status.js';
import {
  buildStudentTaskViews,
  resolveStudentTaskViews,
} from './student-task-view.js';
import { OnTrackHttpError } from './auth.js';
import type {
  FeedbackItem,
  ProjectSummary,
  SessionData,
  SubmissionTrigger,
  TaskSelector,
  TaskSummary,
} from './types.js';
import {
  getTaskStatus,
  resolveTaskSelector,
  type UploadFileSpec,
} from './utils.js';

/** Infer default upload trigger from task status when not supplied explicitly. */
export function deriveDefaultSubmissionTrigger(
  task: Partial<TaskSummary>,
): SubmissionTrigger | undefined {
  const status = (getTaskStatus(task) || '').trim().toLowerCase();
  if (status === 'working_on_it' || status === 'need_help') {
    return 'need_help';
  }
  return undefined;
}

/** Parse and validate submission trigger flag. */
export function parseSubmissionTrigger(raw: string | undefined): SubmissionTrigger | undefined {
  if (!raw) {
    return undefined;
  }

  const value = raw.trim().toLowerCase();
  if (value === 'need_help' || value === 'ready_for_feedback') {
    return value;
  }

  throw new Error('--trigger must be one of: need_help, ready_for_feedback.');
}

/** Project the catalogue into the single Student Task View being submitted to. */
export function resolveSelectedStudentTask(
  projects: ProjectSummary[],
  projectId: number,
  taskDefinitionId: number,
) {
  const views = buildStudentTaskViews(projects, {
    includeBeyondTarget: true,
    includeTutorialMismatches: true,
  });
  return resolveStudentTaskViews(views, {
    projectId,
    taskDefinitionIds: [taskDefinitionId],
    abbreviations: [],
  })[0];
}

/** Preserve actionable artifact policy failures without exposing local paths or raw I/O errors. */
export function safeArtifactFailure(error: unknown): string {
  return error instanceof ArtifactSafetyError
    ? error.message
    : 'Artifact access could not be completed safely.';
}

/** Read upload file bytes and annotate with server-only key + filename metadata. */
export async function readUploadFiles(
  assignments: Array<{ key: string; localPath: string }>,
  allowExternalFile: boolean,
): Promise<
  Array<{
    key: string;
    filename: string;
    content: Buffer;
  }>
> {
  return Promise.all(
    assignments.map(async (assignment, index) => {
      try {
        const artifact = await readUploadArtifact(assignment.localPath, {
          root: process.cwd(),
          allowExternal: allowExternalFile,
        });
        return {
          key: assignment.key,
          filename: artifact.filename,
          content: artifact.content,
        };
      } catch (error) {
        throw new Error(
          `Failed to read upload file ${index + 1}: ${safeArtifactFailure(error)}`,
        );
      }
    }),
  );
}

export interface ApplySubmissionUploadInput {
  /** Full task selector, including the deprecated legacy `taskId` form. */
  selector: TaskSelector;
  mode: 'upload' | 'upload-new-files';
  files: UploadFileSpec[];
  allowExternalFile: boolean;
  /** Explicit trigger; mode 'upload' derives one from task status otherwise. */
  trigger?: SubmissionTrigger;
  comment?: string;
  /** false builds the dry-run preview and never dispatches. */
  confirm: boolean;
  idempotencyKey?: string;
  /** Agent-protocol callers must claim confirmed writes with a key. */
  requireIdempotencyKey?: boolean;
}

export interface SubmissionUploadPreview {
  command: string;
  dryRun: true;
  confirmed: false;
  projectId: number;
  unitCode: string | undefined;
  task: string;
  taskDefinitionId: number;
  operationId: string;
  state: SubmissionAttemptState;
  trigger: SubmissionTrigger | null;
  files: { key: string; bytes: number }[];
  comment: { status: 'requested' | 'not_requested' };
  idempotency: { required_for_agent_apply: true; key: string | null };
}

export type SubmissionUploadComment =
  | { status: 'not_requested' }
  | { status: 'posted'; id: FeedbackItem['id'] }
  | { status: 'failed' }
  | { status: 'skipped_until_submission_observed' };

export interface SubmissionUploadCompleted {
  command: string;
  projectId: number;
  unitCode: string | undefined;
  task: string;
  taskDefinitionId: number;
  operationId: string;
  idempotency?: { replayed: false };
  state: SubmissionAttemptState;
  dryRun: false;
  confirmed: true;
  verification: 'observed' | 'not_observed' | 'unavailable' | 'credential_expired';
  trigger: SubmissionTrigger | null;
  files: { key: string; bytes: number }[];
  upload: { status: 'response_accepted' };
  comment: SubmissionUploadComment;
}

export type SubmissionUploadOutcome =
  | { kind: 'preview'; preview: SubmissionUploadPreview }
  /** A prior claim with the same key+input already succeeded; nothing was sent. */
  | { kind: 'replayed'; claim: ExecutionClaim }
  | { kind: 'completed'; output: SubmissionUploadCompleted };

/** Claim a confirmed write when a key is present; agent callers must supply one. */
async function claimSubmissionWrite(
  idempotencyKey: string | undefined,
  requireKey: boolean,
  command: string,
  input: Readonly<Record<string, unknown>>,
): Promise<ExecutionClaim | undefined> {
  if (!idempotencyKey) {
    if (requireKey) {
      throw new AgentProtocolError({
        code: 'CONFIRMATION_REQUIRED',
        status: 'action_required',
        summary: 'Confirmed Agent writes require --idempotency-key.',
        nextActions: [
          {
            action: command,
            arguments: {
              confirm: true,
              idempotency_key: 'choose-a-stable-operation-key',
            },
          },
        ],
      });
    }
    return undefined;
  }
  return claimExecution(idempotencyKey, command, input);
}

/** Preview or dispatch a submission with requirement-aware file key mapping. */
export async function applySubmissionUpload(
  api: OnTrackApiClient,
  session: SessionData,
  input: ApplySubmissionUploadInput,
): Promise<SubmissionUploadOutcome> {
  const { mode } = input;
  const projects = await loadProjectsWithTaskMetadata(api, session, {
    projectId: input.selector.projectId,
  });
  const resolved = resolveTaskSelector(projects, input.selector);
  const trigger =
    input.trigger ??
    (mode === 'upload' ? deriveDefaultSubmissionTrigger(resolved.task) : undefined);

  const view = resolveSelectedStudentTask(
    projects,
    resolved.project.id,
    resolved.taskDefId,
  );
  const inputDetails = await Promise.all(
    input.files.map(async (file, index) => {
      try {
        const artifact = await inspectUploadFile(file.path, {
          root: process.cwd(),
          allowExternal: input.allowExternalFile,
        });
        return {
          key: file.key,
          localPath: file.path,
          size: artifact.size,
        };
      } catch (error) {
        throw new Error(
          `Failed to inspect upload file ${index + 1}: ${safeArtifactFailure(error)}`,
        );
      }
    }),
  );
  const prepared = prepareSubmission(view, inputDetails);
  let attempt = createSubmissionAttempt(prepared, {
    operationId: randomUUID(),
    at: new Date().toISOString(),
  });

  if (mode === 'upload-new-files') {
    const existing = parseSubmissionDetails(
      await api.getSubmissionDetails(
        session,
        resolved.project.id,
        resolved.taskDefId,
      ),
    );
    validateSubmissionMode(mode, existing);
  }

  const safeFiles = prepared.files.map((file) => ({
    key: file.key,
    bytes: file.size,
  }));
  if (!input.confirm) {
    return {
      kind: 'preview',
      preview: {
        command: `submission ${mode}`,
        dryRun: true,
        confirmed: false,
        projectId: resolved.project.id,
        unitCode: resolved.unitCode,
        task: resolved.abbr,
        taskDefinitionId: resolved.taskDefId,
        operationId: attempt.operationId,
        state: attempt.state,
        trigger: trigger ?? null,
        files: safeFiles,
        comment: { status: input.comment ? 'requested' : 'not_requested' },
        idempotency: {
          required_for_agent_apply: true,
          key: input.idempotencyKey ?? null,
        },
      },
    };
  }

  const files = await readUploadFiles(prepared.files, input.allowExternalFile);
  const command =
    mode === 'upload'
      ? 'submission.upload'
      : 'submission.upload_new_files';
  const executionInput = {
    project_id: resolved.project.id,
    task_definition_id: resolved.taskDefId,
    mode,
    trigger: trigger ?? null,
    files: files.map((file) => ({
      key: file.key,
      bytes: file.content.byteLength,
      sha256: createHash('sha256').update(file.content).digest('hex'),
    })),
    comment_sha256: input.comment
      ? createHash('sha256').update(input.comment).digest('hex')
      : null,
  };
  const claim = await claimSubmissionWrite(
    input.idempotencyKey,
    input.requireIdempotencyKey === true,
    command,
    executionInput,
  );
  if (claim?.replayed) {
    return { kind: 'replayed', claim };
  }
  if (claim) {
    attempt = createSubmissionAttempt(prepared, {
      operationId: claim.operationId,
      at: new Date().toISOString(),
    });
  }
  attempt = transitionSubmissionAttempt(attempt, {
    type: 'upload_started',
    at: new Date().toISOString(),
  });

  try {
    // This non-idempotent request is dispatched exactly once.
    await api.uploadTaskSubmission(
      session,
      resolved.project.id,
      resolved.taskDefId,
      files,
      {
        trigger,
      },
    );
    attempt = transitionSubmissionAttempt(attempt, {
      type: 'upload_accepted',
      at: new Date().toISOString(),
    });
  } catch (error) {
    if (isDefinitiveWriteRejection(error)) {
      attempt = transitionSubmissionAttempt(attempt, {
        type: 'upload_rejected',
        at: new Date().toISOString(),
      });
      if (claim) {
        await updateExecution(claim, command, executionInput, 'rejected');
      }
      throw error;
    }
    attempt = transitionSubmissionAttempt(attempt, {
      type: 'upload_outcome_unknown',
      at: new Date().toISOString(),
    });
    if (claim) {
      await updateExecution(claim, command, executionInput, 'outcome_unknown');
    }
    throw new AgentProtocolError({
      code: 'IDEMPOTENCY_OUTCOME_UNKNOWN',
      status: 'action_required',
      summary: 'Submission was dispatched once, but the transport outcome is unknown.',
      nextActions: [
        {
          action: 'submission.status',
          arguments: {
            project_id: resolved.project.id,
            task_definition_id: resolved.taskDefId,
          },
        },
      ],
      cause: error,
    });
  }

  let verification: 'observed' | 'not_observed' | 'unavailable' | 'credential_expired' =
    'not_observed';
  try {
    const details = parseSubmissionDetails(
      await api.getSubmissionDetails(
        session,
        resolved.project.id,
        resolved.taskDefId,
      ),
    );
    if (isSubmissionObserved(details)) {
      attempt = transitionSubmissionAttempt(attempt, {
        type: 'submission_observed',
        at: new Date().toISOString(),
      });
      verification = 'observed';
    }
  } catch (error) {
    verification =
      error instanceof OnTrackHttpError && error.authFailure !== 'other'
        ? 'credential_expired'
        : 'unavailable';
  }

  let commentResult: FeedbackItem | undefined;
  let commentFailed = false;
  if (input.comment && attempt.state === 'succeeded') {
    try {
      // Keep comment as a separate non-idempotent API call. A failure here must
      // never downgrade the already-confirmed upload into a retryable error.
      commentResult = await api.addTaskComment(
        session,
        resolved.project.id,
        resolved.taskDefId,
        input.comment,
      );
    } catch (error) {
      void error;
      commentFailed = true;
    }
  }

  const output: SubmissionUploadCompleted = {
    command: `submission ${mode}`,
    projectId: resolved.project.id,
    unitCode: resolved.unitCode,
    task: resolved.abbr,
    taskDefinitionId: resolved.taskDefId,
    operationId: attempt.operationId,
    ...(claim ? { idempotency: { replayed: false } } : {}),
    state: attempt.state,
    dryRun: false,
    confirmed: true,
    verification,
    trigger: trigger ?? null,
    files: safeFiles,
    upload: { status: 'response_accepted' },
    comment: !input.comment
      ? { status: 'not_requested' }
      : commentResult
        ? { status: 'posted', id: commentResult.id }
        : commentFailed
          ? { status: 'failed' }
          : { status: 'skipped_until_submission_observed' },
  };
  if (claim) {
    await updateExecution(claim, command, executionInput, 'succeeded', output);
  }
  return { kind: 'completed', output };
}
