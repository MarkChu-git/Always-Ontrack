# CI/CD Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 [CI_CD_DESIGN.md](./CI_CD_DESIGN.md) 实施：验证命令只在 `package.json` 定义一次，CI 拆成并行 job 并由仍叫 `Verify Bun CLI` 的汇总 job 把关，PR 只拦新引入的 advisory，workflow 受 actionlint 与 zizmor 扫描，release 不用缓存并生成构建证明，新依赖版本至少放置 7 天。

**Architecture:** 三个新脚本（`smoke-dist.ts`、`pack-and-verify.ts`、`check-audit.ts`）各自有单元测试，并通过 `package.json` 的 script 暴露；`verify`、`verify:fast`、`verify:graph` 把它们和现有 script 串成三个层级。`ci.yml` 与 `release.yml` 只调用这些 script；`test/workflow-security.test.ts` 读取 workflow 文本、执行其中的关键 shell 片段，锁住汇总、审计分支与 tag 校验的行为。

**Tech Stack:** Bun 1.3.14（运行时、测试、打包）、TypeScript 7.0.2、GitHub Actions、actionlint 1.7.12、zizmor 1.30.1、shellcheck、Dependabot。

**Spec:** [docs/CI_CD_DESIGN.md](./CI_CD_DESIGN.md)

## Global Constraints

- CI 与 release 固定 Bun `1.3.14`（`bun-version: 1.3.14`）；`engines.bun: >=1.3.14` 不变。
- 运行 `tsc` 的 job 与 GitNexus job 安装 Node `24.21.0`；npm 发布 job 保持 `node-version: '24'`。
- GitNexus 全局版本 `1.6.9`。
- actionlint `1.7.12`，linux amd64 SHA-256 `8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8`；zizmor `1.30.1`，x86_64 linux SHA-256 `e65324f4430c2717591937edcec90ccbefaf14c174f8ec9415e03ca875b46e1a`。
- `actions/attest` v4.2.2，SHA `1e69f48acb82d1966a394da916b4c1698aa569d6`。
- 现有 Action pin 不变：checkout `3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1`、setup-bun `0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0`、setup-node `820762786026740c76f36085b0efc47a31fe5020 # v7.0.0`、cache `55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0`、upload-artifact `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1`、download-artifact `3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1`。
- required check 名字不变：`Verify Bun CLI`（汇总 job）与 `Dependency review`。
- 每个 workflow 顶层 `permissions: contents: read`；每个 checkout 设置 `persist-credentials: false`；workflow 里不写内联验证逻辑，只调用 `package.json` script。
- 7 天规则：`minimumReleaseAge = 604800`；Dependabot `cooldown.default-days: 7`。
- 覆盖率阈值（lines、functions 各 80%）不变。
- 分支 `claude/ci-pipeline`；小写 conventional commit，一个 commit 一件事，每个 commit 在本机跑绿（typecheck 与测试）。
- 本机命令都用 Bun 1.3.14，测试用隔离的绝对路径 HOME。每个任务开始前在 shell 里执行：

  ```bash
  export PATH="$(dirname "$(npx -y -p bun@1.3.14 which bun)"):$PATH"
  T="$(mktemp -d)"            # 绝对路径；测试绝不能碰真实 HOME
  t() { env -u XDG_CONFIG_HOME HOME="$T" "$@"; }
  bun --version               # 期望 1.3.14
  ```

- 本机的 workflow 扫描器（macOS arm64 版本，按上游 release digest 校验后放进临时目录）。需要扫描的任务开始前执行：

  ```bash
  SC="$(mktemp -d)"
  fetch() {  # fetch <owner/repo> <tag> <asset>
    digest="$(gh api "repos/$1/releases/tags/$2" --jq ".assets[] | select(.name==\"$3\") | .digest" | sed 's/^sha256://')"
    curl -sSfL -o "$SC/$3" "https://github.com/$1/releases/download/$2/$3"
    printf '%s  %s\n' "$digest" "$SC/$3" | shasum -a 256 -c -
  }
  fetch rhysd/actionlint v1.7.12 actionlint_1.7.12_darwin_arm64.tar.gz
  fetch zizmorcore/zizmor v1.30.1 zizmor-aarch64-apple-darwin.tar.gz
  fetch koalaman/shellcheck v0.11.0 shellcheck-v0.11.0.darwin.aarch64.tar.gz
  tar -xzf "$SC/actionlint_1.7.12_darwin_arm64.tar.gz" -C "$SC" actionlint
  tar -xzf "$SC/zizmor-aarch64-apple-darwin.tar.gz" -C "$SC" zizmor
  tar -xzf "$SC/shellcheck-v0.11.0.darwin.aarch64.tar.gz" -C "$SC" --strip-components 1 shellcheck-v0.11.0/shellcheck
  export PATH="$SC:$PATH"   # actionlint 会用 PATH 上的 shellcheck 检查 run: 脚本
  ```

## Review Focus

1. 某个 CI job 被跳过、取消或没有结果时，汇总 job 必须失败，而不是因为“被跳过等于 Success”而放行（Task 7 的测试执行汇总脚本，覆盖 `skipped`、`cancelled`、空结果）。
2. 手动重试时输入 `v3.0.0x`、`v03.0.0`、`v3.0.0-rc.1` 或带换行的 tag，必须在 checkout 之前被拒绝（Task 8 的测试执行 tag 校验脚本）。
3. PR 把有漏洞的包升到仍受同一 advisory 影响的版本时（继承）应当通过；新增一个带 advisory 的包时必须失败（Task 3 的测试）。
4. `bun audit` 因基础设施原因失败（退出码 2、输出不是 JSON、退出码 1 却报告为空）时必须失败，不能当成“没有漏洞”（Task 3 的测试）。
5. 本机 `artifacts/` 里残留旧 tarball 时，被校验的必须是这次新打的包（Task 2 的测试）。

