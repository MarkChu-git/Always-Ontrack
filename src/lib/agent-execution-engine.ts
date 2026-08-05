import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  AgentProtocolError,
  agentErrorEnvelope,
  agentSuccessEnvelope,
  exitCodeForAgentErrorCode,
} from './agent-protocol.js';
import type {
  AgentFailureEnvelope,
  AgentSuccessEnvelope,
} from './agent-protocol.js';

interface AgentBasePolicy {
  readonly auth: 'none' | 'ensure';
  readonly interaction: 'never' | 'if_required';
  readonly streaming: boolean;
}

interface AgentNonWritePolicy extends AgentBasePolicy {
  readonly risk: 'read' | 'auth' | 'local';
  readonly confirmation: 'none';
  readonly idempotency: 'not_applicable';
}

interface AgentWritePolicy extends AgentBasePolicy {
  readonly risk: 'write';
  readonly auth: 'ensure';
  readonly confirmation: 'required';
  readonly idempotency: 'client_guarded' | 'unknown_outcome_guarded';
}

export type AgentCommandPolicy = AgentNonWritePolicy | AgentWritePolicy;

export interface AgentCommandManifest {
  readonly path: string;
  readonly description: string;
  readonly policy: AgentCommandPolicy;
  readonly input_schema: Readonly<Record<string, unknown>>;
  readonly output_schema: Readonly<Record<string, unknown>>;
}

export interface AgentCommandDefinition {
  readonly path: string;
  readonly description: string;
  readonly policy: AgentCommandPolicy;
  readonly input: z.ZodType;
  readonly output: z.ZodType;
  execute(input: unknown): Promise<unknown>;
}

export interface AgentPolicyRuntime {
  /** Ensure the command has a usable credential without starting interaction. */
  readonly ensureAuth?: (command: AgentCommandDefinition) => Promise<void>;
  /** Execute an explicit confirmation gate for a mutating command. */
  readonly confirm?: (
    command: AgentCommandDefinition,
    input: unknown,
  ) => Promise<void>;
  /** Check or claim the command's idempotency contract before execution. */
  readonly checkIdempotency?: (
    command: AgentCommandDefinition,
    request: AgentCallRequest,
  ) => Promise<void>;
  /** Permit an interaction-capable command to continue. */
  readonly allowInteraction?: (command: AgentCommandDefinition) => Promise<void>;
}

interface DefineAgentCommandOptions<TInputSchema extends z.ZodType, TOutputSchema extends z.ZodType> {
  readonly path: string;
  readonly description: string;
  readonly policy: AgentCommandPolicy;
  readonly input: TInputSchema;
  readonly output: TOutputSchema;
  execute(input: z.output<TInputSchema>): Promise<z.input<TOutputSchema>>;
}

export function defineAgentCommand<
  TInputSchema extends z.ZodType,
  TOutputSchema extends z.ZodType,
>(
  options: DefineAgentCommandOptions<TInputSchema, TOutputSchema>,
): AgentCommandDefinition {
  return {
    path: options.path,
    description: options.description,
    policy: { ...options.policy },
    input: options.input,
    output: options.output,
    execute: (input) => options.execute(input as z.output<TInputSchema>),
  };
}

export type AgentExecutionEnvelope =
  | AgentSuccessEnvelope<unknown>
  | AgentFailureEnvelope;

export interface AgentCallRequest {
  readonly command: string;
  readonly input: unknown;
}

export interface AgentExecutionEngine {
  call(request: AgentCallRequest): Promise<AgentExecutionEnvelope>;
  describe(command: string): AgentCommandManifest;
  capabilities(): readonly AgentCommandManifest[];
}

interface AgentExecutionEngineOptions {
  readonly requestId?: () => string;
  readonly normalizeError?: (error: unknown) => AgentProtocolError;
  readonly policyRuntime?: AgentPolicyRuntime;
}

const UNSAFE_INPUT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const AGENT_COMMAND_PATH = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const MAX_AGENT_COMMAND_PATH_LENGTH = 128;

function isValidCommandPath(command: string): boolean {
  return (
    command.length <= MAX_AGENT_COMMAND_PATH_LENGTH &&
    AGENT_COMMAND_PATH.test(command)
  );
}

function containsUnsafeInputKey(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => containsUnsafeInputKey(item));
  }
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return Object.entries(value).some(
    ([key, child]) =>
      UNSAFE_INPUT_KEYS.has(key) || containsUnsafeInputKey(child),
  );
}

function manifestOf(command: AgentCommandDefinition): AgentCommandManifest {
  return {
    path: command.path,
    description: command.description,
    policy: { ...command.policy },
    input_schema: z.toJSONSchema(command.input) as Readonly<
      Record<string, unknown>
    >,
    output_schema: z.toJSONSchema(command.output) as Readonly<
      Record<string, unknown>
    >,
  };
}

function invalidArgument(summary: string): AgentProtocolError {
  return new AgentProtocolError({
    code: 'INVALID_ARGUMENT',
    summary,
  });
}

