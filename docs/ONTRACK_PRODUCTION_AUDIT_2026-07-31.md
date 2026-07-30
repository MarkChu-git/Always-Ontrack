# OnTrack 真实环境变化审计（2026-07-31）

> 结论先行：这不是一次单纯的 UI 改版。生产环境仍保留 Doubtfire/OnTrack 的核心资源和 `task_def_id` API，但前端已经把产品模型扩展成“项目概览 + 个性化任务计划 + 学习成果 + 参与度 + 前置依赖 + 多阶段提交 + Portfolio + Tutorial/Group + Calendar”的完整学生工作台。当前 CLI 的核心假设仍是 `project.tasks`、简单任务状态、同步上传和静态 token 缓存，因此需要重做领域聚合层、认证生命周期和提交状态机，而不是继续在现有命令上打补丁。

## 1. 审计范围

- 环境：`https://ontrack.infotech.monash.edu`
- 时间：2026-07-31（Asia/Kuala_Lumpur）
- 角色：Student
- 浏览器：Ego Lite，复用现有浏览器登录态
- 对照基线：当前 `/Users/mark/ontrack-cli` 工作区
- 前端构建指纹：`main-573XYQ2E.js`
- 覆盖的真实页面：
  - Home / 当前与历史 unit
  - Project Dashboard
  - Task Details / Task Sheet
  - Task Planner
  - Portfolio Creation
  - Groups List
  - Tutorials
  - My Profile
  - Web Calendar
  - Student QR
- 覆盖的真实 API：
  - 认证换票、project、unit、task definition、comments、submission details、prerequisites、engagements、task PDF、webcal

本次没有实际上传文件、发表评论、修改日期、切换 tutorial、提交 portfolio 或进入 staff/admin 数据。检查上传向导时，页面曾临时把任务状态显示为 `Ready for Feedback`；随后使用页面自带的 `Cancel Submission` 撤销，页面明确提示状态已恢复，最终状态为 `Not Started`。

报告不记录账号、学号、邮箱、token、具体 tutorial 人员信息等个人数据。

仓库中没有可复现的旧生产前端快照，因此本文的“新增/强化”是相对当前 CLI 能力和数据假设而言，不是逐个 release 的精确上线时间线。

## 2. 总体判断

### 2.1 保留的核心合同

以下旧模型仍然存在：

- `Auth-Token` + `Username` 请求头仍用于认证后的 API 请求。
- `/api/projects`、`/api/projects/:id`、`/api/units/:id` 仍存在。
- 评论仍使用 `/projects/:projectId/task_def_id/:taskDefId/comments/`。
- Task PDF 仍使用 `/units/:unitId/task_definitions/:taskDefId/task_pdf.json`。
- `task_definition.id` 和 `abbreviation` 仍是关键标识。
- 学生可选状态仍包含：
  - `Not Started`
  - `Working On It`
  - `Need Help`
  - `Ready for Feedback`

因此，不需要抛弃所有现有 API 代码；但需要重新定义这些 API 如何聚合成 CLI 的任务视图。

### 2.2 已经失效或明显不足的核心假设

1. **`project.tasks` 不再等于学生可见任务列表。**
   - 两个当前项目的 `/api/projects/:id` 都返回了空 `tasks`。
   - 同一时刻 Web UI 分别显示 11 个和 10 个学生任务。
   - `/api/units/:id` 分别带有 18 个和 22 个 `task_definitions`。
   - 可见任务是由 task definitions、目标成绩、tutorial stream、日期、前置依赖和任务实例状态共同派生的。

2. **认证 token 不再稳定保存在旧 localStorage key 中。**
   - 当前浏览器 localStorage 只观察到“是否记住登录/自动登录”的布尔设置。
   - 页面加载时通过 `POST /api/auth/access-token` 获取新的 `auth_token`、`auth_token_expiry` 和 user。
   - 当前 CLI 仍重点依赖 redirect query、`doubtfire_credentials_token` 和 `doubtfire_user` 等旧捕获路径。

3. **提交不是单次 multipart POST 那么简单。**
   - 打开上传向导即进入一个临时 submission 状态。
   - 取消会显式执行状态回滚。
   - 上传要求是逐项 evidence slot，并有 `File Pending`、Next、Upload new files、异步 PDF processing 等阶段。