---

### Task 1: 离线的构建产物冒烟检查（`smoke:dist`）

把 ci.yml、release.yml 与 runbook 里抄了三份的内联检查收进一个脚本，并在隔离环境里运行。

**Files:**
- Create: `scripts/smoke-dist.ts`
- Create: `test/smoke-dist.test.ts`
- Modify: `package.json`（scripts 增加 `smoke:dist`）

**Interfaces:**
- Consumes: `tuiSmokeEnvironment(configRoot: string): Record<string, string>`，来自 `scripts/verify-package.ts`（已存在）。
- Produces: `DistPaths { cliPath: string; tuiPath: string }`；`distSmokeEnvironment(home: string): Record<string, string>`；`smokeDist(paths: DistPaths): Promise<string[]>`，成功时返回 `['tui bundle', 'help', 'schema auth.method', 'capabilities']`；`bun run smoke:dist` 检查 `dist/cli.js` 与 `dist/tui/index.js`。

- [ ] **Step 1: 写失败的测试** `test/smoke-dist.test.ts`

```ts
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'bun:test';
import { distSmokeEnvironment, smokeDist, type DistPaths } from '../scripts/smoke-dist.ts';

interface FakeCliOptions {
  readonly capabilitiesVersion?: string;
  readonly helpExitCode?: number;
}

// Stands in for dist/cli.js. It refuses to run against the operator's home or
// a non-loopback OnTrack, so a smoke that leaks either one fails.
function fakeCli(options: FakeCliOptions = {}): string {
  return `
if (process.env.HOME === ${JSON.stringify(homedir())} || process.env.ONTRACK_BASE_URL !== 'http://127.0.0.1:1') {
  console.error('the dist smoke is not isolated');
  process.exit(9);
}
const command = process.argv.slice(2).join(' ');
if (command === '--help') {
  console.log('Usage: ontrack <command>');
  process.exit(${options.helpExitCode ?? 0});
} else if (command === 'schema auth.method --output agent-json') {
  console.log(JSON.stringify({ data: { path: 'auth.method' } }));
} else if (command === 'capabilities --output agent-json') {
  console.log(JSON.stringify({ schema_version: ${JSON.stringify(options.capabilitiesVersion ?? 'ontrack.agent/v1')} }));
} else {
  console.error('unexpected command: ' + command);
  process.exit(8);
}
`;
}

async function withDist(
  cliSource: string,
  options: { readonly tuiBundle?: boolean },
  run: (paths: DistPaths) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'ontrack-dist-smoke-test-'));
  try {
    await mkdir(join(root, 'tui'), { recursive: true });
    const paths = { cliPath: join(root, 'cli.js'), tuiPath: join(root, 'tui', 'index.js') };
    await writeFile(paths.cliPath, cliSource);
    if (options.tuiBundle ?? true) {
      await writeFile(paths.tuiPath, 'export async function runTui() {}');
    }
    await run(paths);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('smokeDist passes a built CLI that answers every check offline', async () => {
  await withDist(fakeCli(), {}, async (paths) => {
    assert.deepEqual(await smokeDist(paths), [
      'tui bundle',
      'help',
      'schema auth.method',
      'capabilities',
    ]);
  });
});

test('smokeDist fails without the TUI bundle', async () => {
  await withDist(fakeCli(), { tuiBundle: false }, async (paths) => {
    await assert.rejects(() => smokeDist(paths), /missing TUI bundle/);
  });
});

test('smokeDist fails when a CLI check exits non-zero', async () => {
  await withDist(fakeCli({ helpExitCode: 3 }), {}, async (paths) => {
    await assert.rejects(() => smokeDist(paths), /"--help" exited with code 3/);
  });
});

test('smokeDist fails on unexpected agent output', async () => {
  await withDist(fakeCli({ capabilitiesVersion: 'ontrack.agent/v0' }), {}, async (paths) => {
    await assert.rejects(() => smokeDist(paths), /"capabilities" printed unexpected output/);
  });
});

test('the dist smoke environment keeps the CLI off the real home and production', () => {
  const env = distSmokeEnvironment('/tmp/ontrack-smoke-home');
  assert.equal(env.HOME, '/tmp/ontrack-smoke-home');
  assert.equal(env.XDG_CONFIG_HOME, '/tmp/ontrack-smoke-home');
  assert.equal(env.ONTRACK_BASE_URL, 'http://127.0.0.1:1');
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `t bun test test/smoke-dist.test.ts`
Expected: FAIL，报 `Cannot find module '../scripts/smoke-dist.ts'`。

- [ ] **Step 3: 实现** `scripts/smoke-dist.ts`

```ts
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
```

在 `package.json` 的 `"test:coverage"` 之后加一行：

```json
    "smoke:dist": "bun scripts/smoke-dist.ts",
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `t bun test test/smoke-dist.test.ts`
Expected: 5 pass，0 fail。

- [ ] **Step 5: 对真实构建产物运行**

Run: `t bun run build && t bun run smoke:dist`
Expected: `Smoke-tested the built CLI: tui bundle, help, schema auth.method, capabilities.`

- [ ] **Step 6: 全量回归**

Run: `t bun run typecheck && t bun test`
Expected: typecheck 无输出，测试 0 fail。

- [ ] **Step 7: Commit**

```bash
git add scripts/smoke-dist.ts test/smoke-dist.test.ts package.json
git commit -m "feat(ci): add an offline smoke of the built CLI"
```

---

### Task 2: 一次打包、校验同一个 tarball（`package:verify`）

**Files:**
- Create: `scripts/pack-and-verify.ts`
- Create: `test/pack-and-verify.test.ts`
- Modify: `package.json`（scripts 增加 `package:verify`）

