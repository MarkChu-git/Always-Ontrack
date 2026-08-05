import type {
  AgentPlanShowInput,
  AgentPlanShowOutput,
} from './agent-commands.js';
import { agentPlanShowOutputSchema } from './agent-commands.js';
import { AgentProtocolError } from './agent-protocol.js';
import {
  buildPlannerViews,
  type RawTaskPrerequisite,
} from './planner.js';
import { buildStudentTaskViews } from './student-task-view.js';
import type { ProjectSummary } from './types.js';

const MAX_PLAN_TASKS = 200;
const MAX_PLAN_PREREQUISITES = 200;
const MAX_PLAN_OUTPUT_BYTES = 512 * 1024;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

function remoteFailure(summary: string): never {
  throw new AgentProtocolError({ code: 'REMOTE_UNAVAILABLE', summary });
}

function own(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function recordValue(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    remoteFailure(`OnTrack returned malformed ${context} metadata.`);
  }
  return value as Record<string, unknown>;
}

function positiveInteger(value: unknown, context: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    remoteFailure(`OnTrack returned an invalid ${context}.`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, context: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    remoteFailure(`OnTrack returned an invalid ${context}.`);
  }
  return value;
}

function safeText(value: unknown, maxLength: number, context: string): string {
  if (typeof value !== 'string') {
    remoteFailure(`OnTrack returned an invalid ${context}.`);
  }
  if (CONTROL_CHARACTERS.test(value)) {
    remoteFailure(`OnTrack returned an invalid ${context}.`);
  }
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > maxLength
  ) {
    remoteFailure(`OnTrack returned an invalid ${context}.`);
  }
  return normalized;
}

function aliasValues(
  record: Record<string, unknown>,
  keys: readonly string[],
): unknown[] {
  const values = keys
    .filter((key) => own(record, key))
    .map((key) => record[key]);
  const present = values.filter((value) => value !== undefined && value !== null);
  if (present.length > 0 && present.length !== values.length) {
    remoteFailure('OnTrack returned conflicting null/alias values.');
  }
  return present;
}

function pairedPositiveInteger(
  record: Record<string, unknown>,
  keys: readonly string[],
  context: string,
  required = false,
): number | undefined {
  const values = aliasValues(record, keys).map((value) =>
    positiveInteger(value, context)
  );
  if (values.length === 0) {
    if (required) {
      remoteFailure(`OnTrack omitted ${context}.`);
    }
    return undefined;
  }
  if (values.some((value) => value !== values[0])) {
    remoteFailure(`OnTrack returned conflicting ${context} aliases.`);
  }
  return values[0];
}

function pairedNonNegativeInteger(
  record: Record<string, unknown>,
  keys: readonly string[],
  context: string,
): number | undefined {
  const values = aliasValues(record, keys).map((value) =>
    nonNegativeInteger(value, context)
  );
  if (values.length === 0) {
    return undefined;
  }
  if (values.some((value) => value !== values[0])) {
    remoteFailure(`OnTrack returned conflicting ${context} aliases.`);
  }
  return values[0];
}

function pairedText(
  record: Record<string, unknown>,
  keys: readonly string[],
  maxLength: number,
  context: string,
  required = false,
): string | undefined {
  const values = aliasValues(record, keys).map((value) =>
    safeText(value, maxLength, context)
  );
  if (values.length === 0) {
    if (required) {
      remoteFailure(`OnTrack omitted ${context}.`);
    }
    return undefined;
  }
  if (values.some((value) => value !== values[0])) {
    remoteFailure(`OnTrack returned conflicting ${context} aliases.`);
  }
  return values[0];
}

function pairedBoolean(
  record: Record<string, unknown>,
  keys: readonly string[],
  context: string,
): boolean | undefined {
  const values = aliasValues(record, keys);
  if (values.some((value) => typeof value !== 'boolean')) {
    remoteFailure(`OnTrack returned an invalid ${context}.`);
  }
  if (values.length === 0) {
    return undefined;
  }
  if (values.some((value) => value !== values[0])) {
    remoteFailure(`OnTrack returned conflicting ${context} aliases.`);
  }
  return values[0] as boolean;
}

