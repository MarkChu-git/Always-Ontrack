import { AgentProtocolError } from './agent-protocol.js';

const MAX_AGENT_INPUT_BYTES = 64 * 1024;
const AGENT_COMMAND_PATH = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const MAX_AGENT_COMMAND_PATH_LENGTH = 128;

export interface AgentCallInvocation {
  readonly command: string;
  readonly input: Readonly<Record<string, unknown>>;
}

interface AgentCallInputDependencies {
  readonly stdinIsTTY?: boolean;
  readonly readStdin?: () => Promise<string>;
}

function invalidArgument(summary: string, cause?: unknown): AgentProtocolError {
  return new AgentProtocolError({
    code: 'INVALID_ARGUMENT',
    summary,
    cause,
  });
}

async function readProcessStdin(): Promise<string> {
  let result = '';
  for await (const chunk of process.stdin) {
    result += String(chunk);
    if (Buffer.byteLength(result, 'utf8') > MAX_AGENT_INPUT_BYTES) {
      throw invalidArgument(
        `Agent input exceeds ${MAX_AGENT_INPUT_BYTES} bytes.`,
      );
    }
  }
  return result;
}

function parseInputObject(raw: string): Readonly<Record<string, unknown>> {
  if (Buffer.byteLength(raw, 'utf8') > MAX_AGENT_INPUT_BYTES) {
    throw invalidArgument(`Agent input exceeds ${MAX_AGENT_INPUT_BYTES} bytes.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw invalidArgument('Agent input must be valid JSON.', error);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw invalidArgument('Agent input must be a JSON object.');
  }
  return parsed as Readonly<Record<string, unknown>>;
}

export async function parseAgentCallInvocation(
  args: readonly string[],
  dependencies: AgentCallInputDependencies = {},
): Promise<AgentCallInvocation> {
  const command = args[0];
  if (!command || command.startsWith('--')) {
    throw invalidArgument('agent call requires a stable command path.');
  }
  if (
    command.length > MAX_AGENT_COMMAND_PATH_LENGTH ||
    !AGENT_COMMAND_PATH.test(command)
  ) {
    throw invalidArgument('agent call requires a stable command path.');
  }

  let rawInput: string | undefined;
  for (let index = 1; index < args.length; index += 1) {
    const flag = args[index];
    if (flag !== '--input-json' && flag !== '--input') {
      throw invalidArgument(`Unknown agent call flag: ${flag}.`);
    }
    if (rawInput !== undefined) {
      throw invalidArgument('Use either --input-json or --input -, not both.');
    }
    const value = args[index + 1];
    if (!value) {
      throw invalidArgument(`${flag} requires a value.`);
    }
    index += 1;
    if (flag === '--input-json') {
      rawInput = value;
      continue;
    }
    if (value !== '-') {
      throw invalidArgument('--input only supports "-" for stdin.');
    }
    if (dependencies.stdinIsTTY ?? Boolean(process.stdin.isTTY)) {
      throw invalidArgument(
        '--input - requires non-interactive stdin and will not read from a TTY.',
      );
    }
    rawInput = await (dependencies.readStdin ?? readProcessStdin)();
  }

  return {
    command,
    input: rawInput === undefined ? {} : parseInputObject(rawInput),
  };
}
