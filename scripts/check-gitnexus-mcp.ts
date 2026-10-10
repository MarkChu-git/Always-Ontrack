import { setTimeout as delay } from 'node:timers/promises';

const expectedTools = ['check', 'context', 'detect_changes', 'impact', 'query'];
const timeoutMs = 30_000;

interface JsonRpcMessage {
  readonly id?: number;
  readonly method?: string;
  readonly result?: Record<string, unknown>;
  readonly error?: { readonly message?: string };
}

async function within<T>(label: string, operation: Promise<T>): Promise<T> {
  const timeout = delay(timeoutMs, undefined, { ref: false }).then(() => {
    throw new Error(`GitNexus MCP ${label} timed out after ${timeoutMs}ms`);
  });
  return Promise.race([operation, timeout]);
}

function resultText(result: Record<string, unknown>): string {
  const content = Array.isArray(result.content) ? result.content : [];
  return content
    .map((item: Record<string, unknown>) => (typeof item.text === 'string' ? item.text : ''))
    .join('\n');
}

// MCP's stdio transport is newline-delimited JSON-RPC 2.0, so this smoke
// check speaks it directly instead of depending on an MCP SDK.
const server = Bun.spawn(['bun', 'run', 'gitnexus:mcp'], {
  cwd: process.cwd(),
  env: { ...process.env, GITNEXUS_HOME: '.gitnexus-home' },
  stdin: 'pipe',
  stdout: 'pipe',
  stderr: 'ignore',
});

const pending = new Map<number, (message: JsonRpcMessage) => void>();
let nextId = 1;

function send(message: Record<string, unknown>): void {
  server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  server.stdin.flush();
}

async function readMessages(): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of server.stdout) {
    buffer += decoder.decode(chunk, { stream: true });
    for (let end = buffer.indexOf('\n'); end !== -1; end = buffer.indexOf('\n')) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (line === '') continue;
      const message = JSON.parse(line) as JsonRpcMessage;
      if (message.method !== undefined) {
        // Decline any server-initiated request; notifications need no reply.
        if (message.id !== undefined) {
          send({ id: message.id, error: { code: -32601, message: 'Method not found' } });
        }
        continue;
      }
      if (message.id !== undefined) pending.get(message.id)?.(message);
    }
  }
}

const reader = readMessages().then(
  () => 'GitNexus MCP server closed its output',
  (error: unknown) => `GitNexus MCP server sent an invalid message: ${String(error)}`,
);
void reader.then((reason) => {
  for (const resolve of pending.values()) resolve({ error: { message: reason } });
});

async function request(
  label: string,
  method: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const id = nextId++;
  const response = new Promise<JsonRpcMessage>((resolve) => pending.set(id, resolve));
  send({ id, method, params });
  const message = await within(label, response);
  pending.delete(id);
  if (message.error !== undefined || message.result === undefined) {
    throw new Error(`GitNexus MCP ${label} failed: ${message.error?.message ?? 'no result'}`);
  }
  return message.result;
}

try {
  await request('connect', 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'ontrack-gitnexus-check', version: '1.0.0' },
  });
  send({ method: 'notifications/initialized' });
  const listed = await request('listTools', 'tools/list', {});
  const tools = Array.isArray(listed.tools) ? (listed.tools as { name?: unknown }[]) : [];
  const names = new Set(tools.map((tool) => tool.name));
  const missing = expectedTools.filter((name) => !names.has(name));
  if (missing.length > 0) {
    throw new Error(`GitNexus MCP tools missing: ${missing.join(', ')}`);
  }
  const resource = await request('readResource', 'resources/read', {
    uri: 'gitnexus://repos',
  });
  const contents = Array.isArray(resource.contents) ? resource.contents : [];
  const text = contents
    .map((content: Record<string, unknown>) => (typeof content.text === 'string' ? content.text : ''))
    .join('\n');
  const repoEntries = text.match(/^\s+- name:/gmu) ?? [];
  const expectedPath = `path: "${process.cwd()}"`;
  if (
    repoEntries.length !== 1 ||
    !text.includes('name: "ontrack-cli"') ||
    !text.includes(expectedPath)
  ) {
    throw new Error('GitNexus MCP registry is missing or not project-isolated');
  }
  const context = await request('context', 'tools/call', {
    name: 'context',
    arguments: {
      repo: 'ontrack-cli',
      name: 'createOnTrackAuthBroker',
      file_path: 'src/lib/auth-broker.ts',
    },
  });
  if (!resultText(context).includes('"status": "found"')) {
    throw new Error('GitNexus MCP context query did not find the test symbol');
  }
  const check = await request('check', 'tools/call', {
    name: 'check',
    arguments: { repo: 'ontrack-cli', cycles: true },
  });
  if (!resultText(check).includes('"status": "clean"')) {
    throw new Error('GitNexus MCP structural check did not return clean');
  }
  process.stdout.write(
    `Verified ${tools.length} isolated GitNexus MCP tools and live queries.\n`,
  );
} finally {
  server.stdin.end();
  server.kill();
  await server.exited;
}
