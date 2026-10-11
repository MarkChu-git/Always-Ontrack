import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'bun:test';

const workflowRoot = new URL('../.github/workflows/', import.meta.url);

/** The `run: |` block of the named step, dedented. */
function stepScript(workflow: string, stepName: string): string {
  const step = workflow.indexOf(`- name: ${stepName}\n`);
  assert.notEqual(step, -1, `missing step: ${stepName}`);
  const marker = 'run: |\n';
  const runAt = workflow.indexOf(marker, step);
  assert.notEqual(runAt, -1, `step has no run block: ${stepName}`);
  const lines = workflow.slice(runAt + marker.length).split('\n');
  const indent = /^ */.exec(lines[0] ?? '')?.[0] ?? '';
  const body: string[] = [];
  for (const line of lines) {
    if (line.trim() !== '' && !line.startsWith(indent)) break;
    body.push(line.slice(indent.length));
  }
  return body.join('\n');
}

/** Run a step script as GitHub runs a step that sets no `shell:`: `bash -e`, without pipefail. */
async function runStep(
  script: string,
  env: Record<string, string>,
  cwd?: string,
): Promise<{ exitCode: number; stdout: string }> {
  const child = Bun.spawn(['bash', '-e', '-c', script], {
    cwd,
    env: { PATH: process.env.PATH ?? '', ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [exitCode, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()]);
  return { exitCode, stdout };
}

/** The lines of one job, from its key to the next job key. */
function jobBlock(workflow: string, job: string): string {
  const lines = workflow.split('\n');
  const start = lines.indexOf(`  ${job}:`);
  assert.notEqual(start, -1, `missing job: ${job}`);
  const end = lines.findIndex((line, index) => index > start && /^  [a-z][a-z0-9-]*:$/.test(line));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

/** The ids of every job in a workflow. */
function jobIds(workflow: string): string[] {
  const lines = workflow.split('\n');
  return lines
    .slice(lines.indexOf('jobs:') + 1)
    .flatMap((line) => /^  ([a-z][a-z0-9-]*):$/.exec(line)?.[1] ?? []);
}

test('CI never uploads an unverified package from a failed job', async () => {
  const workflow = await readFile(new URL('ci.yml', workflowRoot), 'utf8');
  const upload = 'uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a';
  assert.equal(workflow.split(upload).length, 3);

  const testJob = jobBlock(workflow, 'test');
  assert.match(testJob, /upload-artifact[\s\S]*if: always\(\)[\s\S]*coverage\/lcov\.info/);
  assert.doesNotMatch(testJob, /artifacts\/\*\.tgz/);

  const packageJob = jobBlock(workflow, 'package');
  assert.match(packageJob, /artifacts\/\*\.tgz[\s\S]*if-no-files-found: error/);
  assert.doesNotMatch(packageJob, /if: always\(\)/);
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

test('release waits for npm to finish a publish before checking the registry', async () => {
  const workflow = await readFile(new URL('release.yml', workflowRoot), 'utf8');
  const script = stepScript(workflow, 'Verify artifact checksum and registry integrity');
  const root = await mkdtemp(join(tmpdir(), 'ontrack-release-registry-'));
  try {
    const tarball = 'ontrack-cli-9.9.9.tgz';
    const bytes = 'verified tarball';
    await mkdir(join(root, 'artifacts'));
    await writeFile(join(root, 'artifacts', tarball), bytes);
    await writeFile(
      join(root, 'artifacts', `${tarball}.sha256`),
      `${createHash('sha256').update(bytes).digest('hex')}  ${tarball}\n`,
    );
    const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
    const fakeBin = join(root, 'bin');
    await mkdir(fakeBin);
    // Stands in for npm: `view` fails as it does while npm is still processing
    // a publish for the first PENDING_READS calls, then prints the metadata.
    await writeFile(
      join(fakeBin, 'npm'),
      `#!/bin/sh
reads=$(($(cat "$STATE/reads" 2>/dev/null || echo 0) + 1))
echo "$reads" > "$STATE/reads"
if [ "$reads" -le "$PENDING_READS" ]; then
  echo "npm error 404 No match found for version 9.9.9" >&2
  exit 1
fi
printf '{"name":"ontrack-cli","version":"9.9.9","dist.integrity":"%s"}\\n' "$REGISTRY_INTEGRITY"
`,
    );
    // Records each wait instead of waiting.
    await writeFile(join(fakeBin, 'sleep'), '#!/bin/sh\necho "$1" >> "$STATE/sleeps"\n');
    await chmod(join(fakeBin, 'npm'), 0o755);
    await chmod(join(fakeBin, 'sleep'), 0o755);

    const verifyRegistry = async (pendingReads: number, registryIntegrity: string) => {
      const state = await mkdtemp(join(root, 'state-'));
      const { exitCode } = await runStep(
        script,
        {
          PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
          STATE: state,
          PENDING_READS: String(pendingReads),
          REGISTRY_INTEGRITY: registryIntegrity,
          PACKAGE_NAME: 'ontrack-cli',
          VERSION: '9.9.9',
          TARBALL: tarball,
          MANIFEST: `${tarball}.sha256`,
          PUBLISH_TO_NPM: 'true',
        },
        root,
      );
      const sleeps = await readFile(join(state, 'sleeps'), 'utf8').catch(() => '');
      return { exitCode, sleeps: sleeps.split('\n').filter(Boolean).map(Number) };
    };

    // The version appears on the fifth read, a minute after the first.
    assert.deepEqual(await verifyRegistry(4, integrity), { exitCode: 0, sleeps: [15, 15, 15, 15] });
    // A version with other bytes fails at once instead of waiting.
    assert.deepEqual(await verifyRegistry(0, 'sha512-other'), { exitCode: 1, sleeps: [] });
    // A version that never appears fails after 10 minutes, inside the job's timeout.
    const missing = await verifyRegistry(1000, integrity);
    assert.equal(missing.exitCode, 1);
    assert.equal(missing.sleeps.reduce((total, seconds) => total + seconds, 0), 600);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('verify runs every release gate in order', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { scripts: Record<string, string> };
  const chain = (scripts: readonly string[]): string =>
    scripts.map((script) => `bun run ${script}`).join(' && ');

  assert.equal(manifest.scripts['verify:fast'], 'bun run typecheck && bun run typecheck:tui && bun test');
  assert.equal(
    manifest.scripts.verify,
    chain([
      'skills:check',
      'typecheck',
      'typecheck:tui',
      'test:coverage',
      'test:tui',
      'build',
      'smoke:dist',
      'package:verify',
    ]),
  );
  assert.equal(
    manifest.scripts['verify:graph'],
    chain(['gitnexus:analyze', 'gitnexus:status', 'gitnexus:check', 'gitnexus:mcp:check']),
  );
});

test('the Verify Bun CLI gate always runs and needs every other CI job', async () => {
  const workflow = await readFile(new URL('ci.yml', workflowRoot), 'utf8');
  const gate = jobBlock(workflow, 'gate');
  assert.match(gate, /\n    name: Verify Bun CLI\n/);
  assert.match(gate, /\n    if: always\(\)\n/);
  const needs = /needs: \[([^\]]*)\]/.exec(gate)?.[1]?.split(',').map((job) => job.trim()) ?? [];
  assert.deepEqual(
    [...needs].sort(),
    jobIds(workflow)
      .filter((job) => job !== 'gate')
      .sort(),
  );
});

test('the gate fails unless every needed job succeeded', async () => {
  const workflow = await readFile(new URL('ci.yml', workflowRoot), 'utf8');
  const script = stepScript(workflow, 'Require every CI job to succeed');
  const succeeded = Array.from({ length: 6 }, () => 'success').join(' ');
  assert.equal((await runStep(script, { RESULTS: succeeded })).exitCode, 0);
  for (const results of [
    'success failure success success success success',
    'success skipped success success success success',
    'cancelled success success success success success',
    '',
  ]) {
    assert.equal((await runStep(script, { RESULTS: results })).exitCode, 1, `results: "${results}"`);
  }
});

test('CI audits a pull request against its base and every other event in full', async () => {
  const workflow = await readFile(new URL('ci.yml', workflowRoot), 'utf8');
  const script = stepScript(workflow, 'Audit dependencies');
  const fakeBin = await mkdtemp(join(tmpdir(), 'ontrack-ci-audit-'));
  try {
    await writeFile(join(fakeBin, 'bun'), '#!/bin/sh\necho "bun $*"\n');
    await chmod(join(fakeBin, 'bun'), 0o755);
    const PATH = `${fakeBin}:${process.env.PATH ?? ''}`;
    assert.equal(
      (await runStep(script, { PATH, BASE_SHA: 'abc123' })).stdout.trim(),
      'bun run audit:check --base abc123',
    );
    assert.equal((await runStep(script, { PATH, BASE_SHA: '' })).stdout.trim(), 'bun run audit:check');
  } finally {
    await rm(fakeBin, { recursive: true, force: true });
  }
});

test('every workflow installs from the lockfile without lifecycle scripts', async () => {
  // The root prepare script runs a full build, and release must build only once.
  const installs: string[] = [];
  for (const name of await readdir(workflowRoot)) {
    const workflow = await readFile(new URL(name, workflowRoot), 'utf8');
    for (const install of workflow.match(/bun install(?! -g)[^\n]*/g) ?? []) {
      installs.push(`${name}: ${install}`);
      assert.match(install, /^bun install --frozen-lockfile --ignore-scripts$/, `${name}: ${install}`);
    }
  }
  assert.ok(installs.length >= 6, installs.join('\n'));
});

test('CI runs the package scripts instead of inline gates', async () => {
  const workflow = await readFile(new URL('ci.yml', workflowRoot), 'utf8');
  for (const script of [
    'skills:check',
    'typecheck',
    'typecheck:tui',
    'test:coverage',
    'test:tui',
    'build',
    'smoke:dist',
    'package:verify',
    'verify:graph',
  ]) {
    assert.match(workflow, new RegExp(`bun run ${script}\\n`), script);
  }
  assert.doesNotMatch(workflow, /bun dist\/cli\.js/);
  assert.doesNotMatch(workflow, /tags:/);
});

test('release verifies the tag with the package scripts before recording its checksum', async () => {
  const workflow = await readFile(new URL('release.yml', workflowRoot), 'utf8');
  const job = jobBlock(workflow, 'validate-and-pack');
  assert.match(
    job,
    /PACKAGE_OUTPUT_DIR: artifacts\n\s+run: \|\n\s+bun run verify\n\s+bun run verify:graph\n\s+bun run audit:check\n/,
  );
  assert.ok(job.indexOf('bun run audit:check') < job.indexOf('sha256sum "$TARBALL" > "$MANIFEST"'));
});

test('release never reads the Actions cache', async () => {
  const workflow = await readFile(new URL('release.yml', workflowRoot), 'utf8');
  assert.doesNotMatch(workflow, /actions\/cache@/);
  assert.match(jobBlock(workflow, 'validate-and-pack'), /no-cache: true/);
});

test('release attests the verified tarball before creating the draft', async () => {
  const workflow = await readFile(new URL('release.yml', workflowRoot), 'utf8');
  const job = jobBlock(workflow, 'create-draft-release');
  assert.match(job, /id-token: write/);
  assert.match(job, /attestations: write/);
  const checksum = job.indexOf('sha256sum --check "$MANIFEST"');
  const attest = job.indexOf(
    'uses: actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6 # v4.2.2',
  );
  const draft = job.indexOf('gh release create');
  assert.ok(checksum !== -1 && checksum < attest && attest < draft);
  assert.doesNotMatch(jobBlock(workflow, 'validate-and-pack'), /id-token|attestations/);
});

test('release accepts only strict vMAJOR.MINOR.PATCH tags', async () => {
  const workflow = await readFile(new URL('release.yml', workflowRoot), 'utf8');
  const script = stepScript(workflow, 'Validate untrusted tag input format');
  assert.equal((await runStep(script, { TAG: 'v3.0.0', GITHUB_REF: 'refs/tags/v3.0.0' })).exitCode, 0);
  for (const tag of ['v3.0.0x', 'v03.0.0', 'v3.0', '3.0.0', 'v3.0.0-rc.1', 'v3.0.0\nv9.9.9', '']) {
    const run = await runStep(script, { TAG: tag, GITHUB_REF: `refs/tags/${tag}` });
    assert.equal(run.exitCode, 1, `tag: ${JSON.stringify(tag)}`);
  }
});

test('release refuses a run dispatched from anywhere but the tag it releases', async () => {
  const workflow = await readFile(new URL('release.yml', workflowRoot), 'utf8');
  const script = stepScript(workflow, 'Validate untrusted tag input format');
  // The build provenance names the run's ref and commit, so a retry
  // dispatched from master would attest master instead of the tag it built.
  for (const ref of ['refs/heads/master', 'refs/tags/v2.4.0', '']) {
    assert.equal((await runStep(script, { TAG: 'v3.0.0', GITHUB_REF: ref })).exitCode, 1, `ref: ${ref}`);
  }
});
