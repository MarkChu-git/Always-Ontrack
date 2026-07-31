import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'bun:test';

const workflowRoot = new URL('../.github/workflows/', import.meta.url);

test('CI never uploads an unverified package from a failed job', async () => {
  const workflow = await readFile(new URL('ci.yml', workflowRoot), 'utf8');
  const uploadBlocks = workflow.split(
    'uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
  );

  assert.equal(uploadBlocks.length, 3);
  assert.match(uploadBlocks[1], /if: always\(\)[\s\S]*coverage\/lcov\.info/);
  assert.doesNotMatch(uploadBlocks[1], /artifacts\/\*\.tgz/);
  assert.match(uploadBlocks[2], /artifacts\/\*\.tgz[\s\S]*if-no-files-found: error/);
  assert.doesNotMatch(uploadBlocks[2], /if: always\(\)/);
});

test('release validates the exact single draft asset before reuse and publication', async () => {
  const workflow = await readFile(new URL('release.yml', workflowRoot), 'utf8');

  assert.equal((workflow.match(/GH_REPO: \$\{\{ github\.repository \}\}/g) ?? []).length, 2);
  assert.equal((workflow.match(/\.assets \| length/g) ?? []).length, 2);
  assert.equal((workflow.match(/\.assets\[0\]\.name/g) ?? []).length, 2);
  assert.equal((workflow.match(/gh release download "\$TAG"/g) ?? []).length, 2);
  assert.match(
    workflow,
    /Publish the approved draft GitHub Release[\s\S]*sha256sum[\s\S]*gh release edit "\$TAG" --draft=false/,
  );
});

test('CI and release reject modified or unpinned project skills', async () => {
  const [ciWorkflow, releaseWorkflow] = await Promise.all([
    readFile(new URL('ci.yml', workflowRoot), 'utf8'),
    readFile(new URL('release.yml', workflowRoot), 'utf8'),
  ]);

  assert.match(
    ciWorkflow,
    /Verify pinned project skills[\s\S]*bun run skills:check[\s\S]*bun run typecheck/,
  );
  assert.match(
    releaseWorkflow,
    /Typecheck, test, audit, and build[\s\S]*bun run skills:check[\s\S]*bun run typecheck/,
  );
});