**Interfaces:**
- Consumes: `verifyPackageTarball(tarballPath: string): Promise<PackageVerification>` 与 `PackageVerification`，来自 `scripts/verify-package.ts`（已存在）。
- Produces: `PackedPackage { tarballPath: string; kept: boolean; verification: PackageVerification }`；`packAndVerify(packageRoot: string, outputDir?: string): Promise<PackedPackage>`；`bun run package:verify` 读取环境变量 `PACKAGE_OUTPUT_DIR`（Task 4、7、8 依赖这个名字）。

- [ ] **Step 1: 写失败的测试** `test/pack-and-verify.test.ts`

```ts
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'bun:test';
import { packAndVerify } from '../scripts/pack-and-verify.ts';

const packedCliSource = `#!/usr/bin/env bun
if (process.argv.includes('--help')) {
  console.log('ontrack help works');
} else {
  process.stdout.write('Not signed in\\n');
  process.on('SIGINT', () => process.exit(0));
}`;

async function writePackageDirectory(root: string): Promise<void> {
  await mkdir(join(root, 'dist', 'lib'), { recursive: true });
  await mkdir(join(root, 'dist', 'tui'), { recursive: true });
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'ontrack-cli',
      version: '0.3.0',
      bin: { ontrack: './dist/cli.js' },
      files: ['dist'],
    }),
  );
  await writeFile(join(root, 'LICENSE'), 'Apache-2.0');
  await writeFile(join(root, 'README.md'), '# OnTrack');
  await writeFile(join(root, 'README.zh-CN.md'), '# OnTrack');
  await writeFile(join(root, 'dist', 'lib', 'api.js'), 'export {};');
  await writeFile(join(root, 'dist', 'tui', 'index.js'), 'export async function runTui() {}');
  await writeFile(join(root, 'dist', 'cli.js'), packedCliSource);
  await chmod(join(root, 'dist', 'cli.js'), 0o755);
}

async function withPackage(run: (root: string, scratch: string) => Promise<void>): Promise<void> {
  const scratch = await mkdtemp(join(tmpdir(), 'ontrack-pack-test-'));
  try {
    const root = join(scratch, 'package-root');
    await writePackageDirectory(root);
    await run(root, scratch);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

test('packAndVerify keeps the verified tarball in the output directory', async () => {
  await withPackage(async (root, scratch) => {
    const outputDir = join(scratch, 'artifacts');
    const result = await packAndVerify(root, outputDir);

    assert.equal(result.kept, true);
    assert.equal(result.tarballPath, join(outputDir, 'ontrack-cli-0.3.0.tgz'));
    assert.ok((await stat(result.tarballPath)).isFile());
    assert.ok(result.verification.entries.includes('package/dist/cli.js'));
  });
});

test('packAndVerify removes its temporary directory without an output directory', async () => {
  await withPackage(async (root) => {
    const result = await packAndVerify(root);

    assert.equal(result.kept, false);
    await assert.rejects(() => stat(result.tarballPath));
  });
});

test('packAndVerify verifies the fresh tarball when the output directory holds an older one', async () => {
  await withPackage(async (root, scratch) => {
    const outputDir = join(scratch, 'artifacts');
    await mkdir(outputDir);
    await writeFile(join(outputDir, 'ontrack-cli-0.2.0.tgz'), 'not a tarball');

    const result = await packAndVerify(root, outputDir);

    assert.equal(result.tarballPath, join(outputDir, 'ontrack-cli-0.3.0.tgz'));
  });
});

test('packAndVerify fails when bun pm pack fails', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'ontrack-pack-fail-test-'));
  try {
    await assert.rejects(() => packAndVerify(scratch), /bun pm pack failed/);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `t bun test test/pack-and-verify.test.ts`
Expected: FAIL，报 `Cannot find module '../scripts/pack-and-verify.ts'`。

- [ ] **Step 3: 实现** `scripts/pack-and-verify.ts`

```ts
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
```

在 `package.json` 的 `"smoke:dist"` 之后加一行：

```json
    "package:verify": "bun scripts/pack-and-verify.ts",
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `t bun test test/pack-and-verify.test.ts`
Expected: 4 pass，0 fail。

- [ ] **Step 5: 对真实包运行两种模式**

Run: `t bun run build && t bun run package:verify && t env PACKAGE_OUTPUT_DIR="$T/artifacts" bun run package:verify && ls "$T/artifacts"`
Expected: 第一次输出 `Packed and verified ontrack-cli-3.0.0.tgz (temporary, removed): 54 package files, ...`；第二次输出 `Packed and verified .../artifacts/ontrack-cli-3.0.0.tgz: ...`；`ls` 只列出 `ontrack-cli-3.0.0.tgz`。

- [ ] **Step 6: 全量回归**

Run: `t bun run typecheck && t bun test`
Expected: 0 fail。

- [ ] **Step 7: Commit**

```bash
git add scripts/pack-and-verify.ts test/pack-and-verify.test.ts package.json
git commit -m "feat(ci): pack and verify the release tarball in one script"
```

---

### Task 3: 只拦新引入 advisory 的依赖审计（`audit:check`）

**Files:**
- Create: `scripts/check-audit.ts`
- Create: `test/check-audit.test.ts`
- Modify: `package.json`（scripts 增加 `audit:check`）

**Interfaces:**
- Produces: `Advisory { packageName; url; title; severity }`；`parseAuditReport(stdout: string): Advisory[]`；`introducedAdvisories(head, base): Advisory[]`；`runAuditCheck(options: { args: readonly string[]; cwd: string; runtime?: string; log?: (line: string) => void }): Promise<number>`（0 通过，1 失败，异常即 fail closed）；CLI：`bun run audit:check` 全量，`bun run audit:check --base <commit>` 对比（Task 7、8 依赖这两种形式）。

