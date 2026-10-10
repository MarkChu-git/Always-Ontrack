# OnTrack CLI CI/CD 设计

> 状态：2026-10-09 依据本机的 `cicd-blueprint` skill 重新设计，在 `claude/ci-pipeline` 分支实施。本文既是这次改造的 spec，也是 CI/CD 的现行设计说明。可执行的唯一来源是 `.github/workflows/` 与 `package.json` scripts；本文只写它们必须满足的不变量，不复制 YAML。GitHub/npm 管理面的设置见 [RELEASE_RUNBOOK.md](./RELEASE_RUNBOOK.md)。

## 1. 范围与目标

OnTrack CLI 是用 Bun 1.3.14 构建、发布到 npm 的 TypeScript CLI。从 3.0.0 起它只有 `ontrack` 一个可执行入口。它不是部署到服务器的服务，所以这里的 CD 指：可复现地构建唯一一个 npm tarball，作为 GitHub Release asset 保存，并在 `release` Environment 审批后通过 OIDC 发布到 npm。

2026-10-09 与维护者确认了四个目标：

1. **速度**：PR 反馈从串行的约 2 分 15 秒降到约 1 分 30 秒。
2. **不被上游卡住**：上游新公布的 advisory 不再让没改依赖的 PR 变红；release 仍然拒绝带着已知漏洞发布。
3. **安全加固**：workflow 本身受扫描；release 不使用缓存；发布物带构建证明；依赖的新版本至少放置 7 天才采用。
4. **可维护性**：验证命令只在 `package.json` 里定义一次，本地、CI、release 与 runbook 共用。

## 2. 已核对的事实（2026-10-09）

| 项目 | 事实 | 对设计的影响 |
| --- | --- | --- |
| 运行时 | `packageManager: bun@1.3.14`，`engines.bun: >=1.3.14` | CI 与 release 固定在最低支持版本 Bun 1.3.14 |
| Node | GitNexus 的 LadybugDB 需要 Node ≥22；npm Trusted Publishing 需要 npm ≥11.5.1；TypeScript 7 的 `tsc` 启动器是 `#!/usr/bin/env node` 脚本 | 运行 `tsc` 的 job 与 GitNexus job 安装 Node 24.21.0（2026-09-07 发布）；不装就会用 runner 镜像自带的 Node |
| GitNexus | 全局安装 1.6.9，registry 隔离在 `.gitnexus-home/` | 只在 `graph` job 安装，单独缓存 |
| CI 基线 | 单个串行 job。2026-10-08 的三次运行：setup 约 15 秒，GitNexus 21–22 秒，test 与 coverage 54–64 秒，TUI smoke 26 秒，合计约 2 分 15 秒 | 并行拆分后，关键路径是 test 与 coverage |
| 依赖图 | GitHub 依赖图只解析 `package.json` 的版本范围和 Actions，共 17 项，不解析 `bun.lock` | Dependency review 看不见传递依赖，也看不见只改 lockfile 的升级（PR #73 的 Dependency review 报告没有依赖变化）；lockfile 的漏洞门禁只能靠 `bun audit` |
| audit 痛点 | `bun audit` 扫描整个 lockfile、任何级别都算失败，而它在 required check 里 | 2026-09-17 到 2026-10-08，新 advisory 让 master 和所有 PR 一起变红；见 §5 |
| `bun audit --json` | Bun 1.3.14 只需要 `package.json` 与 `bun.lock`，不需要 `node_modules`。输出形如 `{包名: [{id, url, title, severity, vulnerable_versions, ...}]}`；有 advisory 时退出码为 1，没有时输出 `{}` | 可以在临时目录里审计 base 的 lockfile |
| ruleset | `Default` ruleset 要求 `Verify Bun CLI` 与 `Dependency review` 两个 check（strict），并有 CodeQL code-scanning 门禁 | 汇总 job 必须继续叫 `Verify Bun CLI` |
| CodeQL | GitHub default setup，覆盖 actions 与 javascript-typescript | 不新增 `codeql.yml` |
| 秘密扫描 | GitGuardian app 扫描 PR；2026-10-09 开启了 GitHub secret scanning 与 push protection | 不加 gitleaks |
| Dependabot | bun 与 github-actions 每周更新；2026-10-09 开启了 Dependabot alerts 与 security updates | 加 cooldown 与 opentui 分组，见 §6 |

## 3. 命令分层

