import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'bun:test';

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
  const configRoot = await mkdtemp(join(tmpdir(), 'ontrack-contract-cli-'));
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
    spec_con_days: 2,
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
    allow_flexible_dates: true,
    task_definitions: [
      {
        id: 501,
        abbreviation: 'P1',
        name: 'Pass task',
        target_grade: 0,
        start_date: '2026-03-01',
        target_date: '2026-03-08',
        due_date: '2026-03-12',
        upload_requirements: [{ key: 'file0' }],
      },
    ],
  };
}

test('plan show and task prerequisites expose production contract semantics', async () => {
  await withFixtureServer(
    (request, response) => {
      assert.equal(request.headers['auth-token'], 'fixture-session-marker');
      const payload =
        request.url === '/api/projects'
          ? [projectPayload()]
          : request.url === '/api/projects/101'
            ? projectPayload()
            : request.url === '/api/units/55'
              ? unitPayload()
              : request.url === '/api/units/55/task_prerequisites'
                ? [
                    {
                      id: 1,
                      task_definition_id: 501,
                      prerequisite_id: 400,
                      task_status: 'complete',
                    },
                  ]
                : null;
      if (payload === null) {
        response.writeHead(404).end();
        return;
      }
      sendJson(response, payload);
    },
    async (configRoot) => {
      const plan = await runCli(
        ['plan', 'show', '--project-id', '101', '--json'],
        configRoot,
      );
      assert.equal(plan.exitCode, 0, plan.stderr);
      const plans = JSON.parse(plan.stdout) as Array<Record<string, unknown>>;
      assert.equal(plans.length, 1);
      assert.equal(plans[0].abbreviation, 'P1');
      assert.deepEqual(plans[0].prerequisites, [
        { taskDefinitionId: 400, requiredStatus: 'complete' },
      ]);

      const prerequisites = await runCli(
        [
          'task',
          'prerequisites',
          '--project-id',
          '101',
          '--task-id',
          '501',
          '--json',
        ],
        configRoot,
      );
      assert.equal(prerequisites.exitCode, 0, prerequisites.stderr);
      assert.deepEqual(JSON.parse(prerequisites.stdout), [
        {
          id: 1,
          task_definition_id: 501,
          prerequisite_id: 400,
          task_status: 'complete',
        },
      ]);
    },
  );
});

