/**
 * TUI task-extras actions: prerequisite lookup, submission status, and the
 * task/resource/submission artifact downloads shown in the detail pane.
 * Production implementations are thin compositions of the auth broker and
 * the shared read paths in src/lib/agent-task-reads.ts — the same contract
 * the native agent commands use, so the TUI never re-implements them.
 *
 * Everything here is injectable into the App for headless smoke tests; the
 * production object performs no work until a method is called.
 */
import { AgentProtocolError } from '../lib/agent-protocol';
import {
  readAgentSubmissionPdf,
  readAgentSubmissionStatus,
  readAgentTaskPdf,
  readAgentTaskPrerequisites,
  readAgentTaskResources,
} from '../lib/agent-task-reads';
import { OnTrackHttpError } from '../lib/auth';
import { createOnTrackAuthBroker } from '../lib/auth-broker';
import type { AuthDiagnosticSink } from '../lib/auth-diagnostic';
import { DEFAULT_AUTH_MIN_TTL_SECONDS } from '../lib/auth-runtime';
import type { SubmissionPdfState } from '../lib/submission-lifecycle';
import type { SessionData } from '../lib/types';
import { normalizeBaseUrl, redactSensitiveText } from '../lib/utils';
import type { TuiTask } from './tasks';

export interface PrerequisiteInfo {
  taskDefinitionId: number;
  requiredStatus: string;
}

export interface SubmissionStatusInfo {
  pdfState: SubmissionPdfState;
  submissionObserved: boolean;
  submissionDate: string | null;
  taskStatus: string | null;
}

export interface DownloadedArtifact {
  path: string;
  bytes: number;
}

export type ExtrasResult<T> =
  | { kind: 'ok'; value: T }
  /** Session expired mid-read; the App drops to the sign-in screen. */
  | { kind: 'auth_required' }
  | { kind: 'error'; message: string };

export interface TaskExtrasActions {
  prerequisites(task: TuiTask): Promise<ExtrasResult<PrerequisiteInfo[]>>;
  submissionStatus(task: TuiTask): Promise<ExtrasResult<SubmissionStatusInfo>>;
  downloadTaskPdf(task: TuiTask): Promise<ExtrasResult<DownloadedArtifact>>;
  /** Resolves to null when the task has no resource archive to download. */
  downloadResources(task: TuiTask): Promise<ExtrasResult<DownloadedArtifact | null>>;
  downloadSubmissionPdf(task: TuiTask): Promise<ExtrasResult<DownloadedArtifact>>;
}

function failureMessage(error: unknown): string {
  if (error instanceof AgentProtocolError) {
    return redactSensitiveText(error.summary);
  }
  const message = error instanceof Error ? error.message : String(error);
  return redactSensitiveText(message);
}

/** Shared broker prelude: refresh-check the session, then run the read. */
async function withSession<T>(
  run: (session: SessionData) => Promise<T>,
  reportDiagnostic: AuthDiagnosticSink,
): Promise<ExtrasResult<T>> {
  try {
    const broker = createOnTrackAuthBroker(
      { baseUrl: normalizeBaseUrl() },
      { reportDiagnostic },
    );
    const auth = await broker.ensure({
      minTtlSeconds: DEFAULT_AUTH_MIN_TTL_SECONDS,
      interaction: 'never',
    });
    if (auth.status !== 'ready') {
      return { kind: 'auth_required' };
    }
    const session = await broker.currentSession();
    if (!session) {
      return { kind: 'auth_required' };
    }
    return { kind: 'ok', value: await run(session) };
  } catch (error) {
    if (error instanceof OnTrackHttpError && error.authFailure !== 'other') {
      return { kind: 'auth_required' };
    }
    return { kind: 'error', message: failureMessage(error) };
  }
}

const selectorOf = (task: TuiTask) => ({
  project_id: task.projectId,
  task_definition_id: task.taskDefinitionId,
});

function readPrerequisites(
  task: TuiTask,
  reportDiagnostic: AuthDiagnosticSink,
): Promise<ExtrasResult<PrerequisiteInfo[]>> {
  return withSession(async (session) => {
    const output = await readAgentTaskPrerequisites(
      selectorOf(task),
      session,
      reportDiagnostic,
    );
    return output.prerequisites.map((row) => ({
      taskDefinitionId: row.prerequisite_task_definition_id,
      requiredStatus: row.required_status,
    }));
  }, reportDiagnostic);
}

function readSubmissionStatus(
  task: TuiTask,
  reportDiagnostic: AuthDiagnosticSink,
): Promise<ExtrasResult<SubmissionStatusInfo>> {
  return withSession(async (session) => {
    const output = await readAgentSubmissionStatus(
      selectorOf(task),
      session,
      reportDiagnostic,
    );
    return {
      pdfState: output.pdf_state,
      submissionObserved: output.submission_observed,
      submissionDate: output.submission_date,
      taskStatus: output.task_status,
    };
  }, reportDiagnostic);
}

function readArtifact<T>(
  reportDiagnostic: AuthDiagnosticSink,
  read: (session: SessionData) => Promise<T>,
): Promise<ExtrasResult<T>> {
  return withSession(read, reportDiagnostic);
}

export function createTaskExtrasActions(
  reportDiagnostic: AuthDiagnosticSink,
): TaskExtrasActions {
  return {
    prerequisites: (task) => readPrerequisites(task, reportDiagnostic),
    submissionStatus: (task) => readSubmissionStatus(task, reportDiagnostic),
    downloadTaskPdf: (task) =>
      readArtifact(reportDiagnostic, async (session) => {
        const output = await readAgentTaskPdf(
          selectorOf(task),
          session,
          reportDiagnostic,
        );
        return { path: output.artifact.path, bytes: output.artifact.bytes };
      }),
    downloadResources: (task) =>
      readArtifact(reportDiagnostic, async (session) => {
        const output = await readAgentTaskResources(
          selectorOf(task),
          session,
          reportDiagnostic,
        );
        const first = output.downloads[0];
        return first
          ? { path: first.artifact.path, bytes: first.artifact.bytes }
          : null;
      }),
    downloadSubmissionPdf: (task) =>
      readArtifact(reportDiagnostic, async (session) => {
        const output = await readAgentSubmissionPdf(
          selectorOf(task),
          session,
          reportDiagnostic,
        );
        return { path: output.artifact.path, bytes: output.artifact.bytes };
      }),
  };
}
