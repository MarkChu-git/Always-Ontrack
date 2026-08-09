import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'bun:test';

/**
 * End-to-end tests: run the real CLI as a subprocess against a loopback mock
 * of the OnTrack API, with both credential stores isolated into temp homes.
 *
 * Covered lifecycle:
 *   login (token exchange) -> persisted session + week-long refresh cookie
 *   expired session -> silent HTTP renewal via the refresh cookie
 *   declined refresh cookie -> human-verification error, credential preserved
 */

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface TestHome {
  xdgConfigHome: string;
  home: string;
  sessionPath: string;
  browserStatePath: string;
}

interface MockHits {
  authExchange: number;
  accessToken: number;
  projects: number;
  authMethod: number;
}

const ACCESS_TOKEN = 'e2e-access-token';
const RENEWED_TOKEN = 'e2e-renewed-token';
const REFRESH_TOKEN = 'e2e-refresh-token';
const USERNAME = 'student1';

function runCli(args: string[], home: TestHome): Promise<CliResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [resolve(process.cwd(), 'src/cli.ts'), ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        XDG_CONFIG_HOME: home.xdgConfigHome,
        HOME: home.home,
        NO_COLOR: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) => {
      resolveResult({ stdout, stderr, exitCode: code ?? 1 });
    });
  });
}

async function makeHome(): Promise<TestHome> {
  const root = await mkdtemp(join(tmpdir(), 'ontrack-e2e-'));
  const xdgConfigHome = join(root, 'xdg');
  const home = join(root, 'home');
  // The managed browser-state store refuses directories group/other can access.
  await mkdir(join(xdgConfigHome, 'ontrack-cli'), { recursive: true, mode: 0o700 });
  await mkdir(join(home, '.config', 'ontrack-cli'), { recursive: true, mode: 0o700 });
  return {
    xdgConfigHome,
    home,
    sessionPath: join(xdgConfigHome, 'ontrack-cli', 'session.json'),
    browserStatePath: join(home, '.config', 'ontrack-cli', 'browser-state.json'),
  };
}

async function cleanupHome(home: TestHome): Promise<void> {
  await rm(resolve(home.xdgConfigHome, '..'), { recursive: true, force: true });
}

function refreshCookiePair(expires: Date): string[] {
  const expiresAttr = expires.toUTCString();
  return [
    `refresh_token=${REFRESH_TOKEN}; Path=/api/auth; Expires=${expiresAttr}; HttpOnly; Secure`,
    `username=${USERNAME}; Path=/api/auth; Expires=${expiresAttr}; HttpOnly; Secure`,
  ];
}

function signInPayload(token: string) {
  return {
    auth_token: token,
    auth_token_expiry: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    user: {
      id: 1,
      username: USERNAME,
      role: 'student',
      first_name: 'E2e',
      last_name: 'Student',
      email: 'student1@example.test',
    },
  };
}

async function readBody(request: NodeJS.TypedEmitter): Promise<string> {
  let body = '';
  for await (const chunk of request as AsyncIterable<Buffer>) {
    body += chunk.toString('utf8');
  }
  return body;
}

