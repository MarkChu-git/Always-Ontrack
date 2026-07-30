# OnTrack CLI CI/CD 设计（仅计划）

> 状态：设计提案，2026-07-31。本文**没有**新增 GitHub Actions workflow、没有变更业务代码、没有启用 registry 发布；它定义后续实施时应遵循的发布与验证合同。

## 1. 结论与范围

OnTrack CLI 是一个 Bun 1.3.14 驱动的 TypeScript 命令行工具，而不是部署到服务器的 Web 服务。因此本项目的 CD 指的是：可复现地构建一个 npm-compatible tarball、将其作为 GitHub Release asset 保存、并在明确启用后以受保护的 OIDC 身份发布到 npm registry。

开发、测试、类型检查、构建和打包一律使用 Bun。npm CLI 只在 registry 发布这个窄传输边界使用，因为 npm Trusted Publishing 的 OIDC 文档目前以 npm CLI 为发布端；在 Bun 官方明确支持 npm OIDC 发布之前，不把 `npm publish` 扩展到日常开发或 CI 依赖管理。

本设计的目标：

- PR 与 `master` 上的变更得到可复现、最小权限的质量验证。
- 只有经验证、可安装的唯一 `.tgz` 可以成为 Release asset 或 registry 包。
- tag、`package.json` version、GitHub Release 与 npm registry version 严格一致。
- 不把真实 OnTrack 账号、session、cookie、token 或会产生写入的 smoke test 放进 GitHub Actions。
- 从当前 lines 71.73%、functions 76.00% 的覆盖率稳步提升到项目要求的 80%，期间不允许回退。

## 2. 已核对的事实与约束

| 项目 | 当前事实 | 对设计的影响 |
| --- | --- | --- |
| 默认分支 | `master` | 所有 branch protection 与 PR 触发器以 `master` 为目标。 |
| 版本 | `package.json` 为 `0.3.0` | Release tag 必须严格为 `v0.3.0` 形式，并与包版本去掉 `v` 后相同。 |
| 历史 tag | 本地有带注释的 `v0.2.0`、`v0.3.0`，远端尚未发现它们 | 在启用 tag-triggered release 前，先确认并推送应保留的历史 tag。 |
| package manager | `bun.lock`、`packageManager: bun@1.3.14`、`engines.bun: >=1.3.14` | CI 固定 Bun 1.3.14，使用 `bun install --frozen-lockfile`。 |
| 现有 workflow | 无 `.github/workflows/` | 本文提供蓝图，后续单独 PR 实现。 |
| 公共发行 | npm registry 已有 `ontrack-cli@0.3.0` | registry 发布是现实需求；不能把“迁移 npm 到 Bun”误解成停止 npm registry 分发。 |
| package 发布面 | `bun pm pack --dry-run` 当前包含 package metadata、LICENSE、双语 README 与 `dist/**` | 发布前必须验证 tarball allowlist，阻止源码、测试、session 或下载文件泄漏。 |
| 真实 smoke | `smoke:real` 使用真实账号与生产环境 | 只放在维护者本机/受控人工 checklist，绝不放入 hosted CI。 |
| Dependabot | GitHub 支持 Bun >=1.1.39 的文本 `bun.lock`，不支持旧 `bun.lockb` | 可以原生使用 Dependabot 的 `bun` ecosystem。 |
| npm OIDC | Trusted Publishing 需要 npm CLI >=11.5.1、Node >=22.14、GitHub-hosted runner、`id-token: write`、精确匹配的 `repository.url` | 这是 registry publish job 使用 Node/npm 的唯一例外；发布前补齐包元数据与 trusted publisher 配置。 |

当前 `package.json` 还应在 OIDC 发布前补充：

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

这是后续实施项，不是本文实施的改动。

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

