import {
  agentUnitShowOutputSchema,
  type AgentUnitShowInput,
  type AgentUnitShowOutput,
} from './agent-commands.js';
import {
  AgentProtocolError,
  agentSuccessEnvelope,
} from './agent-protocol.js';
import {
  contractAliasedArray as aliasedArray,
  contractAliasedValue as aliasedValue,
  contractNonNegativeInteger as nonNegativeInteger,
  contractPositiveInteger as positiveInteger,
  contractProjectUnit,
  contractRecord as recordValue,
  contractSafeText as safeText,
  remoteContractFailure as remoteFailure,
  requiredContractPositiveInteger as requiredPositiveInteger,
} from './agent-contract.js';

const MAX_AGENT_TASK_DEFINITIONS = 200;
const MAX_AGENT_UNIT_OUTPUT_BYTES = 512 * 1024;
const MAX_AGENT_REQUEST_ID = `req_${'x'.repeat(120)}`;

export interface AgentUnitShowSource {
  readProject(projectId: number): Promise<unknown>;
  readUnit(unitId: number): Promise<unknown>;
}

function invalidArgument(summary: string): never {
  throw new AgentProtocolError({ code: 'INVALID_ARGUMENT', summary });
}

function booleanValue(value: unknown, context: string): boolean {
  if (typeof value !== 'boolean') {
    remoteFailure(`OnTrack returned an invalid ${context}.`);
  }
  return value;
}

function authoritativeProject(
  rawProject: unknown,
  expectedProjectId: number,
): Record<string, unknown> {
  const project = recordValue(rawProject, 'project');
  const projectId = requiredPositiveInteger(project, ['id'], 'project id');
  if (projectId !== expectedProjectId) {
    remoteFailure('OnTrack returned an unexpected project identity.');
  }
  return project;
}

function projectCapabilities(
  project: Record<string, unknown>,
): Pick<
  AgentUnitShowOutput,
  'target_grade' | 'submitted_grade' | 'enrolled'
> {
  return {
    target_grade: aliasedValue(
      project,
      ['targetGrade', 'target_grade'],
      'target grade',
      nonNegativeInteger,
    ),
    submitted_grade: aliasedValue(
      project,
      ['submittedGrade', 'submitted_grade'],
      'submitted grade',
      nonNegativeInteger,
    ),
    enrolled: aliasedValue(project, ['enrolled'], 'enrolment flag', booleanValue),
  };
}

function unitDetail(
  rawUnit: unknown,
  expectedUnitId: number,
): Pick<
  AgentUnitShowOutput,
  'unit_code' | 'unit_name' | 'active' | 'task_definition_count'
> {
  const unit = recordValue(rawUnit, 'unit');
  const unitId = requiredPositiveInteger(unit, ['id'], 'unit id');
  if (unitId !== expectedUnitId) {
    remoteFailure('OnTrack returned an unexpected unit identity.');
  }
  const definitions = aliasedArray(
    unit,
    ['taskDefinitions', 'task_definitions'],
    'task definition catalogue',
    true,
  );
  if (definitions.length > MAX_AGENT_TASK_DEFINITIONS) {
    remoteFailure(
      `OnTrack returned more than ${MAX_AGENT_TASK_DEFINITIONS} task definitions.`,
    );
  }
  const definitionIds = definitions.map((definition) =>
    requiredPositiveInteger(recordValue(definition, 'task definition'), ['id'], 'task definition id'));
  if (new Set(definitionIds).size !== definitionIds.length) {
    remoteFailure('OnTrack returned duplicate task definition identities.');
  }
  return {
    unit_code: aliasedValue(unit, ['code'], 'unit code', (value, context) =>
      safeText(value, 80, context)),
    unit_name: aliasedValue(unit, ['name'], 'unit name', (value, context) =>
      safeText(value, 512, context)),
    active: aliasedValue(unit, ['active'], 'active flag', booleanValue),
    task_definition_count: definitions.length,
  };
}

function assertUnitMetadataMatchesProject(
  projectUnit: ReturnType<typeof contractProjectUnit>,
  unit: Pick<AgentUnitShowOutput, 'unit_code' | 'unit_name'>,
): void {
  if (projectUnit.code !== null && unit.unit_code !== null && projectUnit.code !== unit.unit_code) {
    remoteFailure('OnTrack returned conflicting unit code metadata.');
  }
  if (projectUnit.name !== null && unit.unit_name !== null && projectUnit.name !== unit.unit_name) {
    remoteFailure('OnTrack returned conflicting unit name metadata.');
  }
}

function completeAgentEnvelopeBytes(output: AgentUnitShowOutput): number {
  return Buffer.byteLength(
    JSON.stringify(
      agentSuccessEnvelope({
        command: 'unit.show',
        requestId: MAX_AGENT_REQUEST_ID,
        data: output,
      }),
      null,
      2,
    ),
    'utf8',
  );
}

function validateOutput(output: AgentUnitShowOutput): AgentUnitShowOutput {
  const parsed = agentUnitShowOutputSchema.safeParse(output);
  if (!parsed.success) {
    throw new AgentProtocolError({
      code: 'INTERNAL_ERROR',
      summary: 'The unit.show output failed contract validation.',
    });
  }
  if (completeAgentEnvelopeBytes(parsed.data) > MAX_AGENT_UNIT_OUTPUT_BYTES) {
    remoteFailure('OnTrack returned unit data exceeding the output safety limit.');
  }
  return parsed.data;
}

/** Build one project-scoped, PII-minimized Student Unit View. */
export function createAgentUnitShow(
  source: AgentUnitShowSource,
): (input: AgentUnitShowInput) => Promise<AgentUnitShowOutput> {
  return async (input) => {
    const project = authoritativeProject(
      await source.readProject(input.project_id),
      input.project_id,
    );
    const projectUnit = contractProjectUnit(project);
    if (input.unit_id !== undefined && input.unit_id !== projectUnit.id) {
      invalidArgument('The supplied unit_id does not belong to the requested project.');
    }
    const capabilities = projectCapabilities(project);
    const unit = unitDetail(await source.readUnit(projectUnit.id), projectUnit.id);
    assertUnitMetadataMatchesProject(projectUnit, unit);
    return validateOutput({
      project_id: input.project_id,
      unit_id: projectUnit.id,
      ...unit,
      ...capabilities,
    });
  };
}