async function startMock(
  handler: (
    request: { url?: string; method?: string; headers: Record<string, unknown> },
    body: string,
  ) => { status: number; json?: unknown; setCookie?: string[] } | null,
): Promise<{ server: Server; baseUrl: string; hits: MockHits }> {
  const hits: MockHits = { authExchange: 0, accessToken: 0, projects: 0, authMethod: 0 };
  const server = createServer((request, response) => {
    void (async () => {
      const body = request.method === 'POST' ? await readBody(request) : '';
      if (request.url === '/api/auth' && request.method === 'POST') hits.authExchange += 1;
      if (request.url === '/api/auth/access-token') hits.accessToken += 1;
      if (request.url === '/api/projects') hits.projects += 1;
      if (request.url === '/api/auth/method') hits.authMethod += 1;
      const outcome = handler(
        request as { url?: string; method?: string; headers: Record<string, unknown> },
        body,
      );
      if (outcome === null) {
        response.writeHead(404).end();
        return;
      }
      const headers: Record<string, string | string[]> = {
        'content-type': 'application/json',
      };
      if (outcome.setCookie) {
        headers['set-cookie'] = outcome.setCookie;
      }
      response.writeHead(outcome.status, headers);
      response.end(outcome.json === null ? 'null' : JSON.stringify(outcome.json));
    })();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return { server, baseUrl: `http://127.0.0.1:${address.port}/api`, hits };
}

async function seedSession(home: TestHome, baseUrl: string, expiresAt: string): Promise<void> {
  await writeFile(
    home.sessionPath,
    JSON.stringify({
      baseUrl,
      username: USERNAME,
      authToken: 'e2e-stale-token',
      savedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      expiresAt,
      user: { id: 1, username: USERNAME, role: 'student' },
      source: 'browser-sso',
    }),
    { mode: 0o600 },
  );
}

async function seedBrowserState(home: TestHome): Promise<void> {
  const expires = Math.floor((Date.now() + 7 * 24 * 60 * 60 * 1000) / 1000);
  const cookie = (name: string, value: string) => ({
    name,
    value,
    domain: '127.0.0.1',
    path: '/api/auth',
    expires,
    httpOnly: true,
    secure: true,
    sameSite: 'Lax' as const,
  });
  await writeFile(
    home.browserStatePath,
    JSON.stringify({
      cookies: [cookie('refresh_token', REFRESH_TOKEN), cookie('username', USERNAME)],
      origins: [],
    }),
    { mode: 0o600 },
  );
}

test(
  'e2e: login with a token stores the session and the week-long refresh cookie',
  async () => {
    const home = await makeHome();
    const { server, baseUrl } = await startMock((request, body) => {
      if (request.url === '/api/auth/method') {
        return {
          status: 200,
          json: { method: 'saml', redirect_to: 'https://idp.example.test/sso?SAMLRequest=x' },
        };
      }
      if (request.url === '/api/auth' && request.method === 'POST') {
        const payload = JSON.parse(body) as Record<string, unknown>;
        assert.equal(payload.username, USERNAME);
        assert.equal(payload.auth_token, 'one-time-e2e-token');
        assert.equal(payload.remember, true);
        return {
          status: 201,
          json: signInPayload(ACCESS_TOKEN),
          setCookie: refreshCookiePair(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
        };
      }
      return null;
    });

    try {
      const method = await runCli(['auth-method', '--base-url', baseUrl, '--json'], home);
      assert.equal(method.exitCode, 0, method.stderr);
      assert.equal(JSON.parse(method.stdout).method, 'saml');

      const login = await runCli(
        ['login', '--auth-token', 'one-time-e2e-token', '--username', USERNAME, '--base-url', baseUrl],
        home,
      );
      assert.equal(login.exitCode, 0, login.stderr);

      const session = JSON.parse(await readFile(home.sessionPath, 'utf8')) as {
        authToken: string;
        baseUrl: string;
        expiresAt?: string;
      };
      assert.equal(session.authToken, ACCESS_TOKEN);
      assert.equal(session.baseUrl, baseUrl);
      assert.ok(session.expiresAt && Date.parse(session.expiresAt) > Date.now());

      const stateStats = await stat(home.browserStatePath);
      assert.equal(stateStats.mode & 0o777, 0o600, 'browser-state must stay operator-only');
      const state = JSON.parse(await readFile(home.browserStatePath, 'utf8')) as {
        cookies: Array<{ name: string; value: string; expires: number }>;
      };
      const refresh = state.cookies.find((cookie) => cookie.name === 'refresh_token');
      const user = state.cookies.find((cookie) => cookie.name === 'username');
      assert.equal(refresh?.value, REFRESH_TOKEN);
      assert.equal(user?.value, USERNAME);
      assert.ok(refresh, 'refresh cookie stored');
      const refreshTtlDays = (refresh.expires * 1000 - Date.now()) / 86_400_000;
      assert.ok(
        refreshTtlDays > 6 && refreshTtlDays < 8,
        `refresh cookie should live about a week, got ${refreshTtlDays.toFixed(2)}d`,
      );
    } finally {
      server.close();
      await cleanupHome(home);
    }
  },
  30_000,
);

test(
  'e2e: an expired session silently renews over plain HTTP and then serves data commands',
  async () => {
    const home = await makeHome();
    const { server, baseUrl, hits } = await startMock((request) => {
      if (request.url === '/api/auth/access-token' && request.method === 'POST') {
        const cookie = String(request.headers.cookie ?? '');
        assert.ok(cookie.includes(`refresh_token=${REFRESH_TOKEN}`), cookie);
        assert.ok(cookie.includes(`username=${USERNAME}`), cookie);
        return { status: 201, json: signInPayload(RENEWED_TOKEN) };
      }
      if (request.url === '/api/projects') {
        assert.equal(request.headers['auth-token'], RENEWED_TOKEN);
        assert.equal(request.headers.username, USERNAME);
        return {
          status: 200,
          json: [{ id: 101, target_grade: 0, unit: { id: 55, code: 'FIT0001' } }],
        };
      }
      return null;
    });

    try {
      await seedSession(home, baseUrl, new Date(Date.now() - 60 * 1000).toISOString());
      await seedBrowserState(home);

      const projects = await runCli(['projects', '--json'], home);
      assert.equal(projects.exitCode, 0, projects.stderr);
      const parsed = JSON.parse(projects.stdout) as Array<Record<string, unknown>>;
      assert.equal(parsed.length, 1);
      assert.equal(parsed[0].id, 101);

      assert.equal(hits.accessToken, 1, 'exactly one silent renewal over plain HTTP');
      assert.equal(hits.projects, 1);

      const session = JSON.parse(await readFile(home.sessionPath, 'utf8')) as {
        authToken: string;
        expiresAt?: string;
      };
      assert.equal(session.authToken, RENEWED_TOKEN);
      assert.ok(session.expiresAt && Date.parse(session.expiresAt) > Date.now());
    } finally {
      server.close();
      await cleanupHome(home);
    }
  },
  30_000,
);

test(
  'e2e: a declined refresh cookie yields a human-verification error and preserves the credential',
  async () => {
    const home = await makeHome();
    const { server, baseUrl } = await startMock((request) => {
      if (request.url === '/api/auth/access-token' && request.method === 'POST') {
        // Production declines a bad/absent refresh cookie with 201 + null.
        return { status: 201, json: null };
      }
      if (request.url === '/api/auth/method') {
        // No redirect_to: the broker stops before any browser-based capture.
        return { status: 200, json: { method: 'database' } };
      }
      return null;
    });

    try {
      await seedSession(home, baseUrl, new Date(Date.now() - 60 * 1000).toISOString());
      await seedBrowserState(home);

      const projects = await runCli(['projects', '--json'], home);
      assert.notEqual(projects.exitCode, 0, 'command must fail without valid credentials');
      assert.match(projects.stderr, /human verification/i);

      // The stored refresh credential must survive a failed silent renewal:
      // one transient failure must never force a full re-login.
      const state = JSON.parse(await readFile(home.browserStatePath, 'utf8')) as {
        cookies: Array<{ name: string; value: string }>;
      };
      assert.equal(
        state.cookies.find((cookie) => cookie.name === 'refresh_token')?.value,
        REFRESH_TOKEN,
      );
    } finally {
      server.close();
      await cleanupHome(home);
    }
  },
  30_000,
);
