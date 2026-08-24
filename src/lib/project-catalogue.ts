/**
 * Project catalogue loading: fetch project overviews, enrich them with
 * project detail payloads and unit task-definition metadata, and tolerate
 * per-project read failures by falling back to the overview payload.
 * Shared by the CLI task commands and the TUI data loader.
 */
import {
  AGENT_REMOTE_READ_CONCURRENCY,
  settleWithConcurrency,
} from './async-pool.js';
import { OnTrackApiClient } from './api.js';
import { AgentProtocolError } from './agent-protocol.js';
import { OnTrackHttpError } from './auth.js';
import { createOnTrackAuthBroker } from './auth-broker.js';
import {
  reportAuthDiagnosticToStderr,
  type AuthDiagnosticSink,
} from './auth-diagnostic.js';
import type {
  ProjectSummary,
  SessionData,
  TaskDefinitionSummary,
  UnitSummary,
} from './types.js';
import { getTaskDefinitionId } from './utils.js';

/**
 * Build an API client that may refresh and replay one failed read. Mutations
 * are never replayed because the protocol layer restricts this callback to
 * GET/HEAD requests.
 */
export function createAuthenticatedApi(
  session: SessionData,
  reportDiagnostic: AuthDiagnosticSink = reportAuthDiagnosticToStderr,
): OnTrackApiClient {
  const broker = createOnTrackAuthBroker(
    { baseUrl: session.baseUrl },
    { reportDiagnostic },
  );
  return new OnTrackApiClient(session.baseUrl, {
    refreshSession: async () => {
      const result = await broker.ensure({
        minTtlSeconds: 0,
        interaction: 'never',
        forceRefresh: true,
      });
      return result.status === 'ready' ? broker.currentSession() : null;
    },
  });
}

