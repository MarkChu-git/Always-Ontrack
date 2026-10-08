import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { verifyPackageTarball, type PackageVerification } from './verify-package.ts';

export interface PackedPackage {
  readonly tarballPath: string;
  /** False when the tarball was packed into a temporary directory that is now gone. */
  readonly kept: boolean;
  readonly verification: PackageVerification;
}

/**
 * Pack the already-built package once and verify that exact tarball. With an
 * output directory the tarball stays there for upload; without one it goes
 * to a temporary directory that is removed afterwards.
 */
export async function packAndVerify(
  packageRoot: string,
  outputDir?: string,
): Promise<PackedPackage> {
  const destination = outputDir
    ? resolve(outputDir)
    : await mkdtemp(join(tmpdir(), 'ontrack-pack-'));
  try {
    await mkdir(destination, { recursive: true });
    const pack = Bun.spawn(
      [process.execPath, 'pm', 'pack', '--ignore-scripts', '--destination', destination, '--quiet'],
      { cwd: packageRoot, stdout: 'pipe', stderr: 'pipe' },
    );
    const [exitCode, stdout, stderr] = await Promise.all([
      pack.exited,
      new Response(pack.stdout).text(),
      new Response(pack.stderr).text(),
    ]);
    if (exitCode !== 0) {
      throw new Error(`bun pm pack failed with exit code ${exitCode}: ${stderr.trim()}`);
    }
    // `--quiet` prints only the path of the tarball it wrote. Look up that name
    // in the destination, so an older tarball there is never the one verified.
    const reported = stdout.trim().split(/\r?\n/u).at(-1) ?? '';
    if (!reported.endsWith('.tgz')) {
      throw new Error(`bun pm pack did not report a tarball: ${stdout.trim()}`);
    }
    const tarballPath = join(destination, basename(reported));
    const verification = await verifyPackageTarball(tarballPath);
    return { tarballPath, kept: Boolean(outputDir), verification };
  } finally {
    if (!outputDir) {
      await rm(destination, { recursive: true, force: true });
    }
  }
}

if (import.meta.main) {
  packAndVerify(process.cwd(), process.env.PACKAGE_OUTPUT_DIR || undefined).then(
    ({ tarballPath, kept, verification }) => {
      const where = kept
        ? relative(process.cwd(), tarballPath)
        : `${basename(tarballPath)} (temporary, removed)`;
      console.log(
        `Packed and verified ${where}: ${verification.entries.length} package files, ` +
          `packed CLI help, no-argument TUI startup, and TUI ${verification.tuiEntrypoint}.`,
      );
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : 'package verification failed');
      process.exitCode = 1;
    },
  );
}
