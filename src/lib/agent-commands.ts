import { z } from 'zod';
import {
  defineAgentCommand,
  type AgentCommandDefinition,
} from './agent-execution-engine.js';
import {
  AGENT_RFC3339_TIMESTAMP_PATTERN,
  AGENT_MULTILINE_SAFE_TEXT_PATTERN,
  AGENT_SAFE_TEXT_PATTERN,
  isAgentRfc3339Timestamp,
} from "./agent-contract.js";

const taskShowProjectId = z.number().int().positive();
const taskShowUnitId = z.number().int().positive();
const taskShowDefinitionId = z.number().int().positive();
export const AGENT_TASKS_LIST_MAX_STATUS_LENGTH = 80;
const taskShowAbbreviations = z
  .array(
    z
      .string()
      .regex(/\S/u, 'abbreviation must contain a non-whitespace character')
      .trim()
      .min(1)
      .max(64),
  )
  .min(1)
  .max(32);

export const agentProjectsListInputSchema = z.object({}).strict();
const agentProjectDirectoryItemSchema = z
  .object({
    project_id: z.number().int().positive(),
    unit_id: z.number().int().positive(),
    unit_code: z.string().min(1).max(80).nullable(),
    unit_name: z.string().min(1).max(512).nullable(),
    target_grade: z.number().int().nonnegative().nullable(),
    submitted_grade: z.number().int().nonnegative().nullable(),
    enrolled: z.boolean().nullable(),
    special_consideration_days: z.number().int().nonnegative().nullable(),
    portfolio_available: z.boolean().nullable(),
    escalation_attempts_remaining: z.number().int().nonnegative().nullable(),
  })
  .strict();
export const agentProjectsListOutputSchema = z
  .object({
    count: z.number().int().nonnegative().max(200),
    projects: z.array(agentProjectDirectoryItemSchema).max(200),
  })
  .strict();
export type AgentProjectsListInput = z.output<typeof agentProjectsListInputSchema>;
export type AgentProjectsListOutput = z.output<typeof agentProjectsListOutputSchema>;

export const agentUnitShowInputSchema = z
  .object({
    project_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    unit_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  })
  .strict();
export const agentUnitShowOutputSchema = z
  .object({
    project_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    unit_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    unit_code: z.string().min(1).max(80).nullable(),
    unit_name: z.string().min(1).max(512).nullable(),
    target_grade: z.number().int().nonnegative().nullable(),
    submitted_grade: z.number().int().nonnegative().nullable(),
    enrolled: z.boolean().nullable(),
    active: z.boolean().nullable(),
    task_definition_count: z.number().int().nonnegative().max(200),
  })
  .strict();
export type AgentUnitShowInput = z.output<typeof agentUnitShowInputSchema>;
export type AgentUnitShowOutput = z.output<typeof agentUnitShowOutputSchema>;

const agentTaskListSafeText = z
  .string()
  .regex(/\S/u, 'value must contain a non-whitespace character')
  .regex(AGENT_SAFE_TEXT_PATTERN, 'value contains unsafe control characters');

export const agentTasksListInputSchema = z
  .object({
    project_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    unit_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    status: agentTaskListSafeText
      .trim()
      .min(1)
      .max(AGENT_TASKS_LIST_MAX_STATUS_LENGTH)
      .optional(),
  })
  .strict();

const agentStudentTaskViewItemSchema = z
  .object({
    project_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    unit_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    unit_code: agentTaskListSafeText.min(1).max(80).nullable(),
    task_definition_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    task_instance_id: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER)
      .nullable(),
    abbreviation: agentTaskListSafeText.min(1).max(80),
    name: agentTaskListSafeText.min(1).max(512).nullable(),
    status: agentTaskListSafeText
      .min(1)
      .max(AGENT_TASKS_LIST_MAX_STATUS_LENGTH),
    due_date: agentTaskListSafeText.min(1).max(128).nullable(),
    completion_date: agentTaskListSafeText.min(1).max(128).nullable(),
    instantiated: z.boolean(),
    visibility: z.literal('within_target'),
  })
  .strict();

