import type { StudentTaskReference, StudentTaskView } from './student-task-view.js';
import type { TaskUploadRequirement } from './types.js';

export type SubmissionPdfState = 'unavailable' | 'processing' | 'ready';

export interface SubmissionDetails {
  hasPdf: boolean;
  processingPdf: boolean;
  pdfState: SubmissionPdfState;
  submissionDate?: string;
  taskStatus?: string;
}

export interface SubmissionFileInput {
  key?: string;
  localPath: string;
  size: number;
}

export interface PreparedSubmissionFile {
  key: string;
  localPath: string;
  size: number;
}

export interface PreparedSubmission {
  reference: StudentTaskReference;
  files: PreparedSubmissionFile[];
}

export type SubmissionAttemptState =
  | 'prepared'
  | 'uploading'
  | 'accepted'
  | 'succeeded'
  | 'failed'
  | 'unknown'
  | 'cancelled';

export interface SubmissionJournalEntry {
  operationId: string;
  taskDefinitionId: number;
  state: SubmissionAttemptState;
  at: string;
  slotKeys: string[];
  outcomeCode:
    | 'preflight_complete'
    | 'request_dispatched'
    | 'response_accepted'
    | 'submission_observed'
    | 'server_rejected'
    | 'outcome_unknown'
    | 'cancelled_before_dispatch';
}

export interface SubmissionAttempt {
  operationId: string;
  prepared: PreparedSubmission;
  state: SubmissionAttemptState;
  journal: SubmissionJournalEntry[];
}

export type SubmissionAttemptEvent =
  | { type: 'upload_started'; at: string }
  | { type: 'upload_accepted'; at: string }
  | { type: 'submission_observed'; at: string }
  | { type: 'upload_rejected'; at: string }
  | { type: 'upload_outcome_unknown'; at: string }
  | { type: 'cancel'; at: string };

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function uploadRequirements(view: StudentTaskView): TaskUploadRequirement[] {
  const requirements =
    view.definition.uploadRequirements ?? view.definition.upload_requirements;
  if (!Array.isArray(requirements)) {
    return [];
  }
  return requirements.filter(
    (requirement): requirement is TaskUploadRequirement =>
      recordValue(requirement) !== undefined,
  );
}

function requirementKeys(view: StudentTaskView): string[] {
  return uploadRequirements(view).map((requirement, index) => {
    return stringValue(requirement.key) ?? `file${index}`;
  });
}

export function parseSubmissionDetails(payload: unknown): SubmissionDetails {
  const record = recordValue(payload);
  if (!record) {
    throw new Error('Submission details must be an object.');
  }

  const hasPdf = booleanValue(record.has_pdf ?? record.hasPdf);
  const processingPdf = booleanValue(
    record.processing_pdf ?? record.processingPdf,
  );
  return {
    hasPdf,
    processingPdf,
    pdfState: processingPdf ? 'processing' : hasPdf ? 'ready' : 'unavailable',
    submissionDate:
      stringValue(record.submission_date) ??
      stringValue(record.submissionDate),
    taskStatus:
      stringValue(record.task_status) ?? stringValue(record.taskStatus),
  };
}

/** True only when a read-only status response proves that a submission exists. */
export function isSubmissionObserved(details: SubmissionDetails): boolean {
  return (
    details.hasPdf ||
    details.processingPdf ||
    details.submissionDate !== undefined ||
    ['ready_for_feedback', 'need_help', 'complete', 'discuss'].includes(
      details.taskStatus?.trim().toLowerCase() ?? '',
    )
  );
}

/**
 * A first upload may create the submission. Uploading replacement files is only
 * valid after the read-only status contract proves an existing submission.
 */
export function validateSubmissionMode(
  mode: 'upload' | 'upload-new-files',
  details: SubmissionDetails,
): void {
  if (mode === 'upload-new-files' && !isSubmissionObserved(details)) {
    throw new Error(
      'upload-new-files requires an existing submission confirmed by submission status.',
    );
  }
}

function validateFileInputs(inputs: SubmissionFileInput[]): void {
  if (inputs.length === 0) {
    throw new Error('At least one evidence file is required.');
  }

  for (const input of inputs) {
    if (!input.localPath.trim()) {
      throw new Error('Evidence file path cannot be empty.');
    }
    if (!Number.isFinite(input.size) || input.size < 0) {
      throw new Error('Evidence file size must be a non-negative number.');
    }
  }
}

