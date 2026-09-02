/**
 * Task-centric Agent read paths, extracted from `src/cli.ts` so the native
 * agent command surface and the TUI share one implementation: prerequisites,
 * resource archives, task/submission PDF downloads, and submission status.
 *
 * Every function takes an already-authenticated `SessionData` and composes
 * the same catalogue/selector pipeline the CLI uses; contract limits and
 * output shapes stay byte-identical to the original handlers.
 */
import { createHash } from 'node:crypto';
import { extname, relative } from 'node:path';
import type {
  AgentSubmissionPdfInput,
  AgentSubmissionPdfOutput,
  AgentSubmissionStatusInput,
  AgentSubmissionStatusOutput,
  AgentTaskPdfInput,
  AgentTaskPdfOutput,
  AgentTaskPrerequisitesInput,
  AgentTaskPrerequisitesOutput,
  AgentTaskResourcesInput,
  AgentTaskResourcesOutput,
} from './agent-commands.js';
import { agentSubmissionStatusOutputSchema } from './agent-commands.js';
import { AgentProtocolError } from './agent-protocol.js';
import type { AuthDiagnosticSink } from './auth-diagnostic.js';
import {
  contentDispositionFilename,
  UnavailableDownloadError,
  type DownloadResult,
  type OnTrackApiClient,
} from './api.js';
import { MAX_DOWNLOAD_BYTES, writeArtifactFile } from './artifact-safety.js';
import {
  createAuthenticatedApi,
  loadProjectsWithTaskMetadata,
} from './project-catalogue.js';
import {
  isSubmissionObserved,
  parseStrictSubmissionDetails,
  type SubmissionDetails,
} from './submission-lifecycle.js';
import type { SessionData } from './types.js';
import {
  buildPdfFilename,
  buildTaskResourceFilename,
  exceedsByteBudget,
  resolveTaskBatchSelector,
  resolveTaskSelector,
  safeTextForHumanDisplay,
  taskIdentityJson,
  type ResolvedTaskSelector,
} from './utils.js';

export const MAX_AGENT_TASK_ITEMS = 200;
export const MAX_AGENT_TASK_OUTPUT_BYTES = 512 * 1024;
const MAX_AGENT_SUBMISSION_STATUS_OUTPUT_BYTES = 16 * 1024;
const MAX_TASK_RESOURCE_BATCH_BYTES = MAX_DOWNLOAD_BYTES * 4;

function positiveIntegerValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

function nonEmptyStringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function hasOwnField(row: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(row, field);
}

/** Read paired prerequisite IDs without treating malformed aliases as absent. */
function prerequisiteIdField(
  row: Record<string, unknown>,
  snakeCase: string,
  camelCase: string,
): number | undefined {
  const fields = [snakeCase, camelCase].filter((field) => hasOwnField(row, field));
  if (fields.length === 0) {
    return undefined;
  }
  const values = fields.map((field) => positiveIntegerValue(row[field]));
  if (values.some((value) => value === undefined)) {
    throw new AgentProtocolError({
      code: 'REMOTE_UNAVAILABLE',
      summary: 'The task prerequisite endpoint returned an invalid relationship id.',
    });
  }
  const [first, ...rest] = values as number[];
  if (rest.some((value) => value !== first)) {
    throw new AgentProtocolError({
      code: 'REMOTE_UNAVAILABLE',
      summary: 'The task prerequisite endpoint returned conflicting relationship ids.',
    });
  }
  return first;
}

function prerequisiteStatusValue(row: Record<string, unknown>): string {
  const fields = ['task_status', 'taskStatus'].filter((field) => hasOwnField(row, field));
  if (fields.length === 0) {
    return 'unknown';
  }
  const values = fields.map((field) => nonEmptyStringValue(row[field]));
  if (values.some((value) => value === undefined) || values.some((value) => value!.length > 80)) {
    throw new AgentProtocolError({
      code: 'REMOTE_UNAVAILABLE',
      summary: 'The task prerequisite endpoint returned an invalid task status.',
    });
  }
  const [first, ...rest] = values as string[];
  if (rest.some((value) => value !== first)) {
    throw new AgentProtocolError({
      code: 'REMOTE_UNAVAILABLE',
      summary: 'The task prerequisite endpoint returned conflicting task statuses.',
    });
  }
  return first;
}

