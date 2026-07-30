# OnTrack CLI CI/CD 设计

> 状态：仓库内的 CI、coverage ratchet、artifact release workflow、Dependabot 和 runbook 已于 2026-07-31 实施。Branch protection、`release` Environment 审批者、npm Trusted Publisher 与 `PUBLISH_TO_NPM` 是 GitHub/npm 管理面设置，刻意不由仓库代码隐式开启；操作步骤见 [RELEASE_RUNBOOK.md](./RELEASE_RUNBOOK.md)。

## 1. 结论与范围

OnTrack CLI 是一个 Bun 1.3.14 驱动的 TypeScript 命令行工具，而不是部署到服务器的 Web 服务。因此本项目的 CD 指的是：可复现地构建一个 npm-compatible tarball、将其作为 GitHub Release asset 保存、并在明确启用后以受保护的 OIDC 身份发布到 npm registry。

开发、测试、类型检查、构建和打包一律使用 Bun。npm CLI 只在 registry 发布这个窄传输边界使用，因为 npm Trusted Publishing 的 OIDC 文档目前以 npm CLI 为发布端；在 Bun 官方明确支持 npm OIDC 发布之前，不把 `npm publish` 扩展到日常开发或 CI 依赖管理。

本设计的目标：

- PR 与 `master` 上的变更得到可复现、最小权限的质量验证。
- 只有经验证、可安装的唯一 `.tgz` 可以成为 Release asset 或 registry 包。
- tag、`package.json` version、GitHub Release 与 npm registry version 严格一致。
- 不把真实 OnTrack 账号、session、cookie、token 或会产生写入的 smoke test 放进 GitHub Actions。
- 对 Bun 可合并计数的 TypeScript library/script 实施 LCOV lines/functions 双 80% 硬门禁且配置无排除；process-entry CLI Adapter 由 spawned stub E2E 覆盖（Bun 不把子进程 counter 合并到父 LCOV）。真实浏览器/SSO 状态机通过注入式 Browser Adapter 在无网络环境测试，人工 Ego smoke 继续验证真实 DOM/SSO 漂移。

## 2. 已核对的事实与约束

| 项目 | 当前事实 | 对设计的影响 |
| --- | --- | --- |
| 默认分支 | `master` | 所有 branch protection 与 PR 触发器以 `master` 为目标。 |
| 版本 | `package.json` 为 `0.3.0` | Release tag 必须严格为 `v0.3.0` 形式，并与包版本去掉 `v` 后相同。 |
| 历史 tag | 本地有带注释的 `v0.2.0`、`v0.3.0`，远端尚未发现它们 | 在启用 tag-triggered release 前，先确认并推送应保留的历史 tag。 |
| package manager | `bun.lock`、`packageManager: bun@1.3.14`、`engines.bun: >=1.3.14` | CI 固定 Bun 1.3.14，使用 `bun install --frozen-lockfile`。 |
| 现有 workflow | 已实现 `ci.yml`、`dependency-review.yml`、`release.yml` | 本文同时是实施说明；远端治理项按 runbook 完成。 |
| 公共发行 | npm registry 已有 `ontrack-cli@0.3.0` | registry 发布是现实需求；不能把“迁移 npm 到 Bun”误解成停止 npm registry 分发。 |
| package 发布面 | `bun pm pack --dry-run` 当前包含 package metadata、LICENSE、双语 README 与 `dist/**` | 发布前必须验证 tarball allowlist，阻止源码、测试、session 或下载文件泄漏。 |
| 真实 smoke | `smoke:real` 使用真实账号与生产环境 | 只放在维护者本机/受控人工 checklist，绝不放入 hosted CI。 |
| Dependabot | GitHub 支持 Bun >=1.1.39 的文本 `bun.lock`，不支持旧 `bun.lockb` | 可以原生使用 Dependabot 的 `bun` ecosystem。 |
| npm OIDC | Trusted Publishing 需要 npm CLI >=11.5.1、Node >=22.14、GitHub-hosted runner、`id-token: write`、精确匹配的 `repository.url` | 这是 registry publish job 使用 Node/npm 的唯一例外；发布前补齐包元数据与 trusted publisher 配置。 |

