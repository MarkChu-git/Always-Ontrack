import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { setTimeout as delay } from 'node:timers/promises';

const expectedTools = ['check', 'context', 'detect_changes', 'impact', 'query'];
const timeoutMs = 30_000;

async function within<T>(label: string, operation: Promise<T>): Promise<T> {
  const timeout = delay(timeoutMs, undefined, { ref: false }).then(() => {
    throw new Error(`GitNexus MCP ${label} timed out after ${timeoutMs}ms`);
  });
  return Promise.race([operation, timeout]);
}

function resultText(result: {
  readonly content: readonly Readonly<Record<string, unknown>>[];
}): string {
  return result.content
    .map((content) => (typeof content.text === 'string' ? content.text : ''))
    .join('\n');
}

const transport = new StdioClientTransport({
  command: 'bun',
  args: ['run', 'gitnexus:mcp'],
  cwd: process.cwd(),
  env: { ...process.env, GITNEXUS_HOME: '.gitnexus-home' },
  stderr: 'pipe',
});
transport.stderr?.on('data', () => undefined);

const client = new Client({ name: 'ontrack-gitnexus-check', version: '1.0.0' });
try {
  await within('connect', client.connect(transport));
  const { tools } = await within('listTools', client.listTools());
  const names = new Set(tools.map((tool) => tool.name));
  const missing = expectedTools.filter((name) => !names.has(name));
  if (missing.length > 0) {
    throw new Error(`GitNexus MCP tools missing: ${missing.join(', ')}`);
  }
  const resource = await within(
    'readResource',
    client.readResource({ uri: 'gitnexus://repos' }),
  );
  const text = resource.contents
    .map((content) => ('text' in content ? content.text : ''))
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
  const context = await within(
    'context',
    client.callTool({
      name: 'context',
      arguments: {
        repo: 'ontrack-cli',
        name: 'createOnTrackAuthBroker',
        file_path: 'src/lib/auth-broker.ts',
      },
    }),
  );
  if (!resultText(context).includes('"status": "found"')) {
    throw new Error('GitNexus MCP context query did not find the test symbol');
  }
  const check = await within(
    'check',
    client.callTool({
      name: 'check',
      arguments: { repo: 'ontrack-cli', cycles: true },
    }),
  );
  if (!resultText(check).includes('"status": "clean"')) {
    throw new Error('GitNexus MCP structural check did not return clean');
  }
  process.stdout.write(
    `Verified ${tools.length} isolated GitNexus MCP tools and live queries.\n`,
  );
} finally {
  await client.close();
}