function prerequisiteRelationshipId(row: Record<string, unknown>): number | null {
  if (!hasOwnField(row, 'id')) {
    return null;
  }
  const id = positiveIntegerValue(row.id);
  if (id === undefined) {
    throw new AgentProtocolError({
      code: 'REMOTE_UNAVAILABLE',
      summary: 'The task prerequisite endpoint returned an invalid relationship record id.',
    });
  }
  return id;
}

/** Read and normalize the direct per-definition prerequisite contract. */
export async function readAgentTaskPrerequisites(
  input: AgentTaskPrerequisitesInput,
  session: SessionData,
  reportDiagnostic?: AuthDiagnosticSink,
): Promise<AgentTaskPrerequisitesOutput> {
  const api = createAuthenticatedApi(session, reportDiagnostic);
  const projects = await loadProjectsWithTaskMetadata(
    api,
    session,
    { projectId: input.project_id },
    { strictMetadata: true },
  );
  const resolved = resolveTaskSelector(projects, {
    projectId: input.project_id,
    taskDefinitionId:
      'task_definition_id' in input ? input.task_definition_id : undefined,
    abbr: 'abbreviation' in input ? input.abbreviation : undefined,
  });
  if (resolved.unitId === undefined) {
    throw new AgentProtocolError({
      code: 'INVALID_ARGUMENT',
      summary: 'The selected task has no unit identity for prerequisite lookup.',
    });
  }

  const rawRows = await api.listTaskPrerequisites(
    session,
    resolved.unitId,
    resolved.taskDefId,
  );
  if (!Array.isArray(rawRows)) {
    throw new AgentProtocolError({
      code: 'REMOTE_UNAVAILABLE',
      summary: 'The task prerequisite endpoint returned an unexpected response shape.',
    });
  }
  if (rawRows.length > MAX_AGENT_TASK_ITEMS) {
    throw new AgentProtocolError({
      code: 'REMOTE_UNAVAILABLE',
      summary: `OnTrack returned more than ${MAX_AGENT_TASK_ITEMS} prerequisite relationships for one task.`,
    });
  }

  const prerequisites = rawRows.flatMap((raw) => {
    if (typeof raw !== 'object' || raw === null) {
      throw new AgentProtocolError({
        code: 'REMOTE_UNAVAILABLE',
        summary: 'The task prerequisite endpoint returned a malformed relationship row.',
      });
    }
    const row = raw as Record<string, unknown>;
    const dependentId = prerequisiteIdField(
      row,
      'task_definition_id',
      'taskDefinitionId',
    );
    const prerequisiteId = prerequisiteIdField(
      row,
      'prerequisite_id',
      'prerequisiteId',
    );
    if (dependentId !== undefined && dependentId !== resolved.taskDefId) {
      return [];
    }
    if (prerequisiteId === undefined) {
      throw new AgentProtocolError({
        code: 'REMOTE_UNAVAILABLE',
        summary: 'The task prerequisite endpoint returned a malformed relationship.',
      });
    }
    return [
      {
        id: prerequisiteRelationshipId(row),
        task_definition_id: resolved.taskDefId,
        prerequisite_task_definition_id: prerequisiteId,
        required_status: prerequisiteStatusValue(row),
      },
    ];
  });

  const output: AgentTaskPrerequisitesOutput = {
    project_id: input.project_id,
    unit_id: resolved.unitId,
    task_definition_id: resolved.taskDefId,
    count: prerequisites.length,
    prerequisites,
  };
  if (
    Buffer.byteLength(JSON.stringify(output), 'utf8') >
    MAX_AGENT_TASK_OUTPUT_BYTES
  ) {
    throw new AgentProtocolError({
      code: 'REMOTE_UNAVAILABLE',
      summary: `OnTrack returned prerequisite data exceeding ${MAX_AGENT_TASK_OUTPUT_BYTES} bytes.`,
    });
  }
  return output;
}

interface TaskResourceDownloadRecord {
  readonly project_id: number;
  readonly unit_id: number | null;
  readonly unit_code: string | null;
  readonly task_definition_id: number;
  readonly task_instance_id: number | null;
  readonly task_id: number;
  readonly task_def_id: number;
  readonly abbreviation: string;
  readonly instantiated: boolean;
  readonly artifact: {
    readonly filename: string;
    readonly path: string;
    readonly bytes: number;
    readonly content_type: string;
    readonly sha256: string;
  };
}

interface TaskResourceUnavailableRecord {
  readonly project_id: number;
  readonly unit_id: number | null;
  readonly unit_code: string | null;
  readonly task_definition_id: number;
  readonly task_instance_id: number | null;
  readonly task_id: number;
  readonly task_def_id: number;
  readonly abbreviation: string;
  readonly instantiated: boolean;
  readonly reason: 'not_available';
}

