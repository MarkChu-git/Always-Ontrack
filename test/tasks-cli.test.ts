import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
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

test('tasks and task show use unit definitions when project instances are empty', async () => {
  const configRoot = await mkdtemp(join(tmpdir(), 'ontrack-tasks-'));
  const server = createServer((request, response) => {
    assert.equal(request.headers['auth-token'], 'fixture-session-marker');
    assert.equal(request.headers.username, 'fixture-student');

    const payload =
      request.url === '/api/projects'
        ? [
            {
              id: 101,
              target_grade: 0,
              unit: { id: 55, code: 'FIT0001' },
            },
          ]
        : request.url === '/api/projects/101'
          ? {
              id: 101,
              target_grade: 0,
              tasks: [],
              unit: { id: 55, code: 'FIT0001' },
            }
          : request.url === '/api/units/55'
            ? {
                id: 55,
                code: 'FIT0001',
                task_definitions: [
                  {
                    id: 501,
                    abbreviation: 'P1',
                    name: 'Definition-only task',
                    target_grade: 0,
                  },
                  {
                    id: 502,
                    abbreviation: 'C1',
                    name: 'Beyond target',
                    target_grade: 1,
                  },
                ],
              }
            : null;

    if (payload === null) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(payload));
  });

  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');

    const sessionDir = join(configRoot, 'ontrack-cli');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, 'session.json'),
      JSON.stringify({
        baseUrl: `http://127.0.0.1:${address.port}/api`,
        username: 'fixture-student',
        authToken: 'fixture-session-marker',
        savedAt: '2026-07-31T00:00:00.000Z',
        user: { id: 1, username: 'fixture-student', role: 'student' },
      }),
      'utf8',
    );

    const listResult = await runCli(['tasks', '--json'], configRoot);
    assert.equal(listResult.exitCode, 0, listResult.stderr);
    const tasks = JSON.parse(listResult.stdout) as Array<Record<string, unknown>>;
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].taskDefinitionId, 501);
    assert.equal(tasks[0].taskInstanceId, undefined);
    assert.equal(tasks[0].status, 'not_instantiated');

    const showResult = await runCli(
      [
        'task',
        'show',
        '--project-id',
        '101',
        '--task-definition-id',
        '501',
        '--json',
      ],
      configRoot,
    );
    assert.equal(showResult.exitCode, 0, showResult.stderr);
    const task = JSON.parse(showResult.stdout) as Record<string, unknown>;
    assert.equal(task.taskDefinitionId, 501);
    assert.equal(task.taskInstanceId, undefined);
    assert.equal(task.taskId, 501);
    assert.equal(task.taskDefId, 501);
    assert.equal(task.name, 'Definition-only task');
  } finally {
    server.close();
    await rm(configRoot, { recursive: true, force: true });
  }
});

test('task show preserves legacy instance selectors, stderr warning, and JSON aliases', async () => {
  const configRoot = await mkdtemp(join(tmpdir(), 'ontrack-task-identity-'));
  const server = createServer((request, response) => {
    const payload =
      request.url === '/api/projects'
        ? [{ id: 101, target_grade: 0, unit: { id: 55, code: 'FIT0001' } }]
        : request.url === '/api/projects/101'
          ? {
              id: 101,
              target_grade: 0,
              tasks: [
                {
                  id: 9001,
                  task_definition_id: 501,
                  status: 'working_on_it',
                },
              ],
              unit: { id: 55, code: 'FIT0001' },
            }
          : request.url === '/api/units/55'
            ? {
                id: 55,
                code: 'FIT0001',
                task_definitions: [
                  {
                    id: 501,
                    abbreviation: 'P1',
                    name: 'Instantiated task',
                    target_grade: 0,
                  },
                ],
              }
            : null;

    if (payload === null) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(payload));
  });

  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');

    const sessionDir = join(configRoot, 'ontrack-cli');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, 'session.json'),
      JSON.stringify({
        baseUrl: `http://127.0.0.1:${address.port}/api`,
        username: 'fixture-student',
        authToken: 'fixture-session-marker',
        savedAt: '2026-07-31T00:00:00.000Z',
        user: { id: 1, username: 'fixture-student', role: 'student' },
      }),
      'utf8',
    );

    const result = await runCli(
      ['task', 'show', '--project-id', '101', '--task-id', '9001', '--json'],
      configRoot,
    );
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stderr, /--task-id is deprecated.*--task-definition-id/i);
    assert.deepEqual(JSON.parse(result.stdout), {
      projectId: 101,
      unitId: 55,
      unitCode: 'FIT0001',
      taskDefinitionId: 501,
      taskInstanceId: 9001,
      taskId: 9001,
      taskDefId: 501,
      abbr: 'P1',
      name: 'Instantiated task',
      status: 'working_on_it',
      raw: {
        id: 9001,
        task_definition_id: 501,
        status: 'working_on_it',
        taskDefinitionId: 501,
        taskInstanceId: 9001,
        isInstantiated: true,
        studentVisibility: 'within_target',
        projectId: 101,
        unitId: 55,
        unitCode: 'FIT0001',
        definition: {
          id: 501,
          abbreviation: 'P1',
          name: 'Instantiated task',
          target_grade: 0,
          targetGrade: 0,
        },
      },
    });
  } finally {
    server.close();
    await rm(configRoot, { recursive: true, force: true });
  }
});
