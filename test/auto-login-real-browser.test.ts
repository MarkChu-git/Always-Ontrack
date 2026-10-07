import { afterEach, beforeEach, test } from 'bun:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { OnTrackApiClient } from '../src/lib/api.js';
import {
  captureSsoCredentials,
  readStoredRefreshCookie,
  resolveBrowserLaunchPlan,
  setBrowserSessionStatePathForTests,
  setSsoBrowserProfileDirForTests,
} from '../src/lib/auto-login.js';
import { finalizeCapturedLogin } from '../src/lib/login-finalize.js';

/**
 * The controlled browser runs the real OnTrack web app, and that app spends
 * the one-time login token from the landing URL itself (doubtfire-web
 * sign-in.component). These tests drive a real Chromium against a loopback
 * stand-in for both Okta and OnTrack, because the bug lived in how the two
 * sides race for that token — something no fake browser can reproduce. They
 * skip where no system browser is installed.
 */

const USERNAME = 'student1';

function systemBrowserAvailable(): boolean {
  try {
    const plan = resolveBrowserLaunchPlan();
    return plan.source === 'system' || plan.source === 'env';
  } catch {
    return false;
  }
}

const browserTest = test.skipIf(!systemBrowserAvailable());

interface Exchange {
  by: 'browser' | 'cli';
  status: number;
}

interface FakeOnTrack {
  ssoUrl: string;
  apiBaseUrl: string;
  exchanges: Exchange[];
  /** Whether each identity-provider visit carried the device cookie it set earlier. */
  idpVisits: boolean[];
  /** Refresh tokens issued by successful exchanges, in order. */
  issuedRefreshTokens: string[];
  close(): Promise<void>;
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    request.on('data', (chunk) => {
      data += chunk;
    });
    request.on('end', () => resolve(data));
  });
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string | string[]> = {},
): void {
  response.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  response.end(JSON.stringify(body));
}

function cookieValue(request: IncomingMessage, name: string): string | undefined {
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return undefined;
}

/**
 * Worst case for the CLI: the page spends the login token the moment it
 * loads, before the CLI can close the window. The real app first waits for
 * `/auth/method`, which only gives the CLI more time.
 */
const SIGN_IN_PAGE = `<!doctype html><title>OnTrack</title><script>
const query = new URLSearchParams(location.search);
fetch('/api/auth', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ auth_token: query.get('authToken'), username: query.get('username'), remember: true }),
}).catch(() => undefined);
</script>`;