4. **due date 已拆成多种日期语义。**
   - unit 默认 start/target/feedback deadline
   - 学生个人 start date
   - 学生个人 target date
   - feedback deadline
   - Task Planner 保存/重置后的个性化日期

5. **反馈模型已超过“文本评论列表”。**
   - 评论区支持附件、语音、emoji。
   - bundle 中存在 discussion prompt/reply API。
   - Task 支持 `Request Feedback Review`。

## 3. 真实环境新增或显著强化的产品面

### 3.1 品牌与全局导航

- 页面 title 仍为 `OnTrack`，设置接口的 external name 也是 OnTrack。
- 顶部产品 logo 的可访问名称已经是 `Formatif logo`。
- 全局导航以“当前 unit + 当前 project 页面”作为上下文。
- Home 只展示当前 enrolled units，并提供 `View all` 进入可搜索、可排序、带分页的历史 unit 表格。
- 账号菜单新增或强化：
  - My Profile
  - Calendar
  - About
  - Sign Out

这更像品牌层/设计系统迁移，不能仅凭 logo 断言产品已正式改名为 Formatif。

### 3.2 Project Dashboard

Dashboard 已从简单 task list 变成项目级学习进度总览：

- Task search
- Task 排序：
  - Priority
  - Start date
  - Target date
  - Due date
  - Abbreviation
- Task 过滤：
  - Hide completed tasks
  - Show tasks beyond target grade
- Target Grade（按 unit 动态定义，观察到 P/C/D/HD，部分 unit 还有 4K）
- Unit Learning Outcomes（ULO）
- Engagement Passport
  - Class attendance
  - Discussion
  - Forum post
  - Tutor email
  - Opportunity
- Progress Burndown
  - Target
  - Projected
  - To Submit
  - To Complete
- Task Status breakdown
  - Complete
  - Discuss
  - Ready for Feedback
  - Working On It
  - Not Started

当前 CLI 的 `project show` 和 `tasks` 无法表达以上项目级数据。

### 3.3 Task Details

新的任务详情至少包含：

- Task Learning Outcomes（TLO）以及到 ULO 的映射
- 任务 grade band
- 个人计划开始日期
- 个人目标提交日期
- feedback deadline
- 前置任务及其：
  - 当前状态
  - 要求状态
- Task Sheet 内嵌 PDF viewer
  - 搜索
  - 缩放
  - viewer 切换
  - 下载
- Resources 下载
- Your Submission tab
- comments side panel
  - 文件附件
  - 音频录制
  - emoji
- Task actions
  - Download submission PDF
  - Download submitted files
- More task options
  - Request Feedback Review

生产 API 的 task definition 还新增或强化了以下能力字段：

- `has_task_sheet`
- `has_task_resources`
- `has_content_link`
- `has_task_resource_link`
- `has_scorm_data`
- `scorm_enabled`
- `scorm_allow_review`
- `scorm_bypass_test`
- `scorm_time_delay_enabled`
- `scorm_attempt_limit`
- `is_graded`
- `assessment_enabled`
- `assess_in_portfolio_only`
- `requires_discussion`
- `discussion_prompts_count`
- `overseer_steps`
- `ilos`

### 3.4 Task Planner

Task Planner 是一个新的核心工作流，不是附属页面：

- 按目标成绩决定需要完成的任务
- 展示 task 时间线
- 展示 prerequisite/dependent 关系
- 学生可调整 start/target dates
- 可显示 unit 默认 task dates
- 可显示超出目标成绩的任务
- Save Dates
- Reset To Unit Default
- Download Chart
- 打开 Calendar

当前 CLI 的 `watch` 只监控一个模糊 `due` 字段，已经无法准确表达这些日期。

### 3.5 Submission 工作流

真实上传向导观察到：

- Submission type 可选择，默认可为 `Ready for Feedback`
- 每个 `upload_requirement` 是单独 evidence slot
- UI 明确展示逐个文件是否 pending
- 上传前有 Next/review 阶段
- 已进入 submission 流程后可 `Upload new files`
- `/submission_details` 返回：
  - `has_pdf`
  - `processing_pdf`
- 取消 submission 会恢复原 task 状态

一个需要特别处理的真实语义：

