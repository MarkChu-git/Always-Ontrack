import { z } from "zod";
import {
  agentFeedbackListOutputSchema,
  agentFeedbackWatchFrameSchema,
  type AgentFeedbackListInput,
  type AgentFeedbackListOutput,
  type AgentTasksListOutput,
} from "./agent-commands.js";
import {
  AgentProtocolError,
  agentSuccessEnvelope,
  assertAgentEnvelopeByteLimit,
} from "./agent-protocol.js";
import {
  contractAliasedValue as aliasedValue,
  contractPositiveInteger as positiveInteger,
  contractRecord as recordValue,
  contractRfc3339Timestamp as rfc3339Timestamp,
  contractSafeMultilineText as safeMultilineText,
  contractSafeText as safeText,
  hasOwnField as own,
  remoteContractFailure as remoteFailure,
} from "./agent-contract.js";
import {
  createAgentTasksList,
  type AgentTasksListSource,
} from './agent-tasks.js';

const MAX_AGENT_FEEDBACK_ITEMS = 200;
const MAX_AGENT_FEEDBACK_TEXT_LENGTH = 4096;
const MAX_AGENT_FEEDBACK_OUTPUT_BYTES = 512 * 1024;
const MAX_AGENT_REQUEST_ID = `req_${'x'.repeat(120)}`;

type AgentFeedbackItem = AgentFeedbackListOutput['feedback'][number];
type AgentFeedbackTask = AgentTasksListOutput['tasks'][number];
export type AgentFeedbackWatchFrame = z.output<
  typeof agentFeedbackWatchFrameSchema
>;

export type AgentFeedbackTarget = Pick<
  AgentFeedbackTask,
  | "project_id"
  | "unit_id"
  | "unit_code"
  | "task_definition_id"
  | "task_instance_id"
  | "abbreviation"
  | "instantiated"
>;

export interface AgentFeedbackListSource extends AgentTasksListSource {
  readFeedback(projectId: number, taskDefinitionId: number): Promise<unknown>;
}

function invalidArgument(summary: string): never {
  throw new AgentProtocolError({ code: 'INVALID_ARGUMENT', summary });
}

function notFound(summary: string): never {
  throw new AgentProtocolError({ code: 'NOT_FOUND', summary });
}

function conflict(summary: string): never {
  throw new AgentProtocolError({ code: 'CONFLICT', summary });
}

function booleanValue(value: unknown, context: string): boolean {
  if (typeof value !== 'boolean') {
    remoteFailure(`OnTrack returned an invalid ${context}.`);
  }
  return value;
}

function feedbackId(item: Record<string, unknown>): number | null {
  if (!own(item, 'id')) {
    return null;
  }
  const id = aliasedValue(item, ['id'], 'feedback id', positiveInteger);
  if (id === null) {
    remoteFailure('OnTrack returned an invalid feedback id.');
  }
  return id;
}

function feedbackText(item: Record<string, unknown>): string | null {
  return aliasedValue(item, ['comment', 'text'], 'feedback text', (value, context) =>
    safeMultilineText(value, MAX_AGENT_FEEDBACK_TEXT_LENGTH, context));
}

function feedbackItem(raw: unknown): AgentFeedbackItem {
  const item = recordValue(raw, "feedback item");
  const text = feedbackText(item);
  const kind =
    aliasedValue(item, ["type"], "feedback type", (value, context) =>
      safeText(value, 80, context),
    ) ?? (text === null ? "event" : "message");
  return {
    feedback_id: feedbackId(item),
    kind,
    text,
    created_at: aliasedValue(
      item,
      ["createdAt", "created_at"],
      "feedback creation timestamp",
      rfc3339Timestamp,
    ),
    updated_at: aliasedValue(
      item,
      ["updatedAt", "updated_at"],
      "feedback update timestamp",
      rfc3339Timestamp,
    ),
    is_new: aliasedValue(
      item,
      ["isNew", "is_new"],
      "feedback new flag",
      booleanValue,
    ),
  };
}

/** Project bounded feedback records without exposing people or unknown remote fields. */
export function projectAgentFeedbackItems(
  rawFeedback: unknown,
): AgentFeedbackItem[] {
  if (!Array.isArray(rawFeedback)) {
    remoteFailure("OnTrack returned an unexpected feedback response shape.");
  }
  if (rawFeedback.length > MAX_AGENT_FEEDBACK_ITEMS) {
    remoteFailure(
      `OnTrack returned more than ${MAX_AGENT_FEEDBACK_ITEMS} feedback items.`,
    );
  }
  const feedback = rawFeedback.map(feedbackItem);
  const ids = feedback
    .map((item) => item.feedback_id)
    .filter((id): id is number => id !== null);
  if (new Set(ids).size !== ids.length) {
    remoteFailure("OnTrack returned duplicate feedback identities.");
  }
  return feedback;
}

