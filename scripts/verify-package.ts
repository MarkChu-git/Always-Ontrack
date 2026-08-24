import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const packagePrefix = 'package/';
const requiredEntries = [
  'package/package.json',
  'package/LICENSE',
  'package/README.md',
  'package/README.zh-CN.md',
  'package/dist/auth-mcp.js',
  'package/dist/cli.js',
  'package/dist/tui/index.js',
] as const;

export interface PackageVerification {
  entries: string[];
  cliOutput: string;
  authMcpVersion: string;
  tuiEntrypoint: 'runTui';
}

const authMcpSmokeTimeoutMs = 10_000;

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

async function withinDeadline<T>(operation: Promise<T>, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), authMcpSmokeTimeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function verifyInstalledAuthMcp(
  authMcpPath: string,
  packageRoot: string,
  expectedVersion: string,
): Promise<string> {
  const client = new Client({ name: 'ontrack-package-verifier', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [authMcpPath],
    cwd: packageRoot,
    stderr: 'pipe',
  });

  try {
    await withinDeadline(
      client.connect(transport),
      'packed Auth MCP did not initialize before the verification deadline',
    );
    const serverVersion = client.getServerVersion()?.version;
    if (serverVersion !== expectedVersion) {
      throw new Error('packed Auth MCP version does not match package.json');
    }
    return serverVersion;
  } finally {
    await withinDeadline(
      client.close().catch(() => undefined),
      'packed Auth MCP did not close before the verification deadline',
    );
  }
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
    const authMcpPath = await realpath(join(packageRoot, 'dist', 'auth-mcp.js'));
    assertChildPath(packageRoot, cliPath);
    assertChildPath(packageRoot, authMcpPath);
    const manifest = JSON.parse(
      await readFile(join(packageRoot, 'package.json'), 'utf8'),
    ) as {
      name?: unknown;
      version?: unknown;
      bin?: unknown;
    };
    if (
      manifest.name !== 'ontrack-cli' ||
      typeof manifest.version !== 'string' ||
      !manifest.bin ||
      typeof manifest.bin !== 'object' ||
      (manifest.bin as Record<string, unknown>).ontrack !== './dist/cli.js' ||
      (manifest.bin as Record<string, unknown>)['ontrack-auth-mcp'] !==
        './dist/auth-mcp.js'
    ) {
      throw new Error('packed manifest does not expose both expected executables');
    }
    const [cliMetadata, authMcpMetadata, authMcpSource] = await Promise.all([
      lstat(cliPath),
      lstat(authMcpPath),
      readFile(authMcpPath, 'utf8'),
    ]);
    if ((cliMetadata.mode & 0o111) === 0 || (authMcpMetadata.mode & 0o111) === 0) {
      throw new Error('packed executables are missing executable permission bits');
    }
    if (!authMcpSource.startsWith('#!/usr/bin/env bun')) {
      throw new Error('packed Auth MCP is missing its Bun executable entrypoint');
    }
    const installationRoot = join(extractionRoot, 'installation');
    await mkdir(installationRoot);
    await writeFile(
      join(installationRoot, 'package.json'),
      JSON.stringify({ private: true }),
      { mode: 0o600 },
    );
    await run(
      [process.execPath, 'install', '--production', '--ignore-scripts', '--no-save', resolvedTarball],
      installationRoot,
    );
    const installedPackageRoot = await realpath(
      join(installationRoot, 'node_modules', 'ontrack-cli'),
    );
    const installedCliPath = await realpath(
      join(installedPackageRoot, 'dist', 'cli.js'),
    );
    const installedAuthMcpPath = await realpath(
      join(installedPackageRoot, 'dist', 'auth-mcp.js'),
    );
    const installedTuiPath = await realpath(
      join(installedPackageRoot, 'dist', 'tui', 'index.js'),
    );
    assertChildPath(installedPackageRoot, installedCliPath);
    assertChildPath(installedPackageRoot, installedAuthMcpPath);
    assertChildPath(installedPackageRoot, installedTuiPath);
    const cli = await run([process.execPath, installedCliPath, '--help'], installedPackageRoot);
    const authMcpVersion = await verifyInstalledAuthMcp(
      installedAuthMcpPath,
      installedPackageRoot,
      manifest.version,
    );
    const tuiModule = (await import(pathToFileURL(installedTuiPath).href)) as {
      runTui?: unknown;
    };
    if (typeof tuiModule.runTui !== 'function') {
      throw new Error('packed TUI does not export runTui');
    }
    return {
      entries,
      cliOutput: `${cli.stdout}${cli.stderr}`,
      authMcpVersion,
      tuiEntrypoint: 'runTui',
    };
  } finally {
    await rm(extractionRoot, { recursive: true, force: true });
  }
}

async function main(args: string[]): Promise<void> {
  if (args.length !== 1) {
    throw new Error('usage: bun scripts/verify-package.ts <package.tgz>');
  }
  const result = await verifyPackageTarball(args[0]);
  console.log(
    `Verified ${result.entries.length} package files, packed CLI help, TUI ${result.tuiEntrypoint}, and Auth MCP ${result.authMcpVersion}.`,
  );
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Package verification failed');
    process.exitCode = 1;
  });
}