所有验证逻辑都写成 `package.json` script。workflow 只调用这些 script，不写内联的验证逻辑。唯一的例外是 `hygiene` job 的 actionlint、zizmor 与 shellcheck：它们只在 CI 运行，用的是 CI 安装的锁定版本（§6），所以 workflow 直接调用它们，`verify` 也不包含它们。

| 命令 | 内容 | 谁调用 |
| --- | --- | --- |
| `verify:fast` | `typecheck`、`typecheck:tui`、`bun test` | 开发者每次改动后 |
| `verify` | `skills:check`、`typecheck`、`typecheck:tui`、`test:coverage`、`test:tui`、`build`、`smoke:dist`、`package:verify` | 发布前在本机运行；release job |
| `smoke:dist` | `scripts/smoke-dist.ts`：检查构建产物的 `--help`、TUI bundle 是否存在、`schema auth.method` 与 `capabilities` 的 agent-json 输出 | CI 的 `package` job；`verify` |
| `package:verify` | `scripts/pack-and-verify.ts`：运行 `bun pm pack --ignore-scripts` 后用 `verify-package.ts` 校验。设置了 `PACKAGE_OUTPUT_DIR` 就把 tgz 留在该目录（必须在包根目录之内，CI 与 release 用 `artifacts`），否则用临时目录并在结束后删除 | CI 的 `package` job；`verify`；release |
| `verify:graph` | `gitnexus:analyze`、`gitnexus:status`、`gitnexus:check`、`gitnexus:mcp:check` | CI 的 `graph` job；release |
| `audit:check` | `scripts/check-audit.ts`，见 §5 | CI 的 `audit` job；release |

`smoke:dist` 必须离线：它在临时的 `HOME` 与 `XDG_CONFIG_HOME` 下运行，并把 `ONTRACK_BASE_URL` 指向一个拒绝连接的 loopback 地址。`auth-method --help` 之类会访问生产 API 的命令不进入任何门禁。

`test/workflow-security.test.ts` 断言 workflow 调用了这些 script，也断言 `verify` 包含上表列出的门禁，防止有人从 script 里删掉门禁后 CI 仍然是绿的。

`verify:graph` 需要全局安装的 GitNexus 1.6.9（见 [docs/agents/gitnexus.md](./agents/gitnexus.md)），所以不放进 `verify`。如果本机 PATH 上是别的 GitNexus 版本，`gitnexus:status` 可能报 stale，此时以 CI 结果为准。

## 4. CI（`.github/workflows/ci.yml`）

触发：`pull_request`（master）、`push`（master）、`merge_group`、每日定时、`workflow_dispatch`。CI 不再在 tag 上运行，因为 release workflow 会对 tag 完整重跑验证。权限：workflow 级只有 `contents: read`，所有 checkout 都设置 `persist-credentials: false`。并发：同一个 PR 或 ref 的新运行取消旧运行。

| Job | 内容 | 说明 |
| --- | --- | --- |
| `test` | 安装 Node 与依赖 → `typecheck` 与 `typecheck:tui` → `test:coverage` → 上传 coverage | 关键路径；coverage 在失败时也上传（`if: always()`） |
| `tui` | 安装依赖 → `test:tui` | |
| `package` | 安装 Node 与依赖 → `build` → `smoke:dist` → `package:verify`（`PACKAGE_OUTPUT_DIR=artifacts`）→ 上传 tgz | tgz 只在成功时上传，并设置 `if-no-files-found: error` |
| `graph` | 安装 Node 与依赖 → 全局 GitNexus 1.6.9 → `verify:graph` | 唯一使用 Bun 缓存的 job；需要完整 git 历史 |
| `audit` | `audit:check`：PR 与 merge queue 用 `--base`，其它事件做全量审计 | 需要完整 git 历史，才能取出 base commit 的 lockfile；不需要安装依赖 |
| `hygiene` | `skills:check` → 安装锁定版本的 actionlint 与 zizmor → `actionlint` → `zizmor` → `shellcheck` | 不需要安装依赖；见 §6 |
| `gate`（显示名 `Verify Bun CLI`） | `needs` 上面全部 job，`if: always()`，任何一个结果不是 `success` 就失败 | ruleset 要求的唯一 CI check |

汇总 job 必须设 `if: always()` 并显式检查每个结果。GitHub 文档写明，被跳过的 job 报告的状态是 Success，即使它是 required check 也不会阻止合并。如果上游 job 失败导致汇总 job 被跳过，PR 就会被错误放行。

