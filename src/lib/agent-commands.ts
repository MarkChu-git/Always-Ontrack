import { z } from 'zod';
import {
  defineAgentCommand,
  type AgentCommandDefinition,
} from './agent-execution-engine.js';

const taskShowProjectId = z.number().int().positive();
const taskShowUnitId = z.number().int().positive();
const taskShowDefinitionId = z.number().int().positive();
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
      abbreviation: z.string().regex(/\S/u).trim().min(1).max(64).optional(),
    })
    .strict(),
  z
    .object({
      project_id: taskShowProjectId,
      abbreviation: z.string().regex(/\S/u).trim().min(1).max(64),
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
const agentPlanDateSchema = (
  kind: 'start' | 'target' | 'feedback_deadline',
) => z
  .object({
    kind: z.literal(kind),
    value: z.string().length(10).regex(/^\d{4}-\d{2}-\d{2}$/u).nullable(),
    source: z.enum(['personal', 'grade_default', 'unit_default', 'missing']),
    editable: z.boolean(),
    interpretation: z.literal('unit_local_calendar_date'),
  })
  .strict();
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
  taskShow(input: AgentTaskShowInput): Promise<AgentTaskShowOutput>;
  taskPrerequisites(
    input: AgentTaskPrerequisitesInput,
  ): Promise<AgentTaskPrerequisitesOutput>;
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