function calendarDate(value: unknown, context: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    remoteFailure(`OnTrack returned an invalid ${context}.`);
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    remoteFailure(`OnTrack returned an invalid ${context}.`);
  }
  return value;
}

function pairedDate(
  record: Record<string, unknown>,
  keys: readonly string[],
  context: string,
): string | undefined {
  const values = aliasValues(record, keys).map((value) =>
    calendarDate(value, context)
  );
  if (values.length === 0) {
    return undefined;
  }
  if (values.some((value) => value !== values[0])) {
    remoteFailure(`OnTrack returned conflicting ${context} aliases.`);
  }
  return values[0];
}

function pairedArray(
  record: Record<string, unknown>,
  keys: readonly string[],
  context: string,
): unknown[] | undefined {
  const values = aliasValues(record, keys);
  if (values.some((value) => !Array.isArray(value))) {
    remoteFailure(`OnTrack returned invalid ${context} metadata.`);
  }
  if (values.length === 0) {
    return undefined;
  }
  const arrays = values as unknown[][];
  if (arrays.slice(1).some((value) => JSON.stringify(value) !== JSON.stringify(arrays[0]))) {
    remoteFailure(`OnTrack returned conflicting ${context} aliases.`);
  }
  return arrays[0];
}

function validateGradeDates(
  definition: Record<string, unknown>,
  projectTargetGrade: number | undefined,
): void {
  const rows = pairedArray(
    definition,
    ['gradeDueDates', 'grade_due_dates'],
    'grade date',
  );
  if (!rows) {
    return;
  }
  if (rows.length > MAX_PLAN_TASKS) {
    remoteFailure('OnTrack returned too many grade date rows.');
  }
  let matchingRows = 0;
  for (const rawRow of rows) {
    const row = recordValue(rawRow, 'grade date row');
    const grade = pairedNonNegativeInteger(
      row,
      ['targetGrade', 'target_grade'],
      'grade date target grade',
    );
    if (grade === undefined) {
      remoteFailure('OnTrack omitted a grade date target grade.');
    }
    if (grade !== projectTargetGrade) {
      continue;
    }
    matchingRows += 1;
    pairedDate(row, ['startDate', 'start_date'], 'grade default start date');
    pairedDate(
      row,
      ['targetDueDate', 'target_due_date'],
      'grade default target date',
    );
  }
  if (matchingRows > 1) {
    remoteFailure('OnTrack returned ambiguous grade default dates.');
  }
}