缓存：项目依赖只有约 50 个包，不用缓存时 `bun install` 也只要几秒，所以只有 `graph` job 缓存 Bun 安装目录（全局 GitNexus 的依赖树很大）。缓存 key 包含 OS、Bun 版本、GitNexus 版本和 `bun.lock` 的 hash。release 不使用任何缓存。

安装：每个 `bun install` 都带 `--frozen-lockfile --ignore-scripts`。根目录的 `prepare` script 会运行完整构建，不加这个参数，安装时就会多构建一次，release 也做不到构建只发生一次（§7）。`test/workflow-security.test.ts` 断言每个 workflow 都这样安装。

预期耗时：关键路径（`test` job）约 75–85 秒，加上汇总 job 的启动时间，PR 反馈约 1 分 30 秒。

## 5. 依赖漏洞审计（`scripts/check-audit.ts`）

两种模式：

- **全量**：`bun run audit:check`。在仓库根目录运行 `bun audit --json`，有任何 advisory 就失败并列出。用于 master push、每日定时、手动运行与 release。
- **对比**：`bun run audit:check -- --base <commit>`。用于 PR（base 为 `pull_request.base.sha`）与 merge queue（base 为 `merge_group.base_sha`）。
  1. 如果 `package.json` 与 `bun.lock` 相对 base 都没变，输出 SKIP 并成功退出。PR 不改依赖就不可能引入依赖漏洞；新公布的 advisory 由全量审计负责。
  2. 否则把 base 的 `package.json` 与 `bun.lock` 写进临时目录审计一次，再审计 head。只有 head 有而 base 没有的 advisory（按包名加 advisory URL 判定）才算失败；从 base 继承的 advisory 打印为警告。

任何一侧 `bun audit` 的退出码不是 0 或 1，或者输出不是 JSON 对象，都算失败（fail closed）。审计服务出故障不能被当成没有漏洞。

效果：上游出现新 advisory 时，master 与每日定时运行会变红，GitHub 会通知维护者，但没改依赖的 PR 不受影响。Dependabot 的修复 PR 只要不引入新 advisory 就能合并。release 用全量模式，仍然拒绝任何已知 advisory。

例外：目前没有。如果某个 advisory 一时无法修复，就在 `check-audit.ts` 里加一份显式忽略列表，每一项写明 GHSA 编号、风险、负责人与到期日。禁止对 audit 使用 `continue-on-error`。

`Dependency review` workflow 保留。它仍覆盖 `package.json` 直接依赖与 GitHub Actions 的变化，也是 ruleset 要求的 check。

## 6. Workflow 与供应链加固