> 打开 Upload Submission 向导时，页面会先进入临时 `Ready for Feedback` 状态；点击 `Cancel Submission` 后才回滚为原状态。

这意味着 CLI 的上传实现必须具备事务式补偿逻辑，不能只依赖“POST 失败就什么都没发生”的假设。

### 3.6 Portfolio

Portfolio Creation 已是五步流程：

1. Portfolio Preparation
2. Select Grade
3. Learning Summary Report
4. Upload Other Files
5. Review Portfolio

同时 project 数据中已经出现：

- `portfolio_files`
- `compile_portfolio`
- `portfolio_available`
- `uses_draft_learning_summary`

当前 CLI 完全没有 portfolio 命令面。

### 3.7 Tutorials 与 Groups

Project 导航新增：

- Groups List
- Tutorial List

Tutorial 页面支持：

- Stream/Campus/Code/Day/Time/Room/Tutor 排序
- 当前 enrolment 显示
- 学生管理 enrolment（由 unit policy 控制）

Unit 数据新增或强化：

- `tutorial_streams`
- `tutorials`
- `tutorial_enrolments`
- `allow_student_change_tutorial`
- `group_sets`
- `groups`

被检查的两个 unit 没有启用 group work，但路由和数据结构已经存在。

### 3.8 Profile、Calendar 与 QR

Profile 可管理：

- Preferred name
- 新消息通知
- Portfolio ready 通知
- 新 task 通知
- 匿名研究统计
- TurnItIn EULA

Calendar：

- `/api/webcal`
- 可启用 iCalendar feed
- 可用于 Outlook、Google Calendar、iCloud Calendar

顶部 QR 不是“学生扫码”，而是：

> 学生展示自己的 QR，由 tutor 扫描后查看 submission 并完成 task marking。

这和 bundle 中的 `check-in`、`tutor-attendance` 路由形成一套新的现场教学流程。

## 4. 真实 API 合同快照

### 4.1 认证

观察到的加载顺序：

1. `GET /api/settings`
2. `GET /api/auth/signout_url`
3. `POST /api/auth/access-token` → `201`
4. 后续请求携带 `Auth-Token` + `Username`

`POST /api/auth/access-token` 返回结构：

```text
user
auth_token
auth_token_expiry
```

当前浏览器会话中没有观察到旧 token/user localStorage payload。这对现有 browser-state 捕获逻辑是 P0 兼容风险。

### 4.2 Project summary 与 project detail

`GET /api/projects/?include_in_active=false` 的 project summary 主要包含：

```text
id
campus_id
user_id
unit
target_grade
spec_con_days
portfolio_available
escalation_attempts_remaining
```

`GET /api/projects/:projectId` 主要包含：

```text
id
unit / unit_id
target_grade
submitted_grade
portfolio_files
compile_portfolio
portfolio_available
uses_draft_learning_summary
tasks
tutorial_enrolments
groups
escalation_attempts_remaining
```

关键事实：检查的两个新项目中 `tasks` 都为空，但 Web 任务列表非空。

### 4.3 Unit detail 成为任务目录的主要来源

`GET /api/units/:unitId` 当前承载：

- unit policy
- 动态 grade definitions
- ULO/ILO
- tutorial streams/tutorials/staff
- task definitions
- group sets/groups
- discussion timeout

两个真实 unit 的对照：

| 指标 | Unit A | Unit B |
|---|---:|---:|
| `project.tasks` | 0 | 0 |
| `unit.task_definitions` | 18 | 22 |
| Web 当前可见 tasks | 11 | 10 |
| Task sheet | 部分 | 22 |
| Task resources | 部分 | 22 |
| Portfolio-only tasks | 存在 | 4 |
| Discussion-required tasks | 存在 | 2 |
| Tutorial streams | 2 | 2 |

不能再把 unit task definitions 当成 project tasks 的可选 metadata；它们已经是完整任务目录的主数据。

### 4.4 新增/关键 endpoint

真实请求已确认：

```text
GET  /api/projects/:projectId/engagements/
GET  /api/units/:unitId/content/links/
GET  /api/units/:unitId/task_definitions/:taskDefId/prerequisites/
GET  /api/units/:unitId/task_prerequisites
GET  /api/projects/:projectId/task_def_id/:taskDefId/submission_details
GET  /api/units/:unitId/task_definitions/:taskDefId/task_pdf.json
GET  /api/webcal
```