- [ ] **Step 1: 写失败的测试** `test/check-audit.test.ts`

```ts
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'bun:test';
import {
  introducedAdvisories,
  parseAuditReport,
  runAuditCheck,
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

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const child = Bun.spawn(
    ['git', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args],
    { cwd, stdout: 'pipe', stderr: 'pipe' },
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
```

- [ ] **Step 2: 运行，确认失败**

Run: `t bun test test/check-audit.test.ts`
Expected: FAIL，报 `Cannot find module '../scripts/check-audit.ts'`。

- [ ] **Step 3: 实现** `scripts/check-audit.ts`

```ts
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

async function capture(command: readonly string[], cwd: string): Promise<Captured> {
  const child = Bun.spawn([...command], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
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
  const { exitCode, stderr } = await capture(
    ['git', 'diff', '--quiet', base, '--', 'package.json', 'bun.lock'],
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
      const { exitCode, stdout, stderr } = await capture(['git', 'show', `${base}:${file}`], cwd);
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
```

在 `package.json` 的 `"package:verify"` 之后加一行：

```json
    "audit:check": "bun scripts/check-audit.ts",
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `t bun test test/check-audit.test.ts`
Expected: 12 pass，0 fail。

- [ ] **Step 5: 对真实 lockfile 运行两种模式**

Run: `t bun run audit:check && t bun run audit:check --base origin/master`
Expected: 第一条输出 `bun audit: no advisories.`；第二条因为本分支改过 `bun.lock`，会审计两边并输出 `bun audit: this change introduces no advisories.`。两条退出码都是 0。

- [ ] **Step 6: 全量回归**

Run: `t bun run typecheck && t bun test`
Expected: 0 fail。

- [ ] **Step 7: Commit**

```bash
git add scripts/check-audit.ts test/check-audit.test.ts package.json
git commit -m "feat(ci): fail the audit only on advisories a change introduces"
```

---

### Task 4: 验证命令分层（`verify:fast`、`verify`、`verify:graph`）

**Files:**
- Modify: `package.json`（scripts）
- Modify: `test/workflow-security.test.ts`（新增一个测试）
- Modify: `docs/RELEASE_RUNBOOK.md`（Release procedure 第 2 步）
- Modify: `docs/development.md`（“Minimum recommended validation” 一段）

**Interfaces:**
- Consumes: Task 1–3 的 `smoke:dist`、`package:verify`、`audit:check`。
- Produces: `bun run verify:fast`、`bun run verify`、`bun run verify:graph`（Task 7、8 的 workflow 调用它们）。

- [ ] **Step 1: 写失败的测试**：在 `test/workflow-security.test.ts` 末尾追加

```ts
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
```

- [ ] **Step 2: 运行，确认失败**

Run: `t bun test test/workflow-security.test.ts`
Expected: FAIL，`verify runs every release gate in order` 报 `undefined !== 'bun run typecheck && ...'`。

- [ ] **Step 3: 实现**：在 `package.json` 的 `"test:coverage"` 之后、`"smoke:dist"` 之前加三行

```json
    "verify:fast": "bun run typecheck && bun run typecheck:tui && bun test",
    "verify": "bun run skills:check && bun run typecheck && bun run typecheck:tui && bun run test:coverage && bun run test:tui && bun run build && bun run smoke:dist && bun run package:verify",
    "verify:graph": "bun run gitnexus:analyze && bun run gitnexus:status && bun run gitnexus:check && bun run gitnexus:mcp:check",
```

把 `docs/RELEASE_RUNBOOK.md` 第 2 步（从 “2. Wait for required checks to pass.” 到它的代码块结束）整体替换为：

~~~markdown
2. Wait for required checks to pass. Locally, run the same gates with Bun 1.3.14, the version CI pins. `bun run verify` packs the tarball into a temporary directory and removes it; set `PACKAGE_OUTPUT_DIR` to keep it.

   ```bash
   bun install --frozen-lockfile
   bun run verify
   bun run verify:graph
   bun run audit:check
   ```
~~~

把 `docs/development.md` 里 “Minimum recommended validation before release:” 这一行及其后的 `bun test / bun run test:coverage / bun run build` 代码块替换为：

~~~markdown
Validation tiers. CI and the release workflow run these same scripts:

```bash
bun run verify:fast   # after each change: both typechecks and the test suite
bun run verify        # before a release: every gate CI runs except GitNexus and the audit
bun run verify:graph  # GitNexus graph checks; needs the global GitNexus 1.6.9
bun run audit:check   # full dependency audit; --base <commit> fails only on new advisories
```
~~~

- [ ] **Step 4: 运行测试，确认通过**

Run: `t bun test test/workflow-security.test.ts`
Expected: 全部 pass。

- [ ] **Step 5: 本机跑一遍 `verify`**

Run: `t bun run verify`
Expected: 依次完成 skills:check、两个 typecheck、`lines: 8x.xx% ... functions: 9x.xx%`、`all smoke checks passed`、build、`Smoke-tested the built CLI: ...`、`Packed and verified ontrack-cli-3.0.0.tgz (temporary, removed): ...`，退出码 0。

- [ ] **Step 6: Commit**

```bash
git add package.json test/workflow-security.test.ts docs/RELEASE_RUNBOOK.md docs/development.md
git commit -m "feat(ci): add verify:fast, verify and verify:graph command tiers"
```

---

### Task 5: 按校验值锁定的 workflow 扫描器

**Files:**
- Create: `scripts/ci/install-pinned-tools.sh`

**Interfaces:**
- Produces: `bash scripts/ci/install-pinned-tools.sh <destination>`，在 `<destination>/actionlint` 与 `<destination>/zizmor` 放置 linux x86_64 可执行文件（Task 7 的 `hygiene` job 调用）。

- [ ] **Step 1: 写脚本** `scripts/ci/install-pinned-tools.sh`

```bash
#!/usr/bin/env bash
# Install the linux x86_64 workflow scanners that CI runs. Each archive is
# checked against the SHA-256 digest its upstream GitHub release publishes
# before it is unpacked. To bump a tool, change its URL and digest together,
# and take the digest from the release's asset metadata, never from a file
# you downloaded.
set -euo pipefail