- **扫描 workflow**：`hygiene` job 用 `scripts/ci/install-pinned-tools.sh` 安装 actionlint 1.7.12 与 zizmor 1.30.1 的 linux x86_64 二进制，安装前按 SHA-256 校验。校验值取自上游 GitHub release 的 asset digest，不取自下载下来的文件；2026-10-09 核对过：actionlint 为 `8aca8db9…49a3d8`，zizmor 为 `e65324f4…b46e1a`。shellcheck 用 runner 镜像自带的版本（ubuntu-24.04 上是 0.9.0），actionlint 也会用它检查 `run:` 脚本。zizmor 以离线模式扫描 `.github/`，包括 workflow 与 `dependabot.yml`。现有 finding 在同一个分支修掉；确实要接受的写进 `.github/zizmor.yml` 并注明原因。
- **Actions 固定到 commit SHA**，带版本注释，由 Dependabot 更新。这一条是现状，保持不变。
- **Dependabot**：bun 与 github-actions 都设置 `cooldown.default-days: 7`。cooldown 只作用于版本更新，安全更新不受影响。新增 `@opentui/*` 分组，core 与 react 必须一起升级。2026-09 这两个包被拆成 #74、#75 分别升级，装出了两份 `@opentui/core`，类型检查因此失败。
- **本地的 7 天规则**：`bunfig.toml` 设置 `install.minimumReleaseAge = 604800`，本地的 `bun add` 与 `bun update` 只解析发布满 7 天的版本。它只影响新版本的解析，已经写进 `bun.lock` 的版本照常安装；2026-10-09 用 Bun 1.3.14 验证过 `--frozen-lockfile` 不受影响。如果需要一个不满 7 天的安全修复，就把该包写进 `minimumReleaseAgeExcludes`，等修复版本满 7 天后再移除。已知风险：如果 Dependabot 的 bun 更新器也读取这个设置，它可能解析不出不满 7 天的安全修复；遇到时按上面的例外办法手动开 PR。
- **release 不使用缓存**：去掉 `actions/cache`，`setup-bun` 设置 `no-cache: true`，避免 tag 构建读到可能被投毒的缓存。
- **tag 输入**：手动重试时输入的 tag 必须匹配严格的 semver 正则 `^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$`。现有校验是 glob `v[0-9]*.[0-9]*.[0-9]*`，像 `v1.2.3x` 这样的输入也能通过，而且 tag 会先用于 checkout，之后才与版本号比对。运行本身也必须来自这个 tag（`GITHUB_REF` 等于 `refs/tags/<tag>`）：构建证明记录的是运行的 ref 与 commit，从 master 发起的重试会把 master 记成来源，所以它在构建前就失败，并提示用 `gh workflow run release.yml --ref <tag> -f tag=<tag>` 重试。
- **构建证明**：`create-draft-release` job 已经有 `contents: write`，再加上 `id-token: write` 与 `attestations: write`。在核对 tgz 的 SHA-256 之后、创建 draft 之前，用 `actions/attest` v4.2.2（SHA `1e69f48…`）为这个 tgz 生成 build provenance。attestation 保存在 GitHub 的 attestation API 里，不是 release asset，所以"draft 恰好只有一个 tgz"的约定不变。下载的人可以用 `gh attestation verify ontrack-cli-X.Y.Z.tgz --repo MarkChu-git/Always-Ontrack` 校验；npm 上的同一个 tarball 继续由 `npm publish --provenance` 提供 provenance。负责构建与测试的 `validate-and-pack` job 仍然只有读权限。
- **版本**：Node 从 24.18.0 升到 24.21.0，涉及 CI、release 与 TypeScript portability。`actions/setup-node` v7.1.0、`upload-artifact` v7.0.2、`download-artifact` v8.0.2 在 2026-10-07 与 10-08 刚发布，按 7 天规则等 Dependabot 来升。

## 7. Release（`.github/workflows/release.yml`）

流程与不变量保持不变：`validate-and-pack`（只读）→ `create-draft-release`（`contents: write` 加构建证明）→ `release` Environment 审批 → `publish-npm`（OIDC，仅当 `PUBLISH_TO_NPM=true`）→ `verify-registry-and-publish-release`。

改动：

1. `validate-and-pack` 依次运行 `bun run verify`、`bun run verify:graph`、`bun run audit:check`（全量）。运行 `verify` 时设置 `PACKAGE_OUTPUT_DIR=artifacts`，所以校验过的 tgz 就是要发布的那个，之后只做 `test -f` 与 SHA-256 manifest。构建只发生一次。
2. 不使用缓存（§6）。
3. tag 输入使用严格的 semver 正则（§6）。
4. 生成构建证明（§6）。

保持不变的约束：tag 必须是 annotated tag；tag 等于 `v` 加 package.json 的版本号；tag 指向的 commit 必须是 `origin/master` 的祖先；draft 只能有一个 tgz，且 SHA-256 一致；npm 上已存在的版本不覆盖；registry integrity 校验通过后才公开 GitHub Release；公开 draft 必须经过 `release` Environment 审批。

## 8. 覆盖率门禁

`config/coverage-thresholds.json` 要求 LCOV 加权的 lines 与 functions 都不低于 80%，且不排除任何文件。2026-10-09 在 `claude/remove-auth-mcp` 上实测：lines 89.73%（12858/14330），functions 90.29%（1135/1257），共 554 个测试。阈值不能为了让 PR 通过而降低。Bun 不会把子进程的 coverage 计数合并进父进程的 LCOV，所以进程入口的 CLI Adapter 由 spawn 子进程的 E2E 测试覆盖。

## 9. 安全边界

- PR 与 master 的 CI 没有任何 secret、写权限或 `id-token: write`，也不使用 `pull_request_target`。
- 写权限只出现在 release 的三个 job：`create-draft-release`（contents、id-token、attestations）、`publish-npm`（id-token，`release` Environment）、`verify-registry-and-publish-release`（contents，`release` Environment）。
- artifact 保留期：CI 的 coverage 与 tgz 为 14 天，release 的 tgz 为 30 天；GitHub Release asset 是长期记录。不上传 `node_modules`、Bun home、cookie、session、浏览器 profile、下载的文件或 `.env`。
- 真实 OnTrack 账号只用于维护者在本机运行的只读 `smoke:real`，从不进入 GitHub Actions。

