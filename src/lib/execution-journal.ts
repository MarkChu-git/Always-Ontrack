import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { AgentProtocolError, sanitizeAgentData } from "./agent-protocol.js";

export type ExecutionState =
  | "in_progress"
  | "succeeded"
  | "rejected"
  | "outcome_unknown";

interface ExecutionRecord {
  readonly schema_version: "ontrack.execution/v1";
  readonly operation_id: string;
  readonly command: string;
  readonly fingerprint: string;
  readonly state: ExecutionState;
  readonly created_at: string;
  readonly updated_at: string;
  readonly result?: unknown;
}

export interface ExecutionClaim {
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly replayed: boolean;
  readonly result?: unknown;
}

export interface ExecutionJournalOptions {
  readonly rootPath?: string;
}

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function configRoot(): string {
  if (process.env.XDG_CONFIG_HOME) {
    return process.env.XDG_CONFIG_HOME;
  }
  if (process.platform === "win32" && process.env.APPDATA) {
    return process.env.APPDATA;
  }
  return join(homedir(), ".config");
}

function journalRoot(options: ExecutionJournalOptions): string {
  return options.rootPath ?? join(configRoot(), "ontrack-cli", "executions");
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stableValue(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

export function executionFingerprint(
  command: string,
  input: Readonly<Record<string, unknown>>,
): string {
  return digest(JSON.stringify(stableValue({ command, input })));
}

export function validateIdempotencyKey(value: string): string {
  if (!IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new AgentProtocolError({
      code: "INVALID_ARGUMENT",
      summary:
        '--idempotency-key must be 1-128 characters using letters, numbers, ".", "_", ":" or "-".',
    });
  }
  return value;
}

function recordPath(key: string, options: ExecutionJournalOptions): string {
  return join(journalRoot(options), `${digest(key)}.json`);
}

function lockPath(key: string, options: ExecutionJournalOptions): string {
  return join(journalRoot(options), `${digest(key)}.lock`);
}

async function atomicWrite(
  path: string,
  record: ExecutionRecord,
): Promise<void> {
  const temporaryPath = join(
    dirname(path),
    `.${basename(path)}.tmp-${randomUUID()}`,
  );
  try {
    // Journal roots are trusted local operator config; filenames are SHA-256 digests.
    // codeql[js/path-injection]
    await writeFile(temporaryPath, JSON.stringify(record, null, 2), {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    // codeql[js/path-injection]
    await chmod(temporaryPath, 0o600);
    // Both paths stay under the same private journal root and use fixed/digested names.
    // codeql[js/path-injection]
    await rename(temporaryPath, path);
    // codeql[js/path-injection]
    await chmod(path, 0o600);
  } finally {
    // codeql[js/path-injection]
    await rm(temporaryPath, { force: true });
  }
}

async function readRecord(
  key: string,
  options: ExecutionJournalOptions,
): Promise<ExecutionRecord | null> {
  let raw: string;
  try {
    // recordPath uses a SHA-256 filename under the trusted private journal root.
    // codeql[js/path-injection]
    raw = await readFile(recordPath(key, options), "utf8");
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ExecutionRecord>;
    if (
      parsed.schema_version !== "ontrack.execution/v1" ||
      typeof parsed.operation_id !== "string" ||
      typeof parsed.command !== "string" ||
      typeof parsed.fingerprint !== "string" ||
      !["in_progress", "succeeded", "rejected", "outcome_unknown"].includes(
        String(parsed.state),
      ) ||
      typeof parsed.created_at !== "string" ||
      typeof parsed.updated_at !== "string"
    ) {
      throw new Error("Invalid execution record.");
    }
    return parsed as ExecutionRecord;
  } catch (error) {
    throw new AgentProtocolError({
      code: "IDEMPOTENCY_OUTCOME_UNKNOWN",
      status: "action_required",
      summary:
        "The local execution record is unreadable; verify remote state before retrying.",
      cause: error,
    });
  }
}

export async function withExecutionJournalLock<T>(
  key: string,
  options: ExecutionJournalOptions,
  operation: () => Promise<T>,
): Promise<T> {
  const root = journalRoot(options);
  const path = lockPath(key, options);
  const owner = { id: randomUUID(), pid: process.pid };
  // The root is trusted local operator configuration, never Agent/remote input.
  // codeql[js/path-injection]
  await mkdir(root, { recursive: true, mode: 0o700 });
  // codeql[js/path-injection]
  await chmod(root, 0o700);
  while (true) {
    try {
      // lockPath uses a SHA-256 filename under the trusted private root.
      // codeql[js/path-injection]
      await mkdir(path, { mode: 0o700 });
      try {
        // owner.json is a fixed child name of the newly-created private lock directory.
        // codeql[js/path-injection]
        await writeFile(join(path, "owner.json"), JSON.stringify(owner), {
          encoding: "utf8",
          mode: 0o600,
          flag: "wx",
        });
      } catch (error) {
        // Only the directory created by this invocation is removed.
        // codeql[js/path-injection]
        await rm(path, { recursive: true, force: true });
        throw error;
      }
      break;
    } catch (error) {
      if (
        !error ||
        typeof error !== "object" ||
        (error as NodeJS.ErrnoException).code !== "EEXIST"
      ) {
        throw error;
      }
      throw new AgentProtocolError({
        code: "CONFLICT",
        status: "action_required",
        summary:
          "An execution lock already exists; verify the remote operation and local journal before retrying.",
      });
    }
  }

  const isCurrentOwner = async (): Promise<boolean> => {
    try {
      // owner.json is a fixed child name and its nonce must match before release.
      // codeql[js/path-injection]
      const stored = JSON.parse(
        await readFile(join(path, "owner.json"), "utf8"),
      ) as { id?: unknown; pid?: unknown };
      return stored.id === owner.id && stored.pid === owner.pid;
    } catch {
      return false;
    }
  };
  try {
    return await operation();
  } finally {
    if (await isCurrentOwner()) {
      // Owner nonce and PID were verified immediately before removing this lock.
      // codeql[js/path-injection]
      await rm(path, { recursive: true, force: true });
    }
  }
}

export async function claimExecution(
  idempotencyKey: string,
  command: string,
  input: Readonly<Record<string, unknown>>,
  options: ExecutionJournalOptions = {},
): Promise<ExecutionClaim> {
  const key = validateIdempotencyKey(idempotencyKey);
  const fingerprint = executionFingerprint(command, input);
  return withExecutionJournalLock(key, options, async () => {
    const existing = await readRecord(key, options);
    if (existing) {
      if (
        existing.command !== command ||
        existing.fingerprint !== fingerprint
      ) {
        throw new AgentProtocolError({
          code: "CONFLICT",
          summary: "This idempotency key is already bound to different input.",
        });
      }
      if (existing.state === "succeeded") {
        return {
          operationId: existing.operation_id,
          idempotencyKey: key,
          replayed: true,
          result: structuredClone(existing.result),
        };
      }
      if (existing.state === "rejected") {
        // The server produced an explicit rejection, so a new dispatch is safe.
      } else {
        throw new AgentProtocolError({
          code: "IDEMPOTENCY_OUTCOME_UNKNOWN",
          status: "action_required",
          summary:
            existing.state === "in_progress"
              ? "A prior process started this operation; its outcome must be verified before retrying."
              : "The prior operation outcome is unknown and must be verified before retrying.",
          nextActions: [
            {
              action: command
                .replace(/\.upload_new_files$/u, ".status")
                .replace(/\.upload$/u, ".status")
                .replace(/^plan\..+$/u, "plan.show"),
            },
          ],
        });
      }
    }

    const now = new Date().toISOString();
    const record: ExecutionRecord = {
      schema_version: "ontrack.execution/v1",
      operation_id: existing?.operation_id ?? `op_${randomUUID()}`,
      command,
      fingerprint,
      state: "in_progress",
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
    await atomicWrite(recordPath(key, options), record);
    return {
      operationId: record.operation_id,
      idempotencyKey: key,
      replayed: false,
    };
  });
}

export async function updateExecution(
  claim: ExecutionClaim,
  command: string,
  input: Readonly<Record<string, unknown>>,
  state: Exclude<ExecutionState, "in_progress">,
  result?: unknown,
  options: ExecutionJournalOptions = {},
): Promise<void> {
  const fingerprint = executionFingerprint(command, input);
  await withExecutionJournalLock(claim.idempotencyKey, options, async () => {
    const existing = await readRecord(claim.idempotencyKey, options);
    if (
      !existing ||
      existing.operation_id !== claim.operationId ||
      existing.command !== command ||
      existing.fingerprint !== fingerprint
    ) {
      throw new AgentProtocolError({
        code: "CONFLICT",
        summary: "The local execution record changed unexpectedly.",
      });
    }
    await atomicWrite(recordPath(claim.idempotencyKey, options), {
      ...existing,
      state,
      updated_at: new Date().toISOString(),
      ...(result === undefined ? {} : { result: sanitizeAgentData(result) }),
    });
  });
}
