import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { test } from 'bun:test';
import { resolveCliEntry } from '../src/lib/cli-entry.ts';

async function runNonInteractiveCli(args: readonly string[]): Promise<{
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}> {
  const child = spawn(process.execPath, [resolve(process.cwd(), 'src/cli.ts'), ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NO_COLOR: '1' },
  });
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
  const exitCode = await new Promise<number | null>((resolveExit) => {
    child.on('exit', resolveExit);
  });
  return {
    exitCode,
    stdout: Buffer.concat(stdoutChunks).toString('utf8'),
    stderr: Buffer.concat(stderrChunks).toString('utf8'),
  };
}

test('no-argument interactive CLI launches the TUI', () => {
  assert.deepEqual(
    resolveCliEntry([], { stdinIsTTY: true, stdoutIsTTY: true }),
    { mode: 'tui', args: [] },
  );
});

test('no-argument non-interactive CLI preserves the welcome fallback', () => {
  for (const terminal of [
    { stdinIsTTY: false, stdoutIsTTY: false },
    { stdinIsTTY: true, stdoutIsTTY: false },
    { stdinIsTTY: false, stdoutIsTTY: true },
  ]) {
    assert.deepEqual(resolveCliEntry([], terminal), { mode: 'welcome', args: [] });
  }
});

test('explicit welcome remains in the normal command dispatcher', () => {
  assert.deepEqual(
    resolveCliEntry(['welcome'], { stdinIsTTY: true, stdoutIsTTY: true }),
    { mode: 'command', args: ['welcome'] },
  );
});

test('non-interactive no-argument and welcome processes preserve help output', async () => {
  for (const args of [[], ['welcome']] as const) {
    const result = await runNonInteractiveCli(args);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Usage:\n  ontrack/);
    assert.doesNotMatch(result.stdout, /Select action number/);
    assert.equal(result.stderr, '');
  }
});