async function startFakeOnTrack(): Promise<FakeOnTrack> {
  const loginTokens = new Map<string, number>();
  const exchanges: Exchange[] = [];
  const idpVisits: boolean[] = [];
  const issuedRefreshTokens: string[] = [];
  let port = 0;

  const server: Server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://placeholder');
    const host = request.headers.host ?? '';

    // Identity provider on its own host, so its cookies never reach OnTrack.
    if (host.startsWith('localhost:') && url.pathname === '/sso') {
      const recognized = cookieValue(request, 'DT') === 'device-1';
      idpVisits.push(recognized);
      const token = `login-${randomUUID()}`;
      loginTokens.set(token, Date.now());
      const headers: Record<string, string | string[]> = {
        Location: `http://127.0.0.1:${port}/sign_in?authToken=${token}&username=${USERNAME}`,
      };
      if (!recognized) {
        const expires = new Date(Date.now() + 365 * 86_400_000).toUTCString();
        headers['Set-Cookie'] = `DT=device-1; Path=/; Expires=${expires}; HttpOnly; SameSite=Lax`;
      }
      response.writeHead(302, headers);
      response.end();
      return;
    }

    if (url.pathname === '/sign_in') {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end(SIGN_IN_PAGE);
      return;
    }

    if (url.pathname === '/api/auth' && request.method === 'POST') {
      const by = (request.headers['user-agent'] ?? '').includes('Chrome') ? 'browser' : 'cli';
      const payload = JSON.parse((await readBody(request)) || '{}') as {
        auth_token?: string;
        remember?: boolean;
      };
      const issuedAt = payload.auth_token ? loginTokens.get(payload.auth_token) : undefined;
      if (issuedAt === undefined || Date.now() - issuedAt > 30_000) {
        // doubtfire-api: a destroyed or expired login token is a 419.
        exchanges.push({ by, status: 419 });
        sendJson(response, 419, { error: 'Could not authenticate with token. Username or Token invalid.' });
        return;
      }
      loginTokens.delete(payload.auth_token!);
      exchanges.push({ by, status: 201 });
      const refreshToken = `refresh-${randomUUID()}`;
      issuedRefreshTokens.push(refreshToken);
      const expires = new Date(Date.now() + 7 * 86_400_000).toUTCString();
      sendJson(
        response,
        201,
        {
          user: { username: USERNAME },
          auth_token: `general-${randomUUID()}`,
          auth_token_expiry: new Date(Date.now() + 10 * 60_000).toISOString(),
        },
        payload.remember
          ? {
              'Set-Cookie': [
                `refresh_token=${refreshToken}; Path=/api/auth; Expires=${expires}; HttpOnly; SameSite=Lax`,
                `username=${USERNAME}; Path=/api/auth; Expires=${expires}; HttpOnly; SameSite=Lax`,
              ],
            }
          : {},
      );
      return;
    }

    response.writeHead(404);
    response.end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  return {
    ssoUrl: `http://localhost:${port}/sso`,
    apiBaseUrl: `http://127.0.0.1:${port}/api`,
    exchanges,
    idpVisits,
    issuedRefreshTokens,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** The same capture → finalize composition the CLI and the TUI run. */
async function browserLogin(onTrack: FakeOnTrack): Promise<string> {
  const api = new OnTrackApiClient(onTrack.apiBaseUrl);
  const captured = await captureSsoCredentials({
    ssoUrl: onTrack.ssoUrl,
    apiBaseUrl: api.base,
    timeoutMs: 30_000,
    headless: true,
  });
  const session = await finalizeCapturedLogin(
    api,
    {
      authToken: captured.authToken,
      username: captured.username,
      expiresAt: captured.expiresAt,
      contract: captured.contract,
      refreshCookie: captured.refreshCookie,
      source: captured.contract === 'access-token' ? 'access-token' : 'browser-sso',
    },
    () => undefined,
  );
  return session.username;
}

const originalConfigHome = process.env.XDG_CONFIG_HOME;
let root = '';

beforeEach(async () => {
  // Inside the operator home, like the managed paths these seams replace.
  root = await mkdtemp(join(homedir(), '.ontrack-real-browser-'));
  process.env.XDG_CONFIG_HOME = join(root, 'config');
  setBrowserSessionStatePathForTests(join(root, 'state', 'browser-state.json'));
  setSsoBrowserProfileDirForTests(join(root, 'state', 'sso-browser-profile'));
});

afterEach(async () => {
  setBrowserSessionStatePathForTests(undefined);
  setSsoBrowserProfileDirForTests(undefined);
  if (originalConfigHome === undefined) {
    delete process.env.XDG_CONFIG_HOME;
  } else {
    process.env.XDG_CONFIG_HOME = originalConfigHome;
  }
  await rm(root, { recursive: true, force: true });
});

browserTest(
  'a first login completes although the page tries to spend the login token itself',
  async () => {
    const onTrack = await startFakeOnTrack();
    try {
      assert.equal(await browserLogin(onTrack), USERNAME);
      // Only the CLI may spend the one-time token: a page exchange that reaches
      // the server first is exactly what answered the CLI with 419.
      assert.deepEqual(onTrack.exchanges, [{ by: 'cli', status: 201 }]);
      assert.equal(
        readStoredRefreshCookie({ targetOrigin: new URL(onTrack.apiBaseUrl).origin })?.refreshToken,
        onTrack.issuedRefreshTokens[0],
      );
    } finally {
      await onTrack.close();
    }
  },
  60_000,
);

browserTest(
  'the identity provider recognizes the device on the next login',
  async () => {
    const onTrack = await startFakeOnTrack();
    try {
      await browserLogin(onTrack);
      await browserLogin(onTrack);
      // Okta's "keep me signed in" / "do not challenge me" ride on its device
      // cookie; a throwaway browser never brings it back, so MFA runs every time.
      assert.deepEqual(onTrack.idpVisits, [false, true]);
    } finally {
      await onTrack.close();
    }
  },
  60_000,
);
