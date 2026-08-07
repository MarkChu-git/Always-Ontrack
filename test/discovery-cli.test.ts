import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'bun:test';

async function runCli(args: string[], configRoot: string): Promise<{
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}> {
  const child = spawn(process.execPath, [resolve(process.cwd(), 'src/cli.ts'), ...args], {
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
  const [code] = await once(child, 'close') as [number | null];
  return { stdout, stderr, exitCode: code ?? 1 };
}

test('discover probe rejects an over-budget limit before authentication or network access', async () => {
  const configRoot = await mkdtemp(join(tmpdir(), 'ontrack-discovery-cli-'));
  try {
    const result = await runCli(['discover', '--probe', '--limit', '26'], configRoot);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /--limit must be at most 25 when used with --probe/);
  } finally {
    await rm(configRoot, { recursive: true, force: true });
  }
});

test('discover probe rejects malformed numeric selectors before authentication or network access', async () => {
  const configRoot = await mkdtemp(join(tmpdir(), 'ontrack-discovery-cli-'));
  try {
    const malformedLimit = await runCli(['discover', '--probe', '--limit', '10junk'], configRoot);
    assert.notEqual(malformedLimit.exitCode, 0);
    assert.match(malformedLimit.stderr, /Expected an integer for --limit/);

    const malformedProject = await runCli(['discover', '--probe', '--project-id', '9junk'], configRoot);
    assert.notEqual(malformedProject.exitCode, 0);
    assert.match(malformedProject.stderr, /Expected an integer for --project-id/);
  } finally {
    await rm(configRoot, { recursive: true, force: true });
  }
});

test('discover rejects probe selectors unless probe mode is explicit', async () => {
  const configRoot = await mkdtemp(join(tmpdir(), 'ontrack-discovery-cli-'));
  try {
    const result = await runCli(['discover', '--project-id', '101'], configRoot);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /Discovery selectors require --probe/);
  } finally {
    await rm(configRoot, { recursive: true, force: true });
  }
});

test('discover help advertises the explicit probe selectors', async () => {
  const configRoot = await mkdtemp(join(tmpdir(), 'ontrack-discovery-cli-'));
  try {
    const result = await runCli(['help'], configRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /discover \[--probe\] \[--project-id ID\] \[--unit-id ID\] \[--task-definition-id ID\]/);
  } finally {
    await rm(configRoot, { recursive: true, force: true });
  }
});
