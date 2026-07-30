import { lstat, mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';

const packagePrefix = 'package/';
const requiredEntries = [
  'package/package.json',
  'package/LICENSE',
  'package/README.md',
  'package/README.zh-CN.md',
  'package/dist/cli.js',
] as const;

export interface PackageVerification {
  entries: string[];
  cliOutput: string;
}

function isSafeEntry(entry: string): boolean {
  const normalized = entry.endsWith('/') ? entry.slice(0, -1) : entry;
  if (!normalized || normalized.includes('\0') || normalized.includes('\\') || isAbsolute(normalized)) {
    return false;
  }
  return normalized.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function isAllowedEntry(entry: string): boolean {
  const normalized = entry.endsWith('/') ? entry.slice(0, -1) : entry;
  if (entry.endsWith('/')) {
    return normalized === 'package' || normalized === 'package/dist' || normalized.startsWith('package/dist/');
  }
  return (
    normalized === 'package/package.json' ||
    normalized === 'package/LICENSE' ||
    normalized === 'package/README.md' ||
    normalized === 'package/README.zh-CN.md' ||
    /^package\/dist\/(?:[^/]+\/)*[^/]+\.js$/u.test(normalized)
  );
}

export function validateTarEntries(entries: readonly string[]): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!isSafeEntry(entry)) {
      throw new Error(`unsafe tar entry: ${entry}`);
    }
    if (!entry.startsWith(packagePrefix) || !isAllowedEntry(entry)) {
      throw new Error(`tar entry is not allowed: ${entry}`);
    }
    if (seen.has(entry)) {
      throw new Error(`tar entry is duplicated: ${entry}`);
    }
    seen.add(entry);
  }

  for (const requiredEntry of requiredEntries) {
    if (!seen.has(requiredEntry)) {
      throw new Error(`tarball is missing required entry: ${requiredEntry}`);
    }
  }

  if (![...seen].some((entry) => entry.startsWith('package/dist/lib/'))) {
    throw new Error('tarball is missing compiled runtime modules under package/dist/lib');
  }
}

/** Reject links and special files before extracting an untrusted package archive. */
export function validateTarEntryTypes(verboseEntries: readonly string[]): void {
  for (const entry of verboseEntries) {
    if (!entry.trim()) {
      continue;
    }
    const type = entry[0];
    if (type !== '-' && type !== 'd') {
      throw new Error(`unsupported tar entry type "${type}"`);
    }
  }
}

async function run(command: string[], cwd?: string): Promise<{ stdout: string; stderr: string }> {
  const processResult = Bun.spawn(command, { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [exitCode, stdout, stderr] = await Promise.all([
    processResult.exited,
    new Response(processResult.stdout).text(),
    new Response(processResult.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`${command[0]} failed with exit code ${exitCode}: ${stderr.trim()}`);
  }
  return { stdout, stderr };
}

function assertChildPath(parent: string, child: string): void {
  const pathToChild = relative(parent, child);
  if (pathToChild === '' || pathToChild.startsWith('..') || isAbsolute(pathToChild)) {
    throw new Error('packed CLI resolves outside the isolated package directory');
  }
}

async function assertRegularTree(root: string): Promise<void> {
  const metadata = await lstat(root);
  if (!metadata.isDirectory() && !metadata.isFile()) {
    throw new Error('packed archive contains a link or special file');
  }
  if (!metadata.isDirectory()) {
    return;
  }
  const children = await readdir(root);
  await Promise.all(children.map((child) => assertRegularTree(join(root, child))));
}

export async function verifyPackageTarball(tarballPath: string): Promise<PackageVerification> {
  const resolvedTarball = resolve(tarballPath);
  if (!resolvedTarball.endsWith('.tgz')) {
    throw new Error('package verification accepts only .tgz tarballs');
  }

  const verboseListing = await run(['tar', '-tvzf', resolvedTarball]);
  validateTarEntryTypes(verboseListing.stdout.split(/\r?\n/u));
  const listing = await run(['tar', '-tzf', resolvedTarball]);
  const archiveEntries = listing.stdout.split(/\r?\n/u).filter(Boolean);
  validateTarEntries(archiveEntries);
  const entries = archiveEntries.filter((entry) => !entry.endsWith('/'));

  const extractionRoot = await mkdtemp(join(tmpdir(), 'ontrack-package-verify-'));
  try {
    await run(['tar', '-xzf', resolvedTarball, '-C', extractionRoot]);
    await assertRegularTree(extractionRoot);
    const packageRoot = await realpath(join(extractionRoot, 'package'));
    const cliPath = await realpath(join(packageRoot, 'dist', 'cli.js'));
    assertChildPath(packageRoot, cliPath);
    const cli = await run([process.execPath, cliPath, '--help'], packageRoot);
    return { entries, cliOutput: `${cli.stdout}${cli.stderr}` };
  } finally {
    await rm(extractionRoot, { recursive: true, force: true });
  }
}

async function main(args: string[]): Promise<void> {
  if (args.length !== 1) {
    throw new Error('usage: bun scripts/verify-package.ts <package.tgz>');
  }
  const result = await verifyPackageTarball(args[0]);
  console.log(`Verified ${result.entries.length} package files and packed CLI help output.`);
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Package verification failed');
    process.exitCode = 1;
  });
}
