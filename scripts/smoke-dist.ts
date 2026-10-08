import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { tuiSmokeEnvironment } from './verify-package.ts';

/** The built files that the dist smoke exercises. */
export interface DistPaths {
  readonly cliPath: string;
  readonly tuiPath: string;
}

interface CliCheck {
  readonly name: string;
  readonly args: readonly string[];
  readonly accepts?: (stdout: string) => boolean;
}

function readsJson(read: (value: Record<string, unknown>) => unknown, expected: string) {
  return (stdout: string): boolean => {
    try {
      return read(JSON.parse(stdout) as Record<string, unknown>) === expected;
    } catch {
      return false;
    }
  };
}

// Every check must stay offline. `auth-method --help`, for one, calls the
// production API, so it never belongs here.
const cliChecks: readonly CliCheck[] = [
  { name: 'help', args: ['--help'] },
  {
    name: 'schema auth.method',
    args: ['schema', 'auth.method', '--output', 'agent-json'],
    accepts: readsJson(
      (value) => (value.data as Record<string, unknown> | undefined)?.path,
      'auth.method',
    ),
  },
  {
    name: 'capabilities',
    args: ['capabilities', '--output', 'agent-json'],
    accepts: readsJson((value) => value.schema_version, 'ontrack.agent/v1'),
  },
];

/** Keep the built CLI off the operator's home, session and production OnTrack. */
export function distSmokeEnvironment(home: string): Record<string, string> {
  return { ...tuiSmokeEnvironment(home), HOME: home, USERPROFILE: home };
}

async function runCli(
  cliPath: string,
  args: readonly string[],
  env: Record<string, string>,
): Promise<string> {
  const child = Bun.spawn([process.execPath, cliPath, ...args], {
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`dist smoke "${args.join(' ')}" exited with code ${exitCode}: ${stderr.trim()}`);
  }
  return stdout;
}

/** Run the offline checks against a built CLI; resolves to the names of the passed checks. */
export async function smokeDist(paths: DistPaths): Promise<string[]> {
  const tuiBundle = await stat(paths.tuiPath).catch(() => undefined);
  if (!tuiBundle?.isFile()) {
    throw new Error(`dist smoke: missing TUI bundle at ${paths.tuiPath}`);
  }
  const home = await mkdtemp(join(tmpdir(), 'ontrack-dist-smoke-'));
  try {
    const env = distSmokeEnvironment(home);
    const passed = ['tui bundle'];
    for (const check of cliChecks) {
      // One CLI process at a time keeps a failure's stderr readable.
      const stdout = await runCli(paths.cliPath, check.args, env);
      if (check.accepts && !check.accepts(stdout)) {
        throw new Error(`dist smoke "${check.name}" printed unexpected output`);
      }
      passed.push(check.name);
    }
    return passed;
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  smokeDist({ cliPath: resolve('dist/cli.js'), tuiPath: resolve('dist/tui/index.js') }).then(
    (passed) => console.log(`Smoke-tested the built CLI: ${passed.join(', ')}.`),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : 'dist smoke failed');
      process.exitCode = 1;
    },
  );
}