function validateProjectMetadata(project: ProjectSummary): {
  readonly unitId: number;
  readonly unitCode: string | null;
  readonly currentStatusByDefinition: ReadonlyMap<number, string>;
} {
  const projectRecord = recordValue(project, 'project');
  positiveInteger(projectRecord.id, 'project id');
  const projectTargetGrade = pairedNonNegativeInteger(
    projectRecord,
    ['targetGrade', 'target_grade'],
    'project target grade',
  );
  const unit = recordValue(projectRecord.unit, 'project unit');
  const unitId = positiveInteger(unit.id, 'unit id');
  const unitCode = own(unit, 'code') && unit.code !== undefined && unit.code !== null
    ? safeText(unit.code, 80, 'unit code')
    : null;
  const flexibleDates = pairedBoolean(
    unit,
    ['allowFlexibleDates', 'allow_flexible_dates'],
    'flexible-date flag',
  );
  if (flexibleDates === undefined) {
    remoteFailure('OnTrack omitted the unit flexible-date capability.');
  }

  const definitions = pairedArray(
    unit,
    ['taskDefinitions', 'task_definitions'],
    'task definition',
  ) ?? [];
  if (definitions.length > MAX_PLAN_TASKS) {
    remoteFailure(`OnTrack returned more than ${MAX_PLAN_TASKS} task definitions.`);
  }
  const definitionIds = new Set<number>();
  for (const rawDefinition of definitions) {
    const definition = recordValue(rawDefinition, 'task definition');
    const definitionId = positiveInteger(definition.id, 'task definition id');
    if (definitionIds.has(definitionId)) {
      remoteFailure('OnTrack returned duplicate task definition ids.');
    }
    definitionIds.add(definitionId);
    pairedText(definition, ['abbreviation'], 80, 'task abbreviation', true);
    pairedText(definition, ['name'], 512, 'task name');
    pairedNonNegativeInteger(
      definition,
      ['targetGrade', 'target_grade'],
      'task target grade',
    );
    pairedText(
      definition,
      ['tutorialStreamAbbr', 'tutorial_stream_abbr'],
      80,
      'tutorial stream abbreviation',
    );
    pairedDate(definition, ['startDate', 'start_date'], 'unit default start date');
    pairedDate(definition, ['targetDate', 'target_date'], 'unit default target date');
    pairedDate(definition, ['dueDate', 'due_date'], 'feedback deadline');
    validateGradeDates(definition, projectTargetGrade);
  }
  const currentStatusByDefinition = new Map<number, string>(
    [...definitionIds].map((definitionId) => [definitionId, 'not_instantiated']),
  );

  const tasksValue = projectRecord.tasks;
  if (tasksValue !== undefined && tasksValue !== null && !Array.isArray(tasksValue)) {
    remoteFailure('OnTrack returned invalid project task metadata.');
  }
  const tasks = Array.isArray(tasksValue) ? tasksValue : [];
  if (tasks.length > MAX_PLAN_TASKS) {
    remoteFailure(`OnTrack returned more than ${MAX_PLAN_TASKS} task instances.`);
  }
  const instanceIds = new Set<number>();
  const instantiatedDefinitions = new Set<number>();
  for (const rawTask of tasks) {
    const task = recordValue(rawTask, 'task instance');
    const instanceId = positiveInteger(task.id, 'task instance id');
    if (instanceIds.has(instanceId)) {
      remoteFailure('OnTrack returned duplicate task instance ids.');
    }
    instanceIds.add(instanceId);
    const definitionRecord =
      typeof task.definition === 'object' && task.definition !== null
        ? recordValue(task.definition, 'embedded task definition')
        : undefined;
    const definitionIdsForTask = [
      ...aliasValues(task, ['taskDefinitionId', 'task_definition_id']),
      ...(definitionRecord && own(definitionRecord, 'id')
        ? [definitionRecord.id]
        : []),
    ].filter((value) => value !== undefined && value !== null)
      .map((value) => positiveInteger(value, 'task definition id'));
    if (definitionIdsForTask.length === 0) {
      remoteFailure('OnTrack omitted a task instance definition id.');
    }
    if (definitionIdsForTask.some((value) => value !== definitionIdsForTask[0])) {
      remoteFailure('OnTrack returned conflicting task definition id aliases.');
    }
    const definitionId = definitionIdsForTask[0] as number;
    if (!definitionIds.has(definitionId)) {
      remoteFailure('OnTrack returned a task instance outside the unit definition catalogue.');
    }
    if (instantiatedDefinitions.has(definitionId)) {
      remoteFailure('OnTrack returned multiple instances for one task definition.');
    }
    instantiatedDefinitions.add(definitionId);
    const status = pairedText(task, ['status'], 80, 'task status', true) as string;
    currentStatusByDefinition.set(definitionId, status);
    pairedDate(task, ['targetStartDate', 'target_start_date'], 'personal start date');
    pairedDate(task, ['targetDueDate', 'target_due_date'], 'personal target date');
  }
  return { unitId, unitCode, currentStatusByDefinition };
}

function normalizePrerequisites(raw: unknown): RawTaskPrerequisite[] {
  if (!Array.isArray(raw)) {
    remoteFailure('OnTrack returned an invalid prerequisite response shape.');
  }
  if (raw.length > MAX_PLAN_PREREQUISITES) {
    remoteFailure(
      `OnTrack returned more than ${MAX_PLAN_PREREQUISITES} prerequisite relationships.`,
    );
  }
  const normalized: RawTaskPrerequisite[] = [];
  const statuses = new Map<string, string>();
  for (const rawRow of raw) {
    const row = recordValue(rawRow, 'prerequisite relationship');
    if (own(row, 'id')) {
      positiveInteger(row.id, 'prerequisite relationship id');
    }
    const dependentId = pairedPositiveInteger(
      row,
      ['task_definition_id', 'taskDefinitionId'],
      'dependent task definition id',
      true,
    ) as number;
    const prerequisiteId = pairedPositiveInteger(
      row,
      ['prerequisite_id', 'prerequisiteId'],
      'prerequisite task definition id',
      true,
    ) as number;
    const status = pairedText(
      row,
      ['task_status', 'taskStatus'],
      80,
      'prerequisite task status',
    ) ?? 'unknown';
    const key = `${dependentId}:${prerequisiteId}`;
    const existing = statuses.get(key);
    if (existing !== undefined) {
      if (existing !== status) {
        remoteFailure('OnTrack returned conflicting duplicate prerequisite relationships.');
      }
      continue;
    }
    statuses.set(key, status);
    normalized.push({
      task_definition_id: dependentId,
      prerequisite_id: prerequisiteId,
      task_status: status,
    });
  }
  return normalized;
}