export const agentTasksListOutputSchema = z
  .object({
    count: z.number().int().nonnegative().max(200),
    tasks: z.array(agentStudentTaskViewItemSchema).max(200),
  })
  .strict();

export type AgentTasksListInput = z.output<typeof agentTasksListInputSchema>;
export type AgentTasksListOutput = z.output<typeof agentTasksListOutputSchema>;

/**
 * Keep selector invariants in the schema itself so `agent describe` is
 * sufficient for a caller to construct a valid request without trial calls.
 */
export const agentTaskShowInputSchema = z.union([
  z
    .object({
      project_id: taskShowProjectId,
      task_definition_id: taskShowDefinitionId,
      abbreviation: taskShowAbbreviations.optional(),
      all_tasks: z.literal(false).optional(),
    })
    .strict(),
  z
    .object({
      project_id: taskShowProjectId,
      task_definition_id: taskShowDefinitionId.optional(),
      abbreviation: taskShowAbbreviations,
      all_tasks: z.literal(false).optional(),
    })
    .strict(),
  z
    .object({
      project_id: taskShowProjectId,
      all_tasks: z.literal(true),
    })
    .strict(),
]);

const agentTaskShowItemSchema = z
  .object({
    project_id: z.number().int().positive(),
    unit_id: z.number().int().positive().nullable(),
    unit_code: z.string().max(80).nullable(),
    task_definition_id: z.number().int().positive(),
    task_instance_id: z.number().int().positive().nullable(),
    abbreviation: z.string().min(1).max(80),
    name: z.string().nullable(),
    status: z.string().nullable(),
    due_date: z.string().nullable(),
    completion_date: z.string().nullable(),
    grade: z.union([z.string(), z.number()]).nullable(),
    quality_points: z.number().nullable(),
    instantiated: z.boolean(),
    visibility: z.enum([
      'within_target',
      'beyond_target',
      'tutorial_mismatch',
      'unknown',
    ]),
  })
  .strict();

export const agentTaskShowOutputSchema = z
  .object({
    project_id: z.number().int().positive(),
    count: z.number().int().nonnegative(),
    tasks: z.array(agentTaskShowItemSchema).max(200),
  })
  .strict();

export type AgentTaskShowInput = z.output<typeof agentTaskShowInputSchema>;
export type AgentTaskShowOutput = z.output<typeof agentTaskShowOutputSchema>;

const taskResourceOptionsSchema = z
  .object({
    out_dir: z.string().trim().min(1).max(4096).optional(),
    allow_external_dir: z.boolean().optional(),
  })
  .strict();

/** Typed caller contract for task-resource downloads. */
export const agentTaskResourcesInputSchema = z.union([
  z
    .object({
      project_id: taskShowProjectId,
      task_definition_id: taskShowDefinitionId,
      abbreviation: taskShowAbbreviations.optional(),
      all_tasks: z.literal(false).optional(),
      ...taskResourceOptionsSchema.shape,
    })
    .strict(),
  z
    .object({
      project_id: taskShowProjectId,
      task_definition_id: taskShowDefinitionId.optional(),
      abbreviation: taskShowAbbreviations,
      all_tasks: z.literal(false).optional(),
      ...taskResourceOptionsSchema.shape,
    })
    .strict(),
  z
    .object({
      project_id: taskShowProjectId,
      all_tasks: z.literal(true),
      ...taskResourceOptionsSchema.shape,
    })
    .strict(),
]);

