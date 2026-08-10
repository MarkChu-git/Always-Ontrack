import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'bun:test';

/**
 * Contract tests for `ontrack task set-status`: dry-run/confirm discipline,
 * exact request shape, and the server's 200-but-unchanged refusal quirk.
 */

async function runCli(
  args: string[],
  configRoot: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [resolve(process.cwd(), 'src/cli.ts'), ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        XDG_CONFIG_HOME: configRoot,
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

async function withFixtureServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
  run: (configRoot: string, baseUrl: string) => Promise<void>,
): Promise<void> {
  const configRoot = await mkdtemp(join(tmpdir(), 'ontrack-task-status-'));
  const server = createServer(handler);
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const baseUrl = `http://127.0.0.1:${address.port}/api`;
    const sessionDir = join(configRoot, 'ontrack-cli');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, 'session.json'),
      JSON.stringify({
        baseUrl,
        username: 'fixture-student',
        authToken: 'fixture-session-marker',
        savedAt: '2026-07-31T00:00:00.000Z',
        user: { id: 1, username: 'fixture-student', role: 'student' },
      }),
      'utf8',
    );
    await run(configRoot, baseUrl);
  } finally {
    server.close();
    await rm(configRoot, { recursive: true, force: true });
  }
}

function sendJson(response: ServerResponse, payload: unknown, status = 200): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(payload));
}

function projectPayload(): Record<string, unknown> {
  return {
    id: 101,
    target_grade: 0,
    tasks: [
      {
        id: 9001,
        task_definition_id: 501,
        status: 'working_on_it',
        target_start_date: '2026-03-03',
        target_due_date: '2026-03-09',
      },
    ],
    unit: { id: 55, code: 'FIT0001' },
  };
}

function unitPayload(): Record<string, unknown> {
  return {
    id: 55,
    code: 'FIT0001',
    task_definitions: [
      {
        id: 501,
        abbreviation: 'P1',
        name: 'Pass task',
        target_grade: 0,
        upload_requirements: [{ key: 'file0' }],
      },
    ],
  };
}

type StatusPutBehavior = 'match' | 'noop' | 'remap' | 'forbidden';

function statusHandler(
  behavior: StatusPutBehavior,
  putBodies: Array<Record<string, unknown>>,
) {
  return (request: IncomingMessage, response: ServerResponse): void => {
    if (
      request.method === 'PUT' &&
      request.url === '/api/projects/101/task_def_id/501'
    ) {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<
          string,
          unknown
        >;
        putBodies.push(body);
        if (behavior === 'forbidden') {
          sendJson(
            response,
            { error: 'Cannot set this task status to ready to mark without uploading documents.' },
            403,
          );
          return;
        }
        const status =
          behavior === 'match'
            ? String(body.trigger)
            : behavior === 'remap'
              ? 'time_exceeded'
              : 'working_on_it';
        sendJson(response, { id: 9001, task_definition_id: 501, status });
      });
      return;
    }

    const payload =
      request.url === '/api/projects'
        ? [projectPayload()]
        : request.url === '/api/projects/101'
          ? projectPayload()
          : request.url === '/api/units/55'
            ? unitPayload()
            : request.url === '/api/units/55/task_prerequisites'
              ? []
              : null;
    if (payload === null) {
      response.writeHead(404).end();
      return;
    }
    sendJson(response, payload);
  };
}

const baseArgs = [
  'task',
  'set-status',
  '--project-id',
  '101',
  '--task-definition-id',
  '501',
];

test('task set-status is a dry-run by default and one exact PUT with --confirm', async () => {
  const putBodies: Array<Record<string, unknown>> = [];
  await withFixtureServer(statusHandler('match', putBodies), async (configRoot) => {
    const args = [...baseArgs, '--status', 'need_help', '--json'];

    const dryRun = await runCli(args, configRoot);
    assert.equal(dryRun.exitCode, 0, dryRun.stderr);
    assert.equal(putBodies.length, 0);
    const preview = JSON.parse(dryRun.stdout);
    assert.equal(preview.dryRun, true);
    assert.deepEqual(preview.mutation.body, { trigger: 'need_help' });
    assert.equal(preview.before.status, 'working_on_it');

    const confirmed = await runCli([...args, '--confirm'], configRoot);
    assert.equal(confirmed.exitCode, 0, confirmed.stderr);
    assert.equal(putBodies.length, 1);
    assert.deepEqual(putBodies[0], { trigger: 'need_help' });
    const output = JSON.parse(confirmed.stdout);
    assert.equal(output.confirmed, true);
    assert.equal(output.verified, true);
    assert.equal(output.matched, true);
    assert.deepEqual(output.before, { status: 'working_on_it' });
    assert.deepEqual(output.after, { status: 'need_help' });
  });
});

