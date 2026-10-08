import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'bun:test';
import { packAndVerify } from '../scripts/pack-and-verify.ts';

const packedCliSource = `#!/usr/bin/env bun
if (process.argv.includes('--help')) {
  console.log('ontrack help works');
} else {
  process.stdout.write('Not signed in\\n');
  process.on('SIGINT', () => process.exit(0));
}`;

async function writePackageDirectory(root: string): Promise<void> {
  await mkdir(join(root, 'dist', 'lib'), { recursive: true });
  await mkdir(join(root, 'dist', 'tui'), { recursive: true });
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'ontrack-cli',
      version: '0.3.0',
      bin: { ontrack: './dist/cli.js' },
      files: ['dist'],
    }),
  );
  await writeFile(join(root, 'LICENSE'), 'Apache-2.0');
  await writeFile(join(root, 'README.md'), '# OnTrack');
  await writeFile(join(root, 'README.zh-CN.md'), '# OnTrack');
  await writeFile(join(root, 'dist', 'lib', 'api.js'), 'export {};');
  await writeFile(join(root, 'dist', 'tui', 'index.js'), 'export async function runTui() {}');
  await writeFile(join(root, 'dist', 'cli.js'), packedCliSource);
  await chmod(join(root, 'dist', 'cli.js'), 0o755);
}

async function withPackage(run: (root: string, scratch: string) => Promise<void>): Promise<void> {
  const scratch = await mkdtemp(join(tmpdir(), 'ontrack-pack-test-'));
  try {
    const root = join(scratch, 'package-root');
    await writePackageDirectory(root);
    await run(root, scratch);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

test('packAndVerify keeps the verified tarball in the output directory', async () => {
  await withPackage(async (root, scratch) => {
    const outputDir = join(scratch, 'artifacts');
    const result = await packAndVerify(root, outputDir);

    assert.equal(result.kept, true);
    assert.equal(result.tarballPath, join(outputDir, 'ontrack-cli-0.3.0.tgz'));
    assert.ok((await stat(result.tarballPath)).isFile());
    assert.ok(result.verification.entries.includes('package/dist/cli.js'));
  });
});

test('packAndVerify removes its temporary directory without an output directory', async () => {
  await withPackage(async (root) => {
    const result = await packAndVerify(root);

    assert.equal(result.kept, false);
    await assert.rejects(() => stat(result.tarballPath));
  });
});

test('packAndVerify verifies the fresh tarball when the output directory holds an older one', async () => {
  await withPackage(async (root, scratch) => {
    const outputDir = join(scratch, 'artifacts');
    await mkdir(outputDir);
    await writeFile(join(outputDir, 'ontrack-cli-0.2.0.tgz'), 'not a tarball');

    const result = await packAndVerify(root, outputDir);

    assert.equal(result.tarballPath, join(outputDir, 'ontrack-cli-0.3.0.tgz'));
  });
});

test('packAndVerify fails when bun pm pack fails', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'ontrack-pack-fail-test-'));
  try {
    await assert.rejects(() => packAndVerify(scratch), /bun pm pack failed/);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
