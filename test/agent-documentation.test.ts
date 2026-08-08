import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

async function listNativeAgentCommands(): Promise<string[]> {
  const result = await new Promise<{ readonly stdout: string; readonly stderr: string; readonly exitCode: number }>(
    (resolveResult, reject) => {
      const child = spawn(process.execPath, [resolve(process.cwd(), 'src/cli.ts'), 'agent', 'list'], {
        cwd: process.cwd(),
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
    },
  );

  assert.equal(result.exitCode, 0, result.stderr);
  const envelope = JSON.parse(result.stdout) as {
    readonly data: { readonly commands: ReadonlyArray<{ readonly path: string }> };
  };
  return envelope.data.commands.map((command) => command.path);
}

function commandPathsFromExamples(document: string): string[] {
  return [...document.matchAll(/^ontrack agent (?:call|stream) ([a-z][a-z0-9.]*)\b/gmu)].map(
    (match) => match[1],
  );
}

function commandPathsFromInventory(document: string, heading: string): string[] {
  const start = document.indexOf(heading);
  assert.notEqual(start, -1, `missing native Agent command inventory: ${heading}`);
  const section = document.slice(start + heading.length).split('\n### ', 1)[0];
  return [...section.matchAll(/^\| `([a-z][a-z0-9.]*)` \|/gmu)].map((match) => match[1]);
}

test('native Agent command discovery is documented in both README languages', async () => {
  const [english, chinese, commands] = await Promise.all([
    readFile(resolve(process.cwd(), 'README.md'), 'utf8'),
    readFile(resolve(process.cwd(), 'README.zh-CN.md'), 'utf8'),
    listNativeAgentCommands(),
  ]);

  const expected = [...commands].sort();
  for (const [document, inventoryHeading] of [
    [english, '#### Native command inventory'],
    [chinese, '#### 原生命令目录'],
  ] as const) {
    assert.match(document, /ontrack agent list/u);
    assert.match(document, /ontrack agent describe task\.show/u);
    assert.deepEqual(commandPathsFromExamples(document).sort(), expected);
    assert.deepEqual(commandPathsFromInventory(document, inventoryHeading).sort(), expected);
  }
});