test('plan writes are dry-run by default and exact PUTs only with --confirm', async () => {
  let putCount = 0;
  let resetCount = 0;
  let lastBody: unknown;
  let personalDates: { start: string; target: string } | undefined = {
    start: '2026-03-03',
    target: '2026-03-09',
  };
  const currentProjectPayload = (): Record<string, unknown> => {
    const project = projectPayload();
    const tasks = project.tasks as Array<Record<string, unknown>>;
    if (personalDates) {
      tasks[0] = {
        ...tasks[0],
        target_start_date: personalDates.start,
        target_due_date: personalDates.target,
      };
    } else {
      const {
        target_start_date: _start,
        target_due_date: _target,
        ...withoutPersonalDates
      } = tasks[0];
      tasks[0] = withoutPersonalDates;
    }
    return project;
  };
  await withFixtureServer(
    (request, response) => {
      if (
        request.method === 'PUT' &&
        request.url === '/api/projects/101/task_def_id/501/target_dates'
      ) {
        putCount += 1;
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () => {
          lastBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const body = lastBody as Record<string, string>;
          personalDates = {
            start: body.target_start_date,
            target: body.target_due_date,
          };
          sendJson(response, { ok: true });
        });
        return;
      }
      if (
        request.method === 'PUT' &&
        request.url === '/api/projects/101/reset_target_dates'
      ) {
        resetCount += 1;
        personalDates = undefined;
        sendJson(response, { ok: true });
        return;
      }

      const payload =
        request.url === '/api/projects'
          ? [currentProjectPayload()]
          : request.url === '/api/projects/101'
            ? currentProjectPayload()
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
    },
    async (configRoot) => {
      const args = [
        'plan',
        'set-dates',
        '--project-id',
        '101',
        '--task-definition-id',
        '501',
        '--start',
        '2026-03-04',
        '--target',
        '2026-03-11',
        '--json',
      ];
      const dryRun = await runCli(args, configRoot);
      assert.equal(dryRun.exitCode, 0, dryRun.stderr);
      assert.equal(putCount, 0);
      assert.equal(JSON.parse(dryRun.stdout).dryRun, true);

      const confirmed = await runCli([...args, '--confirm'], configRoot);
      assert.equal(confirmed.exitCode, 0, confirmed.stderr);
      assert.equal(putCount, 1);
      assert.deepEqual(lastBody, {
        target_start_date: '2026-03-04',
        target_due_date: '2026-03-11',
      });
      const confirmedOutput = JSON.parse(confirmed.stdout);
      assert.equal(confirmedOutput.confirmed, true);
      assert.equal(confirmedOutput.verified, true);
      assert.deepEqual(confirmedOutput.after, {
        start: '2026-03-04',
        target: '2026-03-11',
      });
      assert.equal(JSON.stringify(confirmedOutput).includes('"result"'), false);

      const agentWithoutKey = await runCli(
        [...args.filter((value) => value !== '--json'), '--confirm', '--output', 'agent-json'],
        configRoot,
      );
      assert.equal(agentWithoutKey.exitCode, 6);
      assert.equal(putCount, 1);
      assert.equal(
        (JSON.parse(agentWithoutKey.stdout).error as Record<string, unknown>).code,
        'CONFIRMATION_REQUIRED',
      );

      const normalizedAgentArgs = [
        'plan',
        'set-dates',
        '--project-id',
        '101',
        '--task-definition-id',
        '501',
        '--start',
        '2026-03-05',
        '--target',
        '2026-03-12',
        '--confirm',
        '--idempotency-key',
        'plan-101-P1-2026-03-12',
        '--output',
        'agent-json',
      ];
      const firstAgentWrite = await runCli(normalizedAgentArgs, configRoot);
      assert.equal(firstAgentWrite.exitCode, 0, firstAgentWrite.stderr);
      assert.equal(putCount, 2);
      const firstAgentEnvelope = JSON.parse(firstAgentWrite.stdout);
      assert.equal(firstAgentEnvelope.data.idempotency.replayed, false);

      const replayedAgentWrite = await runCli(normalizedAgentArgs, configRoot);
      assert.equal(replayedAgentWrite.exitCode, 0, replayedAgentWrite.stderr);
      assert.equal(putCount, 2);
      const replayedAgentEnvelope = JSON.parse(replayedAgentWrite.stdout);
      assert.equal(replayedAgentEnvelope.data.idempotency.replayed, true);
      assert.equal(
        replayedAgentEnvelope.data.operationId,
        firstAgentEnvelope.data.operationId,
      );

      const resetArgs = [
        'plan',
        'reset',
        '--project-id',
        '101',
        '--json',
      ];
      const resetDryRun = await runCli(resetArgs, configRoot);
      assert.equal(resetDryRun.exitCode, 0, resetDryRun.stderr);
      assert.equal(resetCount, 0);
      assert.equal(JSON.parse(resetDryRun.stdout).dryRun, true);

      const reset = await runCli([...resetArgs, '--confirm'], configRoot);
      assert.equal(reset.exitCode, 0, reset.stderr);
      assert.equal(resetCount, 1);
      const resetOutput = JSON.parse(reset.stdout);
      assert.equal(resetOutput.confirmed, true);
      assert.equal(resetOutput.verified, true);
      assert.deepEqual(resetOutput.after, [
        {
          taskDefinitionId: 501,
          start: '2026-03-01',
          startSource: 'unit_default',
          target: '2026-03-08',
          targetSource: 'unit_default',
        },
      ]);
    },
  );
});