function taskDefinitionId(input: AgentFeedbackListInput): number | undefined {
  return 'task_definition_id' in input ? input.task_definition_id : undefined;
}

function taskAbbreviation(input: AgentFeedbackListInput): string | undefined {
  return 'abbreviation' in input ? input.abbreviation : undefined;
}

function selectFeedbackTask(
  input: AgentFeedbackListInput,
  tasks: readonly AgentFeedbackTask[],
): AgentFeedbackTask {
  const definitionId = taskDefinitionId(input);
  const abbreviation = taskAbbreviation(input);
  const matches = definitionId === undefined
    ? tasks.filter((task) => task.abbreviation === abbreviation)
    : tasks.filter((task) => task.task_definition_id === definitionId);
  if (matches.length === 0) {
    notFound('The requested task is not visible in the requested project.');
  }
  if (matches.length > 1) {
    conflict('The supplied task selector is ambiguous within the requested project.');
  }
  const task = matches[0];
  if (!task) {
    throw new Error('Expected one feedback task after selector validation.');
  }
  if (definitionId !== undefined && abbreviation !== undefined && task.abbreviation !== abbreviation) {
    invalidArgument('The supplied abbreviation does not match the requested task definition.');
  }
  return task;
}

function completeAgentEnvelopeBytes(output: AgentFeedbackListOutput): number {
  return Buffer.byteLength(
    JSON.stringify(
      agentSuccessEnvelope({
        command: 'feedback.list',
        requestId: MAX_AGENT_REQUEST_ID,
        data: output,
      }),
      null,
      2,
    ),
    'utf8',
  );
}

function validateOutput(output: AgentFeedbackListOutput): AgentFeedbackListOutput {
  const parsed = agentFeedbackListOutputSchema.safeParse(output);
  if (!parsed.success) {
    throw new AgentProtocolError({
      code: 'INTERNAL_ERROR',
      summary: 'The feedback.list output failed contract validation.',
    });
  }
  if (completeAgentEnvelopeBytes(parsed.data) > MAX_AGENT_FEEDBACK_OUTPUT_BYTES) {
    remoteFailure('OnTrack returned feedback data exceeding the output safety limit.');
  }
  return parsed.data;
}

/** Validate and size-bound every runtime feedback.watch frame before emission. */
export function validateAgentFeedbackWatchFrame(
  value: unknown,
): AgentFeedbackWatchFrame {
  const parsed = agentFeedbackWatchFrameSchema.safeParse(value);
  if (!parsed.success) {
    remoteFailure("OnTrack returned an invalid Agent feedback watch frame.");
  }
  return assertAgentEnvelopeByteLimit({
    command: "feedback.watch",
    data: parsed.data,
    maxBytes: MAX_AGENT_FEEDBACK_OUTPUT_BYTES,
    failureSummary:
      "OnTrack returned feedback stream data exceeding the output safety limit.",
  });
}

/** Resolve one strict, definition-first feedback target without reading its timeline. */
export function createAgentFeedbackTarget(
  source: AgentTasksListSource,
): (input: AgentFeedbackListInput) => Promise<AgentFeedbackTarget> {
  const listTasks = createAgentTasksList(source);
  return async (input) => {
    const catalogue = await listTasks({ project_id: input.project_id });
    const task = selectFeedbackTask(input, catalogue.tasks);
    return {
      project_id: task.project_id,
      unit_id: task.unit_id,
      unit_code: task.unit_code,
      task_definition_id: task.task_definition_id,
      task_instance_id: task.task_instance_id,
      abbreviation: task.abbreviation,
      instantiated: task.instantiated,
    };
  };
}

/** Read one task's bounded, person-free feedback timeline through its authoritative catalogue. */
export function createAgentFeedbackList(
  source: AgentFeedbackListSource,
): (input: AgentFeedbackListInput) => Promise<AgentFeedbackListOutput> {
  const readTarget = createAgentFeedbackTarget(source);
  return async (input) => {
    const task = await readTarget(input);
    const feedback = projectAgentFeedbackItems(
      await source.readFeedback(task.project_id, task.task_definition_id),
    );
    return validateOutput({
      project_id: task.project_id,
      unit_id: task.unit_id,
      unit_code: task.unit_code,
      task_definition_id: task.task_definition_id,
      task_instance_id: task.task_instance_id,
      abbreviation: task.abbreviation,
      instantiated: task.instantiated,
      count: feedback.length,
      feedback,
    });
  };
}
