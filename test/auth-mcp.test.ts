import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  createAuthMcpServer,
  type AuthMcpDependencies,
} from '../src/auth-mcp-server.js';

async function withClient(
  dependencies: AuthMcpDependencies,
  run: (client: Client) => Promise<void>,
): Promise<void> {
  const server = createAuthMcpServer(dependencies);
  const client = new Client({ name: 'auth-mcp-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  try {
    await run(client);
  } finally {
    await client.close();
    await server.close();
  }
}

test('Auth MCP exposes only the narrow authentication control plane', async () => {
  await withClient(
    {
      createBroker: () => ({
        status: async () => ({
          status: 'usable',
          source: 'access-token',
          expiresAt: '2026-08-01T00:00:00.000Z',
          baseUrl: 'https://ontrack.example/api',
        }),
        ensure: async () => ({
          status: 'ready',
          expiresAt: '2026-08-01T00:00:00.000Z',
          refreshed: false,
        }),
        currentSession: async () => null,
      }),
      clearSession: async () => undefined,
      clearBrowserSessionState: async () => undefined,
    },
    async (client) => {
      const listed = await client.listTools();
      assert.deepEqual(
        listed.tools.map((tool) => tool.name).sort(),
        ['auth_ensure', 'auth_logout', 'auth_status'],
      );
      const logout = listed.tools.find((tool) => tool.name === 'auth_logout');
      assert.equal(logout?.annotations?.destructiveHint, true);
      const status = listed.tools.find((tool) => tool.name === 'auth_status');
      assert.equal(status?.annotations?.readOnlyHint, true);
    },
  );
});

test('Auth MCP returns structured lifecycle data without credential material', async () => {
  await withClient(
    {
      createBroker: () => ({
        status: async () => ({
          status: 'usable',
          source: 'access-token',
          expiresAt: '2026-08-01T00:00:00.000Z',
          baseUrl: 'https://ontrack.example/api',
        }),
        ensure: async () => ({
          status: 'ready',
          expiresAt: '2026-08-01T00:00:00.000Z',
          refreshed: true,
        }),
        currentSession: async () => null,
      }),
      clearSession: async () => undefined,
      clearBrowserSessionState: async () => undefined,
    },
    async (client) => {
      const status = await client.callTool({
        name: 'auth_status',
        arguments: {},
      });
      assert.equal(status.isError, undefined);
      assert.equal(status.structuredContent?.status, 'success');

      const ensured = await client.callTool({
        name: 'auth_ensure',
        arguments: {
          min_ttl_seconds: 600,
          interaction: 'never',
        },
      });
      assert.equal(ensured.structuredContent?.status, 'success');
      assert.equal(
        JSON.stringify(ensured).includes('authToken'),
        false,
      );
      assert.equal(JSON.stringify(ensured).includes('cookie'), false);
    },
  );
});

test('Auth MCP makes human verification actionable and logout explicit', async () => {
  let clearCalls = 0;
  let browserClearCalls = 0;
  await withClient(
    {
      createBroker: () => ({
        status: async () => ({
          status: 'expired',
          expiresAt: '2026-07-31T00:00:00.000Z',
          baseUrl: 'https://ontrack.example/api',
        }),
        ensure: async () => ({
          status: 'auth_required',
          code: 'HUMAN_VERIFICATION_REQUIRED',
          retryable: true,
        }),
        currentSession: async () => null,
      }),
      clearSession: async () => {
        clearCalls += 1;
      },
      clearBrowserSessionState: async () => {
        browserClearCalls += 1;
      },
    },
    async (client) => {
      const ensured = await client.callTool({
        name: 'auth_ensure',
        arguments: { interaction: 'never' },
      });
      assert.equal(ensured.isError, true);
      assert.equal(ensured.structuredContent?.status, 'auth_required');
      const actions = ensured.structuredContent?.next_actions as Array<Record<string, unknown>>;
      assert.equal(actions[0].action, 'auth.ensure');

      const loggedOut = await client.callTool({
        name: 'auth_logout',
        arguments: { confirm: true },
      });
      assert.equal(loggedOut.structuredContent?.status, 'success');
      assert.equal(clearCalls, 1);
      assert.equal(browserClearCalls, 1);
    },
  );
});

test('Auth MCP refuses caller-controlled origins before creating a broker', async () => {
  let brokerCalls = 0;
  await withClient(
    {
      createBroker: () => {
        brokerCalls += 1;
        throw new Error('must not create broker');
      },
      clearSession: async () => undefined,
      clearBrowserSessionState: async () => undefined,
    },
    async (client) => {
      const result = await client.callTool({
        name: 'auth_ensure',
        arguments: {
          base_url: 'https://attacker.example',
          interaction: 'never',
        },
      });
      assert.equal(result.isError, true);
      assert.equal(brokerCalls, 0);
      assert.equal(
        JSON.stringify(result).includes('attacker.example'),
        false,
      );
    },
  );
});
