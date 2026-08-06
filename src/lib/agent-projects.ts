import {
  agentProjectsListOutputSchema,
  type AgentProjectsListOutput,
} from './agent-commands.js';
import {
  AgentProtocolError,
  agentSuccessEnvelope,
} from './agent-protocol.js';
import {
  contractAliasedValue as aliasedValue,
  contractNonNegativeInteger as nonNegativeInteger,
  contractProjectUnit as projectUnit,
  contractRecord as recordValue,
  remoteContractFailure as remoteFailure,
  requiredContractPositiveInteger as requiredPositiveInteger,
} from './agent-contract.js';

const MAX_AGENT_PROJECTS = 200;
const MAX_AGENT_PROJECTS_OUTPUT_BYTES = 512 * 1024;
const MAX_AGENT_REQUEST_ID = `req_${'x'.repeat(120)}`;

type AgentProjectDirectoryItem = AgentProjectsListOutput['projects'][number];
type AgentProjectCapabilities = Pick<
  AgentProjectDirectoryItem,
  | 'target_grade'
  | 'submitted_grade'
  | 'enrolled'
  | 'special_consideration_days'
  | 'portfolio_available'
  | 'escalation_attempts_remaining'
>;

function booleanValue(value: unknown, context: string): boolean {
  if (typeof value !== 'boolean') {
    remoteFailure(`OnTrack returned an invalid ${context}.`);
  }
  return value;
}

function projectCapabilities(
  project: Record<string, unknown>,
): AgentProjectCapabilities {
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
    special_consideration_days: aliasedValue(
      project,
      ['specConDays', 'spec_con_days'],
      'special consideration days',
      nonNegativeInteger,
    ),
    portfolio_available: aliasedValue(
      project,
      ['portfolioAvailable', 'portfolio_available'],
      'portfolio availability',
      booleanValue,
    ),
    escalation_attempts_remaining: aliasedValue(
      project,
      ['escalationAttemptsRemaining', 'escalation_attempts_remaining'],
      'escalation attempts remaining',
      nonNegativeInteger,
    ),
  };
}

function projectDirectoryItem(rawProject: unknown): AgentProjectDirectoryItem {
  const project = recordValue(rawProject, 'project summary');
  const unit = projectUnit(project);
  return {
    project_id: requiredPositiveInteger(project, ['id'], 'project id'),
    unit_id: unit.id,
    unit_code: unit.code,
    unit_name: unit.name,
    ...projectCapabilities(project),
  };
}

function completeAgentEnvelopeBytes(output: AgentProjectsListOutput): number {
  const envelope = agentSuccessEnvelope({
    command: 'projects.list',
    requestId: MAX_AGENT_REQUEST_ID,
    data: output,
  });
  return Buffer.byteLength(JSON.stringify(envelope, null, 2), 'utf8');
}

/** Build the stable, PII-minimized project directory used by Agent callers. */
export function buildAgentProjectsListOutput(rawProjects: unknown): AgentProjectsListOutput {
  if (!Array.isArray(rawProjects)) {
    remoteFailure('OnTrack returned an unexpected project list shape.');
  }
  if (rawProjects.length > MAX_AGENT_PROJECTS) {
    remoteFailure(`OnTrack returned more than ${MAX_AGENT_PROJECTS} projects.`);
  }

  const projects = rawProjects.map(projectDirectoryItem);
  const projectIds = projects.map((project) => project.project_id);
  if (new Set(projectIds).size !== projectIds.length) {
    remoteFailure('OnTrack returned duplicate project identities.');
  }

  const parsed = agentProjectsListOutputSchema.safeParse({
    count: projects.length,
    projects,
  });
  if (!parsed.success) {
    throw new AgentProtocolError({
      code: 'INTERNAL_ERROR',
      summary: 'The projects.list output failed contract validation.',
    });
  }
  if (completeAgentEnvelopeBytes(parsed.data) > MAX_AGENT_PROJECTS_OUTPUT_BYTES) {
    remoteFailure('OnTrack returned project data exceeding the output safety limit.');
  }
  return parsed.data;
}