export interface TaskResourceDownloadResult {
  readonly project_id: number;
  readonly selected_count: number;
  readonly downloaded_count: number;
  readonly unavailable_count: number;
  readonly downloads: readonly TaskResourceDownloadRecord[];
  readonly unavailable: readonly TaskResourceUnavailableRecord[];
}

function taskResourceIdentity(
  resolved: ResolvedTaskSelector,
): Omit<TaskResourceDownloadRecord, 'artifact'> {
  const identity = taskIdentityJson(resolved);
  const unitCode = resolved.unitCode
    ? safeTextForHumanDisplay(resolved.unitCode, 'unit')
    : null;
  return {
    project_id: resolved.project.id,
    unit_id: resolved.unitId ?? null,
    unit_code: unitCode,
    task_definition_id: identity.taskDefinitionId,
    task_instance_id: identity.taskInstanceId ?? null,
    task_id: identity.taskId,
    task_def_id: identity.taskDefId,
    abbreviation: safeTextForHumanDisplay(
      resolved.abbr,
      String(resolved.taskDefId),
    ),
    instantiated: resolved.task.isInstantiated === true,
  };
}

/** Download task resources through the shared artifact-safety writer. */
export async function downloadTaskResourceArtifacts(
  session: SessionData,
  api: OnTrackApiClient,
  resolvedItems: readonly ResolvedTaskSelector[],
  options: { readonly outDir?: string; readonly allowExternalDir?: boolean },
): Promise<TaskResourceDownloadResult> {
  const downloads: TaskResourceDownloadRecord[] = [];
  const unavailable: TaskResourceUnavailableRecord[] = [];
  let totalBytes = 0;

  for (const resolved of resolvedItems) {
    const identity = taskResourceIdentity(resolved);
    try {
      if (resolved.unitId === undefined) {
        throw new Error('Unit id not found for task resource download.');
      }
      const download = await api.downloadTaskResources(
        session,
        resolved.unitId,
        resolved.taskDefId,
      );
      if (
        exceedsByteBudget(
          totalBytes,
          download.buffer.byteLength,
          MAX_TASK_RESOURCE_BATCH_BYTES,
        )
      ) {
        throw new AgentProtocolError({
          code: 'INVALID_ARGUMENT',
          summary: `Task resource batch exceeds ${MAX_TASK_RESOURCE_BATCH_BYTES} bytes; use a narrower selector.`,
        });
      }
      const filename = buildTaskResourceFilename(
        resolved.unitCode,
        resolved.abbr,
        extname(contentDispositionFilename(download.contentDisposition) ?? '') || '.zip',
      );
      const filePath = await writeArtifactFile(download.buffer, filename, {
        root: process.cwd(),
        outDir: options.outDir,
        allowExternal: options.allowExternalDir,
      });
      totalBytes += download.buffer.byteLength;
      downloads.push({
        ...identity,
        artifact: {
          filename,
          path: relative(process.cwd(), filePath) || filename,
          bytes: download.buffer.byteLength,
          content_type: safeTextForHumanDisplay(
            download.contentType,
            'application/zip',
          ),
          sha256: createHash('sha256').update(download.buffer).digest('hex'),
        },
      });
    } catch (error) {
      if (!(error instanceof UnavailableDownloadError)) {
        throw error;
      }
      unavailable.push({ ...identity, reason: 'not_available' });
    }
  }

  return {
    project_id: resolvedItems[0]?.project.id ?? 0,
    selected_count: resolvedItems.length,
    downloaded_count: downloads.length,
    unavailable_count: unavailable.length,
    downloads,
    unavailable,
  };
}

