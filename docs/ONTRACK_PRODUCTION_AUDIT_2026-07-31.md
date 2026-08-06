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

3. **提交在 UI 上是多阶段流程，但已观察的写合同是单次 multipart POST。**
   - 打开上传向导时客户端可先显示临时 submission 状态。
   - 在真正 dispatch 前取消会恢复 UI 状态；未观察到独立 server begin/cancel/rollback endpoint。
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

> 打开 Upload Submission 向导时，页面会先显示临时 `Ready for Feedback` 状态；点击 `Cancel Submission` 后恢复为原状态。

网络证据只确认了一次 multipart POST，没有确认独立 server begin/cancel/rollback。因此 CLI 实现采用本地 preflight → 单次 dispatch → failed/unknown/accepted/observed-success：dispatch 前取消不发请求，明确 HTTP rejection 是 failed，transport 无法证明结果时才是 unknown，2xx 后还会读取 status；任何不明结果都不自动重试，也不伪造补偿成功。

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
GET  /api/units/:unitId/task_definitions/:taskDefId/task_resources.json?as_attachment=true
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
| `login` | 核心生命周期已修复 | P1 | access-token response 可捕获 nested identity/expiry；真实 Okta DOM 仍需周期 Ego smoke |
| `logout` | 已修复 | - | 使用已观察的 `DELETE /auth?remember=false`，本地清理不依赖远端成功 |
| `whoami --json` | 已修复 | - | 只输出 security identity allowlist，不再序列化 credential |
| `whoami` | 已加 credential lifecycle gate | P2 | expiry 已知时本地 fail-fast；legacy expiry 未知时交由 server 验证 |
| `projects` | Agent 发现面已修复 | - | native typed `projects.list` 输出 PII-minimized safe directory；最多 200 条，Agent HTTP response/完整 envelope 各限 512 KiB，alias/identity 冲突与畸形数据 fail-closed；compatibility Agent path 共用投影，裸 `--json` 保持旧 raw shape 与既有 response behavior |
| `unit show` | 已修复 | - | native typed `unit.show` 以 project 为 scope，先校验 project/unit identity，再读取有界 Unit Detail；只输出 PII-minimized Student Unit View 与 task definition count，裸 `--json` 保持旧 raw shape |
| `tasks` | 已修复 | - | Student Task View 从 Task Definition catalogue 派生，并显式连接可选 Task Instance；native `tasks.list` 以 project-scoped、PII-minimized Student Task View catalogue 暴露同一严格 projection，裸 `--json` 保持原 shape |
| `task show` | 已修复 | - | selector 统一使用 taskDefinitionId，未实例化任务可读取 |
| `plan show` | 已修复 | - | native typed definition-first contract；显式 date source、task/prerequisite required+current status、四态 visibility、独立 feedback deadline 和 normalized prerequisites；缺失 flexible-date capability fail-closed；body/output 均有边界 |
| `inbox` | 路由仍在，需重新实测 | P1 | bundle 保留 endpoint，但未在本次学生主流程中触发 |
| `feedback list/watch` | endpoint 基础仍在，模型不足 | P1 | comments 保留，但缺附件、语音、discussion thread/review |
| `watch` | 日期与状态语义不足 | P1 | 需要区分个人计划、unit 默认、feedback deadline 和派生状态 |
| `pdf task` | 基本合同仍在 | P2 | task PDF endpoint 已确认，Web 现在支持内嵌 viewer |
| `task resources` | 已接入真实下载合同 | - | definition-first；验证 ZIP magic；`FileNotFound.zip` 占位响应稳定归类为 unavailable；默认使用 `FIT0001-P1-TaskResources.zip` 风格 artifact 名称 |
| `pdf submission` | 已修复 | - | 下载前检查 `submission_details` 的 unavailable/processing/ready |
| `submission upload` | 已修复核心状态机 | - | 默认 dry-run、`--confirm` 单次 POST、明确 rejection/transport unknown/observed success、redacted output、comment failure 隔离 |
| `upload-new-files` | 已修复核心状态机 | - | 独立读取 `submission_details`，只有已观察到 existing submission 才允许 confirmed dispatch |
| `discover` | 有价值但规则已漏抓 | P1 | 真实 route/API 多为拼接字符串，现有 literal regex 覆盖不足 |
| Portfolio/Tutorial/Group/Calendar/Engagement | 完全缺失 | P1/P2 | 已成为真实学生工作流 |

## 6. 已确认的认证与安全问题

### 6.1 缓存 session 已不被当前生产 API 接受

本地缓存 session 保存于 2026-03-12。2026-07-31 使用它请求生产 API 时返回：

```text
419 No authentication details provided
```

这只能证明缓存会话已不再被当前生产接口接受；原因可能是 token 过期、撤销或认证协议变化，不能仅凭 419 区分。

