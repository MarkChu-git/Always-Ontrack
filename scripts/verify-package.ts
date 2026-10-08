import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const packagePrefix = 'package/';
const requiredEntries = [
  'package/package.json',
  'package/LICENSE',
  'package/README.md',
  'package/README.zh-CN.md',
  'package/dist/cli.js',
  'package/dist/tui/index.js',
] as const;

export interface PackageVerification {
  entries: string[];
  cliOutput: string;
  tuiEntrypoint: 'runTui';
  tuiOutput: string;
}

const tuiSmokeTimeoutMs = 10_000;
const tuiSmokeOutputLimit = 1_000_000;
const subprocessTerminationGraceMs = 1_000;

interface TerminableSubprocess {
  readonly exited: Promise<number>;
  kill(signal?: number): void;
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

async function exitsWithin(exited: Promise<number>, timeoutMs: number): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      exited.then(() => true),
      new Promise<false>((resolveTimeout) => {
        timeout = setTimeout(() => resolveTimeout(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export async function terminateSubprocess(
  child: TerminableSubprocess,
  graceMs = subprocessTerminationGraceMs,
): Promise<void> {
  child.kill();
  if (await exitsWithin(child.exited, graceMs)) {
    return;
  }
  child.kill(9);
  if (!(await exitsWithin(child.exited, graceMs))) {
    throw new Error('packed TUI subprocess did not terminate after SIGKILL');
  }
}

export interface TuiSmokeOptions {
  readonly outputLimit?: number;
  readonly terminationGraceMs?: number;
  readonly timeoutMs?: number;
}

interface TuiSmokeSettings {
  readonly outputLimit: number;
  readonly terminationGraceMs: number;
  readonly timeoutMs: number;
}

interface TuiCapture {
  readonly failure: Promise<never>;
  readonly finish: () => { readonly interruptSent: boolean; readonly output: string };
  readonly terminal: Bun.Terminal;
}

function resolveTuiSmokeSettings(options: TuiSmokeOptions): TuiSmokeSettings {
  const settings = {
    outputLimit: options.outputLimit ?? tuiSmokeOutputLimit,
    terminationGraceMs: options.terminationGraceMs ?? subprocessTerminationGraceMs,
    timeoutMs: options.timeoutMs ?? tuiSmokeTimeoutMs,
  };
  for (const [name, value] of Object.entries(settings)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`invalid TUI smoke ${name}`);
    }
  }
  return settings;
}

function createTuiCapture(outputLimit: number): TuiCapture {
  const decoder = new TextDecoder();
  let output = '';
  let outputLimitExceeded = false;
  let interruptSent = false;
  let failSmoke: (error: Error) => void = () => undefined;
  const failure = new Promise<never>((_, reject) => {
    failSmoke = reject;
  });
  const terminal = new Bun.Terminal({
    cols: 100,
    rows: 32,
    data(activeTerminal, bytes) {
      if (outputLimitExceeded) return;
      output = `${output}${decoder.decode(bytes, { stream: true })}`;
      if (output.length > outputLimit) {
        output = output.slice(0, outputLimit + 1);
        outputLimitExceeded = true;
        failSmoke(new Error('packed no-argument CLI exceeded the TUI smoke output limit'));
      } else if (!interruptSent && output.includes('Not signed in')) {
        interruptSent = true;
        activeTerminal.write('\u0003');
      }
    },
  });
  return {
    failure,
    finish: () => ({ interruptSent, output: `${output}${decoder.decode()}` }),
    terminal,
  };
}

export function tuiSmokeEnvironment(configRoot: string): Record<string, string> {
  return {
    APPDATA: configRoot,
    COLORTERM: 'truecolor',
    LANG: 'C.UTF-8',
    LOCALAPPDATA: configRoot,
    NO_COLOR: '1',
    // The packed no-arg CLI loads the real TUI, which probes auth on startup.
    // Pin a refused loopback so CI never calls production or launches a browser.
    ONTRACK_BASE_URL: 'http://127.0.0.1:1',
    ONTRACK_HEADLESS: '1',
    ONTRACK_RELAY_URL: '',
    TEMP: configRoot,
    TERM: 'xterm-256color',
    TMP: configRoot,
    TMPDIR: configRoot,
    XDG_CONFIG_HOME: configRoot,
  };
}

async function waitForTuiExit(
  child: TerminableSubprocess,
  failure: Promise<never>,
  timeoutMs: number,
): Promise<number> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      child.exited,
      failure,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('packed no-argument CLI did not finish its TUI smoke test')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function validateTuiSmokeResult(
  exitCode: number,
  capture: ReturnType<TuiCapture['finish']>,
  outputLimit: number,
): string {
  if (capture.output.length > outputLimit) {
    throw new Error('packed no-argument CLI exceeded the TUI smoke output limit');
  }
  if (exitCode !== 0) throw new Error(`packed TUI exited with code ${exitCode}`);
  if (!capture.interruptSent) throw new Error('packed no-argument CLI did not render the TUI');
  return capture.output;
}

export async function verifyInstalledTui(
  cliPath: string,
  packageRoot: string,
  configRoot: string,
  options: TuiSmokeOptions = {},
): Promise<string> {
  const settings = resolveTuiSmokeSettings(options);
  const capture = createTuiCapture(settings.outputLimit);
  let exited = false;
  const child = Bun.spawn([process.execPath, cliPath], {
    cwd: packageRoot,
    env: tuiSmokeEnvironment(configRoot),
    terminal: capture.terminal,
  });

  try {
    const exitCode = await waitForTuiExit(child, capture.failure, settings.timeoutMs);
    exited = true;
    return validateTuiSmokeResult(exitCode, capture.finish(), settings.outputLimit);
  } finally {
    try {
      if (!exited) {
        await terminateSubprocess(child, settings.terminationGraceMs);
      }
    } finally {
      if (!capture.terminal.closed) capture.terminal.close();
    }
  }
}

interface PackedPackagePaths {
  readonly cliPath: string;
  readonly packageRoot: string;
}

interface InstalledPackagePaths extends PackedPackagePaths {
  readonly tuiPath: string;
}

async function inspectTarball(tarballPath: string): Promise<string[]> {
  const verboseListing = await run(['tar', '-tvzf', tarballPath]);
  validateTarEntryTypes(verboseListing.stdout.split(/\r?\n/u));
  const listing = await run(['tar', '-tzf', tarballPath]);
  const archiveEntries = listing.stdout.split(/\r?\n/u).filter(Boolean);
  validateTarEntries(archiveEntries);
  return archiveEntries.filter((entry) => !entry.endsWith('/'));
}

async function verifyPackedManifest(packageRoot: string): Promise<void> {
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as {
    name?: unknown;
    version?: unknown;
    bin?: unknown;
  };
  const bin = manifest.bin as Record<string, unknown> | undefined;
  if (
    manifest.name !== 'ontrack-cli' ||
    typeof manifest.version !== 'string' ||
    !bin ||
    bin.ontrack !== './dist/cli.js' ||
    Object.keys(bin).length !== 1
  ) {
    throw new Error('packed manifest does not expose exactly the ontrack executable');
  }
}

async function resolvePackedPackage(extractionRoot: string): Promise<PackedPackagePaths> {
  await assertRegularTree(extractionRoot);
  const packageRoot = await realpath(join(extractionRoot, 'package'));
  const cliPath = await realpath(join(packageRoot, 'dist', 'cli.js'));
  assertChildPath(packageRoot, cliPath);
  return { cliPath, packageRoot };
}

async function verifyPackedExecutable(paths: PackedPackagePaths): Promise<void> {
  const [cliMetadata, cliSource] = await Promise.all([
    lstat(paths.cliPath),
    readFile(paths.cliPath, 'utf8'),
  ]);
  if ((cliMetadata.mode & 0o111) === 0) {
    throw new Error('packed CLI is missing executable permission bits');
  }
  if (!cliSource.startsWith('#!/usr/bin/env bun')) {
    throw new Error('packed CLI is missing its Bun executable entrypoint');
  }
}

async function installPackedPackage(
  tarballPath: string,
  extractionRoot: string,
): Promise<InstalledPackagePaths> {
  const installationRoot = join(extractionRoot, 'installation');
  await mkdir(installationRoot);
  await writeFile(join(installationRoot, 'package.json'), JSON.stringify({ private: true }), {
    mode: 0o600,
  });
  await run(
    [process.execPath, 'install', '--production', '--ignore-scripts', '--no-save', tarballPath],
    installationRoot,
  );
  const packageRoot = await realpath(join(installationRoot, 'node_modules', 'ontrack-cli'));
  const cliPath = await realpath(join(packageRoot, 'dist', 'cli.js'));
  const tuiPath = await realpath(join(packageRoot, 'dist', 'tui', 'index.js'));
  for (const path of [cliPath, tuiPath]) assertChildPath(packageRoot, path);
  return { cliPath, packageRoot, tuiPath };
}

async function verifyInstalledPackage(
  paths: InstalledPackagePaths,
  configRoot: string,
): Promise<Omit<PackageVerification, 'entries'>> {
  const cli = await run([process.execPath, paths.cliPath, '--help'], paths.packageRoot);
  const tuiModule = (await import(pathToFileURL(paths.tuiPath).href)) as { runTui?: unknown };
  if (typeof tuiModule.runTui !== 'function') {
    throw new Error('packed TUI does not export runTui');
  }
  const tuiOutput = await verifyInstalledTui(paths.cliPath, paths.packageRoot, configRoot);
  return {
    cliOutput: `${cli.stdout}${cli.stderr}`,
    tuiEntrypoint: 'runTui',
    tuiOutput,
  };
}

export async function verifyPackageTarball(tarballPath: string): Promise<PackageVerification> {
  const resolvedTarball = resolve(tarballPath);
  if (!resolvedTarball.endsWith('.tgz')) {
    throw new Error('package verification accepts only .tgz tarballs');
  }

  const entries = await inspectTarball(resolvedTarball);
  const extractionRoot = await mkdtemp(join(tmpdir(), 'ontrack-package-verify-'));
  try {
    await run(['tar', '-xzf', resolvedTarball, '-C', extractionRoot]);
    const packedPaths = await resolvePackedPackage(extractionRoot);
    await verifyPackedManifest(packedPaths.packageRoot);
    await verifyPackedExecutable(packedPaths);
    const installedPaths = await installPackedPackage(resolvedTarball, extractionRoot);
    const isolatedConfigRoot = join(extractionRoot, 'config');
    await mkdir(isolatedConfigRoot);
    const installedResult = await verifyInstalledPackage(installedPaths, isolatedConfigRoot);
    return { entries, ...installedResult };
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
    `Verified ${result.entries.length} package files, packed CLI help, no-argument TUI startup, and TUI ${result.tuiEntrypoint}.`,
  );
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Package verification failed');
    process.exitCode = 1;
  });
}