/** Strict canonical projection for native and compatibility `plan.show`. */
export function buildAgentPlanShowOutput(
  projects: ProjectSummary[],
  rawPrerequisites: unknown,
  input: AgentPlanShowInput,
): AgentPlanShowOutput {
  const project = projects.find((candidate) => candidate.id === input.project_id);
  if (!project) {
    throw new AgentProtocolError({
      code: 'NOT_FOUND',
      summary: `Project ${input.project_id} was not found.`,
    });
  }
  if (projects.length !== 1) {
    remoteFailure('OnTrack returned an ambiguous project scope.');
  }
  const { unitId, unitCode, currentStatusByDefinition } = validateProjectMetadata(project);
  const prerequisites = normalizePrerequisites(rawPrerequisites);
  const includeBeyondTarget = input.include_beyond_target === true;
  let views;
  try {
    views = buildStudentTaskViews(projects, {
      includeBeyondTarget,
      includeTutorialMismatches: true,
      includeUnknown: true,
    });
  } catch (error) {
    if (error instanceof AgentProtocolError) {
      throw error;
    }
    throw new AgentProtocolError({
      code: 'REMOTE_UNAVAILABLE',
      summary: 'OnTrack returned inconsistent planner task metadata.',
      cause: error,
    });
  }
  if (views.length > MAX_PLAN_TASKS) {
    remoteFailure(`OnTrack returned more than ${MAX_PLAN_TASKS} visible plan tasks.`);
  }
  const plans = buildPlannerViews(views, prerequisites);
  const output = {
    project_id: input.project_id,
    unit_id: unitId,
    unit_code: unitCode,
    include_beyond_target: includeBeyondTarget,
    count: views.length,
    tasks: views.map((view, index) => {
      const plan = plans[index];
      if (!plan?.abbreviation) {
        remoteFailure('OnTrack omitted a visible plan task abbreviation.');
      }
      return {
        task_definition_id: view.reference.taskDefinitionId,
        task_instance_id: view.taskInstanceId ?? null,
        abbreviation: plan.abbreviation,
        name: plan.name ?? null,
        status: view.status,
        instantiated: view.taskInstanceId !== undefined,
        visibility: view.visibility,
        flexible_dates: plan.flexibleDates,
        start: { ...plan.start, value: plan.start.value ?? null },
        target: { ...plan.target, value: plan.target.value ?? null },
        feedback_deadline: {
          ...plan.feedbackDeadline,
          value: plan.feedbackDeadline.value ?? null,
        },
        prerequisites: plan.prerequisites.map((item) => ({
          task_definition_id: item.taskDefinitionId,
          required_status: item.requiredStatus,
          current_status: currentStatusByDefinition.get(item.taskDefinitionId) ?? null,
        })),
      };
    }),
  };
  const parsed = agentPlanShowOutputSchema.safeParse(output);
  if (!parsed.success) {
    throw new AgentProtocolError({
      code: 'INTERNAL_ERROR',
      summary: 'The plan.show output failed contract validation.',
    });
  }
  if (Buffer.byteLength(JSON.stringify(parsed.data), 'utf8') > MAX_PLAN_OUTPUT_BYTES) {
    remoteFailure(`OnTrack returned planner data exceeding ${MAX_PLAN_OUTPUT_BYTES} bytes.`);
  }
  return parsed.data;
}
