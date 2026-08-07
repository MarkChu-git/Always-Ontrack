import { z } from 'zod';
import {
  agentSuccessEnvelope,
  assertAgentEnvelopeByteLimit,
} from './agent-protocol.js';
import {
  agentPlanDateSchema,
  agentRfc3339TimestampSchema,
} from './agent-commands.js';
import type { PlanDateKind, PlanDateSource, PlanDateValue } from './planner.js';
import {
  AGENT_SAFE_TEXT_PATTERN,
  contractNonNegativeInteger as nonNegativeInteger,
  contractPositiveInteger as positiveInteger,
  contractRecord as recordValue,
  contractRfc3339Timestamp as rfc3339Timestamp,
  contractSafeText as safeText,
  hasOwnField as own,
  remoteContractFailure as remoteFailure,
} from './agent-contract.js';

const MAX_AGENT_WATCH_TEXT_LENGTH = 128;
const MAX_AGENT_WATCH_ITEMS = 200;
const MAX_AGENT_WATCH_EVENTS = 800;
const MAX_AGENT_STREAM_FRAME_BYTES = 512 * 1024;

export type AgentWatchDateKind = PlanDateKind;
export type AgentWatchDateSource = PlanDateSource;
export type AgentWatchDate = Omit<PlanDateValue, 'value'> & {
  readonly value: string | null;
};

export interface AgentWatchState {
  readonly task_key: string;
  readonly project_id: number;
  readonly unit_id: number;
  readonly unit_code: string | null;
  readonly task_definition_id: number;
  readonly task_instance_id: number | null;
  readonly abbreviation: string;
  readonly status: string;
  readonly start: AgentWatchDate;
  readonly target: AgentWatchDate;
  readonly feedback_deadline: AgentWatchDate;
  readonly feedback: {
    readonly comment_count: number;
    readonly last_comment_at: string | null;
  };
}

export interface AgentWatchEvent {
  readonly type: 'status_changed' | 'date_changed' | 'new_feedback';
  readonly task_key: string;
  readonly project_id: number;
  readonly unit_id: number;
  readonly task_definition_id: number;
  readonly unit_code: string | null;
  readonly abbreviation: string;
  readonly previous?: string | AgentWatchDate | null;
  readonly current?: string | AgentWatchDate | null;
  readonly date_kind?: AgentWatchDateKind;
  readonly delta_comments?: number;
  readonly at: string;
}

const agentWatchTextSchema = z
  .string()
  .min(1)
  .max(MAX_AGENT_WATCH_TEXT_LENGTH)
  .regex(AGENT_SAFE_TEXT_PATTERN);
export const agentWatchDateSchema = z.union([
  agentPlanDateSchema('start'),
  agentPlanDateSchema('target'),
  agentPlanDateSchema('feedback_deadline'),
]);
export const agentWatchStateSchema = z
  .object({
    task_key: z.string().regex(/^\d+:\d+$/u),
    project_id: z.number().int().positive(),
    unit_id: z.number().int().positive(),
    unit_code: agentWatchTextSchema.max(80).nullable(),
    task_definition_id: z.number().int().positive(),
    task_instance_id: z.number().int().positive().nullable(),
    abbreviation: agentWatchTextSchema.max(80),
    status: agentWatchTextSchema.max(80),
    start: agentPlanDateSchema('start'),
    target: agentPlanDateSchema('target'),
    feedback_deadline: agentPlanDateSchema('feedback_deadline'),
    feedback: z
      .object({
        comment_count: z.number().int().nonnegative(),
        last_comment_at: agentRfc3339TimestampSchema.nullable(),
      })
      .strict(),
  })
  .strict();
const agentWatchEventBaseSchema = {
  task_key: z.string().regex(/^\d+:\d+$/u),
  project_id: z.number().int().positive(),
  unit_id: z.number().int().positive(),
  task_definition_id: z.number().int().positive(),
  unit_code: agentWatchTextSchema.max(80).nullable(),
  abbreviation: agentWatchTextSchema.max(80),
  at: agentRfc3339TimestampSchema,
};
export const agentWatchEventSchema = z
  .discriminatedUnion('type', [
    z
      .object({
        ...agentWatchEventBaseSchema,
        type: z.literal('status_changed'),
        previous: agentWatchTextSchema,
        current: agentWatchTextSchema,
      })
      .strict(),
    z
      .object({
        ...agentWatchEventBaseSchema,
        type: z.literal('date_changed'),
        date_kind: z.enum(['start', 'target', 'feedback_deadline']),
        previous: agentWatchDateSchema,
        current: agentWatchDateSchema,
      })
      .strict(),
    z
      .object({
        ...agentWatchEventBaseSchema,
        type: z.literal('new_feedback'),
        previous: agentRfc3339TimestampSchema.nullable(),
        current: agentRfc3339TimestampSchema.nullable(),
        delta_comments: z.number().int().positive().optional(),
      })
      .strict(),
  ])
  .superRefine((event, context) => {
    if (
      event.type === 'date_changed' &&
      (event.previous.kind !== event.date_kind ||
        event.current.kind !== event.date_kind)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'date change kind must match both Plan Date values',
      });
    }
  });