前端 bundle 中还存在以下 API/能力模板：

```text
/projects/:projectId/reset_target_dates
/projects/:projectId/task_def_id/:taskDefId/plan
/projects/:projectId/task_def_id/:taskDefId/target_dates
/units/:unitId/tasks/inbox
/units/:unitId/tasks/moderation
/units/:unitId/tasks/overflow
/projects/:projectId/task_def_id/:taskDefId/scorm-player/...
/comments/:commentId/discussion_comment/...
```

Bundle 中出现不代表本次 Student 账号已实际调用或有权限。

## 5. 当前 CLI 兼容性评估

| 现有命令/模块 | 结论 | 风险 | 原因 |
|---|---|---:|---|
| `login` | 需要重做生命周期 | P0 | 新前端运行时通过 `POST /auth/access-token` 换票，旧 localStorage 捕获假设不足 |
| `logout` | 已确认不兼容 | P0 | 真实执行返回 `400 remember is missing`；现有 `DELETE /auth` 请求缺新必填语义 |
| `whoami --json` | 安全缺陷 | P0 | 会序列化完整 session，包括 `authToken` |
| `whoami` | 仅显示缓存，不验证在线性 | P1 | 旧缓存仍可显示身份，但生产请求已返回 419 |
| `projects` | endpoint 存在，但模型偏旧 | P1 | summary 更轻，新增动态 grade/portfolio/escalation |
| `units` | 需要以 project + unit detail 聚合 | P1 | Web 主要由 project summary 选 unit，再加载 `/units/:id` |
| `tasks` | 核心逻辑失真 | P0 | `project.tasks=[]`，但 UI 从 unit task definitions 派生任务 |
| `task show` | 可能找不到尚未实例化的任务 | P0 | 当前 task selector 依赖 task instance/definition ID 混合匹配 |
| `inbox` | 路由仍在，需重新实测 | P1 | bundle 保留 endpoint，但未在本次学生主流程中触发 |
| `feedback list/watch` | endpoint 基础仍在，模型不足 | P1 | comments 保留，但缺附件、语音、discussion thread/review |
| `watch` | 日期与状态语义不足 | P1 | 需要区分个人计划、unit 默认、feedback deadline 和派生状态 |
| `pdf task` | 基本合同仍在 | P2 | task PDF endpoint 已确认，Web 现在支持内嵌 viewer |
| `pdf submission` | 需要 processing 状态 | P1 | 新增 `submission_details.has_pdf/processing_pdf` |
| `submission upload` | 需要事务式重构 | P0 | 多步骤、临时状态、取消回滚、逐项 evidence slot |
| `upload-new-files` | UI 能力仍在 | P1 | 需要与当前 submission 状态和 slot 完成度联动 |
| `discover` | 有价值但规则已漏抓 | P1 | 真实 route/API 多为拼接字符串，现有 literal regex 覆盖不足 |
| Portfolio/Tutorial/Group/Calendar/Engagement | 完全缺失 | P1/P2 | 已成为真实学生工作流 |

## 6. 已确认的认证与安全问题

### 6.1 缓存 session 已不被当前生产 API 接受

本地缓存 session 保存于 2026-03-12。2026-07-31 使用它请求生产 API 时返回：

```text
419 No authentication details provided
```

这只能证明缓存会话已不再被当前生产接口接受；原因可能是 token 过期、撤销或认证协议变化，不能仅凭 419 区分。

### 6.2 `whoami --json` 泄露 secret

当前实现：

```ts
if (hasFlag(args, '--json')) {
  printJson(session);
}
```

而 `session` 包含 `authToken`。这会把 bearer-equivalent secret 写入终端、日志和自动化输出。

必须改为身份字段 allowlist，并增加回归测试，断言所有 `whoami` 输出都不包含：

- `authToken`
- `auth_token`
- Authorization header
- browser storage credential

### 6.3 `logout` 合同已经变化

对旧 session 执行当前 `logout`：

```text
400 Bad Request: remember is missing
```

CLI 随后按现有设计清除了本地 session 文件。Ego Lite 的浏览器会话是独立的，未被清除。