async function enforcePolicy(
  command: AgentCommandDefinition,
  request: AgentCallRequest,
  runtime: AgentPolicyRuntime | undefined,
): Promise<void> {
  if (command.policy.auth === 'ensure') {
    if (!runtime?.ensureAuth) {
      throw new AgentProtocolError({
        code: 'INTERNAL_ERROR',
        summary: 'The command auth policy runtime is not configured.',
      });
    }
    await runtime.ensureAuth(command);
  }

  if (command.policy.interaction === 'if_required') {
    if (!runtime?.allowInteraction) {
      throw new AgentProtocolError({
        code: 'HUMAN_VERIFICATION_REQUIRED',
        status: 'action_required',
        summary: 'This command requires an interaction policy decision.',
      });
    }
    await runtime.allowInteraction(command);
  }

  if (command.policy.confirmation === 'required') {
    if (!runtime?.confirm) {
      throw new AgentProtocolError({
        code: 'CONFIRMATION_REQUIRED',
        status: 'action_required',
        summary: 'This command requires explicit confirmation.',
      });
    }
    await runtime.confirm(command, request.input);
  }

  if (command.policy.idempotency !== 'not_applicable') {
    if (!runtime?.checkIdempotency) {
      throw new AgentProtocolError({
        code:
          command.policy.idempotency === 'unknown_outcome_guarded'
            ? 'IDEMPOTENCY_OUTCOME_UNKNOWN'
            : 'INTERNAL_ERROR',
        summary: 'The command idempotency policy runtime is not configured.',
      });
    }
    await runtime.checkIdempotency(command, request);
  }
}

function assertSafePolicy(command: AgentCommandDefinition): void {
  const policy = command.policy as {
    readonly risk: string;
    readonly auth: string;
    readonly confirmation: string;
    readonly idempotency: string;
  };
  if (policy.risk === 'write') {
    if (
      policy.auth !== 'ensure' ||
      policy.confirmation !== 'required' ||
      policy.idempotency === 'not_applicable'
    ) {
      throw new Error(
        `Unsafe write policy for Agent command: ${command.path}`,
      );
    }
    return;
  }

  if (
    policy.confirmation !== 'none' ||
    policy.idempotency !== 'not_applicable'
  ) {
    throw new Error(
      `Non-write Agent command declares write-only policy: ${command.path}`,
    );
  }
}

export function createAgentExecutionEngine(
  commands: readonly AgentCommandDefinition[],
  options: AgentExecutionEngineOptions = {},
): AgentExecutionEngine {
  const commandMap = new Map<string, AgentCommandDefinition>();
  for (const command of commands) {
    assertSafePolicy(command);
    if (!isValidCommandPath(command.path)) {
      throw new Error('Agent command definitions require a stable command path.');
    }
    if (commandMap.has(command.path)) {
      throw new Error(`Duplicate Agent command path: ${command.path}`);
    }
    commandMap.set(command.path, command);
  }

  const manifest = [...commandMap.values()].map((command) => manifestOf(command));
  const nextRequestId = options.requestId ?? (() => `req_${randomUUID()}`);

  return {
    call: async (request): Promise<AgentExecutionEnvelope> => {
      const requestId = nextRequestId();
      let envelopeCommand = 'agent.call';
      try {
        if (!isValidCommandPath(request.command)) {
          throw invalidArgument('Agent call requires a stable command path.');
        }
        const command = commandMap.get(request.command);
        if (!command) {
          throw invalidArgument('The requested Agent command is not available.');
        }
        envelopeCommand = command.path;
        if (containsUnsafeInputKey(request.input)) {
          throw invalidArgument('Agent input contains an unsafe object key.');
        }

        const parsedInput = command.input.safeParse(request.input);
        if (!parsedInput.success) {
          throw invalidArgument(
            `Agent input does not match the ${command.path} schema.`,
          );
        }

        const canonicalRequest: AgentCallRequest = {
          ...request,
          input: parsedInput.data,
        };
        await enforcePolicy(command, canonicalRequest, options.policyRuntime);
        const rawOutput = await command.execute(parsedInput.data);
        const parsedOutput = command.output.safeParse(rawOutput);
        if (!parsedOutput.success) {
          throw new AgentProtocolError({
            code: 'INTERNAL_ERROR',
            summary: 'The command returned data that failed contract validation.',
          });
        }

        return agentSuccessEnvelope({
          command: command.path,
          requestId,
          data: parsedOutput.data,
        });
      } catch (error) {
        const normalized = options.normalizeError
          ? options.normalizeError(error)
          : error;
        return agentErrorEnvelope({
          command: envelopeCommand,
          requestId,
          error: normalized,
        });
      }
    },
    describe: (command): AgentCommandManifest => {
      if (!isValidCommandPath(command)) {
        throw invalidArgument('Agent describe requires a stable command path.');
      }
      const result = commandMap.get(command);
      if (!result) {
        throw invalidArgument('The requested Agent command is not available.');
      }
      return manifestOf(result);
    },
    capabilities: (): readonly AgentCommandManifest[] =>
      manifest.map((item) => structuredClone(item)),
  };
}

export function exitCodeForAgentEnvelope(
  envelope: AgentExecutionEnvelope,
): number {
  return 'error' in envelope
    ? exitCodeForAgentErrorCode(envelope.error.code)
    : 0;
}