test('task set-status normalizes server aliases to the canonical trigger', async () => {
  const putBodies: Array<Record<string, unknown>> = [];
  await withFixtureServer(statusHandler('match', putBodies), async (configRoot) => {
    const confirmed = await runCli(
      [...baseArgs, '--status', 'rtm', '--confirm', '--json'],
      configRoot,
    );
    assert.equal(confirmed.exitCode, 0, confirmed.stderr);
    assert.deepEqual(putBodies[0], { trigger: 'ready_for_feedback' });
    assert.equal(JSON.parse(confirmed.stdout).after.status, 'ready_for_feedback');
  });
});

test('task set-status refuses tutor-only statuses before any request', async () => {
  const putBodies: Array<Record<string, unknown>> = [];
  await withFixtureServer(statusHandler('match', putBodies), async (configRoot) => {
    const refused = await runCli(
      [...baseArgs, '--status', 'complete', '--confirm'],
      configRoot,
    );
    assert.notEqual(refused.exitCode, 0);
    assert.equal(putBodies.length, 0);
    assert.match(refused.stderr, /only be set by your tutor/);
  });
});

test('task set-status reports a silent server refusal as a conflict', async () => {
  const putBodies: Array<Record<string, unknown>> = [];
  await withFixtureServer(statusHandler('noop', putBodies), async (configRoot) => {
    const human = await runCli(
      [...baseArgs, '--status', 'need_help', '--confirm'],
      configRoot,
    );
    assert.notEqual(human.exitCode, 0);
    assert.equal(putBodies.length, 1);
    assert.match(human.stderr, /left the status at 'working_on_it'/);

    const agent = await runCli(
      [
        ...baseArgs,
        '--status',
        'need_help',
        '--confirm',
        '--idempotency-key',
        'status-101-501-refusal',
        '--output',
        'agent-json',
      ],
      configRoot,
    );
    assert.equal(agent.exitCode, 6);
    const envelope = JSON.parse(agent.stdout);
    assert.equal(envelope.error.code, 'CONFLICT');
  });
});

test('task set-status accepts a server-remapped outcome with a warning note', async () => {
  const putBodies: Array<Record<string, unknown>> = [];
  await withFixtureServer(statusHandler('remap', putBodies), async (configRoot) => {
    const confirmed = await runCli(
      [...baseArgs, '--status', 'ready_for_feedback', '--confirm', '--json'],
      configRoot,
    );
    assert.equal(confirmed.exitCode, 0, confirmed.stderr);
    const output = JSON.parse(confirmed.stdout);
    assert.equal(output.verified, true);
    assert.equal(output.matched, false);
    assert.equal(output.after.status, 'time_exceeded');
    assert.match(output.note, /remapped/);
  });
});

test('task set-status maps the upload-required 403 to the submission upload action', async () => {
  const putBodies: Array<Record<string, unknown>> = [];
  await withFixtureServer(statusHandler('forbidden', putBodies), async (configRoot) => {
    const human = await runCli(
      [...baseArgs, '--status', 'ready_for_feedback', '--confirm'],
      configRoot,
    );
    assert.notEqual(human.exitCode, 0);
    assert.match(human.stderr, /submission upload/);

    const agent = await runCli(
      [
        ...baseArgs,
        '--status',
        'ready_for_feedback',
        '--confirm',
        '--idempotency-key',
        'status-101-501-upload-required',
        '--output',
        'agent-json',
      ],
      configRoot,
    );
    const envelope = JSON.parse(agent.stdout);
    assert.equal(agent.exitCode, 4);
    assert.equal(envelope.error.code, 'FORBIDDEN');
    assert.equal(envelope.next_actions[0].action, 'submission.upload');
  });
});

test('task set-status enforces agent idempotency and replays completed keys', async () => {
  const putBodies: Array<Record<string, unknown>> = [];
  await withFixtureServer(statusHandler('match', putBodies), async (configRoot) => {
    const withoutKey = await runCli(
      [...baseArgs, '--status', 'need_help', '--confirm', '--output', 'agent-json'],
      configRoot,
    );
    assert.equal(withoutKey.exitCode, 6);
    assert.equal(
      (JSON.parse(withoutKey.stdout).error as Record<string, unknown>).code,
      'CONFIRMATION_REQUIRED',
    );
    assert.equal(putBodies.length, 0);

    const withKey = [
      ...baseArgs,
      '--status',
      'need_help',
      '--confirm',
      '--idempotency-key',
      'status-101-501-need-help',
      '--output',
      'agent-json',
    ];
    const first = await runCli(withKey, configRoot);
    assert.equal(first.exitCode, 0, first.stderr);
    assert.equal(putBodies.length, 1);
    const firstEnvelope = JSON.parse(first.stdout);
    assert.equal(firstEnvelope.data.idempotency.replayed, false);

    const replay = await runCli(withKey, configRoot);
    assert.equal(replay.exitCode, 0, replay.stderr);
    assert.equal(putBodies.length, 1);
    const replayEnvelope = JSON.parse(replay.stdout);
    assert.equal(replayEnvelope.data.idempotency.replayed, true);
    assert.equal(replayEnvelope.data.operationId, firstEnvelope.data.operationId);
  });
});