export function projectUnitId(project: ProjectSummary): number | undefined {
  const nested = project.unit?.id;
  if (typeof nested === 'number' && Number.isInteger(nested)) {
    return nested;
  }

  const record = project as Record<string, unknown>;
  const candidates = [record.unitId, record.unit_id];
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isInteger(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export function getUnitTaskDefinitions(
  unit: UnitSummary | undefined,
): TaskDefinitionSummary[] {
  if (!unit) {
    return [];
  }
  const defs = unit.taskDefinitions ?? unit.task_definitions;
  if (!Array.isArray(defs)) {
    return [];
  }
  return defs;
}

/** Apply optional project/unit scoping to project lists. */
export function projectMatchesScope(
  project: ProjectSummary,
  scope: { projectId?: number; unitId?: number },
): boolean {
  if (scope.projectId !== undefined && project.id !== scope.projectId) {
    return false;
  }
  if (scope.unitId !== undefined && projectUnitId(project) !== scope.unitId) {
    return false;
  }
  return true;
}

function settleMetadataReads<T>(
  tasks: readonly (() => Promise<T>)[],
  agentTransport: boolean,
): Promise<PromiseSettledResult<T>[]> {
  return agentTransport
    ? settleWithConcurrency(tasks, AGENT_REMOTE_READ_CONCURRENCY)
    : Promise.allSettled(tasks.map((task) => task()));
}

/**
 * Load projects and progressively enrich with:
 * - project detail payloads (when accessible)
 * - unit definition metadata (for task names/abbr/upload requirements)
 */
export async function loadProjectsWithTaskMetadata(
  api: OnTrackApiClient,
  session: SessionData,
  scope: { projectId?: number; unitId?: number } = {},
  options: {
    readonly strictMetadata?: boolean;
    /** Use the bounded, canonical Agent transport for every remote read. */
    readonly agentTransport?: boolean;
  } = {},
): Promise<ProjectSummary[]> {
  // Step 1: fetch project overview first (fast, broad visibility).
  const directAgentProject =
    options.agentTransport && scope.projectId !== undefined
      ? await api.getProjectForAgent(session, scope.projectId)
      : undefined;
  if (directAgentProject && directAgentProject.id !== scope.projectId) {
    throw new AgentProtocolError({
      code: 'REMOTE_UNAVAILABLE',
      summary:
        'OnTrack returned an unexpected project identity for the Agent scope.',
    });
  }
  const overview = directAgentProject
    ? [directAgentProject]
    : await (options.agentTransport
        ? api.listProjectsForAgent(session)
        : api.listProjects(session));
  if (options.agentTransport && overview.length > 200) {
    throw new AgentProtocolError({
      code: 'REMOTE_UNAVAILABLE',
      summary: 'OnTrack returned more than 200 projects for the Agent watch.',
    });
  }
  const scopedOverview = overview.filter((project) =>
    projectMatchesScope(project, scope),
  );
  if (scopedOverview.length === 0) {
    return [];
  }

  // Step 2: enrich with project details when accessible (fallback to overview on failure).
  const detailedResults: PromiseSettledResult<ProjectSummary>[] =
    directAgentProject
      ? [{ status: 'fulfilled', value: directAgentProject }]
      : await settleMetadataReads(
          scopedOverview.map((project) => () =>
            options.agentTransport
              ? api.getProjectForAgent(session, project.id)
              : api.getProject(session, project.id),
          ),
          options.agentTransport ?? false,
        );

  const projects: ProjectSummary[] = [];
  for (let index = 0; index < detailedResults.length; index += 1) {
    const result = detailedResults[index];
    if (result.status === 'fulfilled') {
      projects.push(result.value);
      continue;
    }

    if (
      options.strictMetadata ||
      (result.reason instanceof OnTrackHttpError &&
        result.reason.authFailure !== 'other')
    ) {
      throw result.reason;
    }

    // fallback to overview when project detail endpoint is unavailable
    projects.push(scopedOverview[index]);
  }

  // Step 3: enrich with unit task-definition metadata to recover missing task fields.
  const unitIds = [
    ...new Set(
      projects
        .map((project) => projectUnitId(project))
        .filter((id): id is number => typeof id === 'number'),
    ),
  ];

  const unitResults = await settleMetadataReads(
    unitIds.map((unitId) => () =>
      options.agentTransport
        ? api.getUnitForAgent(session, unitId)
        : api.getUnit(session, unitId),
    ),
    options.agentTransport ?? false,
  );

  const unitMap = new Map<number, UnitSummary>();
  const unitDefinitionMap = new Map<
    number,
    Map<number, TaskDefinitionSummary>
  >();
  for (let index = 0; index < unitResults.length; index += 1) {
    const result = unitResults[index];
    if (result.status !== 'fulfilled') {
      if (
        options.strictMetadata ||
        (result.reason instanceof OnTrackHttpError &&
          result.reason.authFailure !== 'other')
      ) {
        throw result.reason;
      }
      continue;
    }

    const unit = result.value;
    unitMap.set(unit.id, unit);
    unitDefinitionMap.set(
      unit.id,
      new Map(
        getUnitTaskDefinitions(unit)
          .filter((definition) => typeof definition.id === 'number')
          .map((definition) => [definition.id as number, definition]),
      ),
    );
  }

  return projects.map((project) => {
    const unitId = projectUnitId(project);
    const fullUnit = unitId !== undefined ? unitMap.get(unitId) : undefined;
    const taskDefinitions =
      unitId !== undefined ? unitDefinitionMap.get(unitId) : undefined;

    const projectUnit =
      project.unit ?? (unitId !== undefined ? { id: unitId } : undefined);
    const mergedUnit = fullUnit
      ? {
          ...projectUnit,
          ...fullUnit,
        }
      : projectUnit;

    const mergedTasks = (project.tasks || []).map((task) => {
      const taskDefId = getTaskDefinitionId(task);
      const taskDefinition =
        taskDefId !== undefined ? taskDefinitions?.get(taskDefId) : undefined;
      return {
        ...task,
        definition: {
          id: taskDefId,
          abbreviation:
            task.definition?.abbreviation ?? taskDefinition?.abbreviation,
          name: task.definition?.name ?? taskDefinition?.name,
          targetGrade:
            task.definition?.targetGrade ?? taskDefinition?.targetGrade,
          uploadRequirements:
            task.definition?.uploadRequirements ??
            task.definition?.upload_requirements ??
            taskDefinition?.uploadRequirements ??
            taskDefinition?.upload_requirements,
          upload_requirements:
            task.definition?.upload_requirements ??
            task.definition?.uploadRequirements ??
            taskDefinition?.upload_requirements ??
            taskDefinition?.uploadRequirements,
        },
      };
    });

    return {
      ...project,
      unit: mergedUnit,
      tasks: mergedTasks,
    };
  });
}