2026-08-05 在 `projects.list` slice 中再次以非交互策略执行
`auth ensure --interaction never --output agent-json`。当前 `browser-sso` session 已过期，CLI
在任何业务 GET 前稳定返回 `HUMAN_VERIFICATION_REQUIRED`。因此本层没有声称完成新的在线
`GET /projects` smoke；实现与测试使用 2026-07-31 保存的脱敏、HTTP-observed project summary
fixture。fresh online smoke 需要用户参与 Monash human verification 后再执行。

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

旧 CLI 对旧 session 执行 `DELETE /api/auth`：

```text
400 Bad Request: remember is missing
```

CLI 随后按现有设计清除了本地 session 文件。Ego Lite 的浏览器会话是独立的，未被清除。

随后从 2026-07-31 的生产 bundle `main-573XYQ2E.js` 找到 Web 的真实实现：

```text
DELETE /api/auth?remember=false
```

Web 使用 query parameter，而不是 JSON body。CLI 已按该合同实现，并加入精确 URL/method 合同测试；远端注销仍为 best effort，本地 credential 始终清除，远端错误细节保持脱敏。

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

### Phase 3：提交与反馈生命周期

1. 把 upload 做成显式 lifecycle：
   - 本地 preflight 与 slot validation
   - 单次 multipart dispatch
   - failed / transport unknown / response accepted / status observed
   - 仅 pre-dispatch local cancel
   - post-dispatch unknown 时引导只读 status 核验，不自动重试
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
5. dispatch 前校验失败或 cancel 时不发写请求。
6. dispatch 后网络结果不明时记录脱敏 `unknown`，不自动重发。
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
- 用户完成 human verification 后，重新执行 native `projects.list` 的 fresh online read-only smoke。
- 特定生产测试任务上的完整提交成功响应与之后只读状态变化；本轮没有执行生产写 smoke。
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
5. `logout` 已按生产 bundle 的 `DELETE /auth?remember=false` 合同修复；远端失败信息会脱敏，并明确区分本地 session 已清理与远端注销失败。

本轮验证结果：

- `bun install --frozen-lockfile`：通过
- `bun run build`：通过
- `bun run typecheck`：通过
- `bun test`：162/162 通过
- `bun audit`：无已知漏洞
- 新 `whoami` Module：100% 行/函数覆盖
- Bun 可合并计数的 TypeScript library/script LCOV：82.32% 行覆盖（4285/5205）、87.15% 函数覆盖（373/428），达到项目要求的双 80%，且配置没有源码排除；process-entry CLI Adapter 由 spawned stub E2E 验证，真实浏览器/SSO 状态机由注入式 Browser Adapter 在无网络环境测试并辅以 Ego smoke。

依据 improve-codebase-architecture 的探索阶段，本轮已实施并接线以下 Module：

1. Auth lifecycle / security identity Module
2. Student task aggregation / `StudentTaskView` Module
3. Submission lifecycle Module
4. Task Planner / date semantics Module
5. Production contract discovery and fixture Module

这些 Module 均已有明确 Interface、不可变 Implementation、HTTP/CLI Adapter 与合同测试；删除任一 Module 都会使 identity、日期优先级、提交状态或合同脱敏规则重新散落到多个调用方，因此通过 deletion test。

## 13. 最终实施结果

截至 2026-07-31，本审计提出的五个核心 Module 与 CI/CD 已完成：

1. **Auth lifecycle / security identity Module**：browser `/auth/access-token` response 直接建立 expiry-aware session（不再回调 legacy `/auth`）、legacy migration、typed 401/419、session provenance、safe whoami、精确 remote logout。
2. **StudentTaskView Module**：以 definition catalogue 为主，以显式 `task_definition_id` 连接 instance；支持空 `project.tasks`、target grade、tutorial stream、not-instantiated，并拒绝同一 definition 的多 instance 歧义。
3. **Submission lifecycle Module**：默认 dry-run、slot schema、immutable attempt journal、local-only pre-dispatch cancel、单次 POST、明确 server rejection=`failed`、transport failure=`unknown`、2xx 后 status observation、redacted output、submission status 与 PDF processing guard。
4. **Planner Module**：personal → grade default → unit default 的日期优先级、明确 date kind/source/`unit_local_calendar_date` interpretation、prerequisite、独立 feedback deadline、严格 YYYY-MM-DD；写操作默认 dry-run，只有 `--confirm` 才执行已观察的 PUT，且 read-back 一致后才输出 verified。
5. **Production contract Module**：脱敏 fixture catalog、provenance/trust、read-only route allowlist、shape/drift validator。
6. **Bun CI/CD**：frozen install、typecheck、162 tests、无源码排除的 80/80 加权 coverage gate、audit、build、package allowlist、SHA-pinned Actions、dependency review、单一 tarball release chain、npm OIDC 与 registry integrity verification。

2026-07-31 最终 Ego 复核发现：页面仍显示已加载的 Student UI，但裸 API 请求返回 419。该结果未被当作成功的生产数据读取；它验证了 CLI 必须把 419 归类为 credential expiry 并提示重新登录，而不能循环重试。前述生产 shape 结论来自本轮较早、credential 尚可用时的只读捕获与 bundle 证据。