destination="${1:?usage: install-pinned-tools.sh <destination>}"
mkdir -p "$destination"

install_one() {
  local url="$1" checksum="$2" binary="$3"
  local archive="${destination}/${binary}.tar.gz"
  curl --fail --silent --show-error --location --output "$archive" "$url"
  printf '%s  %s\n' "$checksum" "$archive" | sha256sum --check --status
  tar --extract --gzip --file "$archive" --directory "$destination" "$binary"
  chmod +x "${destination}/${binary}"
  rm -f "$archive"
}

install_one \
  "https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_linux_amd64.tar.gz" \
  "8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8" \
  actionlint

install_one \
  "https://github.com/zizmorcore/zizmor/releases/download/v1.30.1/zizmor-x86_64-unknown-linux-gnu.tar.gz" \
  "e65324f4430c2717591937edcec90ccbefaf14c174f8ec9415e03ca875b46e1a" \
  zizmor
```

- [ ] **Step 2: 语法与 shellcheck**

Run: `bash -n scripts/ci/install-pinned-tools.sh && shellcheck scripts/ci/install-pinned-tools.sh`（shellcheck 来自 Global Constraints 里的本机扫描器目录）
Expected: 无输出，退出码 0。

- [ ] **Step 3: 模拟运行一次**：在本机下载、校验并解压 linux 版本，确认归档结构与校验值正确

Run: `bash scripts/ci/install-pinned-tools.sh "$T/ci-tools" && file "$T/ci-tools/actionlint" "$T/ci-tools/zizmor"`
Expected: 两个文件都显示 `ELF 64-bit LSB executable, x86-64`。若本机的 `sha256sum` 不支持 `--check --status`，在 `$T/shim/sha256sum` 放一个 `exec shasum -a 256 "$@"` 的包装脚本，再用 `PATH="$T/shim:$PATH"` 重跑。

- [ ] **Step 4: 篡改校验值时必须失败**

Run: `sed 's/8aca8db9/00000000/' scripts/ci/install-pinned-tools.sh > "$T/tampered.sh" && bash "$T/tampered.sh" "$T/tampered-tools"; echo "exit=$?"`
Expected: `exit=1`，且 `$T/tampered-tools/actionlint` 不存在。

- [ ] **Step 5: Commit**

```bash
git add scripts/ci/install-pinned-tools.sh
git commit -m "feat(ci): install actionlint and zizmor from checksum-pinned releases"
```

---

### Task 6: 新版本放置 7 天（Dependabot cooldown、opentui 分组、bunfig）

**Files:**
- Modify: `.github/dependabot.yml`
- Create: `bunfig.toml`
- Modify: `docs/development.md`（新增 “Dependency updates” 一节）

- [ ] **Step 1: 确认 zizmor 当前报 cooldown**

Run: `zizmor --offline --no-progress .github`（zizmor 来自 Global Constraints 里的本机扫描器目录）
Expected: 含两条 `warning[dependabot-cooldown]`（`.github/dependabot.yml` 的两个生态）。

- [ ] **Step 2: 改 `.github/dependabot.yml`** 为

```yaml
version: 2
updates:
  - package-ecosystem: bun
    directory: /
    schedule:
      interval: weekly
    # Wait a week before adopting a new release; security updates skip the wait.
    cooldown:
      default-days: 7
    open-pull-requests-limit: 5
    groups:
      # @opentui/react pins its own @opentui/core; upgrading them apart leaves
      # two copies that fail typechecking.
      opentui:
        patterns:
          - '@opentui/*'
      development-dependencies:
        dependency-type: development

  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
    cooldown:
      default-days: 7
```

- [ ] **Step 3: 新建 `bunfig.toml`**

```toml
[install]
# Resolve only versions published at least seven days ago (604800 seconds), so
# a compromised release has time to be caught. Versions already in bun.lock
# install as usual. A security fix younger than that goes into the excludes
# until it is a week old.
minimumReleaseAge = 604800
minimumReleaseAgeExcludes = []
```

- [ ] **Step 4: 在 `docs/development.md` 的 “Coverage thresholds” 一节之前插入**

~~~markdown
## Dependency updates

New dependency versions wait seven days before the project adopts them, so a
compromised release has time to be caught. `bunfig.toml` sets
`install.minimumReleaseAge` to 604800 seconds, so `bun add` and `bun update`
resolve only versions published at least that long ago, and Dependabot waits
the same seven days (`cooldown` in `.github/dependabot.yml`; security updates
skip the wait). Versions already in `bun.lock` install as usual.

A security fix younger than a week goes into `minimumReleaseAgeExcludes` in
`bunfig.toml` until it is a week old. Verify a changed lockfile with Bun
1.3.14, the version CI pins.
~~~

- [ ] **Step 5: 验证**

Run: `zizmor --offline --no-progress .github; t bun install --frozen-lockfile --ignore-scripts && t bun run verify:fast`
Expected: zizmor 不再报 `dependabot-cooldown`（只剩 Task 7、8 要处理的 `cache-poisoning`）；frozen install 输出 `no changes`；`verify:fast` 0 fail。

- [ ] **Step 6: Commit**

```bash
git add .github/dependabot.yml bunfig.toml docs/development.md
git commit -m "chore(deps): wait seven days before adopting new dependency versions"
```

---

### Task 7: 并行 CI 与 `Verify Bun CLI` 汇总 job

**Files:**
- Modify: `.github/workflows/ci.yml`（整体替换）
- Modify: `test/workflow-security.test.ts`

**Interfaces:**
- Consumes: Task 1–5 的 script 与安装脚本；Task 4 的 `verify:graph`。
- Produces: test helper `stepScript(workflow, stepName)`、`runStep(script, env)`、`jobBlock(workflow, job)`、`jobIds(workflow)`（Task 8 复用）。

- [ ] **Step 1: 写失败的测试**。在 `test/workflow-security.test.ts` 顶部把 import 改为

```ts
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'bun:test';
```

在 `const workflowRoot = ...` 之后加入 helper：

```ts
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

