import type { AgentCommandSpec, CommandInputField } from "./command-spec.js";
import { AgentProtocolError } from "./agent-protocol.js";

const MAX_STRUCTURED_INPUT_BYTES = 64 * 1024;
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const AGENT_GLOBAL_FLAGS = new Set(["--agent", "--json", "--output"]);
const GROUPED_AGENT_COMMANDS = new Set([
  "auth",
  "feedback",
  "pdf",
  "plan",
  "project",
  "submission",
  "task",
  "unit",
]);

export class StructuredInputError extends AgentProtocolError {
  constructor(message: string, cause?: unknown) {
    super({
      code: "INVALID_ARGUMENT",
      summary: message,
      cause,
    });
    this.name = "StructuredInputError";
  }
}

interface StructuredInputDependencies {
  readonly stdinIsTTY?: boolean;
  readonly readStdin?: () => Promise<string>;
}

async function readProcessStdin(): Promise<string> {
  let result = "";
  for await (const chunk of process.stdin) {
    result += String(chunk);
    if (Buffer.byteLength(result, "utf8") > MAX_STRUCTURED_INPUT_BYTES) {
      throw new StructuredInputError(
        `Structured input exceeds ${MAX_STRUCTURED_INPUT_BYTES} bytes.`,
      );
    }
  }
  return result;
}

function readFlagValue(
  args: readonly string[],
  flag: string,
): string | undefined {
  const indices = args.flatMap((value, index) =>
    value === flag ? [index] : [],
  );
  if (indices.length > 1) {
    throw new StructuredInputError(`${flag} may be provided only once.`);
  }
  if (indices.length === 0) {
    return undefined;
  }
  const value = args[indices[0] + 1];
  if (!value || value.startsWith("--")) {
    throw new StructuredInputError(`${flag} requires a value.`);
  }
  return value;
}

function removeFlagPair(args: readonly string[], flag: string): string[] {
  const index = args.indexOf(flag);
  if (index < 0) return [...args];
  return [...args.slice(0, index), ...args.slice(index + 2)];
}

