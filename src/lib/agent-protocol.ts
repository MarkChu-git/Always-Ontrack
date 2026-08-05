import { randomUUID } from 'node:crypto';

export const AGENT_SCHEMA_VERSION = 'ontrack.agent/v1' as const;

export type AgentStatus =
  | 'success'
  | 'warning'
  | 'error'
  | 'auth_required'
  | 'action_required';

export type AgentErrorCode =
  | 'INVALID_ARGUMENT'
  | 'AUTH_REQUIRED'
  | 'HUMAN_VERIFICATION_REQUIRED'
  | 'AUTH_REFRESH_FAILED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'REMOTE_UNAVAILABLE'
  | 'CONFIRMATION_REQUIRED'
  | 'IDEMPOTENCY_OUTCOME_UNKNOWN'
  | 'INTERNAL_ERROR';

export interface AgentNextAction {
  readonly action: string;
  readonly arguments?: Readonly<Record<string, unknown>>;
}

export interface AgentArtifact {
  readonly type: string;
  readonly id?: string;
  readonly path?: string;
}

export interface AgentSuccessEnvelope<T> {
  readonly schema_version: typeof AGENT_SCHEMA_VERSION;
  readonly request_id: string;
  readonly command: string;
  readonly status: 'success' | 'warning';
  readonly summary: string;
  readonly data: T;
  readonly warnings: readonly string[];
  readonly next_actions: readonly AgentNextAction[];
  readonly artifacts: readonly AgentArtifact[];
}

export interface AgentFailureEnvelope {
  readonly schema_version: typeof AGENT_SCHEMA_VERSION;
  readonly request_id: string;
  readonly command: string;
  readonly status: Exclude<AgentStatus, 'success' | 'warning'>;
  readonly summary: string;
  readonly error: {
    readonly code: AgentErrorCode;
    readonly retryable: boolean;
    readonly retry_after_ms?: number;
  };
  readonly next_actions: readonly AgentNextAction[];
  readonly artifacts: readonly AgentArtifact[];
}

const SECRET_STRING_PATTERN =
  /(?:\b(?:bearer|basic)\s+[a-z0-9._~+/-]{8,}|eyj[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}|(?:gh[pousr]|github_pat)_[a-z0-9_]{20,}|sk-[a-z0-9_-]{16,})/i;

const MAX_AGENT_TOKEN_LENGTH = 128;
const MAX_AGENT_METADATA_ITEMS = 16;
const MAX_AGENT_METADATA_DEPTH = 4;
const AGENT_COMMAND_PATH = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const AGENT_REQUEST_ID = /^req_[a-zA-Z0-9_-]{1,120}$/u;

function sanitizeAgentToken(value: string | undefined, fallback: string): string {
  const normalized = (value ?? fallback)
    .replace(/[\u0000-\u001f\u007f]/gu, '?')
    .trim();
  const bounded = (normalized || fallback).slice(0, MAX_AGENT_TOKEN_LENGTH);
  return SECRET_STRING_PATTERN.test(bounded) ? '[REDACTED]' : bounded;
}

function sanitizeAgentCommand(value: string | undefined): string {
  const candidate = value?.trim() ?? '';
  return candidate.length <= MAX_AGENT_TOKEN_LENGTH && AGENT_COMMAND_PATH.test(candidate)
    ? candidate
    : 'agent.call';
}

function sanitizeAgentRequestId(value: string | undefined): string {
  return value && AGENT_REQUEST_ID.test(value)
    ? value
    : `req_${randomUUID()}`;
}

function isCredentialKey(key: string): boolean {
  const normalized = key.replace(/[_-]/gu, '').toLowerCase();
  if (
    normalized.includes('tokenexpiry') ||
    normalized.includes('tokenexpiresat') ||
    normalized === 'tokentype'
  ) {
    return false;
  }
  return (
    normalized.includes('token') ||
    normalized.includes('cookie') ||
    normalized.includes('password') ||
    normalized.includes('passcode') ||
    normalized.includes('secret') ||
    normalized.includes('credential') ||
    normalized.includes('authorization') ||
    normalized === 'session' ||
    normalized.includes('sessionid') ||
    normalized.includes('csrf') ||
    normalized.includes('xsrf') ||
    normalized.includes('apikey') ||
    normalized.includes('privatekey')
  );
}

/** Remove credential-shaped fields while preserving business and identity data. */
export function sanitizeAgentData(value: unknown): unknown {
  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return value;
  }
  if (typeof value === 'string') {
    return SECRET_STRING_PATTERN.test(value) ? '[REDACTED]' : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAgentData(item));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !isCredentialKey(key))
        .map(([key, child]) => [key, sanitizeAgentData(child)]),
    );
  }
  return String(value);
}

/** Bound protocol metadata separately from business data to prevent amplification. */
function sanitizeAgentMetadata(value: unknown, depth = 0): unknown {
  if (depth > MAX_AGENT_METADATA_DEPTH) {
    return '[TRUNCATED]';
  }
  if (typeof value === 'string') {
    return sanitizeAgentToken(value, '');
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_AGENT_METADATA_ITEMS)
      .map((item) => sanitizeAgentMetadata(item, depth + 1));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !isCredentialKey(key))
        .slice(0, MAX_AGENT_METADATA_ITEMS)
        .map(([key, child]) => [
          sanitizeAgentToken(key, 'field'),
          sanitizeAgentMetadata(child, depth + 1),
        ]),
    );
  }
  return sanitizeAgentToken(String(value), '');
}

interface AgentOutputContext {
  readonly command: string;
  readonly requestId: string;
  readonly streaming: boolean;
}