这说明远端 logout 请求需要重新抓取和建模；不能假设 `DELETE /auth` 无 body 即可撤销会话。

## 7. 前端 route 盘点

### Student 主流程

```text
/home
/view-all-projects
/projects/:projectId/dashboard
/projects/:projectId/dashboard/:taskAbbreviation
/projects/:projectId/plan
/projects/:projectId/portfolio
/projects/:projectId/groups
/projects/:projectId/tutorials
/edit_profile
```

### Task/教学扩展

```text
/projects/:projectId/task_def_id/:taskDefId/scorm-player/normal
/projects/:projectId/task_def_id/:taskDefId/scorm-player/review/:testAttemptId
/projects/:projectId/task_def_id/:taskDefId/submission_files/download
/check-in
/tutor-attendance
/tutor-discussion
```

### Staff/管理端（仅 bundle 发现，未验证权限）

```text
/admin
/admin/institution-settings
/admin/units
/admin/users
/analytics
/definition
/discussion
/inbox
/moderation
/overflow
/rollover
/students
/students/groups
/students/portfolios
/tasks
/tasks/inbox
/units
/view-all-units
/jplag-report-viewer
/lti
```

这些路由说明生产前端已经覆盖远多于当前 CLI 的角色和工作流，但不能把静态 route 存在等同于 Student 可访问。

## 8. 建议的大改方向

### Phase 0：安全与认证（先做）

1. 修复 `whoami --json`，使用显式 allowlist。
2. 新增 `SessionCredential`：
   - token
   - username
   - expiresAt
   - source
   - refreshedAt
3. 在每次命令前验证 expiry；419 时输出明确重登指引。
4. 调研并支持 `POST /auth/access-token` 的浏览器换票流程。
5. 不再把 localStorage 当作唯一 token 来源。
6. 抓取真实 logout 请求，补齐 `remember` 等新字段。
7. 日志、JSON 输出、错误对象统一 secret redaction。

### Phase 1：重建领域聚合层

把现有模糊类型拆成：

```text
ProjectSummary
ProjectDetail
UnitDetail
TaskDefinition
TaskInstance
StudentTaskView
TaskPlan
TaskPrerequisite
SubmissionState
CommentThread
```

`StudentTaskView` 应由以下数据派生：

```text
unit.task_definitions
+ project.tasks（可能为空）
+ project.target_grade
+ project.tutorial_enrolments
+ unit.tutorial_streams
+ prerequisites
+ personal target dates
+ unit policy
```

禁止再用“task instance id 或 task definition id，碰到哪个算哪个”的隐式匹配。

### Phase 2：重新设计 CLI 命令面

建议新增：

```text
ontrack dashboard
ontrack plan show
ontrack plan set-dates
ontrack plan reset
ontrack task prerequisites
ontrack task resources
ontrack submission status
ontrack portfolio status
ontrack tutorials
ontrack groups
ontrack calendar
ontrack engagements
```

现有 `tasks` 应默认展示派生后的学生任务视图，并明确区分：

- definition exists
- not instantiated
- working
- submitted/processing
- awaiting feedback
- discuss
- complete

### Phase 3：提交与反馈状态机

1. 把 upload 做成显式 transaction：
   - begin
   - upload slots
   - review
   - commit/trigger
   - rollback on cancel/failure
2. 对每个 upload requirement 做 schema validation。
3. 增加 `submission_details` 轮询和 PDF processing 状态。
4. 评论模型支持附件、音频、discussion prompt/reply、feedback review。
5. 写请求不自动重试，除非 endpoint 有 idempotency contract。

### Phase 4：角色与高级模块

在 Student 核心稳定后再扩展：

- Portfolio
- Tutorial enrolment
- Group work
- Engagement Passport
- SCORM
- Staff inbox/moderation/overflow
- Tutor attendance/discussion
- JPlag/LTI/Admin

## 9. 测试与验收建议

### 合同测试

为以下响应保存脱敏 shape fixture：

- access-token
- projects summary
- project detail with empty `tasks`
- unit detail with task definitions
- task prerequisites
- submission details
- comments with/without attachments
- webcal

### 必须覆盖的回归场景