function parseObject(raw: string): Record<string, unknown> {
  if (Buffer.byteLength(raw, "utf8") > MAX_STRUCTURED_INPUT_BYTES) {
    throw new StructuredInputError(
      `Structured input exceeds ${MAX_STRUCTURED_INPUT_BYTES} bytes.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new StructuredInputError(
      "Structured input must be valid JSON.",
      error,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new StructuredInputError("Structured input must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function encodeField(
  name: string,
  field: CommandInputField,
  value: unknown,
): string[] {
  if (field.type === "boolean") {
    if (typeof value !== "boolean") {
      throw new StructuredInputError(
        `Structured input field "${name}" must be boolean.`,
      );
    }
    return value ? [field.flag] : [];
  }
  if (field.type === "integer") {
    if (!Number.isSafeInteger(value)) {
      throw new StructuredInputError(
        `Structured input field "${name}" must be an integer.`,
      );
    }
    return [field.flag, String(value)];
  }
  if (field.type === "string_array") {
    if (
      !Array.isArray(value) ||
      !value.every((item) => typeof item === "string")
    ) {
      throw new StructuredInputError(
        `Structured input field "${name}" must be an array of strings.`,
      );
    }
    return value.flatMap((item) => [field.flag, item]);
  }
  if (typeof value !== "string") {
    throw new StructuredInputError(
      `Structured input field "${name}" must be a string.`,
    );
  }
  if (field.enum && !field.enum.includes(value)) {
    throw new StructuredInputError(
      `Structured input field "${name}" must be one of: ${field.enum.join(", ")}.`,
    );
  }
  return [field.flag, value];
}

/**
 * Merge explicit schema-backed JSON input into argv without allowing ambiguous
 * precedence or arbitrary flag injection.
 */
export async function mergeStructuredCommandInput(
  args: readonly string[],
  command: AgentCommandSpec,
  dependencies: StructuredInputDependencies = {},
): Promise<string[]> {
  const inline = readFlagValue(args, "--input-json");
  const stdinMarker = readFlagValue(args, "--input");
  if (inline !== undefined && stdinMarker !== undefined) {
    throw new StructuredInputError(
      "Use either --input-json or --input -, not both.",
    );
  }
  if (inline === undefined && stdinMarker === undefined) {
    return [...args];
  }

  let raw: string;
  let stripped = [...args];
  if (inline !== undefined) {
    raw = inline;
    stripped = removeFlagPair(stripped, "--input-json");
  } else {
    if (stdinMarker !== "-") {
      throw new StructuredInputError('--input only supports "-" for stdin.');
    }
    const stdinIsTTY = dependencies.stdinIsTTY ?? Boolean(process.stdin.isTTY);
    if (stdinIsTTY) {
      throw new StructuredInputError(
        "--input - requires non-interactive stdin and will not read from a TTY.",
      );
    }
    raw = await (dependencies.readStdin ?? readProcessStdin)();
    stripped = removeFlagPair(stripped, "--input");
  }

  const input = parseObject(raw);
  const generated: string[] = [];
  for (const [name, value] of Object.entries(input)) {
    if (UNSAFE_KEYS.has(name)) {
      throw new StructuredInputError(`Unsafe structured input field: ${name}.`);
    }
    const field = command.input_fields[name];
    if (!field) {
      throw new StructuredInputError(
        `Unknown structured input field: ${name}.`,
      );
    }
    if (stripped.includes(field.flag)) {
      throw new StructuredInputError(
        `Field "${name}" was provided by both JSON input and ${field.flag}.`,
      );
    }
    generated.push(...encodeField(name, field, value));
  }
  return [...stripped, ...generated];
}

function flagOccurrences(args: readonly string[], flag: string): number[] {
  return args.flatMap((value, index) => (value === flag ? [index] : []));
}

/** Enforce schema-level anyOf required groups before authentication or I/O. */
function validateAnyOfRequiredFields(
  args: readonly string[],
  command: AgentCommandSpec,
): void {
  const alternatives = command.input_schema.anyOf;
  if (!Array.isArray(alternatives)) {
    return;
  }
  const providedFields = new Set(
    Object.entries(command.input_fields)
      .filter(([, field]) => flagOccurrences(args, field.flag).length > 0)
      .map(([name]) => name),
  );
  const satisfied = alternatives.some((alternative) => {
    if (typeof alternative !== 'object' || alternative === null) {
      return false;
    }
    const required = (alternative as { required?: unknown }).required;
    return (
      Array.isArray(required) &&
      required.every((name) => typeof name === 'string' && providedFields.has(name))
    );
  });
  if (!satisfied) {
    const names = alternatives
      .flatMap((alternative) =>
        typeof alternative === 'object' && alternative !== null
          ? (alternative as { required?: unknown }).required ?? []
          : [],
      )
      .filter((name): name is string => typeof name === 'string');
    throw new StructuredInputError(
      `Agent input requires at least one of: ${[...new Set(names)].join(', ')}.`,
    );
  }
}

/** Validate direct Agent argv against the same registry used for JSON input. */
export function validateAgentCommandArguments(
  args: readonly string[],
  command: AgentCommandSpec,
): void {
  const fieldsByFlag = new Map(
    Object.values(command.input_fields).map((field) => [field.flag, field]),
  );
  const allowedFlags = new Set([...fieldsByFlag.keys(), ...AGENT_GLOBAL_FLAGS]);

  const positionalIndices = new Set([0]);
  if (GROUPED_AGENT_COMMANDS.has(args[0] ?? "")) {
    positionalIndices.add(1);
  }
  if (
    command.path === "schema" &&
    typeof args[1] === "string" &&
    !args[1].startsWith("--")
  ) {
    positionalIndices.add(1);
  }

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (positionalIndices.has(index)) {
      if (value.startsWith("--")) {
        throw new StructuredInputError(
          `Missing Agent command segment before ${value}.`,
        );
      }
      continue;
    }
    if (!value.startsWith("--")) {
      throw new StructuredInputError(
        `Unexpected Agent positional argument: ${value}.`,
      );
    }
    if (!allowedFlags.has(value)) {
      throw new StructuredInputError(`Unknown Agent flag: ${value}.`);
    }

    const field = fieldsByFlag.get(value);
    const isBoolean =
      value === "--agent" || value === "--json" || field?.type === "boolean";
    const next = args[index + 1];
    if (isBoolean) {
      if (next !== undefined && !next.startsWith("--")) {
        throw new StructuredInputError(`${value} does not accept a value.`);
      }
      continue;
    }
    if (!next || next.startsWith("--")) {
      throw new StructuredInputError(`${value} requires a value.`);
    }
    index += 1;
  }

  for (const [name, field] of Object.entries(command.input_fields)) {
    const occurrences = flagOccurrences(args, field.flag);
    const positionalSchemaCommand =
      command.path === "schema" &&
      name === "command" &&
      typeof args[1] === "string" &&
      !args[1].startsWith("--");
    if (
      field.required &&
      occurrences.length === 0 &&
      !positionalSchemaCommand
    ) {
      throw new StructuredInputError(`Missing required Agent field: ${name}.`);
    }
    if (field.type !== "string_array" && occurrences.length > 1) {
      throw new StructuredInputError(
        `${field.flag} may be provided only once.`,
      );
    }
    if (field.type === "boolean") {
      continue;
    }
    for (const index of occurrences) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new StructuredInputError(`${field.flag} requires a value.`);
      }
      if (field.type === "integer" && !/^-?\d+$/u.test(value)) {
        throw new StructuredInputError(`${field.flag} requires an integer.`);
      }
      if (field.type === "integer" && (field.minimum !== undefined || field.maximum !== undefined)) {
        const numericValue = Number(value);
        if (!Number.isSafeInteger(numericValue)) {
          throw new StructuredInputError(`${field.flag} requires a safe integer.`);
        }
        if (field.minimum !== undefined && numericValue < field.minimum) {
          throw new StructuredInputError(`${field.flag} must be at least ${field.minimum}.`);
        }
        if (field.maximum !== undefined && numericValue > field.maximum) {
          throw new StructuredInputError(`${field.flag} must be at most ${field.maximum}.`);
        }
      }
      if (field.type === "string") {
        const normalized = value.trim();
        if (field.minLength !== undefined && normalized.length < field.minLength) {
          throw new StructuredInputError(`${field.flag} must contain at least ${field.minLength} character.`);
        }
        if (field.maxLength !== undefined && normalized.length > field.maxLength) {
          throw new StructuredInputError(`${field.flag} must contain at most ${field.maxLength} characters.`);
        }
        if (field.pattern && !field.pattern.test(value)) {
          throw new StructuredInputError(`${field.flag} has an invalid format.`);
        }
      }
      if (field.enum && !field.enum.includes(value)) {
        throw new StructuredInputError(
          `${field.flag} must be one of: ${field.enum.join(", ")}.`,
        );
      }
    }
  }

  validateAnyOfRequiredFields(args, command);
}