test('submission is dry-run by default and a 5xx write outcome stays blocked as unknown', async () => {
  let uploadAttempts = 0;
  await withFixtureServer(
    (request, response) => {
      if (
        request.method === 'POST' &&
        request.url === '/api/projects/101/task_def_id/501/submission'
      ) {
        uploadAttempts += 1;
        sendJson(response, { error: 'temporary rejection' }, 503);
        return;
      }
      const payload =
        request.url === '/api/projects'
          ? [projectPayload()]
          : request.url === '/api/projects/101'
            ? projectPayload()
            : request.url === '/api/units/55'
              ? unitPayload()
              : request.url ===
                  '/api/projects/101/task_def_id/501/submission_details'
                ? {
                    has_pdf: true,
                    processing_pdf: false,
                    submission_date: '2026-03-09T00:00:00Z',
                    task_status: 'ready_for_feedback',
                  }
                : null;
      if (payload === null) {
        response.writeHead(404).end();
        return;
      }
      sendJson(response, payload);
    },
    async (configRoot) => {
      const status = await runCli(
        [
          'submission',
          'status',
          '--project-id',
          '101',
          '--task-id',
          '501',
          '--json',
        ],
        configRoot,
      );
      assert.equal(status.exitCode, 0, status.stderr);
      assert.equal(JSON.parse(status.stdout).pdfState, 'ready');

      const filePath = join(configRoot, 'evidence.txt');
      await writeFile(filePath, 'evidence', 'utf8');
      const blockedExternal = await runCli(
        [
          'submission',
          'upload',
          '--project-id',
          '101',
          '--task-id',
          '501',
          '--file',
          filePath,
          '--json',
        ],
        configRoot,
      );
      assert.equal(blockedExternal.exitCode, 1);
      assert.match(blockedExternal.stderr, /workspace boundary/i);
      assert.equal(blockedExternal.stderr.includes(filePath), false);

      const upload = await runCli(
        [
          'submission',
          'upload',
          '--project-id',
          '101',
          '--task-id',
          '501',
          '--file',
          filePath,
          '--allow-external-file',
          '--json',
        ],
        configRoot,
      );
      assert.equal(upload.exitCode, 0, upload.stderr);
      assert.equal(uploadAttempts, 0);
      const preview = JSON.parse(upload.stdout) as Record<string, unknown>;
      assert.equal(preview.dryRun, true);
      assert.equal(JSON.stringify(preview).includes(filePath), false);
      assert.equal(JSON.stringify(preview).includes('evidence.txt'), false);

      const confirmed = await runCli(
        [
          'submission',
          'upload',
          '--project-id',
          '101',
          '--task-id',
          '501',
          '--file',
          filePath,
          '--allow-external-file',
          '--confirm',
          '--json',
        ],
        configRoot,
      );
      assert.equal(confirmed.exitCode, 1);
      assert.equal(uploadAttempts, 1);
      assert.match(confirmed.stderr, /outcome is unknown/i);
      assert.doesNotMatch(confirmed.stderr, /temporary rejection/i);

      const agentArgs = [
        'submission',
        'upload',
        '--project-id',
        '101',
        '--task-definition-id',
        '501',
        '--file',
        filePath,
        '--allow-external-file',
        '--confirm',
        '--idempotency-key',
        'submission-101-P1-503',
        '--output',
        'agent-json',
      ];
      const agentUnknown = await runCli(agentArgs, configRoot);
      assert.equal(agentUnknown.exitCode, 8);
      assert.equal(uploadAttempts, 2);
      assert.equal(
        (JSON.parse(agentUnknown.stdout).error as Record<string, unknown>).code,
        'IDEMPOTENCY_OUTCOME_UNKNOWN',
      );
      const blockedReplay = await runCli(agentArgs, configRoot);
      assert.equal(blockedReplay.exitCode, 8);
      assert.equal(uploadAttempts, 2);
    },
  );
});

