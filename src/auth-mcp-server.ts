import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  createOnTrackAuthBroker,
  type OnTrackAuthBroker,
} from './lib/auth-broker.js';
import { DEFAULT_AUTH_MIN_TTL_SECONDS } from './lib/auth-runtime.js';
import { clearSession } from './lib/session.js';
import { clearAllBrowserSessionState } from './lib/auto-login.js';
import { packageVersion } from './lib/package-metadata.js';
import { normalizeBaseUrl } from './lib/utils.js';

const nextActionSchema = z.object({
  action: z.string(),
  arguments: z.record(z.string(), z.unknown()).optional(),
});

const toolResultSchema = z.object({
  status: z.enum(['success', 'auth_required', 'action_required', 'error']),
  summary: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
  next_actions: z.array(nextActionSchema),
  artifacts: z.array(z.record(z.string(), z.unknown())),
});

type ToolResult = z.infer<typeof toolResultSchema>;

export interface AuthMcpDependencies {
  createBroker(baseUrl: string): OnTrackAuthBroker;
  clearSession(): Promise<void>;
  clearBrowserSessionState(): Promise<void>;
}

function defaultDependencies(): AuthMcpDependencies {
  return {
    createBroker: (baseUrl) => createOnTrackAuthBroker({ baseUrl }),
    clearSession: () => clearSession(),
    clearBrowserSessionState: async () => clearAllBrowserSessionState(),
  };
}

function toolResponse(
  result: ToolResult,
  isError: boolean = false,
): {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent: ToolResult;
  isError?: true;
} {
  return {
    content: [{ type: 'text', text: result.summary }],
    structuredContent: result,
    ...(isError ? { isError: true as const } : {}),
  };
}

function configuredBaseUrl(): string {
  return normalizeBaseUrl();
}

/** Create the local stdio Auth MCP without exposing any OnTrack business tools. */
export function createAuthMcpServer(
  overrides: Partial<AuthMcpDependencies> = {},
): McpServer {
  const dependencies = { ...defaultDependencies(), ...overrides };
  const server = new McpServer(
    {
      name: 'ontrack-auth',
      version: packageVersion,
    },
    {
      instructions:
        'Use auth_status to inspect authentication and auth_ensure before OnTrack operations. ' +
        'Never ask for or expose passwords, cookies, Okta challenge values, or OnTrack tokens. ' +
        'Use interaction=if_required only when a human is available to complete Monash authentication.',
    },
  );

  server.registerTool(
    'auth_status',
    {
      title: 'OnTrack authentication status',
      description:
        'Returns lifecycle-only local authentication metadata. Never returns identity or credentials.',
      inputSchema: z.object({}).strict(),
      outputSchema: toolResultSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const status = await dependencies
        .createBroker(configuredBaseUrl())
        .status();
      return toolResponse({
        status: 'success',
        summary: `OnTrack authentication is ${status.status}.`,
        data: { ...status },
        next_actions:
          status.status === 'usable'
            ? []
            : [
                {
                  action: 'auth.ensure',
                  arguments: { interaction: 'never' },
                },
              ],
        artifacts: [],
      });
    },
  );

  server.registerTool(
    'auth_ensure',
    {
      title: 'Ensure OnTrack authentication',
      description:
        'Returns a usable credential state, silently refreshing first. A visible browser is allowed only with interaction=if_required.',
      inputSchema: z.object({
        min_ttl_seconds: z
          .number()
          .int()
          .min(0)
          .max(86_400)
          .default(DEFAULT_AUTH_MIN_TTL_SECONDS),
        interaction: z.enum(['never', 'if_required']).default('never'),
      }).strict(),
      outputSchema: toolResultSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ min_ttl_seconds, interaction }) => {
      const result = await dependencies
        .createBroker(configuredBaseUrl())
        .ensure({
          minTtlSeconds: min_ttl_seconds,
          interaction,
        });
      if (result.status === 'ready') {
        return toolResponse({
          status: 'success',
          summary: result.refreshed
            ? 'OnTrack authentication was refreshed.'
            : 'OnTrack authentication is ready.',
          data: {
            expires_at: result.expiresAt,
            refreshed: result.refreshed,
          },
          next_actions: [],
          artifacts: [],
        });
      }
      if (result.status === 'auth_required') {
        return toolResponse(
          {
            status: 'auth_required',
            summary: 'Monash authentication requires human verification.',
            data: {
              code: result.code,
              retryable: result.retryable,
            },
            next_actions: [
              {
                action: 'auth.ensure',
                arguments: { interaction: 'if_required' },
              },
            ],
            artifacts: [],
          },
          true,
        );
      }
      return toolResponse(
        {
          status: 'error',
          summary: 'The OnTrack credential could not be refreshed.',
          data: {
            code:
              result.code === 'INVALID_REFRESHED_SESSION'
                ? 'AUTH_REFRESH_FAILED'
                : result.code,
            retryable: result.retryable,
          },
          next_actions: result.retryable
            ? [
                {
                  action: 'auth.ensure',
                  arguments: { interaction: 'if_required' },
                },
              ]
            : [],
          artifacts: [],
        },
        true,
      );
    },
  );

  server.registerTool(
    'auth_logout',
    {
      title: 'Clear local OnTrack authentication',
      description:
        'Clears the local CLI credential. This does not automate or bypass Monash logout.',
      inputSchema: z.object({
        confirm: z.boolean().default(false),
      }).strict(),
      outputSchema: toolResultSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ confirm }) => {
      if (!confirm) {
        return toolResponse(
          {
            status: 'action_required',
            summary: 'Set confirm=true to clear the local OnTrack credential.',
            next_actions: [
              {
                action: 'auth.logout',
                arguments: { confirm: true },
              },
            ],
            artifacts: [],
          },
          true,
        );
      }
      await Promise.all([
        dependencies.clearSession(),
        dependencies.clearBrowserSessionState(),
      ]);
      return toolResponse({
        status: 'success',
        summary: 'The local OnTrack credential and browser refresh state were cleared.',
        data: { status: 'signed_out' },
        next_actions: [],
        artifacts: [],
      });
    },
  );

  return server;
}

/** Serve the Auth MCP over stdio for local Agent hosts. */
export async function serveAuthMcp(): Promise<void> {
  const server = createAuthMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const close = async (): Promise<void> => {
    await server.close();
  };
  process.once('SIGINT', () => {
    void close().finally(() => {
      process.exitCode = 0;
    });
  });
  process.once('SIGTERM', () => {
    void close().finally(() => {
      process.exitCode = 0;
    });
  });
}