## 10. 失败时怎么处理

| 场景 | 处理 |
| --- | --- |
| PR 的 `Verify Bun CLI` 失败 | 看是哪一个上游 job 失败，修复后重跑；不绕过 required check |
| master 或每日定时运行的 `audit` 失败 | 上游出现了新 advisory：开修复 PR（`bun update <包>` 或提高版本下限）；修复版本不满 7 天时按 §6 加例外 |
| PR 上的对比式 audit 失败 | 这个 PR 引入了新 advisory：换一个版本或去掉该依赖 |
| zizmor 或 actionlint 报错 | 修 workflow；确实要接受的写进 `.github/zizmor.yml` 并注明原因 |
| tag、版本或祖先校验失败 | 不重用已推送的 tag，发新的 patch 版本 |
| draft 的 asset 数量或 SHA-256 不符 | 停下来调查，不覆盖也不公开 |
| npm OIDC 失败 | 检查 Trusted Publisher、`release.yml`、Environment、`repository.url` 与 `id-token: write`；不用长期 token 绕过 |
| 已发布的版本有缺陷 | 发新的 patch 版本，对旧版本运行 `npm deprecate`；不覆盖已发布的版本 |

## 11. 没有采用的 blueprint 内容

| blueprint 项 | 原因 |
| --- | --- |
| preview、deploy、1%→100% 灰度、k6、Lighthouse | 没有部署的服务；npm 版本发布后不可变 |
| performance 基准 | CLI 没有性能 SLO |
| branch-name 门禁 | 维护者的分支前缀是 `claude/`，Dependabot 的是 `dependabot/`；单人维护，收益低 |
| gitleaks | GitGuardian 与 GitHub secret scanning、push protection 已经覆盖 |
| osv-scanner | 与 `bun audit` 重复；对比式审计已经解决了 PR 被卡住的问题 |
| Semgrep 策略规则 | 没有组织级规则 |
| `codeql.yml` | default setup 已经作为门禁写在 ruleset 里 |
| 升级到 Bun 1.4 | `engines.bun >=1.3.14` 是对用户的承诺，CI 固定在最低支持版本；提高下限要单独决定 |
| 升级 GitNexus 1.6.9 | 牵涉 skills 同步检查与索引的存储格式，单独处理 |
| 测试分片 | Bun 的 LCOV 要合并后才能计算覆盖率；`test/e2e.test.ts` 里 7 个用例各等待约 2 秒，先优化这些等待更划算 |

## 12. 验收标准

1. 本分支的 PR 上，所有 job 成功时 `Verify Bun CLI` 通过，耗时约 1 分 30 秒。在 PR 里记录与 2026-10-08 基线（2 分 15 秒）的对比。
2. 任何一个 job 失败时，`Verify Bun CLI` 都失败。汇总逻辑由 `test/workflow-security.test.ts` 断言。
3. `check-audit.ts` 的单元测试覆盖四种情况：依赖没变时 SKIP、继承来的 advisory 不导致失败、新增的 advisory 导致失败、非 JSON 输出导致失败。
4. `hygiene` job 中的 actionlint 与 zizmor 没有未处理的 finding。
5. `bun run verify` 在本机通过；RELEASE_RUNBOOK 的本地验证清单只剩 script 调用。
6. release 的改动不打 tag 就没法端到端运行。在下一次真实发布（3.0.0）时核对 draft、attestation（`gh attestation verify`）与 npm provenance。

## 13. 来源

- 本机的 cicd-blueprint skill：`~/.agents/skills/cicd-blueprint`
- [GitHub：用条件控制 job 的执行（被跳过的 job 报告 Success）](https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/using-conditions-to-control-job-execution)
- [GitHub Dependabot 配置项参考（cooldown、groups）](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference)
- [GitHub Dependency Review](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependency-review)
- [GitHub artifact attestations](https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations/using-artifact-attestations-to-establish-provenance-for-builds)
- [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)
- [Bun：`bun audit`](https://bun.com/docs/install/audit)
- [Bun：bunfig（`minimumReleaseAge`）](https://bun.com/docs/runtime/bunfig)
- [zizmor](https://docs.zizmor.sh/)
- [actionlint](https://github.com/rhysd/actionlint)
- [oven-sh/setup-bun](https://github.com/oven-sh/setup-bun)