export const agentWatchFrameSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('baseline'),
      at: agentRfc3339TimestampSchema,
      interval_seconds: z.number().int().min(1),
      tasks: z.array(agentWatchStateSchema).max(MAX_AGENT_WATCH_ITEMS),
    })
    .strict(),
  z
    .object({
      type: z.literal('events'),
      at: agentRfc3339TimestampSchema,
      events: z.array(agentWatchEventSchema).max(MAX_AGENT_WATCH_EVENTS),
    })
    .strict(),
]);
export type AgentWatchFrame = z.output<typeof agentWatchFrameSchema>;

function optionalText(
  record: Record<string, unknown>,
  key: string,
  context: string,
): string | null {
  if (!own(record, key) || record[key] === null) {
    return null;
  }
  return safeText(record[key], MAX_AGENT_WATCH_TEXT_LENGTH, context);
}

function requiredText(
  record: Record<string, unknown>,
  key: string,
  context: string,
): string {
  if (!own(record, key)) {
    remoteFailure(`OnTrack omitted ${context}.`);
  }
  return safeText(record[key], MAX_AGENT_WATCH_TEXT_LENGTH, context);
}

function watchDate(value: unknown, kind: AgentWatchDateKind): AgentWatchDate {
  const parsed = agentPlanDateSchema(kind).safeParse(value);
  if (!parsed.success) {
    remoteFailure(`OnTrack returned an invalid ${kind} watch date.`);
  }
  return parsed.data;
}

function optionalPositiveInteger(
  record: Record<string, unknown>,
  key: string,
  context: string,
): number | null {
  if (!own(record, key) || record[key] === null) {
    return null;
  }
  return positiveInteger(record[key], context);
}

function optionalTimestamp(
  record: Record<string, unknown>,
  key: string,
  context: string,
): string | null {
  if (!own(record, key) || record[key] === null) {
    return null;
  }
  return rfc3339Timestamp(record[key], context);
}

function watchFeedback(value: unknown): AgentWatchState['feedback'] {
  const record = recordValue(value, 'watch feedback');
  const commentCount = positiveOrZero(
    record,
    'comment_count',
    'watch comment count',
  );
  return {
    comment_count: commentCount,
    last_comment_at: optionalTimestamp(
      record,
      'last_comment_at',
      'watch feedback timestamp',
    ),
  };
}

function positiveOrZero(
  record: Record<string, unknown>,
  key: string,
  context: string,
): number {
  if (!own(record, key)) {
    remoteFailure(`OnTrack omitted ${context}.`);
  }
  return nonNegativeInteger(record[key], context);
}

/** Project a watch state through a strict, person-free Agent allowlist. */
export function projectAgentWatchState(value: unknown): AgentWatchState {
  const record = recordValue(value, 'watch state');
  const projectId = positiveInteger(record.project_id, 'watch project id');
  const definitionId = positiveInteger(
    record.task_definition_id,
    'watch task definition id',
  );
  const taskKey = requiredText(record, 'task_key', 'watch task key');
  if (taskKey !== `${projectId}:${definitionId}`) {
    remoteFailure('OnTrack returned an inconsistent watch task identity.');
  }
  return {
    task_key: taskKey,
    project_id: projectId,
    unit_id: positiveInteger(record.unit_id, 'watch unit id'),
    unit_code: optionalText(record, 'unit_code', 'watch unit code'),
    task_definition_id: definitionId,
    task_instance_id: optionalPositiveInteger(
      record,
      'task_instance_id',
      'watch task instance id',
    ),
    abbreviation: requiredText(
      record,
      'abbreviation',
      'watch task abbreviation',
    ),
    status: requiredText(record, 'status', 'watch task status'),
    start: watchDate(record.start, 'start'),
    target: watchDate(record.target, 'target'),
    feedback_deadline: watchDate(record.feedback_deadline, 'feedback_deadline'),
    feedback: watchFeedback(record.feedback),
  };
}

/** Enforce the single-frame transport boundary shared by every Agent stream. */
export function assertAgentStreamFrameLimit<T>(command: string, frame: T): T {
  return assertAgentEnvelopeByteLimit({
    command,
    data: frame,
    maxBytes: MAX_AGENT_STREAM_FRAME_BYTES,
    failureSummary:
      'OnTrack returned stream data exceeding the output safety limit.',
  });
}

