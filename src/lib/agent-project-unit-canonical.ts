import { AGENT_TASKS_LIST_MAX_STATUS_LENGTH } from './agent-commands.js';
import { AgentProtocolError } from './agent-protocol.js';
import {
  contractAliasedArray as aliasedArray,
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
import type {
  ProjectSummary,
  TaskDefinitionSummary,
  TaskSummary,
  UnitSummary,
} from './types.js';

export interface AgentProjectUnitSource {
  readProject(projectId: number, signal?: AbortSignal): Promise<unknown>;
  readUnit(unitId: number, signal?: AbortSignal): Promise<unknown>;
}

function booleanValue(value: unknown, context: string): boolean {
  if (typeof value !== 'boolean') {
    remoteFailure(`OnTrack returned an invalid ${context}.`);
  }
  return value;
}

function invalidArgument(summary: string): never {
  throw new AgentProtocolError({ code: 'INVALID_ARGUMENT', summary });
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

export function canonicalTaskCatalogueProject(
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

function tutorialCollections(unit: Record<string, unknown>) {
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
    assertUniqueNumbers(tutorials.map((tutorial) => tutorial.id), 'tutorial');
  }
  if (tutorialStreams !== undefined) {
    assertUniqueStrings(
      tutorialStreams.map((stream) => stream.abbreviation),
      'tutorial stream',
    );
  }
  return { tutorials, tutorialStreams };
}

export function canonicalTaskCatalogueUnit(
  rawUnit: unknown,
  expectedUnitId: number,
): UnitSummary {
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
  const { tutorials, tutorialStreams } = tutorialCollections(unit);
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

export function canonicalTutorialStatusProject(
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
  const tutorialEnrolments = canonicalTutorialEnrolments(project);
  return {
    id: projectId,
    unit: { id: unitId },
    ...(tutorialEnrolments === undefined
      ? {}
      : { tutorial_enrolments: tutorialEnrolments }),
  };
}

export function canonicalTutorialStatusUnit(
  rawUnit: unknown,
  expectedUnitId: number,
): UnitSummary {
  const unit = recordValue(rawUnit, 'unit');
  const unitId = requiredPositiveInteger(unit, ['id'], 'unit id');
  if (unitId !== expectedUnitId) {
    remoteFailure('OnTrack returned an unexpected unit identity.');
  }
  const { tutorials, tutorialStreams } = tutorialCollections(unit);
  const tutorialChangeAllowed = aliasedValue(
    unit,
    ['allowStudentChangeTutorial', 'allow_student_change_tutorial'],
    'tutorial change policy',
    booleanValue,
  );
  return {
    id: unitId,
    ...(tutorialStreams === undefined
      ? {}
      : { tutorial_streams: tutorialStreams }),
    ...(tutorials === undefined ? {} : { tutorials }),
    ...(tutorialChangeAllowed === null
      ? {}
      : { allow_student_change_tutorial: tutorialChangeAllowed }),
  };
}