`package.json` 已包含 OIDC 发布所需的仓库元数据：

```json
{
  "repository": {
    "type": "git",
    "url": "git+https://github.com/MarkChu-git/ontrack-cli.git"
  },
  "bugs": {
    "url": "https://github.com/MarkChu-git/ontrack-cli/issues"
  },
  "homepage": "https://github.com/MarkChu-git/ontrack-cli#readme",
  "publishConfig": {
    "access": "public"
  }
}
```

registry 发布仍默认关闭，直到维护者完成 Trusted Publisher 与受保护 Environment 的外部配置。

## 3. 目标流水线

```text
PR / push to master / tag
        │
        ▼
  CI: frozen install → typecheck → test+coverage → audit → build
        │
        ▼
  package verification: build one tgz → inspect → isolated CLI help
        │
        ├─────────────────────────────► merge gate
        │
protected vX.Y.Z tag
        │
        ▼
  Release: repeat all verification and produce the same single tgz
        │
        ▼
  draft GitHub Release (asset = verified tgz)
        │
        ▼
protected environment approval (release)
        │
        ├── registry disabled ─────────► publish GitHub Release
        │
        └── registry enabled ─► npm OIDC publish + provenance
                                   │
                                   ▼
                           registry metadata verification
                                   │
                                   ▼
                           publish GitHub Release
```

release 的关键顺序固定为：**生成并验证唯一 tgz → 建立 draft GitHub Release → `release` Environment 审批 → 可选 npm OIDC publish → registry 验证（仅 registry 启用时）→ 公开 GitHub Release**。无论 registry 是否启用，draft 都不得在缺少 `release` Environment 审批的情况下自动转正。GitHub Release 绝不以重新构建的第二份 tarball 替换已验证产物。

## 4. Workflow 蓝图

实际 workflow 是唯一可执行的来源：[ci.yml](../.github/workflows/ci.yml)、[dependency-review.yml](../.github/workflows/dependency-review.yml) 与 [release.yml](../.github/workflows/release.yml)。下面的片段保留为设计解释，并与实施时使用的完整 Action commit SHA 对齐。

### 4.1 `.github/workflows/ci.yml`

#### 触发、权限、并发

```yaml
name: CI

on:
  pull_request:
    branches: [master]
  push:
    branches: [master]
    tags: ['v*']
  merge_group:
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: ci-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true
```

如果仓库未启用 merge queue，删除 `merge_group` 即可。不要使用 `pull_request_target`，也不要在 PR job 提供任何 secret、`id-token: write` 或写权限。

#### 安装、缓存与验证 job

```yaml
jobs:
  verify:
    name: Verify Bun CLI
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
        with:
          persist-credentials: false
          fetch-depth: 0

      - uses: oven-sh/setup-bun@ecf28ddc73e819eb6fa29df6b34ef8921c743461
        with:
          bun-version: 1.3.14

      - uses: actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9
        with:
          path: ~/.bun/install/cache
          key: bun-${{ runner.os }}-1.3.14-${{ hashFiles('bun.lock') }}

      - name: Verify runtime
        run: test "$(bun --version)" = "1.3.14"

      - name: Install exactly from lockfile
        run: bun install --frozen-lockfile

      - run: bun run typecheck
      - run: bun test --coverage --coverage-reporter=text --coverage-reporter=lcov
      - run: bun audit
      - run: bun run build
      - run: bun dist/cli.js --help
      - run: bun dist/cli.js auth-method --help

      - name: Pack the already-built release candidate
        run: |
          mkdir -p artifacts
          VERSION="$(bun -e 'console.log(require("./package.json").version)')"
          bun pm pack --ignore-scripts --destination artifacts \
            --filename "ontrack-cli-${VERSION}.tgz"

      - name: Verify package contents and installed binary
        run: bun scripts/verify-package.ts artifacts/*.tgz

      - uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a
        with:
          name: ci-${{ github.sha }}
          path: |
            artifacts/*.tgz
            coverage/lcov.info
          if-no-files-found: error
          retention-days: 14
```

