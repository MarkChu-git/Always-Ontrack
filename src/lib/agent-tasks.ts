import {
  AGENT_TASKS_LIST_MAX_STATUS_LENGTH,
  agentTasksListOutputSchema,
  type AgentTasksListInput,
  type AgentTasksListOutput,
} from './agent-commands.js';
import {
  AgentProtocolError,
  agentSuccessEnvelope,
} from './agent-protocol.js';
import {
  contractAliasedValue as aliasedValue,
  contractNonNegativeInteger as nonNegativeInteger,
  contractPositiveInteger as positiveInteger,
  contractProjectUnit,
  contractRecord as recordValue,
  contractSafeText as safeText,
  hasOwnField as own,
  remoteContractFailure as remoteFailure,
  requiredContractPositiveInteger as requiredPositiveInteger,
} from './agent-contract.js';
import {
  buildStudentTaskViews,
  type StudentTaskView,
} from './student-task-view.js';
import type {
  ProjectSummary,
  TaskDefinitionSummary,
  TaskSummary,
  UnitSummary,
} from './types.js';

const MAX_AGENT_TASKS = 200;
const MAX_AGENT_TASKS_OUTPUT_BYTES = 512 * 1024;
const MAX_AGENT_REQUEST_ID = `req_${'x'.repeat(120)}`;

type AgentTaskCatalogueItem = AgentTasksListOutput['tasks'][number];

export interface AgentTasksListSource {
  readProject(projectId: number): Promise<unknown>;
  readUnit(unitId: number): Promise<unknown>;
}

function invalidArgument(summary: string): never {
  throw new AgentProtocolError({ code: 'INVALID_ARGUMENT', summary });
}

function aliasedArray(
  record: Record<string, unknown>,
  keys: readonly string[],
  context: string,
  required: true,
): unknown[];
function aliasedArray(
  record: Record<string, unknown>,
  keys: readonly string[],
  context: string,
  required: false,
): unknown[] | undefined;
function aliasedArray(
  record: Record<string, unknown>,
  keys: readonly string[],
  context: string,
  required: boolean,
): unknown[] | undefined {
  const presentKeys = keys.filter((key) => own(record, key));
  if (presentKeys.length === 0) {
    if (required) {
      remoteFailure(`OnTrack omitted ${context}.`);
    }
    return undefined;
  }
  const values = presentKeys.map((key) => record[key]);
  if (values.some((value) => !Array.isArray(value))) {
    remoteFailure(`OnTrack returned an invalid ${context}.`);
  }
  if (
    values.length > 1 &&
    values.slice(1).some((value) => JSON.stringify(value) !== JSON.stringify(values[0]))
  ) {
    remoteFailure(`OnTrack returned conflicting ${context} aliases.`);
  }
  return values[0] as unknown[];
}

function canonicalTaskDefinition(raw: unknown): TaskDefinitionSummary {
  const definition = recordValue(raw, 'task definition');
  const id = requiredPositiveInteger(definition, ['id'], 'task definition id');
  const abbreviation = aliasedValue(
    definition,
    ['abbreviation', 'abbr'],
    'task abbreviation',
    (value, context) => safeText(value, 80, context),
  );
  if (abbreviation === null) {
    remoteFailure('OnTrack omitted task abbreviation.');
  }
  const name = aliasedValue(definition, ['name'], 'task name', (value, context) =>
    safeText(value, 512, context));
  const targetGrade = aliasedValue(
    definition,
    ['targetGrade', 'target_grade'],
    'task target grade',
    nonNegativeInteger,
  );
  const tutorialStream = aliasedValue(
    definition,
    ['tutorialStreamAbbr', 'tutorial_stream_abbr'],
    'tutorial stream abbreviation',
    (value, context) => safeText(value, 80, context),
  );
  const dueDate = aliasedValue(
    definition,
    ['dueDate', 'due_date'],
    'task due date',
    (value, context) => safeText(value, 128, context),
  );
  return {
    id,
    abbreviation,
    ...(name === null ? {} : { name }),
    ...(targetGrade === null ? {} : { targetGrade }),
    ...(tutorialStream === null ? {} : { tutorialStreamAbbr: tutorialStream }),
    ...(dueDate === null ? {} : { dueDate }),
  };
}

interface OptionalIdentity {
  present: boolean;
  value: number | null;
}

function embeddedTaskDefinitionIdentity(
  instance: Record<string, unknown>,
): OptionalIdentity {
  const nestedDefinition = own(instance, 'definition')
    ? recordValue(instance.definition, 'embedded task definition')
    : undefined;
  return {
    present: nestedDefinition ? own(nestedDefinition, 'id') : false,
    value: nestedDefinition
      ? aliasedValue(
          nestedDefinition,
          ['id'],
          'task definition id',
          positiveInteger,
        )
      : null,
  };
}