1. `project.tasks=[]`，但 `unit.task_definitions` 非空时，CLI 仍列出正确任务。
2. 目标成绩变化后，可见任务集合变化。
3. tutorial stream 不同，任务集合不同。
4. 任务尚未实例化时，task show/PDF/resources 仍可用。
5. 上传中途失败时恢复原状态。
6. cancel submission 后状态恢复。
7. submission PDF processing 时不误报下载成功。
8. 419 时提示重登，不重复刷接口。
9. 所有 JSON 输出均不包含 secret。
10. 动态 grade definitions（包括非标准 grade）不会被硬编码丢失。

按项目规则，重构后应同时具备 unit、integration、E2E 测试，并保持 80% 以上覆盖率。

## 10. 仍需进一步验证的未知项

- Staff/admin 角色的真实页面与 API 权限。
- `/units/:id/tasks/inbox` 在新学期、不同角色下的真实响应。
- 带真实 comments/attachments/audio 的数据 shape。
- 已存在 task instance 时 `/projects/:id.tasks` 的完整 shape。
- 完整提交成功时各请求的先后顺序和 rollback contract。
- remote logout 的新 body/query contract。
- SCORM、content link、overseer、JPlag、LTI 的实际启用方式。
- Portfolio 编译完成后的异步状态与下载接口。
- Tutorial enrolment 写接口和容量冲突处理。

## 11. 与本地代码的直接对应

- 命令与路由分发：[`../src/cli.ts`](../src/cli.ts)
- API 协议层：[`../src/lib/api.ts`](../src/lib/api.ts)
- 当前领域类型：[`../src/lib/types.ts`](../src/lib/types.ts)
- 浏览器 SSO：[`../src/lib/auto-login.ts`](../src/lib/auto-login.ts)
- 前端 bundle discovery：[`../src/lib/discovery.ts`](../src/lib/discovery.ts)
- 真实环境 smoke 脚本：[`../scripts/smoke-real.mjs`](../scripts/smoke-real.mjs)

下一步不建议直接增加几个 endpoint。应先完成 Phase 0 的剩余认证生命周期工作，再进入 Phase 1 的 `StudentTaskView` 聚合层。只有这两层稳定后，现有 tasks、feedback、watch、PDF、submission 命令才有可靠的重构基础。

## 12. 本轮实施状态与架构决策入口

截至 2026-07-31，本轮已经完成两项可独立验证的基础工作：

1. 工具链已从 npm/Node 执行入口迁移到 Bun 1.3.14：使用 `bun.lock`、Bun scripts、Bun test runner 与 Bun shebang；原 `package-lock.json`、`tsx`、`rimraf` 已移除。
2. `whoami` 已改用安全身份投影 Module。JSON 与人类输出只读取明确 allowlist，不再序列化完整 session；针对顶层 token、嵌套 token、authorization 与 browser credential 的回归测试已加入。
3. 浏览器 session 复用已完成安全收口：凭据捕获严格绑定目标 OnTrack origin/domain；真实系统 profile 默认关闭且不会复制完整 storage state；CLI state 只保留 OnTrack cookies/origins，并以目录 `0700`、文件 `0600` 持久化。
4. CLI 不再自动执行未固定版本的 Playwright/Chromium 安装；需要时由用户明确执行文档中的固定版本命令。
5. `logout` 仍不猜测未知的生产 `remember` 合同，但远端失败信息会脱敏，并明确区分本地 session 已清理与远端注销失败。

本轮验证结果：

- `bun install --frozen-lockfile`：通过
- `bun run build`：通过
- `bun run typecheck`：通过
- `bun test`：73/73 通过
- `bun audit`：无已知漏洞
- 新 `whoami` Module：100% 行/函数覆盖
- 仓库整体：71.73% 行覆盖、76.00% 函数覆盖，尚未达到项目要求的 80%；主要缺口在浏览器自动登录与真实交互分支

依据 improve-codebase-architecture 的探索阶段，下一轮可深入的候选 Module 是：

1. Auth lifecycle / security identity Module
2. Student task aggregation / `StudentTaskView` Module
3. Submission lifecycle Module
4. Task Planner / date semantics Module
5. Production contract discovery and fixture Module

这里暂不定义新 Interface 或 Adapter。应先选择一个候选，继续验证它是否能提供足够的 Depth、Leverage 与 Locality，并确认删除测试成立，再进入实现。