let activeOutputContext: AgentOutputContext | undefined;

/** Enable envelope wrapping for the current process invocation. */
export function configureAgentOutputContext(context: AgentOutputContext): void {
  activeOutputContext = { ...context };
}

/** Clear process-scoped output state, primarily for tests and embedded callers. */
export function clearAgentOutputContext(): void {
  activeOutputContext = undefined;
}

export function getAgentOutputContext(): AgentOutputContext | undefined {
  return activeOutputContext ? { ...activeOutputContext } : undefined;
}

interface AgentProtocolErrorOptions {
  readonly code: AgentErrorCode;
  readonly status?: AgentFailureEnvelope['status'];
  readonly summary: string;
  readonly retryable?: boolean;
  readonly retryAfterMs?: number;
  readonly nextActions?: readonly AgentNextAction[];
  readonly cause?: unknown;
}

/** Typed, secret-free failure contract for Agent callers. */
export class AgentProtocolError extends Error {
  readonly code: AgentErrorCode;
  readonly status: AgentFailureEnvelope['status'];
  readonly summary: string;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly nextActions: readonly AgentNextAction[];

  constructor(options: AgentProtocolErrorOptions) {
    super(options.summary, { cause: options.cause });
    this.name = 'AgentProtocolError';
    this.code = options.code;
    this.status = options.status ?? 'error';
    this.summary = options.summary;
    this.retryable = options.retryable ?? false;
    this.retryAfterMs = options.retryAfterMs;
    this.nextActions = options.nextActions ? [...options.nextActions] : [];
  }
}

interface SuccessEnvelopeOptions<T> {
  readonly command: string;
  readonly requestId?: string;
  readonly status?: 'success' | 'warning';
  readonly summary?: string;
  readonly data: T;
  readonly warnings?: readonly string[];
  readonly nextActions?: readonly AgentNextAction[];
  readonly artifacts?: readonly AgentArtifact[];
}

/** Create one immutable, versioned success observation. */
export function agentSuccessEnvelope<T>(
  options: SuccessEnvelopeOptions<T>,
): AgentSuccessEnvelope<T> {
  return {
    schema_version: AGENT_SCHEMA_VERSION,
    request_id: sanitizeAgentRequestId(options.requestId),
    command: sanitizeAgentCommand(options.command),
    status: options.status ?? 'success',
    summary: sanitizeAgentToken(
      options.summary,
      'Command completed successfully.',
    ),
    data: sanitizeAgentData(structuredClone(options.data)) as T,
    warnings: options.warnings
      ? options.warnings
          .slice(0, MAX_AGENT_METADATA_ITEMS)
          .map((warning) => sanitizeAgentToken(warning, ''))
      : [],
    next_actions: options.nextActions
      ? (sanitizeAgentMetadata(structuredClone(options.nextActions)) as AgentNextAction[])
      : [],
    artifacts: options.artifacts
      ? (sanitizeAgentMetadata(structuredClone(options.artifacts)) as AgentArtifact[])
      : [],
  };
}

/** Preserve legacy JSON unless the CLI explicitly selected Agent output. */
export function wrapAgentOutput<T>(data: T): T | AgentSuccessEnvelope<T> {
  if (!activeOutputContext) {
    return data;
  }
  return agentSuccessEnvelope({
    command: activeOutputContext.command,
    requestId: activeOutputContext.requestId,
    data,
  });
}

interface ErrorEnvelopeOptions {
  readonly command: string;
  readonly requestId?: string;
  readonly error: unknown;
}

/** Normalize unknown failures without placing raw exception text in Agent context. */
function normalizeProtocolError(error: unknown): AgentProtocolError {
  if (error instanceof AgentProtocolError) {
    return error;
  }
  return new AgentProtocolError({
    code: 'INTERNAL_ERROR',
    summary: 'The command failed unexpectedly.',
    cause: error,
  });
}

/** Create one immutable, versioned failure observation. */
export function agentErrorEnvelope(
  options: ErrorEnvelopeOptions,
): AgentFailureEnvelope {
  const error = normalizeProtocolError(options.error);
  return {
    schema_version: AGENT_SCHEMA_VERSION,
    request_id: sanitizeAgentRequestId(options.requestId),
    command: sanitizeAgentCommand(options.command),
    status: error.status,
    summary: sanitizeAgentToken(error.summary, 'The command failed unexpectedly.'),
    error: {
      code: error.code,
      retryable: error.retryable,
      ...(error.retryAfterMs !== undefined
        ? { retry_after_ms: error.retryAfterMs }
        : {}),
    },
    next_actions: sanitizeAgentMetadata(structuredClone(error.nextActions)) as AgentNextAction[],
    artifacts: [],
  };
}

const EXIT_CODES: Readonly<Record<AgentErrorCode, number>> = {
  INVALID_ARGUMENT: 2,
  AUTH_REQUIRED: 3,
  HUMAN_VERIFICATION_REQUIRED: 3,
  AUTH_REFRESH_FAILED: 3,
  FORBIDDEN: 4,
  NOT_FOUND: 5,
  CONFLICT: 6,
  CONFIRMATION_REQUIRED: 6,
  RATE_LIMITED: 7,
  REMOTE_UNAVAILABLE: 7,
  IDEMPOTENCY_OUTCOME_UNKNOWN: 8,
  INTERNAL_ERROR: 10,
};

export function exitCodeForAgentErrorCode(code: AgentErrorCode): number {
  return EXIT_CODES[code];
}

/** Stable process exit code for Agent orchestration. */
export function exitCodeForAgentError(error: unknown): number {
  return exitCodeForAgentErrorCode(normalizeProtocolError(error).code);
}