const agentTaskResourceArtifactSchema = z
  .object({
    filename: z.string().min(1).max(255),
    path: z.string().min(1).max(4096),
    bytes: z.number().int().nonnegative(),
    content_type: z.string().min(1).max(128),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();

const agentTaskResourceDownloadSchema = z
  .object({
    project_id: z.number().int().positive(),
    unit_id: z.number().int().positive().nullable(),
    unit_code: z.string().max(80).nullable(),
    task_definition_id: z.number().int().positive(),
    task_instance_id: z.number().int().positive().nullable(),
    task_id: z.number().int().positive(),
    task_def_id: z.number().int().positive(),
    abbreviation: z.string().min(1).max(80),
    instantiated: z.boolean(),
    artifact: agentTaskResourceArtifactSchema,
  })
  .strict();

const agentTaskResourceUnavailableSchema = z
  .object({
    project_id: z.number().int().positive(),
    unit_id: z.number().int().positive().nullable(),
    unit_code: z.string().max(80).nullable(),
    task_definition_id: z.number().int().positive(),
    task_instance_id: z.number().int().positive().nullable(),
    task_id: z.number().int().positive(),
    task_def_id: z.number().int().positive(),
    abbreviation: z.string().min(1).max(80),
    instantiated: z.boolean(),
    reason: z.literal('not_available'),
  })
  .strict();

export const agentTaskResourcesOutputSchema = z
  .object({
    project_id: z.number().int().positive(),
    selected_count: z.number().int().nonnegative(),
    downloaded_count: z.number().int().nonnegative(),
    unavailable_count: z.number().int().nonnegative(),
    downloads: z.array(agentTaskResourceDownloadSchema).max(200),
    unavailable: z.array(agentTaskResourceUnavailableSchema).max(200),
  })
  .strict();

export type AgentTaskResourcesInput = z.output<typeof agentTaskResourcesInputSchema>;
export type AgentTaskResourcesOutput = z.output<typeof agentTaskResourcesOutputSchema>;

/** Shared typed caller contract for a single definition-first task read. */
const agentSingleTaskInputSchema = z.union([
  z
    .object({
      project_id: taskShowProjectId,
      task_definition_id: taskShowDefinitionId,
      abbreviation: z
        .string()
        .regex(/^(?=[^,]*\S)[^,]+$/u)
        .trim()
        .min(1)
        .max(64)
        .optional(),
    })
    .strict(),
  z
    .object({
      project_id: taskShowProjectId,
      abbreviation: z
        .string()
        .regex(/^(?=[^,]*\S)[^,]+$/u)
        .trim()
        .min(1)
        .max(64),
    })
    .strict(),
]);

/** Typed caller contract for one task's prerequisite relationships. */
export const agentTaskPrerequisitesInputSchema = agentSingleTaskInputSchema;

const agentTaskPrerequisiteSchema = z
  .object({
    id: z.number().int().positive().nullable(),
    task_definition_id: taskShowDefinitionId,
    prerequisite_task_definition_id: taskShowDefinitionId,
    required_status: z.string().min(1).max(80),
  })
  .strict();

export const agentTaskPrerequisitesOutputSchema = z
  .object({
    project_id: taskShowProjectId,
    unit_id: taskShowUnitId,
    task_definition_id: taskShowDefinitionId,
    count: z.number().int().nonnegative(),
    prerequisites: z.array(agentTaskPrerequisiteSchema).max(200),
  })
  .strict();

export type AgentTaskPrerequisitesInput = z.output<
  typeof agentTaskPrerequisitesInputSchema
>;
export type AgentTaskPrerequisitesOutput = z.output<
  typeof agentTaskPrerequisitesOutputSchema
>;

/** Typed caller contract for one task's bounded, person-free feedback timeline. */
export const agentFeedbackListInputSchema = agentSingleTaskInputSchema;
const agentFeedbackTextSchema = z
  .string()
  .min(1)
  .max(4096)
  .regex(AGENT_SAFE_TEXT_PATTERN);
const agentFeedbackMultilineTextSchema = z
  .string()
  .min(1)
  .max(4096)
  .regex(AGENT_MULTILINE_SAFE_TEXT_PATTERN);
export const agentRfc3339TimestampSchema = z
  .string()
  .max(128)
  .regex(AGENT_RFC3339_TIMESTAMP_PATTERN)
  .refine(isAgentRfc3339Timestamp, "timestamp must be a real RFC 3339 instant");
export const agentFeedbackItemSchema = z
  .object({
    feedback_id: z.number().int().positive().nullable(),
    kind: agentFeedbackTextSchema.max(80),
    text: agentFeedbackMultilineTextSchema.nullable(),
    created_at: agentRfc3339TimestampSchema.nullable(),
    updated_at: agentRfc3339TimestampSchema.nullable(),
    is_new: z.boolean().nullable(),
  })
  .strict();
export const agentFeedbackListOutputSchema = z
  .object({
    project_id: taskShowProjectId,
    unit_id: taskShowUnitId,
    unit_code: agentFeedbackTextSchema.max(80).nullable(),
    task_definition_id: taskShowDefinitionId,
    task_instance_id: z.number().int().positive().nullable(),
    abbreviation: agentFeedbackTextSchema.max(80),
    instantiated: z.boolean(),
    count: z.number().int().nonnegative().max(200),
    feedback: z.array(agentFeedbackItemSchema).max(200),
  })
  .strict();
export type AgentFeedbackListInput = z.output<typeof agentFeedbackListInputSchema>;
export type AgentFeedbackListOutput = z.output<typeof agentFeedbackListOutputSchema>;

/** NDJSON frame contract for a bounded, person-free task feedback stream. */
export const agentFeedbackWatchFrameSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("baseline"),
      at: agentRfc3339TimestampSchema,
      project_id: taskShowProjectId,
      task_definition_id: taskShowDefinitionId,
      abbreviation: agentFeedbackTextSchema.max(80),
      interval_seconds: z.number().int().min(1),
      total_feedback: z.number().int().nonnegative().max(200),
      feedback: z.array(agentFeedbackItemSchema).max(200),
    })
    .strict(),
  z
    .object({
      type: z.literal("feedback"),
      at: agentRfc3339TimestampSchema,
      project_id: taskShowProjectId,
      task_definition_id: taskShowDefinitionId,
      abbreviation: agentFeedbackTextSchema.max(80),
      feedback: z.array(agentFeedbackItemSchema).min(1).max(200),
    })
    .strict(),
]);