已实现的 `scripts/verify-package.ts` 是小型确定性脚本：列出 tarball；检查必需的 `package.json`、LICENSE、双语 README、`dist/cli.js`、运行时 `dist/lib/**`；拒绝 `src/**`、`test/**`、`.git/**`、`.env*`、`downloads/**`、session、coverage 与 `node_modules/**`；解包到临时目录并执行打包后的 CLI `--help`。其行为由 `test/verify-package.test.ts` 覆盖。

缓存只覆盖 Bun package cache，不缓存 `node_modules`、`dist`、浏览器 profile 或整个家目录。key 包含 OS、Bun 精确版本与 `bun.lock` hash，也不使用会取回过期依赖状态的宽泛 restore key。

`bun audit` 在当前依赖集没有漏洞时应是硬门禁。若未来有不可立即升级的 advisory，例外必须有 GHSA/CVE、风险说明、负责人和到期日；禁止把 audit 设置为 `continue-on-error`。

当前没有 linter/formatter，首期不伪造 `lint` job；等选定 Biome 或 ESLint 后再把 formatting/lint 作为独立质量门禁加入。

### 4.2 `.github/workflows/dependency-review.yml`

```yaml
name: Dependency review

on:
  pull_request:
    branches: [master]

permissions:
  contents: read

jobs:
  dependency-review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
        with:
          persist-credentials: false
      - uses: actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294
        with:
          fail-on-severity: high
          fail-on-scopes: runtime,development
```

公共仓库可直接使用 Dependency Review；若仓库转为私有，需要相应的 GitHub Code Security/Advanced Security 能力才能保持同一门禁。依赖 review 与 `bun audit` 互补：前者聚焦 PR 新引入的依赖差异，后者扫描当前完整 lockfile。

### 4.3 `.github/workflows/release.yml`

#### 触发、并发与分层权限

```yaml
name: Release

on:
  push:
    tags: ['v*']
  workflow_dispatch:
    inputs:
      tag:
        description: Existing vX.Y.Z tag to retry
        required: true
        type: string

permissions:
  contents: read

concurrency:
  group: release-${{ github.repository }}
  cancel-in-progress: false
```

release 必须串行，不能被新 tag 取消。workflow dispatch 只能重试已存在的 tag，不接受任意 commit SHA 或版本字符串。

建议 jobs：

1. `validate-and-pack`：只有 read 权限，checkout 选定 tag（完整历史，禁止 depth=1），重跑 CI 的 frozen install、typecheck、coverage、audit、build、package verification；输出唯一 tarball 与 SHA256 manifest。不绑定 `release` Environment，避免审批前无法重跑校验。
2. `create-draft-release`：仅授予 `contents: write`，以唯一 tgz 建立 draft GitHub Release。可用 `gh release create --draft`，凭据只在该 job 的 `GH_TOKEN: ${{ github.token }}` 中存在。draft 不是发布完成态。
3. `publish-npm`：只在 registry 发布开关已启用时执行；必须设置 `environment: release`，并授予 `contents: read` 与 `id-token: write`。
4. `verify-registry-and-publish-release`：必须设置 `environment: release`（registry-disabled 时这是唯一发布审批门；registry-enabled 时可与 `publish-npm` 共用同一环境保护）。registry-enabled 时先核对 registry metadata 与已验证 tgz 的 name/version/integrity，再公开 draft；registry-disabled 时跳过 registry 查询，但仍须在 Environment 审批通过后才执行 `gh release edit "$TAG" --draft=false`。该 job 需要 `contents: write`，且必须复用 `validate-and-pack` 的同一 artifact，禁止重建 tarball。

`environment: release` 是 GitHub Release 转正与 npm 发布的强制边界，不能只加在 YAML `if` 条件上，也不能仅保护 `publish-npm` 而让 registry-disabled 路径自动公开 draft。

