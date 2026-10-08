import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'bun:test';
import {
  terminateSubprocess,
  tuiSmokeEnvironment,
  validateTarEntries,
  validateTarEntryTypes,
  verifyInstalledTui,
  verifyPackageTarball,
} from '../scripts/verify-package.ts';

test('terminateSubprocess waits for SIGTERM before escalating to SIGKILL', async () => {
  let resolveExit: (code: number) => void = () => undefined;
  const exited = new Promise<number>((resolve) => {
    resolveExit = resolve;
  });
  let signals: Array<number | undefined> = [];
  const child = {
    exited,
    kill(signal?: number) {
      signals = [...signals, signal];
      if (signal === 9) {
        resolveExit(137);
      }
    },
  };

  await terminateSubprocess(child, 1);

  assert.deepEqual(signals, [undefined, 9]);
});

async function assertTuiSmokeFailure(
  source: string,
  expected: RegExp,
  options: {
    readonly outputLimit?: number;
    readonly terminationGraceMs?: number;
    readonly timeoutMs?: number;
  },
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'ontrack-tui-smoke-failure-'));
  const cliPath = join(root, 'cli.js');
  const configRoot = join(root, 'config');
  try {
    await mkdir(configRoot);
    await writeFile(cliPath, source);
    await assert.rejects(
      () => verifyInstalledTui(cliPath, root, configRoot, options),
      expected,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('packed TUI smoke env never targets production OnTrack', () => {
  const env = tuiSmokeEnvironment('/tmp/ontrack-config');
  assert.equal(env.ONTRACK_BASE_URL, 'http://127.0.0.1:1');
  assert.equal(env.ONTRACK_HEADLESS, '1');
  assert.equal(env.ONTRACK_RELAY_URL, '');
});

test('verifyInstalledTui bounds timeout, output, and nonzero-exit failures', async () => {
  await assertTuiSmokeFailure(
    "process.on('SIGTERM', () => undefined); setInterval(() => undefined, 1_000);",
    /did not finish its TUI smoke test/,
    { timeoutMs: 10, terminationGraceMs: 10 },
  );
  await assertTuiSmokeFailure(
    "process.stdout.write('x'.repeat(1_024)); process.on('SIGTERM', () => undefined); setInterval(() => undefined, 1_000);",
    /exceeded the TUI smoke output limit/,
    { outputLimit: 10, timeoutMs: 1_000, terminationGraceMs: 10 },
  );
  await assertTuiSmokeFailure(
    'setTimeout(() => process.exit(2), 10);',
    /packed TUI exited with code 2/,
    { timeoutMs: 1_000, terminationGraceMs: 10 },
  );
});

const validEntries = [
  'package/package.json',
  'package/LICENSE',
  'package/README.md',
  'package/README.zh-CN.md',
  'package/dist/cli.js',
  'package/dist/lib/api.js',
  'package/dist/tui/index.js',
];

test('validateTarEntries accepts the supported package surface', () => {
  assert.doesNotThrow(() => validateTarEntries(validEntries));
});

test('validateTarEntries requires the public CLI executable', () => {
  assert.throws(
    () => validateTarEntries(validEntries.filter((entry) => entry !== 'package/dist/cli.js')),
    /missing required entry: package\/dist\/cli\.js/,
  );
});

test('validateTarEntries requires the published TUI entrypoint', () => {
  assert.throws(
    () => validateTarEntries(validEntries.filter((entry) => entry !== 'package/dist/tui/index.js')),
    /missing required entry: package\/dist\/tui\/index\.js/,
  );
});

test('validateTarEntries rejects source, tests, secrets, and path traversal', () => {
  for (const prohibitedEntry of [
    'package/src/cli.ts',
    'package/test/api.test.ts',
    'package/.env',
    'package/downloads/report.pdf',
    'package/../outside.txt',
    'other/package.json',
  ]) {
    assert.throws(() => validateTarEntries([...validEntries, prohibitedEntry]), /not allowed|unsafe/);
  }
});

test('validateTarEntryTypes allows only regular files and directories', () => {
  assert.doesNotThrow(() =>
    validateTarEntryTypes([
      'drwxr-xr-x user/group 0 2026-07-31 00:00 package/',
      '-rw-r--r-- user/group 12 2026-07-31 00:00 package/package.json',
    ]),
  );

  for (const type of ['l', 'h', 'b', 'c', 'p']) {
    assert.throws(
      () =>
        validateTarEntryTypes([
          `${type}rwxrwxrwx user/group 0 2026-07-31 00:00 package/dist/lib/api.js`,
        ]),
      /unsupported tar entry type/i,
    );
  }
});

const packedCliSource = `#!/usr/bin/env bun
if (process.argv.includes('--help')) {
  console.log('ontrack help works');
} else {
  process.stdout.write('Not signed in\\n');
  process.on('SIGINT', () => process.exit(0));
}`;

async function writePackageArchive(
  root: string,
  options: { readonly bin?: Record<string, string>; readonly cliSource?: string } = {},
): Promise<string> {
  const packageRoot = join(root, 'package');
  const archivePath = join(root, 'ontrack-cli-0.3.0.tgz');

  await mkdir(join(packageRoot, 'dist', 'lib'), { recursive: true });
  await mkdir(join(packageRoot, 'dist', 'tui'), { recursive: true });
  await writeFile(
    join(packageRoot, 'package.json'),
    JSON.stringify({
      name: 'ontrack-cli',
      version: '0.3.0',
      bin: options.bin ?? { ontrack: './dist/cli.js' },
    }),
  );
  await writeFile(join(packageRoot, 'LICENSE'), 'Apache-2.0');
  await writeFile(join(packageRoot, 'README.md'), '# OnTrack');
  await writeFile(join(packageRoot, 'README.zh-CN.md'), '# OnTrack');
  await writeFile(join(packageRoot, 'dist', 'lib', 'api.js'), 'export {};');
  await writeFile(
    join(packageRoot, 'dist', 'tui', 'index.js'),
    'export async function runTui() {}',
  );
  await writeFile(join(packageRoot, 'dist', 'cli.js'), options.cliSource ?? packedCliSource);
  await chmod(join(packageRoot, 'dist', 'cli.js'), 0o755);

  const tar = Bun.spawn(['tar', '-czf', archivePath, '-C', root, 'package'], { stdout: 'pipe', stderr: 'pipe' });
  assert.equal(await tar.exited, 0, await new Response(tar.stderr).text());
  return archivePath;
}

test('verifyPackageTarball verifies the archive and runs the packed CLI from an isolated directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ontrack-package-test-'));
  try {
    const result = await verifyPackageTarball(await writePackageArchive(root));

    assert.match(result.cliOutput, /ontrack help works/);
    assert.match(result.tuiOutput, /Not signed in/);
    assert.equal(result.tuiEntrypoint, 'runTui');
    assert.deepEqual([...result.entries].sort(), [...validEntries].sort());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('verifyPackageTarball rejects a manifest that exposes another executable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ontrack-package-bin-test-'));
  try {
    const archivePath = await writePackageArchive(root, {
      bin: { ontrack: './dist/cli.js', 'ontrack-auth-mcp': './dist/auth-mcp.js' },
    });

    await assert.rejects(
      () => verifyPackageTarball(archivePath),
      /does not expose exactly the ontrack executable/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('verifyPackageTarball rejects a CLI without its Bun entrypoint', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ontrack-package-shebang-test-'));
  try {
    const archivePath = await writePackageArchive(root, {
      cliSource: "console.log('ontrack help works');",
    });

    await assert.rejects(
      () => verifyPackageTarball(archivePath),
      /missing its Bun executable entrypoint/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('verifyPackageTarball rejects symlink entries before extraction', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ontrack-package-link-test-'));
  const packageRoot = join(root, 'package');
  const archivePath = join(root, 'ontrack-cli-link.tgz');

  try {
    await mkdir(join(packageRoot, 'dist', 'lib'), { recursive: true });
    await writeFile(
      join(packageRoot, 'package.json'),
      JSON.stringify({ name: 'ontrack-cli', version: '0.3.0', bin: { ontrack: './dist/cli.js' } }),
    );
    await writeFile(join(packageRoot, 'LICENSE'), 'Apache-2.0');
    await writeFile(join(packageRoot, 'README.md'), '# OnTrack');
    await writeFile(join(packageRoot, 'README.zh-CN.md'), '# OnTrack');
    await writeFile(join(packageRoot, 'dist', 'cli.js'), "console.log('ontrack help works');");
    await symlink('../../README.md', join(packageRoot, 'dist', 'lib', 'api.js'));

    const tar = Bun.spawn(['tar', '-czf', archivePath, '-C', root, 'package'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    assert.equal(await tar.exited, 0, await new Response(tar.stderr).text());

    await assert.rejects(
      () => verifyPackageTarball(archivePath),
      /unsupported tar entry type/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
