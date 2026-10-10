import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'bun:test';
import {
  introducedAdvisories,
  parseAuditReport,
  runAuditCheck,
  withoutGitRepositoryEnv,
  type Advisory,
} from '../scripts/check-audit.ts';

// What Bun 1.3.14 prints for `bun audit --json` (captured 2026-10-09).
const sdkReport = {
  '@modelcontextprotocol/sdk': [
    {
      id: 1241339,
      url: 'https://github.com/advisories/GHSA-6qxp-vccf-f47h',
      title:
        'MCP TypeScript SDK: OAuth client could send credentials to an authorization server chosen by the MCP server',
      severity: 'high',
      vulnerable_versions: '>=1.12.0 <1.31.0',
      cwe: ['CWE-345', 'CWE-522'],
      cvss: { score: 7.5, vectorString: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N' },
    },
  ],
};
const honoReport = {
  hono: [
    {
      id: 1100001,
      url: 'https://github.com/advisories/GHSA-hono-test-0001',
      title: 'Hono test advisory',
      severity: 'moderate',
      vulnerable_versions: '<4.12.0',
    },
  ],
};

// Stands in for `bun`: `audit --json` prints the audited directory's bun.lock
// as the report, so each test picks its base and head reports.
const reportingAudit = `#!/bin/sh
[ "$1 $2" = "audit --json" ] || exit 64
cat bun.lock
[ "$(cat bun.lock)" = '{}' ] && exit 0
exit 1
`;

interface AuditFixture {
  readonly root: string;
  readonly base: string;
  readonly runtime: string;
}

// Under a hook, git's own GIT_DIR would point `git init` at the hook's repository,
// where it can set core.bare = true for every checkout.
async function git(cwd: string, args: readonly string[]): Promise<string> {
  const child = Bun.spawn(
    ['git', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args],
    { cwd, env: withoutGitRepositoryEnv(), stdout: 'pipe', stderr: 'pipe' },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  assert.equal(exitCode, 0, stderr);
  return stdout.trim();
}

/** A checkout whose committed bun.lock is the base report and whose working tree holds the head. */
async function withAuditFixture(
  reports: { readonly base: object; readonly head: object | string },
  run: (fixture: AuditFixture) => Promise<void>,
  runtimeSource = reportingAudit,
): Promise<void> {
  const scratch = await mkdtemp(join(tmpdir(), 'ontrack-audit-test-'));
  try {
    const root = join(scratch, 'repo');
    await mkdir(root);
    await writeFile(join(root, 'package.json'), '{"name":"audit-fixture"}');
    await writeFile(join(root, 'bun.lock'), JSON.stringify(reports.base));
    await git(root, ['init', '--quiet']);
    await git(root, ['add', 'package.json', 'bun.lock']);
    await git(root, [
      '-c', 'user.name=Audit Test',
      '-c', 'user.email=audit@example.com',
      'commit', '--quiet', '-m', 'base',
    ]);
    const base = await git(root, ['rev-parse', 'HEAD']);
    const head =
      typeof reports.head === 'string' ? reports.head : JSON.stringify(reports.head, null, 2);
    await writeFile(join(root, 'bun.lock'), head);
    const runtime = join(scratch, 'fake-bun');
    await writeFile(runtime, runtimeSource);
    await chmod(runtime, 0o755);
    await run({ root, base, runtime });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

async function check(fixture: AuditFixture, args: readonly string[]): Promise<{ exitCode: number; output: string }> {
  const lines: string[] = [];
  const exitCode = await runAuditCheck({
    args,
    cwd: fixture.root,
    runtime: fixture.runtime,
    log: (line) => lines.push(line),
  });
  return { exitCode, output: lines.join('\n') };
}

test('parseAuditReport reads the report Bun 1.3.14 prints', () => {
  assert.deepEqual(parseAuditReport(JSON.stringify(sdkReport)), [
    {
      packageName: '@modelcontextprotocol/sdk',
      url: 'https://github.com/advisories/GHSA-6qxp-vccf-f47h',
      title:
        'MCP TypeScript SDK: OAuth client could send credentials to an authorization server chosen by the MCP server',
      severity: 'high',
    },
  ]);
  assert.deepEqual(parseAuditReport('{}'), []);
});

test('parseAuditReport rejects output that is not a report', () => {
  assert.throws(() => parseAuditReport('error: registry unreachable'), /did not print a JSON report/);
  assert.throws(() => parseAuditReport('[]'), /did not print a JSON object/);
  assert.throws(() => parseAuditReport('{"zod": 1}'), /without an advisory array/);
});

test('introducedAdvisories keys advisories by package and advisory URL', () => {
  const advisory = (packageName: string, url: string): Advisory => ({
    packageName,
    url,
    title: '',
    severity: 'high',
  });
  const base = [advisory('qs', 'https://github.com/advisories/GHSA-1')];
  const head = [
    advisory('qs', 'https://github.com/advisories/GHSA-1'),
    advisory('express', 'https://github.com/advisories/GHSA-1'),
    advisory('qs', 'https://github.com/advisories/GHSA-2'),
  ];

  assert.deepEqual(introducedAdvisories(head, base), head.slice(1));
});

test('the full audit passes a clean lockfile', async () => {
  await withAuditFixture({ base: {}, head: '{}' }, async (fixture) => {
    assert.deepEqual(await check(fixture, []), {
      exitCode: 0,
      output: 'bun audit: no advisories.',
    });
  });
});

test('the full audit fails and lists every advisory', async () => {
  await withAuditFixture({ base: {}, head: JSON.stringify(sdkReport) }, async (fixture) => {
    const result = await check(fixture, []);
    assert.equal(result.exitCode, 1);
    assert.match(result.output, /bun audit: 1 advisory:/);
    assert.match(result.output, /GHSA-6qxp-vccf-f47h/);
  });
});

test('the diff audit skips without calling bun audit when dependencies match the base', async () => {
  const neverAudits = '#!/bin/sh\necho "bun audit must not run" >&2\nexit 70\n';
  await withAuditFixture(
    { base: sdkReport, head: JSON.stringify(sdkReport) },
    async (fixture) => {
      const result = await check(fixture, ['--base', fixture.base]);
      assert.equal(result.exitCode, 0);
      assert.match(result.output, /^SKIP: package\.json and bun\.lock match /);
    },
    neverAudits,
  );
});

test('the diff audit passes advisories the change inherits from its base', async () => {
  await withAuditFixture({ base: sdkReport, head: sdkReport }, async (fixture) => {
    const result = await check(fixture, ['--base', fixture.base]);
    assert.equal(result.exitCode, 0);
    assert.match(result.output, /warning: inherited from [0-9a-f]+: @modelcontextprotocol\/sdk/);
    assert.match(result.output, /this change introduces no advisories/);
  });
});

test('the diff audit fails on an advisory the change introduces', async () => {
  await withAuditFixture(
    { base: sdkReport, head: { ...sdkReport, ...honoReport } },
    async (fixture) => {
      const result = await check(fixture, ['--base', fixture.base]);
      assert.equal(result.exitCode, 1);
      assert.match(result.output, /this change introduces 1 advisory:/);
      assert.match(result.output, /hono: moderate - Hono test advisory/);
    },
  );
});

test('the diff audit reads the checkout at cwd when a git hook exports GIT_DIR', async () => {
  // A hook run from a linked worktree gets GIT_DIR from git. Bun.spawn ignores
  // later process.env edits, so only a fresh process starts with it set.
  await withAuditFixture({ base: sdkReport, head: sdkReport }, async (fixture) => {
    const script = join(import.meta.dir, '..', 'scripts', 'check-audit.ts');
    const child = Bun.spawn(
      [
        process.execPath,
        '-e',
        `import { runAuditCheck } from ${JSON.stringify(script)};
process.exitCode = await runAuditCheck({
  args: ['--base', ${JSON.stringify(fixture.base)}],
  cwd: process.cwd(),
  runtime: ${JSON.stringify(fixture.runtime)},
});`,
      ],
      {
        cwd: fixture.root,
        env: { ...process.env, GIT_DIR: join(fixture.root, 'hook-repository') },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    assert.equal(exitCode, 0, stderr);
    assert.match(stdout, /this change introduces no advisories/);
  });
});

test('the audit fails closed when bun audit cannot run', async () => {
  const brokenAudit = '#!/bin/sh\necho "error: registry unreachable" >&2\nexit 2\n';
  await withAuditFixture(
    { base: {}, head: '{}' },
    async (fixture) => {
      await assert.rejects(() => check(fixture, []), /exit code 2: error: registry unreachable/);
    },
    brokenAudit,
  );
});

test('the audit fails closed on output that is not a report', async () => {
  await withAuditFixture({ base: {}, head: 'error: registry unreachable' }, async (fixture) => {
    await assert.rejects(() => check(fixture, []), /did not print a JSON report/);
  });
});

test('the audit fails closed when bun audit exits 1 without an advisory', async () => {
  const emptyFailure = '#!/bin/sh\necho "{}"\nexit 1\n';
  await withAuditFixture(
    { base: {}, head: '{}' },
    async (fixture) => {
      await assert.rejects(() => check(fixture, []), /exited 1 without reporting an advisory/);
    },
    emptyFailure,
  );
});

test('runAuditCheck rejects malformed arguments', async () => {
  for (const args of [['--base'], ['--bas', 'abc'], ['--base', '--other'], ['--base', '']]) {
    await assert.rejects(
      () => runAuditCheck({ args, cwd: process.cwd(), log: () => undefined }),
      /usage:/,
      JSON.stringify(args),
    );
  }
});