每个消费 tarball 的下游 job 都必须重新下载 artifact，并在上传 GitHub Release 或发布 registry **之前**运行 `sha256sum --check`（或等价的跨平台校验），比对 `validate-and-pack` 产生的 manifest。不能只相信 artifact 名称、job dependency 或 Actions 传递成功；hash 不一致时整个 release 立即失败。

#### tag/version/source 校验

`validate-and-pack` 的第一阶段必须做到：

```bash
# checkout 后，TAG 为 vX.Y.Z，VERSION 来自 package.json
# 需要足够的 master 历史；--depth=1 会使非 tip 的合法 tag 误判为非 ancestor
test "${TAG#v}" = "$VERSION"
git fetch origin master --no-tags
test "$(git cat-file -t "$TAG")" = tag
SOURCE_SHA="$(git rev-list -n 1 "$TAG")"
git merge-base --is-ancestor "$SOURCE_SHA" origin/master
```

- tag 必须是 `v<package.json version>`，而不是仅匹配 `v*`。
- 无论由 tag push 还是 `workflow_dispatch` 触发，都以 tag peel 后的 `SOURCE_SHA` 为发行源；不能在手动重试时误用指向默认分支的 `GITHUB_SHA`。
- tag commit 必须来自 `master`；release 不接受 fork 或临时分支上的 tag。
- 只允许规范带注释 tag；建议后续启用 GitHub tag ruleset，并在维护者已建立 GPG/SSH signing 后加入 `git verify-tag`。
- registry publish 前执行 `npm view ontrack-cli@${VERSION}`：若该 immutable version 已存在则失败，绝不尝试覆盖。
- `workflow_dispatch` 时必须先验证 input tag 存在、格式正确、与包版本相同。

#### registry-disabled 的 Release 分支

当 repository variable（例如 `PUBLISH_TO_NPM`）不是显式 `true` 时：

1. `validate-and-pack` 成功；
2. `create-draft-release` 上传 asset；
3. 维护者通过 `release` Environment 审批（必要门禁，不得省略或改成仅人工看 draft 页面）；
4. `verify-registry-and-publish-release` 在审批通过后公开 GitHub Release；
5. Release notes 标示“registry publish 未启用”。

这允许项目先采用可靠的 GitHub Release artifact，而不要求立即配置 npm OIDC；但 GitHub Release 转正仍受 Environment 审批约束，不存在“registry 关闭即可自动公开”的旁路。

#### OIDC npm publish 分支

启用条件：

1. `package.json.repository.url` 与 GitHub repository 精确匹配；
2. npm package settings 中建立 Trusted Publisher：`MarkChu-git` / `ontrack-cli` / `release.yml` / Environment `release`，允许 `npm publish`；
3. 该 job 运行在 GitHub-hosted runner；
4. job 声明 `permissions: { contents: read, id-token: write }`；
5. Environment `release` 已设置维护者审批与 protected tag 限制。

publish job 安装 Node 24（满足 Node >=22.14）与 npm >=11.5.1；它不使用 npm 安装依赖，也不运行 npm build/test：

```yaml
- uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020
  with:
    node-version: '24'
    registry-url: https://registry.npmjs.org
    package-manager-cache: false
- run: npm --version
- run: npm publish "artifacts/ontrack-cli-${VERSION}.tgz" --provenance
```

不设置 `NODE_AUTH_TOKEN`、`NPM_TOKEN` 或长期 automation token。npm 将使用 GitHub OIDC 短时 token；公开 repo 的公开 package 通过 Trusted Publishing 会自动生成 provenance，`--provenance` 是明确的安全意图。若未来 Bun 官方记录了同等的 npm OIDC 支持，可以在独立决策后替换这一个窄边界，不能在没有证据时假设支持。

发布后查询 registry 并验证 name、version、integrity 与 tarball URL；验证成功才执行 `gh release edit "$TAG" --draft=false`。若发布失败，draft 保留用于诊断，绝不自动公开。