/** Run a step script the way GitHub's bash shell does. */
async function runStep(
  script: string,
  env: Record<string, string>,
): Promise<{ exitCode: number; stdout: string }> {
  const child = Bun.spawn(['bash', '--noprofile', '--norc', '-eo', 'pipefail', '-c', script], {
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
```

把现有的 `CI never uploads an unverified package from a failed job` 测试整体替换为：

```ts
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
```

把 `CI and release reject modified or unpinned project skills` 与 `CI and release gate the published TUI` 两个测试改成只检查 release（release.yml 在 Task 8 才改）：

```ts
test('release rejects modified or unpinned project skills', async () => {
  const releaseWorkflow = await readFile(new URL('release.yml', workflowRoot), 'utf8');
  assert.match(
    releaseWorkflow,
    /Typecheck, test, audit, and build[\s\S]*bun run skills:check[\s\S]*bun run typecheck/,
  );
});

test('release gates the published TUI', async () => {
  const releaseWorkflow = await readFile(new URL('release.yml', workflowRoot), 'utf8');
  assert.match(releaseWorkflow, /bun run typecheck:tui/);
  assert.match(releaseWorkflow, /bun run test:tui/);
  assert.match(releaseWorkflow, /test -f dist\/tui\/index\.js/);
});
```

在文件末尾追加：

```ts
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
```

- [ ] **Step 2: 运行，确认失败**

Run: `t bun test test/workflow-security.test.ts`
Expected: FAIL：`missing job: package`、`missing job: gate`、`missing step: Require every CI job to succeed` 等。

- [ ] **Step 3: 整体替换 `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  pull_request:
    branches: [master]
  push:
    branches: [master]
  merge_group:
  schedule:
    # Daily, so new advisories and dependency rot surface without a push.
    - cron: '17 3 * * *'
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: ci-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

jobs:
  test:
    name: Test and coverage
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false

      - uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0
        with:
          bun-version: 1.3.14

      # TypeScript 7's tsc launcher runs under node; pin it instead of the runner's.
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: 24.21.0
          package-manager-cache: false

      - name: Verify Bun runtime
        run: test "$(bun --version)" = "1.3.14"

      - name: Install exactly from the lockfile
        run: bun install --frozen-lockfile --ignore-scripts

      - name: Typecheck
        run: |
          bun run typecheck
          bun run typecheck:tui

      - name: Test and enforce 80% core coverage
        run: bun run test:coverage

      - uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
        if: always()
        with:
          name: ci-coverage-${{ github.sha }}
          path: coverage/lcov.info
          if-no-files-found: warn
          retention-days: 14

  tui:
    name: TUI smoke
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false

      - uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0
        with:
          bun-version: 1.3.14

      - name: Install exactly from the lockfile
        run: bun install --frozen-lockfile --ignore-scripts

      - name: Smoke TUI interactions
        run: bun run test:tui

  package:
    name: Build and verify package
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false

      - uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0
        with:
          bun-version: 1.3.14

      # TypeScript 7's tsc launcher runs under node; pin it instead of the runner's.
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: 24.21.0
          package-manager-cache: false

      - name: Install exactly from the lockfile
        run: bun install --frozen-lockfile --ignore-scripts

      - name: Build package
        run: bun run build

      - name: Smoke the built CLI
        run: bun run smoke:dist

      - name: Pack and verify one release candidate
        env:
          PACKAGE_OUTPUT_DIR: artifacts
        run: bun run package:verify

      - uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
        with:
          name: ci-package-${{ github.sha }}
          path: artifacts/*.tgz
          if-no-files-found: error
          retention-days: 14

  graph:
    name: GitNexus graph
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0
          persist-credentials: false

      - uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0
        with:
          bun-version: 1.3.14

      # GitNexus's LadybugDB analysis needs Node 22 or later.
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: 24.21.0
          package-manager-cache: false

      # Only this job caches: the global GitNexus dependency tree is large.
      - uses: actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0
        with:
          path: ~/.bun/install/cache
          key: gitnexus-${{ runner.os }}-bun-1.3.14-gitnexus-1.6.9-${{ hashFiles('bun.lock') }}

      - name: Install exactly from the lockfile
        run: bun install --frozen-lockfile --ignore-scripts

      - name: Install GitNexus toolchain (global, trusted native builds)
        run: |
          bun install -g gitnexus@1.6.9
          bun pm -g trust @ladybugdb/core tree-sitter gitnexus

      - name: Verify isolated GitNexus agent graph
        run: bun run verify:graph

  audit:
    name: Dependency audit
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          # The base commit must be present to audit its lockfile.
          fetch-depth: 0
          persist-credentials: false

      - uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0
        with:
          bun-version: 1.3.14

      - name: Audit dependencies
        env:
          BASE_SHA: ${{ github.event.pull_request.base.sha || github.event.merge_group.base_sha }}
        run: |
          if [ -n "$BASE_SHA" ]; then
            bun run audit:check --base "$BASE_SHA"
          else
            bun run audit:check
          fi

  hygiene:
    name: Repository hygiene
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false

      - uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0
        with:
          bun-version: 1.3.14

      - name: Verify pinned project skills
        run: bun run skills:check

      - name: Install pinned workflow scanners
        run: bash scripts/ci/install-pinned-tools.sh "$RUNNER_TEMP/ci-tools"

      - name: Lint workflows
        run: |
          "$RUNNER_TEMP/ci-tools/actionlint" -color

      - name: Audit workflow security
        run: |
          "$RUNNER_TEMP/ci-tools/zizmor" --offline --no-progress .github

      - name: Lint shell scripts
        run: shellcheck scripts/ci/install-pinned-tools.sh

  gate:
    # The ruleset requires this check by name. A skipped job reports success,
    # so this job always runs and fails unless every other CI job succeeded.
    name: Verify Bun CLI
    needs: [test, tui, package, graph, audit, hygiene]
    if: always()
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: Require every CI job to succeed
        env:
          RESULTS: ${{ join(needs.*.result, ' ') }}
        run: |
          echo "CI job results: $RESULTS"
          if [ -z "$RESULTS" ]; then
            echo "No CI job results were reported." >&2
            exit 1
          fi
          for result in $RESULTS; do
            if [ "$result" != success ]; then
              echo "A CI job did not succeed; see the failed or skipped job above." >&2
              exit 1
            fi
          done
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `t bun test test/workflow-security.test.ts`
Expected: 全部 pass。

- [ ] **Step 5: 本机扫描 workflow**

Run: `actionlint -no-color && zizmor --offline --no-progress .github`
Expected: actionlint 无输出；zizmor 只剩 `release.yml` 的两条 `cache-poisoning`（Task 8 处理），`ci.yml` 没有 finding。

- [ ] **Step 6: 全量回归**

Run: `t bun run verify:fast`
Expected: 0 fail。

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/ci.yml test/workflow-security.test.ts
git commit -m "feat(ci): run CI jobs in parallel behind the Verify Bun CLI gate"
```

---

### Task 8: 不用缓存、带构建证明的 release

**Files:**
- Modify: `.github/workflows/release.yml`（`validate-and-pack` 与 `create-draft-release` 两个 job）
- Modify: `.github/workflows/typescript-portability.yml`（Node 版本）
- Modify: `test/workflow-security.test.ts`
- Modify: `docs/RELEASE_RUNBOOK.md`

**Interfaces:**
- Consumes: Task 7 的 `stepScript`、`runStep`、`jobBlock`；Task 2 的 `PACKAGE_OUTPUT_DIR`；Task 3 的 `audit:check`；Task 4 的 `verify`、`verify:graph`。

- [ ] **Step 1: 写失败的测试**。删除 Task 7 留下的 `release rejects modified or unpinned project skills` 与 `release gates the published TUI` 两个测试（它们断言的内联命令将被 `bun run verify` 取代，由 Task 4 的 `verify runs every release gate in order` 覆盖），在文件末尾追加：

```ts
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
  assert.equal((await runStep(script, { TAG: 'v3.0.0' })).exitCode, 0);
  for (const tag of ['v3.0.0x', 'v03.0.0', 'v3.0', '3.0.0', 'v3.0.0-rc.1', 'v3.0.0\nv9.9.9', '']) {
    assert.equal((await runStep(script, { TAG: tag })).exitCode, 1, `tag: ${JSON.stringify(tag)}`);
  }
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `t bun test test/workflow-security.test.ts`
Expected: 四个新测试 FAIL（找不到 `PACKAGE_OUTPUT_DIR`、仍有 `actions/cache@`、没有 attest、`v3.0.0x` 被接受）。

- [ ] **Step 3: 改 `release.yml` 的 `validate-and-pack` job**：从 `steps:` 开始，整段 steps 替换为（`outputs` 与 `env` 不变）：

```yaml
    steps:
      - name: Validate untrusted tag input format
        run: |
          if [[ ! "$TAG" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
            echo "tag must have the vMAJOR.MINOR.PATCH form" >&2
            exit 1
          fi

      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          ref: ${{ env.TAG }}
          fetch-depth: 0
          fetch-tags: true
          persist-credentials: false

      # A tag build never reads the Actions cache, so a poisoned cache cannot reach a release.
      - uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0
        with:
          bun-version: 1.3.14
          no-cache: true

      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: 24.21.0
          package-manager-cache: false

      - name: Validate annotated tag, version, and master ancestry
        id: metadata
        run: |
          test "$(git cat-file -t "$TAG")" = tag
          SOURCE_SHA="$(git rev-list -n 1 "$TAG")"
          git fetch --no-tags origin +refs/heads/master:refs/remotes/origin/master
          git merge-base --is-ancestor "$SOURCE_SHA" origin/master
          VERSION="$(bun -e 'console.log((await Bun.file("package.json").json()).version)')"
          test "$TAG" = "v$VERSION"
          TARBALL="ontrack-cli-$VERSION.tgz"
          MANIFEST="$TARBALL.sha256"
          {
            echo "tag=$TAG"
            echo "version=$VERSION"
            echo "tarball=$TARBALL"
            echo "manifest=$MANIFEST"
          } >> "$GITHUB_OUTPUT"

      - name: Install exactly from the lockfile
        run: bun install --frozen-lockfile --ignore-scripts

      - name: Install GitNexus toolchain (global, trusted native builds)
        run: |
          bun install -g gitnexus@1.6.9
          bun pm -g trust @ladybugdb/core tree-sitter gitnexus

      - name: Verify, pack, and audit the release
        env:
          PACKAGE_OUTPUT_DIR: artifacts
        run: |
          bun run verify
          bun run verify:graph
          bun run audit:check

      - name: Record the checksum of the only release artifact
        env:
          TARBALL: ${{ steps.metadata.outputs.tarball }}
          MANIFEST: ${{ steps.metadata.outputs.manifest }}
        run: |
          test -f "artifacts/$TARBALL"
          test "$(find artifacts -maxdepth 1 -name '*.tgz' | wc -l)" -eq 1
          (
            cd artifacts
            sha256sum "$TARBALL" > "$MANIFEST"
            sha256sum --check "$MANIFEST"
          )

      - uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
        with:
          name: release-${{ steps.metadata.outputs.tag }}
          path: |
            artifacts/${{ steps.metadata.outputs.tarball }}
            artifacts/${{ steps.metadata.outputs.manifest }}
          if-no-files-found: error
          retention-days: 30
```

- [ ] **Step 4: 改 `create-draft-release` job**：`permissions` 改为

```yaml
    permissions:
      contents: write
      # Build provenance for the verified tarball.
      id-token: write
      attestations: write
```

并在 `Verify release artifact checksum` 步骤之后、`Create draft without replacing any existing asset` 之前插入：

```yaml
      - name: Attest the build provenance of the verified tarball
        uses: actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6 # v4.2.2
        with:
          subject-path: artifacts/${{ needs.validate-and-pack.outputs.tarball }}
```

`publish-npm` 与 `verify-registry-and-publish-release` 不变。

- [ ] **Step 5: 改 `typescript-portability.yml`**：`node-version: 24.18.0` 改为 `node-version: 24.21.0`。

- [ ] **Step 6: 改 `docs/RELEASE_RUNBOOK.md`**

在 “One-time administration” 第 5 项之后追加：

~~~markdown
6. Keep GitHub secret scanning, push protection, Dependabot alerts, and Dependabot security updates enabled. They were turned on on 2026-10-09.
~~~

把 Release procedure 第 4 步替换为：

~~~markdown
4. The Release workflow checks out the tag and proves it is annotated and an ancestor of `origin/master`. It then runs `bun run verify` (which packs the one tarball into `artifacts/`), `bun run verify:graph`, and `bun run audit:check`, and records a SHA256 manifest of that tarball. It never reads the Actions cache.
~~~

把第 5 步开头的 “It creates a draft GitHub Release with that verified tarball.” 替换为 “It attests the build provenance of that verified tarball, then creates a draft GitHub Release with it.”，其余句子不变。

把第 7 步替换为：

~~~markdown
7. Verify the public GitHub Release has a single `ontrack-cli-X.Y.Z.tgz` asset, that `gh attestation verify ontrack-cli-X.Y.Z.tgz --repo MarkChu-git/Always-Ontrack` succeeds for the downloaded asset, and, when registry publishing is enabled, that `npm view ontrack-cli@X.Y.Z dist.integrity` is present.
~~~

- [ ] **Step 7: 运行测试，确认通过**

Run: `t bun test test/workflow-security.test.ts`
Expected: 全部 pass，包括原有的 `release validates the exact single draft asset before reuse and publication`。

- [ ] **Step 8: 本机扫描 workflow**

Run: `actionlint -no-color && zizmor --offline --no-progress .github`
Expected: actionlint 无输出；zizmor 输出 `No findings to report. Good job!`（被默认 persona 抑制的 pedantic finding 不计）。

- [ ] **Step 9: 全量回归**

Run: `t bun run verify:fast`
Expected: 0 fail。

- [ ] **Step 10: Commit**

```bash
git add .github/workflows/release.yml .github/workflows/typescript-portability.yml test/workflow-security.test.ts docs/RELEASE_RUNBOOK.md
git commit -m "feat(ci): release without caches and attest the verified tarball"
```

---

### Task 9: 最终验证与交接

**Files:** 无新增；如验证发现与 spec 不符，修正后单独 commit（例如 `docs: ...`）。

- [ ] **Step 1: 完整门禁**

Run: `t bun install --frozen-lockfile --ignore-scripts && t bun run verify && t bun run audit:check && t bun run audit:check --base origin/master`
Expected: 全部退出码 0；覆盖率不低于 80/80。

- [ ] **Step 2: GitNexus**

Run: `t bun run verify:graph`
Expected: analyze、check、mcp:check 通过。本机 `gitnexus:status` 可能因 PATH 上的 GitNexus 版本不同而报 stale；这种情况下以 CI 的 `graph` job 为准，并在交接时说明。

- [ ] **Step 3: workflow 扫描**

Run: `actionlint -no-color && zizmor --offline --no-progress .github && shellcheck scripts/ci/install-pinned-tools.sh`
Expected: 全部干净。

- [ ] **Step 4: 变更影响**

Run: `bun run gitnexus:analyze`，再用与 package script 相同的 GitNexus 二进制运行 `detect-changes --scope compare --base-ref origin/master --repo ontrack-cli`
Expected: 变更集中在 `scripts/`、`test/`、`.github/` 与文档；如有 HIGH/CRITICAL，逐项核对受影响的执行流。

- [ ] **Step 5: spec 对照**：逐节对照 [CI_CD_DESIGN.md](./CI_CD_DESIGN.md) §3–§7 与 §12 的验收标准，记录实际结果；与 spec 不符之处修正代码或修正 spec，并单独 commit。

- [ ] **Step 6: 交接**：push 与开 PR 是对外操作，先问维护者。三个分支（`claude/update-dependencies`、`claude/remove-auth-mcp`、`claude/ci-pipeline`）建议各开一个指向 `master` 的 PR，按顺序合并；`ci.yml` 只对目标为 `master` 的 PR 触发，所以不能把 PR 叠在彼此的分支上。CI 分支的 PR 上记录 `Verify Bun CLI` 的耗时，与 2 分 15 秒的基线对比。合并前按 AGENTS.md 用仓库的 `code-review` skill 做 Standards 与 Spec 两个维度的自查。
