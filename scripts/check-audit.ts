import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** One advisory from `bun audit --json`, identified by its package and advisory URL. */
export interface Advisory {
  readonly packageName: string;
  readonly url: string;
  readonly title: string;
  readonly severity: string;
}

export interface AuditCheckOptions {
  /** `[]` for a full audit, or `['--base', <commit>]` for a diff audit. */
  readonly args: readonly string[];
  /** The checkout whose package.json and bun.lock are audited. */
  readonly cwd: string;
  /** The Bun executable that runs `audit`; tests substitute a stand-in. */
  readonly runtime?: string;
  readonly log?: (line: string) => void;
}

interface Captured {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * `process.env` without the variables `git rev-parse --local-env-vars` lists.
 * Git exports GIT_DIR and the rest to hooks; a hook run from a linked worktree
 * gets an absolute GIT_DIR, which makes git ignore `cwd` and read that repository.
 */
export function withoutGitRepositoryEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  const names = Bun.spawnSync(['git', 'rev-parse', '--local-env-vars']).stdout.toString();
  for (const name of names.split('\n')) delete env[name];
  return env;
}

async function capture(
  command: readonly string[],
  cwd: string,
  env?: Record<string, string | undefined>,
): Promise<Captured> {
  const child = Bun.spawn([...command], { cwd, env, stdout: 'pipe', stderr: 'pipe' });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

/** Run git on the repository at `cwd`, even under a hook that set GIT_DIR. */
function captureGit(args: readonly string[], cwd: string): Promise<Captured> {
  return capture(['git', ...args], cwd, withoutGitRepositoryEnv());
}

/** Parse `bun audit --json`: an object that maps package names to advisory lists. */
export function parseAuditReport(stdout: string): Advisory[] {
  let report: unknown;
  try {
    report = JSON.parse(stdout);
  } catch {
    throw new Error('bun audit did not print a JSON report');
  }
  if (report === null || typeof report !== 'object' || Array.isArray(report)) {
    throw new Error('bun audit did not print a JSON object');
  }
  return Object.entries(report).flatMap(([packageName, entries]) => {
    if (!Array.isArray(entries)) {
      throw new Error(`bun audit listed ${packageName} without an advisory array`);
    }
    return entries.map((entry: Record<string, unknown>) => {
      const url =
        typeof entry.url === 'string' && entry.url !== '' ? entry.url : String(entry.id ?? '');
      if (url === '') {
        throw new Error(`bun audit listed an advisory for ${packageName} without a url or id`);
      }
      return {
        packageName,
        url,
        title: typeof entry.title === 'string' ? entry.title : '',
        severity: typeof entry.severity === 'string' ? entry.severity : 'unknown',
      };
    });
  });
}

const advisoryKey = (advisory: Advisory): string => `${advisory.packageName} ${advisory.url}`;

/** The advisories present at head but not at base. */
export function introducedAdvisories(
  head: readonly Advisory[],
  base: readonly Advisory[],
): Advisory[] {
  const known = new Set(base.map(advisoryKey));
  return head.filter((advisory) => !known.has(advisoryKey(advisory)));
}

/**
 * Audit the package.json and bun.lock in `cwd`. Bun exits 1 when it finds
 * advisories; any other failure, or output that is not a report, fails closed.
 */
async function auditDirectory(cwd: string, runtime: string): Promise<Advisory[]> {
  const { exitCode, stdout, stderr } = await capture([runtime, 'audit', '--json'], cwd);
  if (exitCode !== 0 && exitCode !== 1) {
    throw new Error(`bun audit failed with exit code ${exitCode}: ${stderr.trim()}`);
  }
  const advisories = parseAuditReport(stdout);
  if (exitCode === 1 && advisories.length === 0) {
    throw new Error(`bun audit exited 1 without reporting an advisory: ${stderr.trim()}`);
  }
  return advisories;
}

async function dependenciesChanged(base: string, cwd: string): Promise<boolean> {
  // `git diff --quiet` exits 0 when the files match base and 1 when they differ.
  const { exitCode, stderr } = await captureGit(
    ['diff', '--quiet', base, '--', 'package.json', 'bun.lock'],
    cwd,
  );
  if (exitCode !== 0 && exitCode !== 1) {
    throw new Error(`git diff against ${base} failed: ${stderr.trim()}`);
  }
  return exitCode === 1;
}

async function writeBaseManifests(base: string, cwd: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ontrack-audit-base-'));
  try {
    for (const file of ['package.json', 'bun.lock']) {
      const { exitCode, stdout, stderr } = await captureGit(['show', `${base}:${file}`], cwd);
      if (exitCode !== 0) {
        throw new Error(`git show ${base}:${file} failed: ${stderr.trim()}`);
      }
      await writeFile(join(directory, file), stdout);
    }
    return directory;
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

const plural = (count: number): string => `${count} ${count === 1 ? 'advisory' : 'advisories'}`;
const describe = (advisory: Advisory): string =>
  `${advisory.packageName}: ${advisory.severity} - ${advisory.title} (${advisory.url})`;

/** Run the audit gate and resolve to the process exit code: 0 passes, 1 fails. */
export async function runAuditCheck(options: AuditCheckOptions): Promise<number> {
  const { args, cwd } = options;
  const runtime = options.runtime ?? process.execPath;
  const log = options.log ?? ((line: string) => console.log(line));
  const base =
    args.length === 2 && args[0] === '--base' && args[1] !== '' && !args[1].startsWith('-')
      ? args[1]
      : undefined;
  if (args.length !== 0 && base === undefined) {
    throw new Error('usage: bun scripts/check-audit.ts [--base <commit>]');
  }

  if (base === undefined) {
    const advisories = await auditDirectory(cwd, runtime);
    if (advisories.length === 0) {
      log('bun audit: no advisories.');
      return 0;
    }
    log(`bun audit: ${plural(advisories.length)}:`);
    for (const advisory of advisories) log(`  ${describe(advisory)}`);
    return 1;
  }

  if (!(await dependenciesChanged(base, cwd))) {
    log(
      `SKIP: package.json and bun.lock match ${base}. ` +
        'The full audit on master, the daily schedule and release covers new advisories.',
    );
    return 0;
  }
  const baseDirectory = await writeBaseManifests(base, cwd);
  try {
    const [baseAdvisories, headAdvisories] = await Promise.all([
      auditDirectory(baseDirectory, runtime),
      auditDirectory(cwd, runtime),
    ]);
    const introduced = introducedAdvisories(headAdvisories, baseAdvisories);
    for (const advisory of headAdvisories) {
      if (!introduced.includes(advisory)) {
        log(`warning: inherited from ${base}: ${describe(advisory)}`);
      }
    }
    if (introduced.length === 0) {
      log('bun audit: this change introduces no advisories.');
      return 0;
    }
    log(`bun audit: this change introduces ${plural(introduced.length)}:`);
    for (const advisory of introduced) log(`  ${describe(advisory)}`);
    return 1;
  } finally {
    await rm(baseDirectory, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  runAuditCheck({ args: process.argv.slice(2), cwd: process.cwd() }).then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : 'dependency audit failed');
      process.exitCode = 2;
    },
  );
}