function taskDefinitionIdFromInstance(
  instance: Record<string, unknown>,
): number {
  const flat: OptionalIdentity = {
    present: ['taskDefinitionId', 'task_definition_id'].some((key) =>
      own(instance, key)),
    value: aliasedValue(
      instance,
      ['taskDefinitionId', 'task_definition_id'],
      'task definition id',
      positiveInteger,
    ),
  };
  const nested = embeddedTaskDefinitionIdentity(instance);
  if (
    (flat.value !== null && nested.present && nested.value === null) ||
    (nested.value !== null && flat.present && flat.value === null)
  ) {
    remoteFailure('OnTrack returned conflicting task definition identity aliases.');
  }
  if (
    flat.value !== null &&
    nested.value !== null &&
    flat.value !== nested.value
  ) {
    remoteFailure('OnTrack returned conflicting task definition identities.');
  }
  const definitionId = flat.value ?? nested.value;
  if (definitionId === null) {
    remoteFailure('OnTrack omitted task definition id.');
  }
  return definitionId;
}

function canonicalTaskInstance(raw: unknown): TaskSummary {
  const instance = recordValue(raw, 'task instance');
  const id = requiredPositiveInteger(instance, ['id'], 'task instance id');
  const definitionId = taskDefinitionIdFromInstance(instance);
  const status = aliasedValue(instance, ['status'], 'task status', (value, context) =>
    safeText(value, AGENT_TASKS_LIST_MAX_STATUS_LENGTH, context));
  if (status === null) {
    remoteFailure('OnTrack omitted task status.');
  }
  const dueDate = aliasedValue(
    instance,
    ['dueDate', 'due_date'],
    'task due date',
    (value, context) => safeText(value, 128, context),
  );
  const completionDate = aliasedValue(
    instance,
    ['completionDate', 'completion_date'],
    'task completion date',
    (value, context) => safeText(value, 128, context),
  );
  return {
    id,
    taskDefinitionId: definitionId,
    task_definition_id: definitionId,
    status,
    ...(dueDate === null ? {} : { dueDate }),
    ...(completionDate === null ? {} : { completionDate }),
  };
}

function assertUniqueTaskInstances(tasks: TaskSummary[]): void {
  const instanceIds = tasks.map((task) => task.id);
  const definitionIds = tasks.map((task) => task.taskDefinitionId);
  if (
    new Set(instanceIds).size !== instanceIds.length ||
    new Set(definitionIds).size !== definitionIds.length
  ) {
    remoteFailure('OnTrack returned duplicate task instance identities.');
  }
}

function canonicalTutorialEnrolments(
  project: Record<string, unknown>,
): Array<{ tutorial_id: number }> | undefined {
  return aliasedArray(
    project,
    ['tutorialEnrolments', 'tutorial_enrolments'],
    'tutorial enrolments',
    false,
  )?.map((rawEnrolment) => {
    const enrolment = recordValue(rawEnrolment, 'tutorial enrolment');
    return {
      tutorial_id: requiredPositiveInteger(
        enrolment,
        ['tutorialId', 'tutorial_id'],
        'tutorial enrolment id',
      ),
    };
  });
}

function authoritativeProjectId(
  project: Record<string, unknown>,
  expectedProjectId: number,
): number {
  const projectId = requiredPositiveInteger(project, ['id'], 'project id');
  if (projectId !== expectedProjectId) {
    remoteFailure('OnTrack returned an unexpected project identity.');
  }
  return projectId;
}

function canonicalProject(
  rawProject: unknown,
  expectedProjectId: number,
  expectedUnitId?: number,
): ProjectSummary {
  const project = recordValue(rawProject, 'project');
  const projectId = authoritativeProjectId(project, expectedProjectId);
  const unitId = contractProjectUnit(project).id;
  if (expectedUnitId !== undefined && unitId !== expectedUnitId) {
    invalidArgument('The supplied unit_id does not belong to the requested project.');
  }
  const targetGrade = aliasedValue(
    project,
    ['targetGrade', 'target_grade'],
    'project target grade',
    nonNegativeInteger,
  );
  const tasks = aliasedArray(
    project,
    ['tasks'],
    'task instance list',
    true,
  ).map(canonicalTaskInstance);
  assertUniqueTaskInstances(tasks);
  const tutorialEnrolments = canonicalTutorialEnrolments(project);
  return {
    id: projectId,
    unit: { id: unitId },
    tasks,
    ...(targetGrade === null ? {} : { targetGrade }),
    ...(tutorialEnrolments === undefined
      ? {}
      : { tutorial_enrolments: tutorialEnrolments }),
  };
}