/** Typed caller contract for one task's normalized submission lifecycle status. */
export const agentSubmissionStatusInputSchema = agentSingleTaskInputSchema;
export const agentSubmissionStatusOutputSchema = z
  .object({
    project_id: taskShowProjectId,
    unit_id: taskShowUnitId.nullable(),
    unit_code: z.string().max(80).nullable(),
    task_definition_id: taskShowDefinitionId,
    task_instance_id: z.number().int().positive().nullable(),
    abbreviation: z.string().min(1).max(80),
    instantiated: z.boolean(),
    has_pdf: z.boolean(),
    processing_pdf: z.boolean(),
    pdf_state: z.enum(['unavailable', 'processing', 'ready']),
    submission_date: z.string().min(1).max(128).nullable(),
    task_status: z.string().min(1).max(80).nullable(),
    submission_observed: z.boolean(),
  })
  .strict();

export type AgentSubmissionStatusInput = z.output<
  typeof agentSubmissionStatusInputSchema
>;
export type AgentSubmissionStatusOutput = z.output<
  typeof agentSubmissionStatusOutputSchema
>;

const agentPlanProjectId = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
const agentPlanSafeShortText = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[^\u0000-\u001f\u007f]*$/u);
function isCalendarDate(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

const agentPlanCalendarDateSchema = z
  .string()
  .length(10)
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
  .refine(isCalendarDate, "value must be a real calendar date");

/** Canonical Agent Plan Date contract shared by plan.show and streaming watch. */
export const agentPlanDateSchema = (
  kind: "start" | "target" | "feedback_deadline",
) =>
  z
    .object({
      kind: z.literal(kind),
      value: agentPlanCalendarDateSchema.nullable(),
      source: z.enum(["personal", "grade_default", "unit_default", "missing"]),
      editable: z.boolean(),
      interpretation: z.literal("unit_local_calendar_date"),
    })
    .strict()
    .superRefine((value, context) => {
      if ((value.value === null) !== (value.source === "missing")) {
        context.addIssue({
          code: "custom",
          message: "missing date values and sources must agree",
        });
      }
    });
const agentPlanPrerequisiteSchema = z
  .object({
    task_definition_id: taskShowDefinitionId,
    required_status: agentPlanSafeShortText,
    current_status: agentPlanSafeShortText.nullable(),
  })
  .strict();
const agentPlanTaskSchema = z
  .object({
    task_definition_id: taskShowDefinitionId,
    task_instance_id: z.number().int().positive().nullable(),
    abbreviation: agentPlanSafeShortText,
    name: z
      .string()
      .min(1)
      .max(512)
      .regex(/^[^\u0000-\u001f\u007f]*$/u)
      .nullable(),
    status: agentPlanSafeShortText,
    instantiated: z.boolean(),
    visibility: z.enum([
      'within_target',
      'beyond_target',
      'tutorial_mismatch',
      'unknown',
    ]),
    flexible_dates: z.boolean(),
    start: agentPlanDateSchema('start'),
    target: agentPlanDateSchema('target'),
    feedback_deadline: agentPlanDateSchema('feedback_deadline'),
    prerequisites: z.array(agentPlanPrerequisiteSchema).max(200),
  })
  .strict();

/** Typed caller contract for the definition-first project plan read. */
export const agentPlanShowInputSchema = z
  .object({
    project_id: agentPlanProjectId,
    include_beyond_target: z.boolean().optional(),
  })
  .strict();

export const agentPlanShowOutputSchema = z
  .object({
    project_id: agentPlanProjectId,
    unit_id: taskShowUnitId,
    unit_code: agentPlanSafeShortText.nullable(),
    include_beyond_target: z.boolean(),
    count: z.number().int().nonnegative().max(200),
    tasks: z.array(agentPlanTaskSchema).max(200),
  })
  .strict();

export type AgentPlanShowInput = z.output<typeof agentPlanShowInputSchema>;
export type AgentPlanShowOutput = z.output<typeof agentPlanShowOutputSchema>;
export type AgentAuthStatus = {
  readonly status: 'signed_out' | 'usable' | 'expired' | 'unknown';
  readonly source?: string;
  readonly expiresAt?: string;
  readonly baseUrl: string;
};

export interface NativeAgentCommandHandlers {
  authStatus(): Promise<AgentAuthStatus>;
  projectsList(): Promise<AgentProjectsListOutput>;
  unitShow(input: AgentUnitShowInput): Promise<AgentUnitShowOutput>;
  tasksList(input: AgentTasksListInput): Promise<AgentTasksListOutput>;
  taskShow(input: AgentTaskShowInput): Promise<AgentTaskShowOutput>;
  taskPrerequisites(
    input: AgentTaskPrerequisitesInput,
  ): Promise<AgentTaskPrerequisitesOutput>;
  feedbackList(input: AgentFeedbackListInput): Promise<AgentFeedbackListOutput>;
  taskResources(input: AgentTaskResourcesInput): Promise<AgentTaskResourcesOutput>;
  planShow(input: AgentPlanShowInput): Promise<AgentPlanShowOutput>;
  submissionStatus(
    input: AgentSubmissionStatusInput,
  ): Promise<AgentSubmissionStatusOutput>;
}

const authStatusInputSchema = z.object({}).strict();
const authStatusOutputSchema = z
  .object({
    status: z.enum(['signed_out', 'usable', 'expired', 'unknown']),
    source: z.string().min(1).optional(),
    expiresAt: z.string().min(1).optional(),
    baseUrl: z.string().url(),
  })
  .strict();

const readPolicy = {
  auth: 'none' as const,
  interaction: 'never' as const,
  confirmation: 'none' as const,
  idempotency: 'not_applicable' as const,
  streaming: false,
};

export function createNativeAgentCommands(
  handlers: NativeAgentCommandHandlers,
): readonly AgentCommandDefinition[] {
  return [
    defineAgentCommand({
      path: 'auth.status',
      description: 'Inspect local authentication lifecycle metadata.',
      policy: { ...readPolicy, risk: 'auth' as const },
      input: authStatusInputSchema,
      output: authStatusOutputSchema,
      execute: () => handlers.authStatus(),
    }),
    defineAgentCommand({
      path: 'projects.list',
      description: 'List the safe project directory for Agent discovery.',
      policy: {
        ...readPolicy,
        risk: 'read' as const,
        auth: 'ensure' as const,
      },
      input: agentProjectsListInputSchema,
      output: agentProjectsListOutputSchema,
      execute: () => handlers.projectsList(),
    }),
    defineAgentCommand({
      path: 'unit.show',
      description: 'Read the safe project-scoped Student Unit View.',
      policy: {
        ...readPolicy,
        risk: 'read' as const,
        auth: 'ensure' as const,
      },
      input: agentUnitShowInputSchema,
      output: agentUnitShowOutputSchema,
      execute: (input) => handlers.unitShow(input),
    }),
    defineAgentCommand({
      path: 'tasks.list',
      description: 'List the safe project-scoped Student Task View catalogue.',
      policy: {
        ...readPolicy,
        risk: 'read' as const,
        auth: 'ensure' as const,
      },
      input: agentTasksListInputSchema,
      output: agentTasksListOutputSchema,
      execute: (input) => handlers.tasksList(input),
    }),
    defineAgentCommand({
      path: 'task.show',
      description: 'Read definition-first student task views.',
      policy: {
        ...readPolicy,
        risk: 'read' as const,
        auth: 'ensure' as const,
      },
      input: agentTaskShowInputSchema,
      output: agentTaskShowOutputSchema,
      execute: (input) => handlers.taskShow(input),
    }),
    defineAgentCommand({
      path: 'task.prerequisites',
      description: 'Read prerequisites for one task.',
      policy: {
        ...readPolicy,
        risk: 'read' as const,
        auth: 'ensure' as const,
      },
      input: agentTaskPrerequisitesInputSchema,
      output: agentTaskPrerequisitesOutputSchema,
      execute: (input) => handlers.taskPrerequisites(input),
    }),
    defineAgentCommand({
      path: 'feedback.list',
      description: 'Read one task\'s bounded, person-free feedback timeline.',
      policy: {
        ...readPolicy,
        risk: 'read' as const,
        auth: 'ensure' as const,
      },
      input: agentFeedbackListInputSchema,
      output: agentFeedbackListOutputSchema,
      execute: (input) => handlers.feedbackList(input),
    }),
    defineAgentCommand({
      path: 'task.resources',
      description: 'Download task resource archives with artifact metadata.',
      policy: {
        ...readPolicy,
        risk: 'read' as const,
        auth: 'ensure' as const,
      },
      input: agentTaskResourcesInputSchema,
      output: agentTaskResourcesOutputSchema,
      execute: (input) => handlers.taskResources(input),
    }),
    defineAgentCommand({
      path: 'plan.show',
      description: 'Read the definition-first student plan.',
      policy: {
        ...readPolicy,
        risk: 'read' as const,
        auth: 'ensure' as const,
      },
      input: agentPlanShowInputSchema,
      output: agentPlanShowOutputSchema,
      execute: (input) => handlers.planShow(input),
    }),
    defineAgentCommand({
      path: 'submission.status',
      description: 'Read submission lifecycle status.',
      policy: {
        ...readPolicy,
        risk: 'read' as const,
        auth: 'ensure' as const,
      },
      input: agentSubmissionStatusInputSchema,
      output: agentSubmissionStatusOutputSchema,
      execute: (input) => handlers.submissionStatus(input),
    }),
  ];
}
