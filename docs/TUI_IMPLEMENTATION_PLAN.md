# OnTrack TUI 全面实施计划

状态：Phase 0（骨架，PR #53）、Phase 1（只读数据接入，PR #54）、
Phase 2（认证向导，PR #56）已合并；Phase 3（状态变更）实施完成，自审后合并
骨架分支：`feat/tui-skeleton`（PR #53）
协议目标：TUI 不引入新业务行为，只做 `src/lib/` 能力的人类渲染层

## 1. 定位与原则

TUI 是 agent-first 核心之上的第二个前端。它与 agent 协议共享同一执行面，
不复制业务逻辑：

- TUI 的每个读视图都来自 `src/lib/` 已有的投影（Student Task View、Plan、
  Watch Snapshot），每个写操作都复用同一命令执行路径（command-spec /
  execution-engine / submission-lifecycle），包括其 preflight、结果验证和
  unknown-outcome 保护。
- TUI 层不包含 API 调用细节、日期优先级规则、提交状态机；它渲染领域投影，
  把用户意图翻译成与 CLI 命令等价的调用。
- Agent 路径（JSON 输出、退出码、错误码）零变化；无参数 `ontrack` 在非 TTY
  下保持现有 welcome 菜单行为。

## 2. 分支与 PR 策略

1. `feat/tui-skeleton`（从 `origin/master` 切出，已完成）— 骨架 + 冒烟测试 +
   AGENTS.md 说明，即 PR #53。
2. 后续每个阶段（见 §4）一个分支一个 PR，叠在 skeleton 合并后的 master 上。
3. 遵循仓库规则：每个 PR 合并前用 `code-review` skill 自审（Standards + Spec
   两轴），全部检查绿才合并。

## 3. 目标架构

```mermaid
flowchart TB
  subgraph TUI["src/tui/（渲染层）"]
    Views["视图：任务/详情/计划/监视"]
    Wizards["向导：登录/提交/状态变更"]
    Palette["命令面板 + 底部输入栏"]
  end
  subgraph Core["src/lib/（agent-first 核心，已有）"]
    Exec["command-spec / agent-execution-engine"]
    Proj["student-task-view / agent-plan / watch-snapshots"]
    Life["submission-lifecycle / execution-journal"]
    Auth["session / auth-broker / auto-login"]
  end
  OnTrack["OnTrack API"]
  Views --> Proj
  Wizards --> Exec
  Wizards --> Life
  Wizards --> Auth
  Palette --> Exec
  Exec --> OnTrack
  Proj --> OnTrack
  Life --> OnTrack
  Auth --> OnTrack
```

数据流：TUI 启动时加载 session，读路径经投影层拉取并规范化；写路径一律
走命令执行面并以其返回的结果为准（例如 Status Trigger 可能被服务器重映射，
UI 显示响应里的最终状态而非乐观值）。

## 4. 分阶段实施

### Phase 0 — 分支整理与骨架 PR

- 按 §2 建 `feat/tui-skeleton`，提交现有骨架（`src/tui/`、
  `scripts/smoke-tui.tsx`、`tsconfig.tui.json`、package/tsconfig 调整、
  AGENTS.md 的 TUI 小节）。
- 验收：CI 绿；`bun run typecheck` 与 `bun run typecheck:tui` 互不干扰；
  `bun test` 453+ 通过；code-review skill 自审通过。

### Phase 1 — 只读数据接入

- 用 `loadSession` + `sessionUsability` 判定登录态；未登录显示登录引导屏
  （代替任务列表）。
- 任务列表/详情接入 `resolveStudentTaskViews` / `buildStudentTaskRows` 投影；
  多 unit 时在顶栏加 unit 切换（`agent-projects` / `agent-units` 数据）。
- 详情面板补充投影字段：Effective Date 及其来源。前置任务
  （`agentTaskPrerequisites`）与资源/任务 PDF 下载入口移至 Phase 4 随提交
  向导一起做，避免在此引入只读下载的半成品。
- 视图状态三态：loading / error（结构化错误 + 建议动作）/ empty。
- 验收：数据映射由 contract fixture 单测覆盖；交互冒烟用合成数据驱动
  （需要多任务、多状态覆盖交互路径）；真实账号手动验证（`smoke:real`
  流程不回归）。

### Phase 2 — 认证向导（已完成）

- 登录向导封装 `captureSsoCredentialsWithGuidedLogin`：分步界面（凭据 →
  SSO 步骤 → MFA 选择/代码 → Okta Verify 数字挑战 → 结果），MFA 选项来自
  `MfaMethodOption`；失败分类沿用 `classifySsoFallback`。会话落盘走
  `src/lib/login-finalize.ts`（从 cli.ts 提取，CLI/TUI 共用同一路径）。
- 顶栏显示 identity（`toWhoAmIView`）与 token 有效期药丸（<1h/<24h 警告
  色，已过期红色）；`/logout` 双次确认后清 session 并回到引导屏。
- 验收达成：456 项现有测试不回归；向导每一步（凭据/MFA 选择/MFA 代码/
  数字挑战/失败分类/登出）由 fixture runner 在无头冒烟驱动（31 项断言）。

### Phase 3 — 状态变更（第一个写操作）（已完成）

- 任务详情弹层加可点操作与快捷键：`working_on_it` / `need_help` /
  `not_started` / `ready_for_feedback` / `assess_in_portfolio`，字母键或
  点击预选，enter/再次点击确认（防误触），esc 分级取消。
- 写路径复用提取出的 `src/lib/set-task-status.ts`
  （`applyStudentStatusTrigger`，CLI 同一实现）：服务器 200 原样拒绝与
  重映射都被识别，UI 以响应中的最终状态为准局部刷新该行；结果显示
  toast；`unknown` 结果不自动重试。