## 5. 覆盖率硬门禁

项目标准是 lines/functions 均至少 80%。CI 以 Bun LCOV 的 `LF/LH`、`FNF/FNH` 汇总字段做加权计算，不使用 Bun 文本表的逐文件平均值。受版本控制的门禁配置为：

```json
{
  "lines": 80,
  "functions": 80
}
```

覆盖门禁不排除任何源码文件。`src/lib/auto-login.ts` 通过窄 `BrowserLaunchAdapter` Seam 在无网络、无真实浏览器进程的情况下执行凭据捕获状态机；origin、cookie、storage、CAPTCHA、MFA 与引导式字段流都由确定性测试覆盖。parser 仍只接受精确的仓库相对 `.ts` 路径（如未来确有临时排除），拒绝 glob、绝对路径与 `..`，避免扩大排除面。

2026-07-31 LCOV 门禁实测：

- lines：82.32%（4285/5205）
- functions：87.15%（373/428）
- 测试：162/162

补测按风险和生产重要性实施，而不是只覆盖简单代码：

1. `auto-login`：origin 限制、browser state 过滤、失败清理。
2. API client：认证、非成功响应、上传/下载、生产合同漂移。
3. CLI：参数验证、`--json`、秘密字段回归。
4. session/discovery：损坏状态、缓存、fixture drift。
5. 稳定 mock/fixture 集成测试；真实 smoke 仍保持人工执行。

阈值不得降低来让 PR 通过；未来可以提高到当前实测值，或在 Bun 提供稳定 branches/stmts 后通过独立决策增加指标。

## 6. 依赖更新与供应链管理

首期选择 Dependabot，而非 Renovate：它不需要额外 GitHub App 或 bot，并且 GitHub 已支持 Bun 文本 `bun.lock`。

```yaml
version: 2
updates:
  - package-ecosystem: bun
    directory: /
    schedule:
      interval: weekly
    open-pull-requests-limit: 5
    groups:
      development-dependencies:
        dependency-type: development
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
```

不要对 Bun major、TypeScript major、Playwright major 或 GitHub Action major 自动合并。只有在建立明确 policy、通过所有 required checks 并经审查后，才考虑对低风险 patch dev dependency 启用自动合并。Renovate 只在需要跨仓库 grouping、复杂 automerge 或更强 dependency policy 时再评估。

Actions 使用 SHA pinning，Dependabot 负责产生更新 PR。每个 Action 仍需选用官方或 verified publisher，且 workflow 不下载/执行浮动版本的远程脚本。

## 7. 安全、artifact 与真实环境边界

### 最小权限

- CI 和 Dependency Review：`contents: read`。
- GitHub Release job：增加 `contents: write`，且仅限该 job。
- npm OIDC publish job：`contents: read` + `id-token: write`，不需要 package write 或 repository write。
- 如未来采用 GitHub artifact attestation，单独增加 `attestations: write`，而不是全局授权。

### Artifact retention

- PR 的 coverage 与 release-candidate tgz：14 天。
- `master`/tag 的 CI artifact：30 天。
- 正式 GitHub Release asset 作为长期 release record，不依赖 Actions artifact retention。
- 不上传 `node_modules`、整个 Bun home、cookie、session、浏览器 profile、screenshots、下载文件、`.env` 或真实 smoke 日志。

### 真实 OnTrack 环境

生产 smoke 只作为发布前人工 checklist：维护者在本机使用有效 session 运行只读 `smoke:real`，并确认它没有 upload、comment、日期修改、tutorial/group 变更或 Portfolio 写入。GitHub Actions 不保存也不接收任何 OnTrack credential。

## 8. 发布失败恢复与回滚