export function prepareSubmission(
  view: StudentTaskView,
  inputs: SubmissionFileInput[],
): PreparedSubmission {
  validateFileInputs(inputs);
  const keys = requirementKeys(view);
  const explicit = new Map<string, SubmissionFileInput>();
  const queued: SubmissionFileInput[] = [];

  for (const input of inputs) {
    const key = stringValue(input.key);
    if (!key) {
      queued.push({ ...input });
      continue;
    }
    if (explicit.has(key)) {
      throw new Error(`Duplicate evidence slot "${key}".`);
    }
    if (keys.length > 0 && !keys.includes(key)) {
      throw new Error(`Unknown evidence slot "${key}".`);
    }
    explicit.set(key, { ...input, key });
  }

  if (keys.length > 0 && inputs.length !== keys.length) {
    throw new Error(
      `This task expects ${keys.length} evidence file(s), but received ${inputs.length}.`,
    );
  }

  const orderedKeys =
    keys.length > 0
      ? keys
      : inputs.map((input, index) => stringValue(input.key) ?? `file${index}`);
  const remainingKeys = orderedKeys.filter((key) => !explicit.has(key));
  if (remainingKeys.length !== queued.length) {
    throw new Error('Unable to map evidence files to required slots.');
  }

  let queueIndex = 0;
  return {
    reference: { ...view.reference },
    files: orderedKeys.map((key) => {
      const file = explicit.get(key) ?? queued[queueIndex++];
      return {
        key,
        localPath: file.localPath,
        size: file.size,
      };
    }),
  };
}

function journalEntry(
  attempt: Pick<SubmissionAttempt, 'operationId' | 'prepared'>,
  state: SubmissionAttemptState,
  at: string,
  outcomeCode: SubmissionJournalEntry['outcomeCode'],
): SubmissionJournalEntry {
  return {
    operationId: attempt.operationId,
    taskDefinitionId: attempt.prepared.reference.taskDefinitionId,
    state,
    at,
    slotKeys: attempt.prepared.files.map((file) => file.key),
    outcomeCode,
  };
}

export function createSubmissionAttempt(
  prepared: PreparedSubmission,
  options: { operationId: string; at: string },
): SubmissionAttempt {
  if (!options.operationId.trim()) {
    throw new Error('Submission operation id is required.');
  }
  return {
    operationId: options.operationId,
    prepared: {
      reference: { ...prepared.reference },
      files: prepared.files.map((file) => ({ ...file })),
    },
    state: 'prepared',
    journal: [
      journalEntry(
        { operationId: options.operationId, prepared },
        'prepared',
        options.at,
        'preflight_complete',
      ),
    ],
  };
}

function withTransition(
  attempt: SubmissionAttempt,
  state: SubmissionAttemptState,
  at: string,
  outcomeCode: SubmissionJournalEntry['outcomeCode'],
): SubmissionAttempt {
  return {
    ...attempt,
    state,
    journal: [
      ...attempt.journal.map((entry) => ({
        ...entry,
        slotKeys: [...entry.slotKeys],
      })),
      journalEntry(attempt, state, at, outcomeCode),
    ],
  };
}

export function transitionSubmissionAttempt(
  attempt: SubmissionAttempt,
  event: SubmissionAttemptEvent,
): SubmissionAttempt {
  if (event.type === 'cancel') {
    if (attempt.state !== 'prepared') {
      throw new Error('A submission cannot be cancelled after dispatch.');
    }
    return withTransition(
      attempt,
      'cancelled',
      event.at,
      'cancelled_before_dispatch',
    );
  }

  if (event.type === 'upload_started') {
    if (attempt.state !== 'prepared') {
      throw new Error(`Cannot dispatch a submission in state "${attempt.state}".`);
    }
    return withTransition(
      attempt,
      'uploading',
      event.at,
      'request_dispatched',
    );
  }

  if (event.type === 'submission_observed') {
    if (attempt.state !== 'accepted') {
      throw new Error(
        `Cannot confirm a submission observation in state "${attempt.state}".`,
      );
    }
    return withTransition(
      attempt,
      'succeeded',
      event.at,
      'submission_observed',
    );
  }

  if (attempt.state !== 'uploading') {
    throw new Error(
      `Cannot record an upload result in state "${attempt.state}".`,
    );
  }

  if (event.type === 'upload_accepted') {
    return withTransition(
      attempt,
      'accepted',
      event.at,
      'response_accepted',
    );
  }

  return event.type === 'upload_rejected'
    ? withTransition(attempt, 'failed', event.at, 'server_rejected')
    : withTransition(attempt, 'unknown', event.at, 'outcome_unknown');
}