test('submission transport failure is unknown and is dispatched only once', async () => {
  let uploadAttempts = 0;
  await withFixtureServer(
    (request, response) => {
      if (
        request.method === 'POST' &&
        request.url === '/api/projects/101/task_def_id/501/submission'
      ) {
        uploadAttempts += 1;
        request.socket.destroy();
        return;
      }
      const payload =
        request.url === '/api/projects'
          ? [projectPayload()]
          : request.url === '/api/projects/101'
            ? projectPayload()
            : request.url === '/api/units/55'
              ? unitPayload()
              : null;
      if (payload === null) {
        response.writeHead(404).end();
        return;
      }
      sendJson(response, payload);
    },
    async (configRoot) => {
      const filePath = join(configRoot, 'private-evidence.txt');
      await writeFile(filePath, 'evidence', 'utf8');
      const result = await runCli(
        [
          'submission',
          'upload',
          '--project-id',
          '101',
          '--task-id',
          '501',
          '--file',
          filePath,
          '--allow-external-file',
          '--confirm',
          '--json',
        ],
        configRoot,
      );
      assert.equal(result.exitCode, 1);
      assert.equal(uploadAttempts, 1);
      assert.match(result.stderr, /transport outcome is unknown/i);
      assert.doesNotMatch(result.stderr, /private-evidence|fixture-session-marker/i);
    },
  );
});

test('a comment failure never turns a confirmed upload into a retryable upload error', async () => {
  let uploadAttempts = 0;
  let commentAttempts = 0;
  await withFixtureServer(
    (request, response) => {
      if (
        request.method === 'POST' &&
        request.url === '/api/projects/101/task_def_id/501/submission'
      ) {
        uploadAttempts += 1;
        sendJson(response, {
          ok: true,
          auth_token: 'raw-upload-secret',
          filename: 'private-evidence.txt',
        });
        return;
      }
      if (
        request.method === 'POST' &&
        request.url === '/api/projects/101/task_def_id/501/comments'
      ) {
        commentAttempts += 1;
        sendJson(response, { error: 'comment unavailable' }, 503);
        return;
      }
      const payload =
        request.url === '/api/projects'
          ? [projectPayload()]
          : request.url === '/api/projects/101'
            ? projectPayload()
            : request.url === '/api/units/55'
              ? unitPayload()
              : request.url ===
                  '/api/projects/101/task_def_id/501/submission_details'
                ? {
                    has_pdf: true,
                    processing_pdf: false,
                    submission_date: '2026-03-09T00:00:00Z',
                    task_status: 'ready_for_feedback',
                  }
              : null;
      if (payload === null) {
        response.writeHead(404).end();
        return;
      }
      sendJson(response, payload);
    },
    async (configRoot) => {
      const filePath = join(configRoot, 'evidence.txt');
      await writeFile(filePath, 'evidence', 'utf8');
      const result = await runCli(
        [
          'submission',
          'upload',
          '--project-id',
          '101',
          '--task-id',
          '501',
          '--file',
          filePath,
          '--allow-external-file',
          '--comment',
          'Please review',
          '--confirm',
          '--json',
        ],
        configRoot,
      );
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(uploadAttempts, 1);
      assert.equal(commentAttempts, 1);
      const output = JSON.parse(result.stdout) as Record<string, unknown>;
      assert.equal(output.state, 'succeeded');
      assert.deepEqual(output.comment, {
        status: 'failed',
      });
      const serialized = JSON.stringify(output);
      assert.equal(serialized.includes(filePath), false);
      assert.equal(serialized.includes('evidence.txt'), false);
      assert.equal(serialized.includes('raw-upload-secret'), false);
      assert.equal(serialized.includes('private-evidence.txt'), false);
      assert.equal(serialized.includes('Please review'), false);
    },
  );
});

