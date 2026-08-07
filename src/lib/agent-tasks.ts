import {
  agentTasksListOutputSchema,
  type AgentTasksListInput,
  type AgentTasksListOutput,
} from './agent-commands.js';
import {
  AgentProtocolError,
  agentSuccessEnvelope,
} from './agent-protocol.js';
import { remoteContractFailure as remoteFailure } from './agent-contract.js';
import {
  canonicalTaskCatalogueProject,
  canonicalTaskCatalogueUnit,
  type AgentProjectUnitSource,
} from './agent-project-unit-canonical.js';
import {
  buildStudentTaskViews,
  type StudentTaskView,
} from './student-task-view.js';
import type {
  ProjectSummary,
  UnitSummary,
} from './types.js';

/** Compatibility name retained for callers that import the task catalogue source. */
export interface AgentTasksListSource extends AgentProjectUnitSource {}
export { createAgentTutorialsStatus } from './agent-tutorials.js';

const MAX_AGENT_TASKS = 200;
const MAX_AGENT_TASKS_OUTPUT_BYTES = 512 * 1024;
const MAX_AGENT_REQUEST_ID = `req_${'x'.repeat(120)}`;

type AgentTaskCatalogueItem = AgentTasksListOutput['tasks'][number];

function completeAgentEnvelopeBytes(output: AgentTasksListOutput): number {
  return Buffer.byteLength(
    JSON.stringify(
      agentSuccessEnvelope({
        command: 'tasks.list',
        requestId: MAX_AGENT_REQUEST_ID,
        data: output,
      }),
      null,
      2,
    ),
    'utf8',
  );
}

function assertAuthoritativeTaskDefinitions(
  project: ProjectSummary,
  unit: UnitSummary,
): void {
  const definitionIds = new Set(
    (unit.taskDefinitions ?? unit.task_definitions ?? []).map(
      (definition) => definition.id,
    ),
  );
  const hasOrphan = (project.tasks ?? []).some(
    (task) =>
      task.taskDefinitionId === undefined ||
      !definitionIds.has(task.taskDefinitionId),
  );
  if (hasOrphan) {
    remoteFailure(
      'OnTrack returned a task instance without an authoritative task definition.',
    );
  }
}

function buildVisibleStudentTaskViews(
  project: ProjectSummary,
  unit: UnitSummary,
): StudentTaskView[] {
  const views = buildStudentTaskViews(
    [{ ...project, unit }],
    {
      includeBeyondTarget: true,
      includeTutorialMismatches: true,
      includeUnknown: true,
    },
  );
  if (views.some((view) => view.visibility === 'unknown')) {
    remoteFailure('OnTrack returned insufficient task visibility metadata.');
  }
  return views.filter((view) => view.visibility === 'within_target');
}

function catalogueItem(view: StudentTaskView): AgentTaskCatalogueItem {
  const abbreviation = view.definition.abbreviation;
  if (typeof abbreviation !== 'string' || abbreviation.trim().length === 0) {
    remoteFailure('OnTrack returned a task without an authoritative abbreviation.');
  }
  return {
    project_id: view.reference.projectId,
    unit_id: view.reference.unitId,
    unit_code: view.unitCode ?? null,
    task_definition_id: view.reference.taskDefinitionId,
    task_instance_id: view.taskInstanceId ?? null,
    abbreviation,
    name: view.definition.name ?? null,
    status: view.status,
    due_date: view.dates.effectiveDue ?? null,
    completion_date: view.dates.completion ?? null,
    instantiated: view.taskInstanceId !== undefined,
    visibility: 'within_target',
  };
}

function catalogueItems(
  input: AgentTasksListInput,
  project: ProjectSummary,
  unit: UnitSummary,
): AgentTaskCatalogueItem[] {
  const status = input.status?.trim().toLocaleLowerCase('en-US');
  const tasks = buildVisibleStudentTaskViews(project, unit)
    .filter(
      (view) =>
        status === undefined ||
        view.status.toLocaleLowerCase('en-US') === status,
    )
    .map(catalogueItem);
  if (tasks.length > MAX_AGENT_TASKS) {
    remoteFailure(`OnTrack returned more than ${MAX_AGENT_TASKS} visible tasks.`);
  }
  return tasks;
}

function validateOutput(tasks: AgentTaskCatalogueItem[]): AgentTasksListOutput {
  const parsed = agentTasksListOutputSchema.safeParse({ count: tasks.length, tasks });
  if (!parsed.success) {
    throw new AgentProtocolError({
      code: 'INTERNAL_ERROR',
      summary: 'The tasks.list output failed contract validation.',
    });
  }
  if (completeAgentEnvelopeBytes(parsed.data) > MAX_AGENT_TASKS_OUTPUT_BYTES) {
    remoteFailure('OnTrack returned task data exceeding the output safety limit.');
  }
  return parsed.data;
}

function buildOutput(
  input: AgentTasksListInput,
  rawProject: unknown,
  rawUnit: unknown,
): AgentTasksListOutput {
  const project = canonicalTaskCatalogueProject(
    rawProject,
    input.project_id,
    input.unit_id,
  );
  const unitId = project.unit?.id;
  if (unitId === undefined) {
    remoteFailure('OnTrack omitted unit id.');
  }
  const unit = canonicalTaskCatalogueUnit(rawUnit, unitId);
  assertAuthoritativeTaskDefinitions(project, unit);
  return validateOutput(catalogueItems(input, project, unit));
}

/** Create the project-scoped, definition-first Student Task View catalogue. */
export function createAgentTasksList(
  source: AgentProjectUnitSource,
): (input: AgentTasksListInput) => Promise<AgentTasksListOutput> {
  return async (input) => {
    const rawProject = await source.readProject(input.project_id);
    const project = canonicalTaskCatalogueProject(
      rawProject,
      input.project_id,
      input.unit_id,
    );
    const unitId = project.unit?.id;
    if (unitId === undefined) {
      remoteFailure('OnTrack omitted unit id.');
    }
    return buildOutput(input, rawProject, await source.readUnit(unitId));
  };
}
