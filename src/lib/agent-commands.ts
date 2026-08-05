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

/** Typed caller contract for one task's prerequisite relationships. */
export const agentTaskPrerequisitesInputSchema = z.union([
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
export type AgentAuthStatus = {
  readonly status: 'signed_out' | 'usable' | 'expired' | 'unknown';
  readonly source?: string;
  readonly expiresAt?: string;
  readonly baseUrl: string;
};

export interface NativeAgentCommandHandlers {
  authStatus(): Promise<AgentAuthStatus>;
  taskShow(input: AgentTaskShowInput): Promise<AgentTaskShowOutput>;
  taskPrerequisites(
    input: AgentTaskPrerequisitesInput,
  ): Promise<AgentTaskPrerequisitesOutput>;
  taskResources(input: AgentTaskResourcesInput): Promise<AgentTaskResourcesOutput>;
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
  ];
}
