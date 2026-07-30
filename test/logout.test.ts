import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { test } from 'bun:test';

test('logout clears the local session and emits no remote error detail', async () => {
  const exposureMarker = 'logout-redaction-test-marker';
  const configRoot = await mkdtemp(join(tmpdir(), 'ontrack-logout-'));
  const sessionDir = join(configRoot, 'ontrack-cli');
  const sessionPath = join(sessionDir, 'session.json');
  const server = createServer((_, response) => {
    response.writeHead(400, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: `auth_token=${exposureMarker}` }));
  });

  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');

    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      sessionPath,
      JSON.stringify({
        baseUrl: `http://127.0.0.1:${address.port}/api`,
        username: 'student1',
        authToken: exposureMarker,
        savedAt: '2026-07-31T00:00:00.000Z',
        user: { id: 1, username: 'student1', role: 'student' },
      }),
      'utf8',
    );

    const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolveResult, reject) => {
      const child = spawn(process.execPath, [resolve(process.cwd(), 'src/cli.ts'), 'logout'], {
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

    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(
      result.stderr,
      '[warn] Local session was cleared, but remote sign-out failed. Re-authenticate if needed.\n',
    );
    assert.equal(result.stderr.includes(exposureMarker), false);
    assert.equal(existsSync(sessionPath), false);
  } finally {
    server.close();
    await rm(configRoot, { recursive: true, force: true });
  }
});
