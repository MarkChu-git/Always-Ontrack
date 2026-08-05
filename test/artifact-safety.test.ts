import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { chmod, link, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  findExternalArtifactPaths,
  inspectUploadFile,
  readUploadFile,
  writeArtifactFile,
} from '../src/lib/artifact-safety.js';

test('guided artifact paths identify only workspace-external inputs', async () => {
  const root = await mkdtemp(join(process.cwd(), 'ontrack-artifact-boundary-'));
  try {
    assert.deepEqual(
      findExternalArtifactPaths(
        ['report.pdf', join(root, 'nested', 'evidence.zip'), join(root, '..', 'outside.pdf')],
        root,
      ),
      [join(root, '..', 'outside.pdf')],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('upload artifacts stay inside the workspace, reject symlinks, and are size bounded', async () => {
  const root = await mkdtemp(join(process.cwd(), 'ontrack-artifact-root-'));
  const outside = await mkdtemp(join(process.cwd(), 'ontrack-artifact-outside-'));
  try {
    await writeFile(join(root, 'report.pdf'), 'pdf');
    await writeFile(join(outside, 'secret.pdf'), 'secret');
    await symlink(join(outside, 'secret.pdf'), join(root, 'linked.pdf'));
    await link(join(outside, 'secret.pdf'), join(root, 'hard-linked.pdf'));

    const inspected = await inspectUploadFile('report.pdf', { root, maxBytes: 3 });
    assert.equal(inspected.filename, 'report.pdf');
    assert.equal(inspected.size, 3);
    assert.deepEqual(await readUploadFile(inspected, { maxBytes: 3 }), Buffer.from('pdf'));

    await assert.rejects(
      () => inspectUploadFile('../ontrack-artifact-outside-missing/secret.pdf', { root }),
      /workspace boundary/,
    );
    await assert.rejects(
      () => inspectUploadFile('linked.pdf', { root }),
      /symbolic link/,
    );
    await assert.rejects(
      () => inspectUploadFile('hard-linked.pdf', { root }),
      /hard link/,
    );
    await assert.rejects(
      () => inspectUploadFile('report.pdf', { root, maxBytes: 2 }),
      /maximum allowed size/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('PDF artifacts reject unsafe directories and destination traversal', async () => {
  const root = await mkdtemp(join(process.cwd(), 'ontrack-artifact-output-'));
  const outside = await mkdtemp(join(process.cwd(), 'ontrack-artifact-output-outside-'));
  try {
    const path = await writeArtifactFile(Buffer.from('%PDF'), 'task.pdf', {
      root,
      outDir: 'downloads',
    });
    assert.equal(await readFile(path, 'utf8'), '%PDF');
    await chmod(path, 0o644);
    await writeArtifactFile(Buffer.from('%PDF-2'), 'task.pdf', {
      root,
      outDir: 'downloads',
    });
    assert.equal((await stat(path)).mode & 0o777, 0o600);

    await assert.rejects(
      () => writeArtifactFile(Buffer.from('x'), '../escape.pdf', { root, outDir: 'downloads' }),
      /filename|destination/,
    );
    await assert.rejects(
      () => writeArtifactFile(Buffer.from('x'), 'outside.pdf', { root, outDir: outside }),
      /workspace boundary/,
    );
    const explicitlyAllowed = await writeArtifactFile(
      Buffer.from('external'),
      'external.pdf',
      { root, outDir: join(outside, 'new-output'), allowExternal: true },
    );
    assert.equal(await readFile(explicitlyAllowed, 'utf8'), 'external');

    await mkdir(join(root, 'real'), { recursive: true });
    await symlink(join(root, 'real'), join(root, 'linked-dir'));
    await assert.rejects(
      () => writeArtifactFile(Buffer.from('x'), 'linked.pdf', { root, outDir: 'linked-dir' }),
      /symbolic link/,
    );

    await mkdir(join(root, 'protected-output'), { recursive: true });
    await writeFile(join(root, 'protected.pdf'), 'protected');
    await link(
      join(root, 'protected.pdf'),
      join(root, 'protected-output', 'task.pdf'),
    );
    await assert.rejects(
      () => writeArtifactFile(Buffer.from('replacement'), 'task.pdf', {
        root,
        outDir: 'protected-output',
      }),
      /hard link/,
    );
    assert.equal(await readFile(join(root, 'protected.pdf'), 'utf8'), 'protected');
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('explicit external access still rejects parent symbolic-link components', async () => {
  const root = await mkdtemp(join(process.cwd(), 'ontrack-artifact-external-root-'));
  const outside = await mkdtemp(join(process.cwd(), 'ontrack-artifact-external-target-'));
  const linkParent = await mkdtemp(join(process.cwd(), 'ontrack-artifact-external-link-'));
  try {
    await writeFile(join(outside, 'secret.pdf'), 'secret');
    await symlink(outside, join(linkParent, 'linked'));

    await assert.rejects(
      () => inspectUploadFile(join(linkParent, 'linked', 'secret.pdf'), {
        root,
        allowExternal: true,
      }),
      /symbolic link/,
    );
    await assert.rejects(
      () => writeArtifactFile(Buffer.from('x'), 'output.pdf', {
        root,
        outDir: join(linkParent, 'linked', 'downloads'),
        allowExternal: true,
      }),
      /symbolic link/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
    await rm(linkParent, { recursive: true, force: true });
  }
});

test('explicit external access accepts platform temporary-directory aliases', async () => {
  const root = await mkdtemp(join(process.cwd(), 'ontrack-artifact-alias-root-'));
  const externalRoot = await mkdtemp(join(tmpdir(), 'ontrack-artifact-alias-external-'));
  try {
    const inputPath = join(externalRoot, 'input.pdf');
    await writeFile(inputPath, 'input');
    assert.equal(
      (await inspectUploadFile(inputPath, { root, allowExternal: true })).size,
      5,
    );

    const outputPath = await writeArtifactFile(Buffer.from('output'), 'output.pdf', {
      root,
      outDir: join(externalRoot, 'downloads'),
      allowExternal: true,
    });
    assert.equal(await readFile(outputPath, 'utf8'), 'output');
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(externalRoot, { recursive: true, force: true });
  }
});