/** Validate a typed watch frame before it is wrapped as an Agent NDJSON envelope. */
export function validateAgentWatchFrame(value: unknown): AgentWatchFrame {
  const parsed = agentWatchFrameSchema.safeParse(value);
  if (!parsed.success) {
    remoteFailure('OnTrack returned an invalid Agent watch frame.');
  }
  return assertAgentStreamFrameLimit('watch', parsed.data);
}

/** Split one poll's events into independently valid Agent stream frames. */
export function splitAgentWatchEventFrames(
  at: string,
  events: readonly AgentWatchEvent[],
): AgentWatchFrame[] {
  const frames: AgentWatchFrame[] = [];
  let current: AgentWatchEvent[] = [];
  let currentBytes = agentWatchFrameEnvelopeBytes(at, current);

  for (const event of events) {
    const parsedEvent = agentWatchEventSchema.safeParse(event);
    if (!parsedEvent.success) {
      remoteFailure('OnTrack returned an invalid Agent watch event.');
    }
    const eventBytes = Buffer.byteLength(
      JSON.stringify(parsedEvent.data),
      'utf8',
    );
    const candidateBytes =
      currentBytes + eventBytes + (current.length === 0 ? 0 : 1);
    if (
      current.length < MAX_AGENT_WATCH_EVENTS &&
      candidateBytes <= MAX_AGENT_STREAM_FRAME_BYTES
    ) {
      current = [...current, parsedEvent.data];
      currentBytes = candidateBytes;
      continue;
    }

    if (current.length === 0) {
      remoteFailure(
        'OnTrack returned a watch event exceeding the output safety limit.',
      );
    }
    frames.push(
      validateAgentWatchFrame({ type: 'events', at, events: current }),
    );
    current = [parsedEvent.data];
    currentBytes = agentWatchFrameEnvelopeBytes(at, current);
    if (currentBytes > MAX_AGENT_STREAM_FRAME_BYTES) {
      remoteFailure(
        'OnTrack returned a watch event exceeding the output safety limit.',
      );
    }
  }

  if (current.length > 0) {
    frames.push(
      validateAgentWatchFrame({ type: 'events', at, events: current }),
    );
  }
  return frames;
}

function agentWatchFrameEnvelopeBytes(
  at: string,
  events: readonly AgentWatchEvent[],
): number {
  return Buffer.byteLength(
    JSON.stringify(
      agentSuccessEnvelope({
        command: 'watch',
        requestId: `req_${'x'.repeat(120)}`,
        data: { type: 'events', at, events },
      }),
    ),
    'utf8',
  );
}

function eventBase(
  next: AgentWatchState,
  at: string,
): Omit<
  AgentWatchEvent,
  'type' | 'previous' | 'current' | 'date_kind' | 'delta_comments'
> {
  return {
    task_key: next.task_key,
    project_id: next.project_id,
    unit_id: next.unit_id,
    task_definition_id: next.task_definition_id,
    unit_code: next.unit_code,
    abbreviation: next.abbreviation,
    at,
  };
}

function datesEqual(left: AgentWatchDate, right: AgentWatchDate): boolean {
  return (
    left.value === right.value &&
    left.source === right.source &&
    left.editable === right.editable &&
    left.interpretation === right.interpretation
  );
}

/** Diff typed Agent watch states without collapsing independent Plan Date semantics. */
export function diffAgentWatchStates(
  previous: ReadonlyMap<string, AgentWatchState>,
  current: ReadonlyMap<string, AgentWatchState>,
  at: string = new Date().toISOString(),
): AgentWatchEvent[] {
  const events: AgentWatchEvent[] = [];
  for (const [taskKey, next] of current.entries()) {
    const prior = previous.get(taskKey);
    if (!prior) {
      continue;
    }
    const base = eventBase(next, at);
    if (prior.status !== next.status) {
      events.push({
        ...base,
        type: 'status_changed',
        previous: prior.status,
        current: next.status,
      });
    }
    for (const kind of ['start', 'target', 'feedback_deadline'] as const) {
      if (!datesEqual(prior[kind], next[kind])) {
        events.push({
          ...base,
          type: 'date_changed',
          date_kind: kind,
          previous: prior[kind],
          current: next[kind],
        });
      }
    }
    const commentDelta =
      next.feedback.comment_count - prior.feedback.comment_count;
    if (
      commentDelta > 0 ||
      next.feedback.last_comment_at !== prior.feedback.last_comment_at
    ) {
      events.push({
        ...base,
        type: 'new_feedback',
        previous: prior.feedback.last_comment_at,
        current: next.feedback.last_comment_at,
        ...(commentDelta > 0 ? { delta_comments: commentDelta } : {}),
      });
    }
  }
  return events;
}
