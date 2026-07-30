import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'bun:test';
import {
  validateTarEntries,
  validateTarEntryTypes,
  verifyPackageTarball,
} from '../scripts/verify-package.ts';

const validEntries = [
  'package/package.json',
  'package/LICENSE',
  'package/README.md',
  'package/README.zh-CN.md',
  'package/dist/cli.js',
  'package/dist/lib/api.js',
];

test('validateTarEntries accepts the supported package surface', () => {
  assert.doesNotThrow(() => validateTarEntries(validEntries));
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

test('verifyPackageTarball verifies the archive and runs the packed CLI from an isolated directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ontrack-package-test-'));
  const packageRoot = join(root, 'package');
  const archivePath = join(root, 'ontrack-cli-0.3.0.tgz');

  await mkdir(join(packageRoot, 'dist', 'lib'), { recursive: true });
  await writeFile(
    join(packageRoot, 'package.json'),
    JSON.stringify({ name: 'ontrack-cli', version: '0.3.0', bin: { ontrack: './dist/cli.js' } }),
  );
  await writeFile(join(packageRoot, 'LICENSE'), 'Apache-2.0');
  await writeFile(join(packageRoot, 'README.md'), '# OnTrack');
  await writeFile(join(packageRoot, 'README.zh-CN.md'), '# OnTrack');
  await writeFile(join(packageRoot, 'dist', 'lib', 'api.js'), 'export {};');
  await writeFile(join(packageRoot, 'dist', 'cli.js'), "console.log('ontrack help works');");

  const tar = Bun.spawn(['tar', '-czf', archivePath, '-C', root, 'package'], { stdout: 'pipe', stderr: 'pipe' });
  assert.equal(await tar.exited, 0, await new Response(tar.stderr).text());

  const result = await verifyPackageTarball(archivePath);

  assert.match(result.cliOutput, /ontrack help works/);
  assert.deepEqual([...result.entries].sort(), [...validEntries].sort());
  await rm(root, { recursive: true, force: true });
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