以下是实现时的精确结构蓝图；占位的 `<PINNED_SHA>` 必须替换为完整 commit SHA，不能长期使用浮动 tag。

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
      - uses: actions/checkout@<PINNED_SHA>
        with:
          persist-credentials: false
          fetch-depth: 0

      - uses: oven-sh/setup-bun@<PINNED_SHA>
        with:
          bun-version: 1.3.14

      - uses: actions/cache@<PINNED_SHA>
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

      - uses: actions/upload-artifact@<PINNED_SHA>
        with:
          name: ci-${{ github.sha }}
          path: |
            artifacts/*.tgz
            coverage/lcov.info
          if-no-files-found: error
          retention-days: 14
```

实现时 `scripts/verify-package.ts` 应为小型确定性脚本：列出 tarball；检查必需的 `package.json`、LICENSE、README、`dist/cli.js`、运行时 `dist/lib/**`；拒绝 `src/**`、`test/**`、`.git/**`、`.env*`、`downloads/**`、session、coverage 与 `node_modules/**`；解包到临时目录并在隔离位置安装/执行 `ontrack --help`。当前仓库尚无此脚本，因此上面仅为 blueprint。

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
      - uses: actions/checkout@<PINNED_SHA>
        with:
          persist-credentials: false
      - uses: actions/dependency-review-action@<PINNED_SHA>
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
- uses: actions/setup-node@<PINNED_SHA>
  with:
    node-version: '24'
    registry-url: https://registry.npmjs.org
    package-manager-cache: false
- run: npm --version
- run: npm publish "artifacts/ontrack-cli-${VERSION}.tgz" --provenance
```

不设置 `NODE_AUTH_TOKEN`、`NPM_TOKEN` 或长期 automation token。npm 将使用 GitHub OIDC 短时 token；公开 repo 的公开 package 通过 Trusted Publishing 会自动生成 provenance，`--provenance` 是明确的安全意图。若未来 Bun 官方记录了同等的 npm OIDC 支持，可以在独立决策后替换这一个窄边界，不能在没有证据时假设支持。

发布后查询 registry 并验证 name、version、integrity 与 tarball URL；验证成功才执行 `gh release edit "$TAG" --draft=false`。若发布失败，draft 保留用于诊断，绝不自动公开。

## 5. 覆盖率 Ratchet

项目标准是至少 80%，但当前覆盖率尚未达到。门禁应分三阶段推进：

### Phase A：可见性

- 在每次 CI 运行 `bun test --coverage --coverage-reporter=lcov`。
- 上传 `coverage/lcov.info`，并在日志显示 summary。
- 先验证 GitHub Linux runner 与本地的 lines 71.73%、functions 76.00% 基线一致。
- 此阶段不设 threshold，避免首次引入 CI 时把现有主线错误标红。

### Phase B：无回归

新增受版本控制的 coverage threshold 文件与 LCOV parser，基线为：

```json
{
  "lines": 71.73,
  "functions": 76.0
}
```

parser 必须排除测试和生成输出，低于任一指标即失败，并输出当前值、要求值与主要低覆盖文件。阈值配置只能提高；任何下降必须经维护者显式审批并附带事故/迁移说明。

### Phase C：达到 80%

按风险和生产重要性补测试，而不是只覆盖简单代码：

1. `auto-login`：origin 限制、browser state 过滤、失败清理。
2. API client：认证、非成功响应、上传/下载、生产合同漂移。
3. CLI：参数验证、`--json`、秘密字段回归。
4. session/discovery：损坏状态、缓存、fixture drift。
5. 稳定 mock/fixture 集成测试；真实 smoke 仍保持人工执行。

逐档提升 lines/functions：`71.73/76 → 74/78 → 76/80 → 78/80 → 80/80`。每一档达成后立即提高 gate。到 80% 后再评估是否加入 branches/stmts 指标。

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
| draft Release 上传失败 | 修复 workflow 后针对同一 tag 重跑；asset upload 使用幂等 `--clobber`。 |
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

- 实现 `ci.yml`、`dependency-review.yml`、package verification、coverage visibility、Dependabot。
- 实现 tag/version/source 校验和 draft GitHub Release asset。
- 用一个新的 prerelease 或 patch tag 做演练。

验收：PR/push/tag 都执行稳定验证；失败阻止合并；Release asset 可被隔离安装并执行 `ontrack --help`；普通 CI 没有 secrets 或写权限。

### Phase 2：Coverage ratchet 与 OIDC registry 发布

- 建立 LCOV 无回归 gate。
- 逐阶段补足高风险代码的测试并升到 80%。
- 建立 npm Trusted Publisher，完成一次受保护的 OIDC 发布演练。
- 成功后撤销旧 automation token（如有）。

验收：lines 与 functions 均不低于 80%；npm 包拥有 provenance；tag、package version、tarball SHA、GitHub Release 与 registry metadata 完全一致。

### Phase 3：可选增强

- 选型并加入 Biome/ESLint formatting gate。
- CodeQL 周期扫描。
- GitHub artifact attestation。
- 基于稳定 fixture 的跨 OS CLI integration matrix。

## 10. Decision Gates

以下决定必须在实施前由维护者确认，不能由 workflow 隐式猜测：

1. 历史 `v0.2.0`/`v0.3.0` 是否应推送到 origin。
2. tag 后是自动公开 Release，还是始终先 draft + Environment 审批（推荐后者）。
3. npm registry 是否是正式发行渠道；启用时是否接受“registry 成功后才公开 GitHub Release”的顺序（推荐接受）。
4. 80% 是否以 lines/functions 双指标为合规口径，及之后是否加入 branches/stmts。
5. 是否在首期就采用完整 SHA pinning（推荐是）并接受 Dependabot 对 Action SHA 的更新 PR。
6. lint/format 工具选择是否与基础 CI 分开（推荐分开，避免扩大首期风险）。

## 11. 官方来源

- [GitHub Dependabot 支持的生态与 Bun 文本 lockfile](https://docs.github.com/en/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories)
- [GitHub Dependabot 配置选项](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference)
- [GitHub Dependency Review](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependency-review)
- [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)
- [npm provenance](https://docs.npmjs.com/generating-provenance-statements/)
- [oven-sh/setup-bun GitHub Action](https://github.com/oven-sh/setup-bun)