export async function readAgentTaskResources(
  input: AgentTaskResourcesInput,
  session: SessionData,
  reportDiagnostic?: AuthDiagnosticSink,
): Promise<AgentTaskResourcesOutput> {
  const api = createAuthenticatedApi(session, reportDiagnostic);
  const projects = await loadProjectsWithTaskMetadata(
    api,
    session,
    { projectId: input.project_id },
    { strictMetadata: true },
  );
  const resolved = resolveTaskBatchSelector(projects, {
    projectId: input.project_id,
    taskDefinitionIds:
      !('task_definition_id' in input) || input.task_definition_id === undefined
        ? []
        : [input.task_definition_id],
    taskIds: [],
    abbrs: 'abbreviation' in input ? input.abbreviation ?? [] : [],
    allTasks: input.all_tasks,
  });
  if (resolved.length > MAX_AGENT_TASK_ITEMS) {
    throw new AgentProtocolError({
      code: 'INVALID_ARGUMENT',
      summary: `task.resources selected more than ${MAX_AGENT_TASK_ITEMS} tasks; use a narrower selector.`,
    });
  }

  const result = await downloadTaskResourceArtifacts(session, api, resolved, {
    outDir: input.out_dir,
    allowExternalDir: input.allow_external_dir,
  });
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_AGENT_TASK_OUTPUT_BYTES) {
    throw new AgentProtocolError({
      code: 'INVALID_ARGUMENT',
      summary: `task.resources response exceeds ${MAX_AGENT_TASK_OUTPUT_BYTES} bytes; use a narrower selector.`,
    });
  }
  return {
    ...result,
    downloads: [...result.downloads],
    unavailable: [...result.unavailable],
  };
}

function buildAgentTaskPdfOutput(
  resolved: ResolvedTaskSelector,
  unitId: number,
  download: DownloadResult,
  filePath: string,
  filename: string,
): AgentTaskPdfOutput {
  return {
    project_id: resolved.project.id,
    unit_id: unitId,
    unit_code: resolved.unitCode
      ? safeTextForHumanDisplay(resolved.unitCode, 'unit')
      : null,
    task_definition_id: resolved.taskDefId,
    task_instance_id: resolved.taskInstanceId ?? null,
    abbreviation: safeTextForHumanDisplay(resolved.abbr, String(resolved.taskDefId)),
    instantiated: resolved.task.isInstantiated === true,
    artifact: {
      filename,
      path: relative(process.cwd(), filePath) || filename,
      bytes: download.buffer.byteLength,
      content_type: safeTextForHumanDisplay(download.contentType, 'application/pdf'),
      sha256: createHash('sha256').update(download.buffer).digest('hex'),
    },
  };
}

/** Download one Task Definition's task sheet through the strict native contract. */
export async function readAgentTaskPdf(
  input: AgentTaskPdfInput,
  session: SessionData,
  reportDiagnostic?: AuthDiagnosticSink,
): Promise<AgentTaskPdfOutput> {
  const api = createAuthenticatedApi(session, reportDiagnostic);
  const projects = await loadProjectsWithTaskMetadata(
    api,
    session,
    { projectId: input.project_id },
    { strictMetadata: true },
  );
  const resolved = resolveTaskSelector(projects, {
    projectId: input.project_id,
    taskDefinitionId:
      'task_definition_id' in input ? input.task_definition_id : undefined,
    abbr: 'abbreviation' in input ? input.abbreviation : undefined,
  });
  const unitId = resolved.unitId;
  if (unitId === undefined) {
    throw new AgentProtocolError({
      code: 'INVALID_ARGUMENT',
      summary: 'The selected task has no unit identity for task PDF download.',
    });
  }
  const download = await api.downloadTaskPdf(
    session,
    unitId,
    resolved.taskDefId,
  );
  const filename = buildPdfFilename(resolved.unitCode, resolved.abbr, 'task');
  const filePath = await writeArtifactFile(download.buffer, filename, {
    root: process.cwd(),
    outDir: input.out_dir,
    allowExternal: input.allow_external_dir,
  });
  return buildAgentTaskPdfOutput(resolved, unitId, download, filePath, filename);
}

function requireAgentSubmissionPdfReady(
  resolved: ResolvedTaskSelector,
  details: SubmissionDetails,
): void {
  if (details.pdfState === 'processing') {
    throw new AgentProtocolError({
      code: 'CONFLICT',
      summary: 'The submission PDF is still processing.',
      retryable: true,
      nextActions: [
        {
          action: 'submission.status',
          arguments: {
            project_id: resolved.project.id,
            task_definition_id: resolved.taskDefId,
          },
        },
      ],
    });
  }
  if (details.pdfState === 'unavailable') {
    throw new AgentProtocolError({
      code: 'NOT_FOUND',
      summary: 'The submission PDF is not available.',
    });
  }
}