test('upload-new-files checks existing submission state before its single confirmed dispatch', async () => {
  let uploadAttempts = 0;
  let existingSubmission = false;
  await withFixtureServer(
    (request, response) => {
      if (
        request.method === 'POST' &&
        request.url === '/api/projects/101/task_def_id/501/submission'
      ) {
        uploadAttempts += 1;
        sendJson(response, { ok: true });
        return;
      }
      const payload =
        request.url === '/api/projects'
          ? [projectPayload()]
          : request.url === '/api/projects/101'
            ? projectPayload()
            : request.url === '/api/units/55'
              ? unitPayload()
              : request.url ===
                  '/api/projects/101/task_def_id/501/submission_details'
                ? existingSubmission
                  ? {
                      has_pdf: true,
                      processing_pdf: false,
                      submission_date: '2026-03-09T00:00:00Z',
                      task_status: 'ready_for_feedback',
                    }
                  : {
                      has_pdf: false,
                      processing_pdf: false,
                      task_status: 'working_on_it',
                    }
                : null;
      if (payload === null) {
        response.writeHead(404).end();
        return;
      }
      sendJson(response, payload);
    },
    async (configRoot) => {
      const filePath = join(configRoot, 'replacement.txt');
      await writeFile(filePath, 'replacement', 'utf8');
      const args = [
        'submission',
        'upload-new-files',
        '--project-id',
        '101',
        '--task-id',
        '501',
        '--file',
        filePath,
        '--allow-external-file',
        '--json',
      ];

      const blocked = await runCli([...args, '--confirm'], configRoot);
      assert.equal(blocked.exitCode, 1);
      assert.match(blocked.stderr, /existing submission/i);
      assert.equal(uploadAttempts, 0);

      existingSubmission = true;
      const preview = await runCli(args, configRoot);
      assert.equal(preview.exitCode, 0, preview.stderr);
      assert.equal(JSON.parse(preview.stdout).dryRun, true);
      assert.equal(uploadAttempts, 0);

      const confirmed = await runCli([...args, '--confirm'], configRoot);
      assert.equal(confirmed.exitCode, 0, confirmed.stderr);
      assert.equal(JSON.parse(confirmed.stdout).state, 'succeeded');
      assert.equal(uploadAttempts, 1);
    },
  );
});

test('feedback and cross-task watch terminate on a mid-poll 419 without leaking its body', async () => {
  await withFixtureServer(
    (() => {
      let commentReads = 0;
      return (request, response) => {
        if (
          request.url ===
          '/api/projects/101/task_def_id/501/comments'
        ) {
          commentReads += 1;
          if (commentReads % 2 === 0) {
            sendJson(
              response,
              {
                error:
                  'expired for student@example.edu Authorization: Basic raw-watch-secret',
              },
              419,
            );
          } else {
            sendJson(response, []);
          }
          return;
        }
        const payload =
          request.url === '/api/projects'
            ? [projectPayload()]
            : request.url === '/api/projects/101'
              ? projectPayload()
              : request.url === '/api/units/55'
                ? unitPayload()
                : null;
        if (payload === null) {
          response.writeHead(404).end();
          return;
        }
        sendJson(response, payload);
      };
    })(),
    async (configRoot) => {
      const feedback = await runCli(
        [
          'feedback',
          'watch',
          '--project-id',
          '101',
          '--task-id',
          '501',
          '--interval',
          '1',
          '--history',
          '0',
          '--json',
        ],
        configRoot,
      );
      assert.equal(feedback.exitCode, 1);
      assert.match(
        feedback.stderr,
        /saved credential \(expired\).*auth ensure/is,
      );
      assert.doesNotMatch(feedback.stderr, /student@example|raw-watch-secret|Basic/i);

      const watch = await runCli(
        [
          'watch',
          '--project-id',
          '101',
          '--interval',
          '1',
          '--json',
        ],
        configRoot,
      );
      assert.equal(watch.exitCode, 1);
      assert.match(watch.stderr, /saved credential \(expired\).*auth ensure/is);
      assert.doesNotMatch(watch.stderr, /student@example|raw-watch-secret|Basic/i);
    },
  );
});