function canonicalTutorialStream(raw: unknown): { abbreviation: string } {
  const stream = recordValue(raw, 'tutorial stream');
  const abbreviation = aliasedValue(
    stream,
    ['abbreviation', 'tutorialStreamAbbr', 'tutorial_stream_abbr'],
    'tutorial stream abbreviation',
    (value, context) => safeText(value, 80, context),
  );
  if (abbreviation === null) {
    remoteFailure('OnTrack omitted tutorial stream abbreviation.');
  }
  return { abbreviation };
}

function canonicalTutorial(
  raw: unknown,
): { id: number; tutorial_stream_abbr?: string } {
  const tutorial = recordValue(raw, 'tutorial');
  const stream = aliasedValue(
    tutorial,
    ['tutorialStreamAbbr', 'tutorial_stream_abbr'],
    'tutorial stream abbreviation',
    (value, context) => safeText(value, 80, context),
  );
  return {
    id: requiredPositiveInteger(tutorial, ['id'], 'tutorial id'),
    ...(stream === null ? {} : { tutorial_stream_abbr: stream }),
  };
}

function assertUniqueNumbers(values: number[], context: string): void {
  if (new Set(values).size !== values.length) {
    remoteFailure(`OnTrack returned duplicate ${context} identities.`);
  }
}

function assertUniqueStrings(values: string[], context: string): void {
  if (new Set(values).size !== values.length) {
    remoteFailure(`OnTrack returned duplicate ${context} identities.`);
  }
}

function canonicalUnit(rawUnit: unknown, expectedUnitId: number): UnitSummary {
  const unit = recordValue(rawUnit, 'unit');
  const unitId = requiredPositiveInteger(unit, ['id'], 'unit id');
  if (unitId !== expectedUnitId) {
    remoteFailure('OnTrack returned an unexpected unit identity.');
  }
  const code = aliasedValue(unit, ['code'], 'unit code', (value, context) =>
    safeText(value, 80, context));
  const name = aliasedValue(unit, ['name'], 'unit name', (value, context) =>
    safeText(value, 512, context));
  const taskDefinitions = aliasedArray(
    unit,
    ['taskDefinitions', 'task_definitions'],
    'task definition catalogue',
    true,
  ).map(canonicalTaskDefinition);
  assertUniqueNumbers(
    taskDefinitions.map((definition) => definition.id as number),
    'task definition',
  );
  const tutorialStreams = aliasedArray(
    unit,
    ['tutorialStreams', 'tutorial_streams'],
    'tutorial streams',
    false,
  )?.map(canonicalTutorialStream);
  const tutorials = aliasedArray(unit, ['tutorials'], 'tutorials', false)?.map(
    canonicalTutorial,
  );
  if (tutorials !== undefined) {
    assertUniqueNumbers(
      tutorials.map((tutorial) => tutorial.id),
      'tutorial',
    );
  }
  if (tutorialStreams !== undefined) {
    assertUniqueStrings(
      tutorialStreams.map((stream) => stream.abbreviation),
      'tutorial stream',
    );
  }
  return {
    id: unitId,
    ...(code === null ? {} : { code }),
    ...(name === null ? {} : { name }),
    taskDefinitions,
    ...(tutorialStreams === undefined
      ? {}
      : { tutorial_streams: tutorialStreams }),
    ...(tutorials === undefined ? {} : { tutorials }),
  };
}

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
  const project = canonicalProject(rawProject, input.project_id, input.unit_id);
  const unitId = project.unit?.id;
  if (unitId === undefined) {
    remoteFailure('OnTrack omitted unit id.');
  }
  const unit = canonicalUnit(rawUnit, unitId);
  assertAuthoritativeTaskDefinitions(project, unit);
  return validateOutput(catalogueItems(input, project, unit));
}

/** Create the project-scoped, definition-first Student Task View catalogue. */
export function createAgentTasksList(
  source: AgentTasksListSource,
): (input: AgentTasksListInput) => Promise<AgentTasksListOutput> {
  return async (input) => {
    const project = await source.readProject(input.project_id);
    const projectRecord = recordValue(project, 'project');
    authoritativeProjectId(projectRecord, input.project_id);
    const authoritativeUnitId = contractProjectUnit(projectRecord).id;
    if (input.unit_id !== undefined && input.unit_id !== authoritativeUnitId) {
      invalidArgument('The supplied unit_id does not belong to the requested project.');
    }
    const unit = await source.readUnit(authoritativeUnitId);
    return buildOutput(input, project, unit);
  };
}