| 场景 | 正确处理 |
| --- | --- |
| typecheck/test/audit/pack 失败 | 修复 PR，不绕过 required check。 |
| tag 与 package version 不一致 | 若未推远，修正本地 tag；若已推远，不重用 tag，建立新 patch version。 |
| draft Release 创建/校验失败 | 保留现场并调查；仅当 draft 恰好只有同名 tgz 且 SHA256 一致时允许同一 tag 重跑，禁止 `--clobber` 或发布含额外 asset 的 draft。 |
| npm OIDC 认证失败 | 检查 runner 类型、`id-token: write`、trusted publisher 的 owner/repo/workflow/environment 与 `repository.url`；不临时退回长期 token。 |
| npm publish 成功但 GitHub Release 未公开 | 保留 draft，验证 registry metadata 后重跑公开步骤。 |
| 已发布版本有缺陷 | 发布新 patch，使用 `npm deprecate ontrack-cli@bad-version "reason"`，把 `latest` 指向修复版；保留历史 tag，不 force-push、不 retag、不覆盖 immutable version。 |
| 供应链事件 | 暂停 `release` Environment、撤销旧 token、关闭 automerge、锁定受影响版本并走 hotfix。 |
| OnTrack 生产合同变化 | 先更新 fixture/计划与人工只读 smoke，不能以 CI secret 或自动写入来“验证”。 |

## 9. 分阶段实施与验收标准

### Phase 0：治理准备

- 确认并推送历史 tag 的意图。
- 配置 `master` branch protection：required CI、dependency review、至少一位 review、禁止 force push、要求解决讨论。
- 建立 protected `release` Environment。
- 在发布元数据 PR 中补充 repository/bugs/homepage/publishConfig。

验收：远端历史与 npm 公共版本可追溯；未来 tag 不能绕过审查与 release approval。

### Phase 1：CI 与 GitHub Release artifact

- 已实现 `ci.yml`、`dependency-review.yml`、package verification、coverage gate、Dependabot。
- 已实现 tag/version/source 校验和 draft GitHub Release asset。
- 用一个新的 prerelease 或 patch tag 做演练。

验收：PR/push/tag 都执行稳定验证；失败阻止合并；Release asset 可被隔离安装并执行 `ontrack --help`；普通 CI 没有 secrets 或写权限。

### Phase 2：Coverage ratchet 与 OIDC registry 发布

- 已建立 LCOV 80/80 硬门禁。
- 已补足高风险代码测试，LCOV 门禁实测 82.32/87.15。
- 建立 npm Trusted Publisher，完成一次受保护的 OIDC 发布演练。
- 成功后撤销旧 automation token（如有）。

验收：lines 与 functions 均不低于 80%；npm 包拥有 provenance；tag、package version、tarball SHA、GitHub Release 与 registry metadata 完全一致。

### Phase 3：可选增强

- 选型并加入 Biome/ESLint formatting gate。
- CodeQL 周期扫描。
- GitHub artifact attestation。
- 基于稳定 fixture 的跨 OS CLI integration matrix。

## 10. 已决策与管理面 Gates

仓库实现采用以下决策；需要 GitHub/npm 管理权限的项目仍按 runbook 显式配置，workflow 不隐式猜测：

1. 历史 `v0.2.0`/`v0.3.0` 是否应推送到 origin。
2. tag 后始终先 draft，再经 `release` Environment 审批。
3. npm registry 是可选正式发行渠道；registry 成功并校验后才公开 GitHub Release。
4. 80% 使用加权 lines/functions 双指标；branches/stmts 留待 Bun 稳定支持后另行决策。
5. 所有第三方 Action 使用完整 SHA pinning，并由 Dependabot 更新。
6. lint/format 工具选择是否与基础 CI 分开（推荐分开，避免扩大首期风险）。

## 11. 官方来源

- [GitHub Dependabot 支持的生态与 Bun 文本 lockfile](https://docs.github.com/en/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories)
- [GitHub Dependabot 配置选项](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference)
- [GitHub Dependency Review](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependency-review)
- [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)
- [npm provenance](https://docs.npmjs.com/generating-provenance-statements/)
- [oven-sh/setup-bun GitHub Action](https://github.com/oven-sh/setup-bun)