- 验收达成：重映射与拒绝两个 fixture 场景进无头冒烟（39 项断言）；
  修复过程中发现并修掉一个真实 bug（loading 屏按方向键会把选中索引
  钳到 -1，选中态卡死）。
- 顺带修复：离开 `main` 模式时显式 blur 过滤输入框（AGENTS.md 已记录
  的 focus 竞态），否则详情弹层按键被输入框吞掉。

### Phase 4 — 提交向导与任务资源（已完成）

- 详情面板补充前置任务（`agentTaskPrerequisites`）与资源/任务 PDF 下载
  入口（`agent-task-pdf`，落到 `downloads/`）。
- Wizard 步骤：Evidence Slot 清单 → 文件选择（路径输入 + 校验，
  `inspectUploadFile` / `readUploadArtifact`，外部路径需显式授权，沿用
  `--allow-external-file` 语义）→ 预检摘要 → 单发派送 + 进度 → 服务器回执。
- `transport-unknown` 结果按 Unknown Outcome 规则处理：不自动重试，展示
  journal 记录（`execution-journal`）与下一步建议。
- 提交后可查看 submission PDF 状态（`submission-lifecycle` 的
  `unavailable/processing/ready` 轮询）。
- 验收：现有 submission 测试不回归；向导在无头冒烟中走通完整 fixture 流程。
- 验收达成：写路径提取为 `src/lib/submission-upload.ts`
  （`applySubmissionUpload`，dry-run/claim/单发派送/回执分类与 CLI 逐字节
  一致），agent 读路径（prerequisites/resources/task PDF/submission PDF/
  submission status）提取为 `src/lib/agent-task-reads.ts`；456 项测试不回归。
- 向导每个 attempt 铸一个幂等键（`tui:<uuid>`，进入 preflight 时铸造，与
  显示一致）：重复确认走 replay 而不是二次派送；已观察提交自动切
  `upload-new-files` 模式。冒烟增至 54 项断言（extras 渲染/下载 toast/
  向导全流程/unknown 不重试/loading 可 ESC 取消/拒绝后重试铸新键）。

### Phase 5 — Watch 实时面板

- `buildWatchSnapshots` 轮询接入：状态变化在列表行高亮闪动 + toast；侧栏
  可选的 watch feed（最近 N 条变化）。
- 顶栏 watch 药丸显示真实轮询状态（间隔、上次成功时间、失败退避）。
- 验收：watch 快照 fixture 驱动的高亮/toast 冒烟断言；轮询退出时无悬挂
  定时器。

### Phase 6 — 计划视图

- 新主视图（tab 或 `ctrl+p`）：按 Effective Date 排序的时间线，区分
  Unit Default / Personal Override 来源；逾期任务置顶红色区。
- 支持编辑 Personal Date（写路径复用现有 plan 命令）。
- 验收：`agent-plan` fixture 渲染正确；日期编辑走通并反映来源变化。

### Phase 7 — 入口集成与分发

> 部分完成（v2.2.0）：无参数 `ontrack` 的 TTY 默认入口、独立 TUI bundle、
> package verifier 与 CI/release 门禁已接入；显式 `tui` 子命令、`--no-tui`
> 和偏好持久化仍留待后续。

- 无参数 `ontrack`：TTY → TUI；非 TTY → 现有 welcome 菜单（行为不变）。
  增加 `ontrack tui` 显式子命令与 `--no-tui` 逃生门。
- dist 构建：TUI 需以 bun bundler（或独立 tsc 配置 + JSX）并入 `dist/`；
  保持 `bin/ontrack` 单入口；验证 `npm pack` 产物可直接运行 TUI。
- 主题/键位偏好持久化到用户配置目录（与 session 存储同级，不含敏感数据）。
- 验收：`bun run build` 产物手动验证；`verify-package` 脚本扩展覆盖 TUI 入口。

### Phase 8 — 测试、文档与收尾

- 冒烟测试矩阵化：每个主视图至少一条 fixture 驱动断言；保留现有的
  testRender 时序注意事项（settle、首帧、ESC）。
- README 增加 TUI 章节（截图/asciinema）；AGENTS.md TUI 小节更新为正式约定；
  CONTEXT.md 如需补充 TUI 侧术语（如 Watch Feed）再动。
- 用仓库 `to-issues` skill 把各 Phase 拆成可认领的 issue（可选）。

## 5. 待决技术决策

| 决策点 | 选项 | 倾向 |
| --- | --- | --- |
| dist 中 TSX 的构建方式 | bun bundler 单独产物 / tsc 双配置 | bun bundler，避免双编译歧义 |
| TUI 状态管理 | 继续 useState / 引入轻量 store | 先 useState，Phase 4 若跨视图状态变复杂再评估 |
| 键位抽象 | 继续内联 useKeyboard / `@opentui/keymap` | Phase 3 起键位增多时迁 `@opentui/keymap` |
| 大列表性能 | 分页 / scrollbox 虚拟化 | scrollbox，超 200 行再优化 |
| 真机验证 | 手动 / 扩展 `smoke:real` | 每阶段手动 + Phase 7 纳入 smoke:real |

## 6. 风险与缓解

- **OpenTUI 处于 0.x**：API 可能随版本变动。锁定版本；升级前跑全量冒烟。
- **React reconciler 的测试时序问题**（状态更新后输入需 settle）：已在
  AGENTS.md 记录；真实渲染器无此问题，若恶化可评估迁移 `@opentui/solid`。
- **写操作安全**：TUI 不得绕过 unknown-outcome 与外部文件授权规则；所有写
  路径以命令执行面为唯一入口，code-review 时逐条核对。
- **范围蔓延**：每阶段只做本节列出的内容；新想法先进 issue，不进当前 PR。