function buildAgentSubmissionPdfOutput(
  resolved: ResolvedTaskSelector,
  download: DownloadResult,
  filePath: string,
  filename: string,
): AgentSubmissionPdfOutput {
  return {
    project_id: resolved.project.id,
    unit_id: resolved.unitId ?? null,
    unit_code: resolved.unitCode
      ? safeTextForHumanDisplay(resolved.unitCode, 'unit')
      : null,
    task_definition_id: resolved.taskDefId,
    task_instance_id: resolved.taskInstanceId ?? null,
    abbreviation: safeTextForHumanDisplay(resolved.abbr, String(resolved.taskDefId)),
    instantiated: resolved.task.isInstantiated === true,
    has_pdf: true,
    processing_pdf: false,
    pdf_state: 'ready',
    submission_observed: true,
    artifact: {
      filename,
      path: relative(process.cwd(), filePath) || filename,
      bytes: download.buffer.byteLength,
      content_type: safeTextForHumanDisplay(download.contentType, 'application/pdf'),
      sha256: createHash('sha256').update(download.buffer).digest('hex'),
    },
  };
}

/** Download one ready submission PDF through the strict native contract. */
export async function readAgentSubmissionPdf(
  input: AgentSubmissionPdfInput,
  session: SessionData,
  reportDiagnostic?: AuthDiagnosticSink,
): Promise<AgentSubmissionPdfOutput> {
  const api = createAuthenticatedApi(session, reportDiagnostic);
  const projects = await loadProjectsWithTaskMetadata(
    api,
    session,
    { projectId: input.project_id },
    { strictMetadata: true },
  );
  const resolved = resolveTaskSelector(projects, {
    projectId: input.project_id,
    taskDefinitionId:
      'task_definition_id' in input ? input.task_definition_id : undefined,
    abbr: 'abbreviation' in input ? input.abbreviation : undefined,
  });
  const details = parseStrictSubmissionDetails(
    await api.getSubmissionDetails(session, resolved.project.id, resolved.taskDefId),
  );
  requireAgentSubmissionPdfReady(resolved, details);
  const download = await api.downloadSubmissionPdf(
    session,
    resolved.project.id,
    resolved.taskDefId,
  );
  const filename = buildPdfFilename(resolved.unitCode, resolved.abbr, 'submission');
  const filePath = await writeArtifactFile(download.buffer, filename, {
    root: process.cwd(),
    outDir: input.out_dir,
    allowExternal: input.allow_external_dir,
  });
  return buildAgentSubmissionPdfOutput(resolved, download, filePath, filename);
}

export async function readAgentSubmissionStatus(
  input: AgentSubmissionStatusInput,
  session: SessionData,
  reportDiagnostic?: AuthDiagnosticSink,
): Promise<AgentSubmissionStatusOutput> {
  const api = createAuthenticatedApi(session, reportDiagnostic);
  const projects = await loadProjectsWithTaskMetadata(
    api,
    session,
    { projectId: input.project_id },
    { strictMetadata: true },
  );
  const resolved = resolveTaskSelector(projects, {
    projectId: input.project_id,
    taskDefinitionId:
      'task_definition_id' in input ? input.task_definition_id : undefined,
    abbr: 'abbreviation' in input ? input.abbreviation : undefined,
  });
  const details = parseStrictSubmissionDetails(
    await api.getSubmissionDetails(
      session,
      resolved.project.id,
      resolved.taskDefId,
    ),
  );
  return buildAgentSubmissionStatusOutput(resolved, details);
}

function buildAgentSubmissionStatusOutput(
  resolved: ResolvedTaskSelector,
  details: SubmissionDetails,
): AgentSubmissionStatusOutput {
  const output = {
    project_id: resolved.project.id,
    unit_id: resolved.unitId ?? null,
    unit_code: resolved.unitCode ?? null,
    task_definition_id: resolved.taskDefId,
    task_instance_id: resolved.taskInstanceId ?? null,
    abbreviation: resolved.abbr,
    instantiated: resolved.task.isInstantiated === true,
    has_pdf: details.hasPdf,
    processing_pdf: details.processingPdf,
    pdf_state: details.pdfState,
    submission_date: details.submissionDate ?? null,
    task_status: details.taskStatus ?? null,
    submission_observed: isSubmissionObserved(details),
  };
  const parsedOutput = agentSubmissionStatusOutputSchema.safeParse(output);
  if (!parsedOutput.success) {
    throw new AgentProtocolError({
      code: 'INTERNAL_ERROR',
      summary: 'The submission.status output failed contract validation.',
    });
  }
  if (
    Buffer.byteLength(JSON.stringify(parsedOutput.data), 'utf8') >
    MAX_AGENT_SUBMISSION_STATUS_OUTPUT_BYTES
  ) {
    throw new AgentProtocolError({
      code: 'INTERNAL_ERROR',
      summary: 'The submission.status output exceeded its safety limit.',
    });
  }
  return parsedOutput.data;
}
