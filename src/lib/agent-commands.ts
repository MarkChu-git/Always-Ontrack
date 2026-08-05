import { z } from 'zod';
import {
  defineAgentCommand,
  type AgentCommandDefinition,
} from './agent-execution-engine.js';

const taskShowProjectId = z.number().int().positive();
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
    unit_code: z.string().nullable(),
    task_definition_id: z.number().int().positive(),
    task_instance_id: z.number().int().positive().nullable(),
    abbreviation: z.string().min(1),
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
export type AgentAuthStatus = {
  readonly status: 'signed_out' | 'usable' | 'expired' | 'unknown';
  readonly source?: string;
  readonly expiresAt?: string;
  readonly baseUrl: string;
};

export interface NativeAgentCommandHandlers {
  authStatus(): Promise<AgentAuthStatus>;
  taskShow(input: AgentTaskShowInput): Promise<AgentTaskShowOutput>;
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
  ];
}
