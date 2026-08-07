import {
  agentTutorialsStatusOutputSchema,
  type AgentTutorialsStatusInput,
  type AgentTutorialsStatusOutput,
} from './agent-commands.js';
import { AgentProtocolError } from './agent-protocol.js';
import { remoteContractFailure as remoteFailure } from './agent-contract.js';
import {
  canonicalTutorialStatusProject,
  canonicalTutorialStatusUnit,
  type AgentProjectUnitSource,
} from './agent-project-unit-canonical.js';
import { resolveStudentTutorialStatus } from './student-task-view.js';

const MAX_AGENT_TUTORIALS_STATUS_OUTPUT_BYTES = 512 * 1024;

function tutorialChangeAllowed(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function validateTutorialStatus(
  output: AgentTutorialsStatusOutput,
): AgentTutorialsStatusOutput {
  const parsed = agentTutorialsStatusOutputSchema.safeParse(output);
  if (!parsed.success) {
    throw new AgentProtocolError({
      code: 'INTERNAL_ERROR',
      summary: 'The tutorials.status output failed contract validation.',
    });
  }
  if (
    Buffer.byteLength(JSON.stringify(parsed.data), 'utf8') >
    MAX_AGENT_TUTORIALS_STATUS_OUTPUT_BYTES
  ) {
    remoteFailure('OnTrack returned tutorial data exceeding the output safety limit.');
  }
  return parsed.data;
}

/** Build a PII-minimized tutorial state from the canonical project-unit join. */
export function createAgentTutorialsStatus(
  source: AgentProjectUnitSource,
): (input: AgentTutorialsStatusInput) => Promise<AgentTutorialsStatusOutput> {
  return async (input) => {
    const project = canonicalTutorialStatusProject(
      await source.readProject(input.project_id),
      input.project_id,
      input.unit_id,
    );
    const unitId = project.unit?.id;
    if (unitId === undefined) {
      remoteFailure('OnTrack omitted unit id.');
    }
    const unit = canonicalTutorialStatusUnit(await source.readUnit(unitId), unitId);
    const status = resolveStudentTutorialStatus(project, unit);
    return validateTutorialStatus({
      project_id: input.project_id,
      unit_id: unitId,
      state: status.state,
      available_streams: [...status.availableStreams],
      enrolled_streams: [...status.enrolledStreams],
      applies_to_all_streams: status.appliesToAllStreams,
      can_change_tutorial: tutorialChangeAllowed(unit.allow_student_change_tutorial),
    });
  };
}
