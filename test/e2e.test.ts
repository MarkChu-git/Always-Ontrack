import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'bun:test';
import {
  deriveMailboxId,
  encryptForCli,
  type PairCredentialPayload,
} from '../src/lib/pair-login.js';

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
const PAIRED_TOKEN = 'paired-token';
/** The pending one-time token a bookmarklet can forward from the landing URL. */
const LANDING_TOKEN = 'landing-url-token';
const USERNAME = 'student1';

function runCli(
  args: string[],
  home: TestHome,
  options: {
    env?: Record<string, string>;
    onStdout?: (chunk: string) => void;
  } = {},
): Promise<CliResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [resolve(process.cwd(), 'src/cli.ts'), ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        XDG_CONFIG_HOME: home.xdgConfigHome,
        HOME: home.home,
        NO_COLOR: '1',
        ...options.env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      options.onStdout?.(chunk);
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

/** Minimal in-memory pairing relay: PUT stores, GET reads-and-deletes. */
async function startMockRelay(): Promise<{ server: Server; relayUrl: string }> {
  const mailboxes = new Map<string, string>();
  const server = createServer((request, response) => {
    void (async () => {
      const match = /^\/m\/([0-9a-f]{64})$/.exec(request.url ?? '');
      if (!match) {
        response.writeHead(404).end();
        return;
      }
      if (request.method === 'PUT') {
        const body = await readBody(request);
        if (mailboxes.has(match[1])) {
          response.writeHead(409).end();
          return;
        }
        mailboxes.set(match[1], body);
        response.writeHead(200, { 'content-type': 'application/json' }).end('{}');
        return;
      }
      if (request.method === 'GET') {
        const body = mailboxes.get(match[1]);
        if (body === undefined) {
          response.writeHead(404).end();
          return;
        }
        mailboxes.delete(match[1]);
        response
          .writeHead(200, { 'content-type': 'application/json' })
          .end(body);
        return;
      }
      response.writeHead(405).end();
    })();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  return { server, relayUrl: `http://127.0.0.1:${address.port}` };
}

/**
 * Drive one pairing login end to end: the test plays the browser side — as
 * soon as the CLI prints the pairing URL, encrypt the credential to the
 * advertised key and PUT it to the mailbox derived from the pairing code,
 * like the bookmarklet would.
 */
async function runPairingLogin(options: {
  home: TestHome;
  baseUrl: string;
  relayUrl: string;
  extraArgs?: string[];
  extraEnv?: Record<string, string>;
  /** Defaults to the shape a bookmarklet without the contract field delivers. */
  payload?: PairCredentialPayload;
}): Promise<CliResult> {
  let stdoutSoFar = '';
  let delivered: Promise<void> | undefined;
  const result = await runCli(
    ['login', '--base-url', options.baseUrl, ...(options.extraArgs ?? [])],
    options.home,
    {
      env: { ONTRACK_HEADLESS: '1', ...options.extraEnv },
      onStdout: (chunk) => {
        stdoutSoFar += chunk;
        if (delivered) {
          return;
        }
        const match = /#c=([a-z2-7]{16})&k=([A-Za-z0-9_-]+)/.exec(stdoutSoFar);
        if (!match) {
          return;
        }
        delivered = (async () => {
          const envelope = await encryptForCli(
            match[2],
            options.payload ?? { authToken: PAIRED_TOKEN, username: USERNAME },
          );
          const mailboxId = deriveMailboxId(match[1]);
          const response = await fetch(`${options.relayUrl}/m/${mailboxId}`, {
            method: 'PUT',
            body: JSON.stringify(envelope),
          });
          assert.equal(response.status, 200);
        })();
      },
    },
  );
  await delivered;
  return result;
}

/**
 * Mock OnTrack for the pairing tests. The two knobs are the two answers that
 * decide which path the CLI must take: whether the paired token already works
 * as an API credential, and whether `POST /auth` accepts it for exchange.
 */
function startPairableOnTrackMock(
  options: {
    read?: 'accepted' | 'expired';
    exchange?: 'accepted' | 'expired';
    /** Which token `POST /auth` accepts; production answers 419 for any other. */
    exchangeableToken?: string;
  } = {},
) {
  const read = options.read ?? 'accepted';
  const exchange = options.exchange ?? 'accepted';
  const exchangeableToken = options.exchangeableToken ?? PAIRED_TOKEN;
  return startMock((request, body) => {
    if (request.url === '/api/auth/method') {
      return {
        status: 200,
        json: { method: 'saml', redirect_to: 'https://idp.example.test/sso?SAMLRequest=x' },
      };
    }
    if (request.url === '/api/projects' && request.method === 'GET') {
      // Whatever the verdict, the read must present the paired credential.
      assert.equal(request.headers['auth-token'], PAIRED_TOKEN);
      assert.equal(request.headers.username, USERNAME);
      return read === 'accepted'
        ? { status: 200, json: [] }
        : { status: 419, json: { error: 'Authentication Timeout' } };
    }
    if (request.url === '/api/auth' && request.method === 'POST') {
      const payload = JSON.parse(body) as Record<string, unknown>;
      assert.equal(payload.username, USERNAME);
      assert.equal(payload.remember, true);
      return exchange === 'accepted' && payload.auth_token === exchangeableToken
        ? {
            status: 201,
            json: signInPayload(ACCESS_TOKEN),
            setCookie: refreshCookiePair(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
          }
        : { status: 419, json: { error: 'Authentication Timeout' } };
    }
    return null;
  });
}

test(
  'e2e: headless login pairs through the relay and keeps the minted token instead of replaying it through /auth',
  async () => {
    const home = await makeHome();
    // Production shape: the bookmarklet mints the token from
    // /auth/access-token, so it is already an API credential and `POST /auth`
    // answers 419 for it. Replaying it there is what used to lose the login.
    const { server, baseUrl, hits } = await startPairableOnTrackMock({
      exchange: 'expired',
    });
    const relay = await startMockRelay();

    try {
      const login = await runPairingLogin({
        home,
        baseUrl,
        relayUrl: relay.relayUrl,
        extraEnv: { ONTRACK_RELAY_URL: relay.relayUrl },
      });
      assert.equal(login.exitCode, 0, login.stderr);
      assert.match(login.stdout, /Pairing code: [a-z2-7]{4}-/);

      const session = JSON.parse(await readFile(home.sessionPath, 'utf8')) as {
        authToken: string;
        source?: string;
      };
      assert.equal(session.authToken, PAIRED_TOKEN);
      assert.equal(session.source, 'pair-relay');
      assert.equal(hits.authExchange, 0, '/auth must not be called for a live token');
      assert.equal(hits.projects, 1, 'the credential must be verified exactly once');
    } finally {
      server.close();
      relay.server.close();
      await cleanupHome(home);
    }
  },
  30_000,
);

test(
  'e2e: pairing falls back to the /auth exchange when OnTrack rejects the paired token',
  async () => {
    const home = await makeHome();
    // Older OnTrack shape: the bookmarklet caught the one-time token from the
    // sign_in landing URL, so reads reject it and the exchange is the way in.
    const { server, baseUrl, hits } = await startPairableOnTrackMock({
      read: 'expired',
    });
    const relay = await startMockRelay();

    try {
      const login = await runPairingLogin({
        home,
        baseUrl,
        relayUrl: relay.relayUrl,
        extraEnv: { ONTRACK_RELAY_URL: relay.relayUrl },
      });
      assert.equal(login.exitCode, 0, login.stderr);

      const session = JSON.parse(await readFile(home.sessionPath, 'utf8')) as {
        authToken: string;
        source?: string;
      };
      assert.equal(session.authToken, ACCESS_TOKEN);
      assert.equal(session.source, 'pair-relay');
      assert.equal(hits.authExchange, 1);
    } finally {
      server.close();
      relay.server.close();
      await cleanupHome(home);
    }
  },
  30_000,
);

test(
  'e2e: a rejected paired credential fails with re-pairing guidance, not a raw 419',
  async () => {
    const home = await makeHome();
    const { server, baseUrl } = await startPairableOnTrackMock({
      read: 'expired',
      exchange: 'expired',
    });
    const relay = await startMockRelay();

    try {
      const login = await runPairingLogin({
        home,
        baseUrl,
        relayUrl: relay.relayUrl,
        extraEnv: { ONTRACK_RELAY_URL: relay.relayUrl },
      });
      assert.notEqual(login.exitCode, 0);
      assert.match(login.stderr, /rejected the paired credential/i);
      await assert.rejects(() => stat(home.sessionPath));
    } finally {
      server.close();
      relay.server.close();
      await cleanupHome(home);
    }
  },
  30_000,
);

test(
  'e2e: a bookmarklet that reports the access-token contract stores the token expiry',
  async () => {
    const home = await makeHome();
    const { server, baseUrl, hits } = await startPairableOnTrackMock({
      exchange: 'expired',
    });
    const relay = await startMockRelay();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    try {
      const login = await runPairingLogin({
        home,
        baseUrl,
        relayUrl: relay.relayUrl,
        extraEnv: { ONTRACK_RELAY_URL: relay.relayUrl },
        payload: {
          authToken: PAIRED_TOKEN,
          username: USERNAME,
          expiresAt,
          contract: 'access-token',
        },
      });
      assert.equal(login.exitCode, 0, login.stderr);

      const session = JSON.parse(await readFile(home.sessionPath, 'utf8')) as {
        authToken: string;
        expiresAt?: string;
      };
      assert.equal(session.authToken, PAIRED_TOKEN);
      assert.equal(session.expiresAt, expiresAt);
      assert.equal(hits.authExchange, 0);
      assert.equal(hits.projects, 1, 'a declared contract is still verified once');
    } finally {
      server.close();
      relay.server.close();
      await cleanupHome(home);
    }
  },
  30_000,
);

test(
  'e2e: a bookmarklet that reports the legacy contract exchanges without a probe',
  async () => {
    const home = await makeHome();
    const { server, baseUrl, hits } = await startPairableOnTrackMock();
    const relay = await startMockRelay();

    try {
      const login = await runPairingLogin({
        home,
        baseUrl,
        relayUrl: relay.relayUrl,
        extraEnv: { ONTRACK_RELAY_URL: relay.relayUrl },
        payload: {
          authToken: PAIRED_TOKEN,
          username: USERNAME,
          contract: 'legacy-auth',
        },
      });
      assert.equal(login.exitCode, 0, login.stderr);

      const session = JSON.parse(await readFile(home.sessionPath, 'utf8')) as {
        authToken: string;
      };
      assert.equal(session.authToken, ACCESS_TOKEN);
      assert.equal(hits.authExchange, 1);
      assert.equal(hits.projects, 0, 'an explicit contract needs no verification read');
    } finally {
      server.close();
      relay.server.close();
      await cleanupHome(home);
    }
  },
  30_000,
);

test(
  'e2e: a forwarded landing-URL token is exchanged, so the paired session can renew silently',
  async () => {
    const home = await makeHome();
    // The minted token would work for reads, but it cannot outlive itself. Only
    // `POST /auth` returns the refresh cookie, so the still-pending landing-URL
    // token the bookmarklet forwarded is worth spending first.
    const { server, baseUrl, hits } = await startPairableOnTrackMock({
      exchangeableToken: LANDING_TOKEN,
    });
    const relay = await startMockRelay();

    try {
      const login = await runPairingLogin({
        home,
        baseUrl,
        relayUrl: relay.relayUrl,
        extraEnv: { ONTRACK_RELAY_URL: relay.relayUrl },
        payload: {
          authToken: PAIRED_TOKEN,
          username: USERNAME,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          contract: 'access-token',
          exchangeToken: LANDING_TOKEN,
        },
      });
      assert.equal(login.exitCode, 0, login.stderr);

      const session = JSON.parse(await readFile(home.sessionPath, 'utf8')) as {
        authToken: string;
      };
      // The mock 419s anything but LANDING_TOKEN, so a stored exchanged token
      // proves the spare was what the CLI presented.
      assert.equal(session.authToken, ACCESS_TOKEN);
      assert.equal(hits.authExchange, 1);
      assert.equal(hits.projects, 0, 'a successful exchange needs no verification read');
      assert.match(
        await readFile(home.browserStatePath, 'utf8'),
        /refresh_token/,
        'the exchange must leave the refresh cookie behind for silent renewal',
      );
      assert.doesNotMatch(login.stdout, /cannot renew itself silently/);
    } finally {
      server.close();
      relay.server.close();
      await cleanupHome(home);
    }
  },
  30_000,
);

test(
  'e2e: a landing-URL token the web app already spent falls back to the minted credential',
  async () => {
    const home = await makeHome();
    const { server, baseUrl, hits } = await startPairableOnTrackMock({
      exchange: 'expired',
    });
    const relay = await startMockRelay();

    try {
      const login = await runPairingLogin({
        home,
        baseUrl,
        relayUrl: relay.relayUrl,
        extraEnv: { ONTRACK_RELAY_URL: relay.relayUrl },
        payload: {
          authToken: PAIRED_TOKEN,
          username: USERNAME,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          contract: 'access-token',
          exchangeToken: LANDING_TOKEN,
        },
      });
      assert.equal(login.exitCode, 0, login.stderr);

      const session = JSON.parse(await readFile(home.sessionPath, 'utf8')) as {
        authToken: string;
      };
      assert.equal(session.authToken, PAIRED_TOKEN);
      assert.equal(hits.authExchange, 1, 'the spare is tried exactly once');
      assert.equal(hits.projects, 1, 'the minted fallback is still verified');
      assert.match(login.stdout, /cannot renew itself silently/);
    } finally {
      server.close();
      relay.server.close();
      await cleanupHome(home);
    }
  },
  30_000,
);

test(
  'e2e: pairing works with --relay-url instead of the env var',
  async () => {
    const home = await makeHome();
    const { server, baseUrl } = await startPairableOnTrackMock();
    const relay = await startMockRelay();

    try {
      const login = await runPairingLogin({
        home,
        baseUrl,
        relayUrl: relay.relayUrl,
        extraArgs: ['--relay-url', relay.relayUrl],
      });
      assert.equal(login.exitCode, 0, login.stderr);
      const session = JSON.parse(await readFile(home.sessionPath, 'utf8')) as {
        source?: string;
      };
      assert.equal(session.source, 'pair-relay');
    } finally {
      server.close();
      relay.server.close();
      await cleanupHome(home);
    }
  },
  30_000,
);

test('e2e: --pair conflicts and an empty relay with --pair fail fast', async () => {
  const home = await makeHome();
  try {
    const conflict = await runCli(['login', '--pair', '--no-pair'], home, {
      env: { ONTRACK_HEADLESS: '1' },
    });
    assert.notEqual(conflict.exitCode, 0);
    assert.match(conflict.stderr, /either --pair or --no-pair/);

    const disabled = await runCli(['login', '--pair'], home, {
      env: { ONTRACK_HEADLESS: '1', ONTRACK_RELAY_URL: '' },
    });
    assert.notEqual(disabled.exitCode, 0);
    assert.match(disabled.stderr, /Pairing is disabled/);
  } finally {
    await cleanupHome(home);
  }
});
