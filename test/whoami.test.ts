import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'bun:test';
import { toWhoAmIView } from '../src/lib/whoami.js';
import type { SessionData } from '../src/lib/types.js';

const secretValues = {
  authToken: 'auth-token-must-not-be-printed',
  auth_token: 'nested-auth-token-must-not-be-printed',
  authorization: 'authorization-header-must-not-be-printed',
  browserCredential: 'browser-credential-must-not-be-printed',
};

function makeSession(): SessionData {
  return {
    baseUrl: 'https://ontrack.infotech.monash.edu/api',
    username: 'student1',
    authToken: secretValues.authToken,
    savedAt: '2026-07-31T00:00:00.000Z',
    user: {
      id: 1,
      username: 'student1',
      role: 'student',
      first_name: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.test',
      auth_token: secretValues.auth_token,
      authorization: secretValues.authorization,
      browserStorageCredential: secretValues.browserCredential,
    },
  };
}

function assertContainsNoSecrets(value: string): void {
  for (const secret of Object.values(secretValues)) {
    assert.equal(value.includes(secret), false, `output leaked ${secret}`);
  }
}

test('toWhoAmIView returns only explicitly allowed identity fields without mutating the session', () => {
  const session = makeSession();
  const before = structuredClone(session);

  const view = toWhoAmIView(session);

  assert.deepEqual(view, {
    username: 'student1',
    id: 1,
    role: 'student',
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.test',
    savedAt: '2026-07-31T00:00:00.000Z',
  });
  assert.deepEqual(session, before);
  assertContainsNoSecrets(JSON.stringify(view));
});

test('toWhoAmIView falls back from a blank role to system_role', () => {
  const session = makeSession();
  session.user = { role: '   ', system_role: 'student' };

  const view = toWhoAmIView(session);

  assert.equal(view.role, 'student');
});

async function runCliWhoAmI(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const configRoot = await mkdtemp(join(tmpdir(), 'ontrack-whoami-'));
  const sessionPath = join(configRoot, 'ontrack-cli', 'session.json');
  await mkdir(join(configRoot, 'ontrack-cli'), { recursive: true });
  await writeFile(sessionPath, JSON.stringify(makeSession()), 'utf8');

  const cliPath = resolve(process.cwd(), 'src/cli.ts');
  const commandArgs = [cliPath, 'whoami', ...args];

  try {
    return await new Promise((resolveResult, reject) => {
      const child = spawn(process.execPath, commandArgs, {
        cwd: process.cwd(),
        env: { ...process.env, XDG_CONFIG_HOME: configRoot, NO_COLOR: '1' },
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
  } finally {
    await rm(configRoot, { recursive: true, force: true });
  }
}

test('whoami --json emits the identity projection without session credentials', async () => {
  const result = await runCliWhoAmI(['--json']);

  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    username: 'student1',
    id: 1,
    role: 'student',
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.test',
    savedAt: '2026-07-31T00:00:00.000Z',
  });
  assertContainsNoSecrets(`${result.stdout}\n${result.stderr}`);
});

test('whoami human output emits no session credentials', async () => {
  const result = await runCliWhoAmI([]);

  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /student1/);
  assertContainsNoSecrets(`${result.stdout}\n${result.stderr}`);
});
