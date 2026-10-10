import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'bun:test';
import { distSmokeEnvironment, smokeDist, type DistPaths } from '../scripts/smoke-dist.ts';

interface FakeCliOptions {
  readonly capabilitiesVersion?: string;
  readonly helpExitCode?: number;
}

// Stands in for dist/cli.js. It refuses to run against the operator's home or
// a non-loopback OnTrack, so a smoke that leaks either one fails.
function fakeCli(options: FakeCliOptions = {}): string {
  return `
if (process.env.HOME === ${JSON.stringify(homedir())} || process.env.ONTRACK_BASE_URL !== 'http://127.0.0.1:1') {
  console.error('the dist smoke is not isolated');
  process.exit(9);
}
const command = process.argv.slice(2).join(' ');
if (command === '--help') {
  console.log('Usage: ontrack <command>');
  process.exit(${options.helpExitCode ?? 0});
} else if (command === 'schema auth.method --output agent-json') {
  console.log(JSON.stringify({ data: { path: 'auth.method' } }));
} else if (command === 'capabilities --output agent-json') {
  console.log(JSON.stringify({ schema_version: ${JSON.stringify(options.capabilitiesVersion ?? 'ontrack.agent/v1')} }));
} else {
  console.error('unexpected command: ' + command);
  process.exit(8);
}
`;
}

async function withDist(
  cliSource: string,
  options: { readonly tuiBundle?: boolean },
  run: (paths: DistPaths) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'ontrack-dist-smoke-test-'));
  try {
    await mkdir(join(root, 'tui'), { recursive: true });
    const paths = { cliPath: join(root, 'cli.js'), tuiPath: join(root, 'tui', 'index.js') };
    await writeFile(paths.cliPath, cliSource);
    if (options.tuiBundle ?? true) {
      await writeFile(paths.tuiPath, 'export async function runTui() {}');
    }
    await run(paths);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('smokeDist passes a built CLI that answers every check offline', async () => {
  await withDist(fakeCli(), {}, async (paths) => {
    assert.deepEqual(await smokeDist(paths), [
      'tui bundle',
      'help',
      'schema auth.method',
      'capabilities',
    ]);
  });
});

test('smokeDist fails without the TUI bundle', async () => {
  await withDist(fakeCli(), { tuiBundle: false }, async (paths) => {
    await assert.rejects(() => smokeDist(paths), /missing TUI bundle/);
  });
});

test('smokeDist fails when a CLI check exits non-zero', async () => {
  await withDist(fakeCli({ helpExitCode: 3 }), {}, async (paths) => {
    await assert.rejects(() => smokeDist(paths), /"--help" exited with code 3/);
  });
});

test('smokeDist fails on unexpected agent output', async () => {
  await withDist(fakeCli({ capabilitiesVersion: 'ontrack.agent/v0' }), {}, async (paths) => {
    await assert.rejects(() => smokeDist(paths), /"capabilities" printed unexpected output/);
  });
});

test('the dist smoke environment keeps the CLI off the real home and production', () => {
  const env = distSmokeEnvironment('/tmp/ontrack-smoke-home');
  assert.equal(env.HOME, '/tmp/ontrack-smoke-home');
  assert.equal(env.XDG_CONFIG_HOME, '/tmp/ontrack-smoke-home');
  assert.equal(env.ONTRACK_BASE_URL, 'http://127.0.0.1:1');
});
