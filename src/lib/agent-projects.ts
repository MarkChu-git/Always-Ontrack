import {
  agentProjectsListOutputSchema,
  type AgentProjectsListOutput,
} from './agent-commands.js';
import {
  AgentProtocolError,
  agentSuccessEnvelope,
} from './agent-protocol.js';

const MAX_AGENT_PROJECTS = 200;
const MAX_AGENT_PROJECTS_OUTPUT_BYTES = 512 * 1024;
const MAX_AGENT_REQUEST_ID = `req_${'x'.repeat(120)}`;
const UNSAFE_TERMINAL_TEXT =
  /[\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u206f]/u;

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
  if (typeof value !== 'string' || UNSAFE_TERMINAL_TEXT.test(value)) {
    remoteFailure(`OnTrack returned an invalid ${context}.`);
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength) {
    remoteFailure(`OnTrack returned an invalid ${context}.`);
  }
  return normalized;
}

function booleanValue(value: unknown, context: string): boolean {
  if (typeof value !== 'boolean') {
    remoteFailure(`OnTrack returned an invalid ${context}.`);
  }
  return value;
}

function aliasedValue<T>(
  record: Record<string, unknown>,
  keys: readonly string[],
  context: string,
  parse: (value: unknown, context: string) => T,
): T | null {
  const rawValues = keys.filter((key) => own(record, key)).map((key) => record[key]);
  if (rawValues.length === 0) {
    return null;
  }
  if (rawValues.some((value) => value === undefined)) {
    remoteFailure(`OnTrack returned an invalid ${context}.`);
  }
  if (
    rawValues.some((value) => value === null) &&
    rawValues.some((value) => value !== null)
  ) {
    remoteFailure(`OnTrack returned conflicting ${context} aliases.`);
  }
  if (rawValues.every((value) => value === null)) {
    return null;
  }
  const values = rawValues.map((value) => parse(value, context));
  if (values.some((value) => value !== values[0])) {
    remoteFailure(`OnTrack returned conflicting ${context} aliases.`);
  }
  return values[0] ?? null;
}

function requiredPositiveInteger(
  record: Record<string, unknown>,
  keys: readonly string[],
  context: string,
): number {
  const value = aliasedValue(record, keys, context, positiveInteger);
  if (value === null) {
    remoteFailure(`OnTrack omitted ${context}.`);
  }
  return value;
}

function projectUnit(
  project: Record<string, unknown>,
): { readonly id: number; readonly code: string | null; readonly name: string | null } {
  const rawUnit = own(project, 'unit') ? project.unit : undefined;
  const unit = rawUnit === undefined ? undefined : recordValue(rawUnit, 'project unit');
  const nestedIdPresent = unit ? own(unit, 'id') : false;
  const nestedId = unit
    ? aliasedValue(unit, ['id'], 'unit id', positiveInteger)
    : null;
  const flatIdPresent = ['unitId', 'unit_id'].some((key) => own(project, key));
  const flatId = aliasedValue(
    project,
    ['unitId', 'unit_id'],
    'unit id',
    positiveInteger,
  );
  if (nestedId !== null && flatIdPresent && flatId === null) {
    remoteFailure('OnTrack returned conflicting unit identity aliases.');
  }
  if (flatId !== null && nestedIdPresent && nestedId === null) {
    remoteFailure('OnTrack returned conflicting unit identity aliases.');
  }
  if (nestedId !== null && flatId !== null && nestedId !== flatId) {
    remoteFailure('OnTrack returned conflicting unit identities.');
  }
  const id = nestedId ?? flatId;
  if (id === null) {
    remoteFailure('OnTrack omitted unit id.');
  }
  return {
    id,
    code: unit
      ? aliasedValue(unit, ['code'], 'unit code', (value, context) =>
          safeText(value, 80, context))
      : null,
    name: unit
      ? aliasedValue(unit, ['name'], 'unit name', (value, context) =>
          safeText(value, 512, context))
      : null,
  };
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
