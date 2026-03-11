#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) {
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args.set(key, true);
      continue;
    }

    args.set(key, next);
    index += 1;
  }
  return args;
}

function run(commandArgs, label) {
  const result = spawnSync(process.execPath, ['dist/cli.js', ...commandArgs], {
    stdio: 'pipe',
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`${label} failed.\n${output}`);
  }

  return result.stdout;
}

function runJson(commandArgs, label) {
  const withJson = commandArgs.includes('--json') ? commandArgs : [...commandArgs, '--json'];
  const output = run(withJson, label).trim();
  try {
    return JSON.parse(output);
  } catch (error) {
    throw new Error(`${label} returned non-JSON output.\n${output}\n${String(error)}`);
  }
}

function runWatch(projectId, intervalSec) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [
      'dist/cli.js',
      'watch',
      '--project-id',
      String(projectId),
      '--interval',
      String(intervalSec),
      '--json',
    ]);

    let stdout = '';
    let stderr = '';
    let baselineSeen = false;
    let stopRequested = false;
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
      if (!baselineSeen && stdout.includes('"type": "baseline"')) {
        baselineSeen = true;
        if (!stopRequested) {
          stopRequested = true;
          setTimeout(() => child.kill('SIGINT'), 400);
        }
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    const timer = setTimeout(() => {
      if (!stopRequested) {
        stopRequested = true;
        child.kill('SIGINT');
      }
    }, 60000);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const hasBaseline = stdout.includes('"type": "baseline"');
      if (!hasBaseline) {
        reject(new Error(`watch did not produce baseline output.\n${stdout}\n${stderr}`));
        return;
      }

      const interruptedByUs = signal === 'SIGINT' || signal === 'SIGTERM';
      if (code !== 0 && !interruptedByUs) {
        reject(new Error(`watch failed with exit code ${code}.\n${stdout}\n${stderr}`));
        return;
      }
      resolvePromise(stdout);
    });
  });
}

function pickFirstTask(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new Error('No tasks found for project.');
  }

  const withAbbr = tasks.find((task) => task?.definition?.abbreviation);
  return withAbbr || tasks[0];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = resolve(String(args.get('--out-dir') || './downloads-smoke'));
  const intervalSec = Number.parseInt(String(args.get('--watch-interval') || '1'), 10);
  mkdirSync(outDir, { recursive: true });

  run(['auth-method'], 'auth-method');
  run(['whoami'], 'whoami');
  run(['doctor'], 'doctor');
  run(['discover', '--limit', '20'], 'discover');
  run(['discover', '--probe', '--limit', '10'], 'discover --probe');

  const projects = runJson(['projects'], 'projects');
  if (!Array.isArray(projects) || projects.length === 0) {
    throw new Error('No projects available for this account.');
  }

  const projectId = Number.parseInt(
    String(args.get('--project-id') || projects[0]?.id),
    10,
  );
  if (!Number.isFinite(projectId)) {
    throw new Error('Invalid project id.');
  }

  const tasks = runJson(['tasks', '--project-id', String(projectId)], 'tasks');
  const selectedTask = pickFirstTask(tasks);
  const abbr = String(args.get('--abbr') || selectedTask?.definition?.abbreviation || '');
  if (!abbr) {
    throw new Error('No task abbreviation available. Pass --abbr explicitly.');
  }

  const taskShow = runJson(
    ['task', 'show', '--project-id', String(projectId), '--abbr', abbr],
    'task show',
  );
  const unitId = Number.parseInt(String(taskShow?.unitId ?? taskShow?.raw?.unitId ?? ''), 10);
  if (!Number.isFinite(unitId)) {
    throw new Error('task show did not return unitId.');
  }

  run(['units'], 'units');
  run(['project', 'show', '--project-id', String(projectId)], 'project show');
  run(['unit', 'show', '--unit-id', String(unitId)], 'unit show');
  run(['unit', 'tasks', '--unit-id', String(unitId)], 'unit tasks');
  run(['inbox', '--unit-id', String(unitId)], 'inbox');
  run(['feedback', 'list', '--project-id', String(projectId), '--abbr', abbr], 'feedback list');
  run(
    ['pdf', 'task', '--project-id', String(projectId), '--abbr', abbr, '--out-dir', outDir],
    'pdf task',
  );
  run(
    ['pdf', 'submission', '--project-id', String(projectId), '--abbr', abbr, '--out-dir', outDir],
    'pdf submission',
  );

  await runWatch(projectId, intervalSec);

  console.log('Smoke check passed.');
  console.log(`projectId=${projectId}`);
  console.log(`abbr=${abbr}`);
  console.log(`unitId=${unitId}`);
  console.log(`outDir=${outDir}`);
}

main().catch((error) => {
  console.error(`Smoke check failed: ${error.message}`);
  process.exitCode = 1;
});
