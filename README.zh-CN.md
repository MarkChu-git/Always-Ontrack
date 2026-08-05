# Always Ontrack (ontrack-cli)

[English](./README.md)

<p align="center">
  <img src="./always-ontrack-logo.png" alt="Always OnTrack logo" width="480" />
</p>

<p align="center">
  面向 Agent 的 Monash OnTrack / Doubtfire CLI 与鉴权 MCP
</p>

`ontrack-cli` 把 Monash OnTrack 中常见的登录、查看任务、跟踪反馈、下载 PDF、上传 submission 等操作统一到一个命令面里:

```bash
ontrack <command>
```

项目默认面向 Monash OnTrack 站点:

`https://ontrack.infotech.monash.edu/api`

主要接口是版本化、可发现 Schema 的 Agent 协议；人类表格与交互启动器继续复用同一执行引擎。

## 目录

- [功能概览](#功能概览)
- [安装](#安装)
- [Agent-first 使用方式](#agent-first-使用方式)
- [快速开始](#快速开始)
- [核心概念](#核心概念)
- [登录与会话](#登录与会话)
- [命令总览](#命令总览)
- [常见工作流](#常见工作流)
- [输出、高亮与 JSON](#输出高亮与-json)
- [环境变量](#环境变量)
- [文件与目录](#文件与目录)
- [本地开发](#本地开发)
- [测试与验证](#测试与验证)
- [项目结构](#项目结构)
- [故障排查](#故障排查)
- [当前边界](#当前边界)

## 功能概览

`ontrack-cli` 目前覆盖了几个核心能力面:

- 登录与会话管理
  - 从受限浏览器状态静默续期 token
  - 仅在 Monash 强制验证时进行结构化 human handoff
  - 本地 `ontrack-auth-mcp` 鉴权控制面
  - 支持 `SSO auto capture`
  - 支持手动粘贴 redirect URL
  - 支持直接传入 `auth token + username`
- 学习数据读取
  - `projects`
  - `units`
  - `tasks`
  - `inbox`
  - `task show`
- 反馈与实时跟踪
  - `feedback list`
  - `feedback watch`
  - `watch`
- 文件能力
  - `pdf task`
  - `pdf submission`
  - `submission upload`
  - `submission upload-new-files`
- 工程与排障
  - `doctor`
  - `discover`
  - `discover --probe`
- 终端体验
  - 默认彩色高亮表格输出
  - `--output agent-json` 提供版本化 Agent 自动化协议
  - 旧 `--json` 保持原始脚本输出兼容
  - 自动处理部分 endpoint 权限差异和 fallback

## 安装

### 运行环境

- Bun `1.3.14+`
- macOS / Linux / Windows
- 需要手动安装经过审核的浏览器 runtime 时，请保证网络可用

### 全局安装

推荐直接全局安装:

```bash
bun add --global ontrack-cli
```

安装完成后，命令入口为:

```bash
ontrack
ontrack-auth-mcp
```

### 本地安装

如果你只想在当前项目里使用:

```bash
bun install
bun run ontrack -- auth-method
```

### 从源码运行

```bash
bun install
bun run build
bun dist/cli.js auth-method
```

开发模式:

```bash
bun run dev -- auth-method
```

## Agent-first 使用方式

### 原生 caller-first 接口

新的 Agent 集成应使用显式的 caller-first 接口。它接收一个有大小上限的
JSON object，不会把 JSON 转译成人类 CLI flag，并且 stdout 恰好输出一个
`ontrack.agent/v1` envelope：

```bash
ontrack agent list
ontrack agent describe task.show
ontrack agent call auth.status --input-json '{}'
ontrack agent call task.show \
  --input-json '{"project_id":87,"abbreviation":["D4"]}'
```

`task.show` 使用 definition-first 的 Student Task View，因此即使项目的
`tasks` 数组为空，也能从 unit 的 task-definition catalogue 发现任务；未实例化
任务会明确标记，不会猜测 instance id。也可以使用 `--input -` 读取有大小上限的
非交互 stdin。当前原生接口覆盖 `auth.status` 与 `task.show`，后续命令会按独立的
垂直切片逐个审查后加入。

更广泛的旧命令仍通过 `--output agent-json` compatibility Adapter 提供；裸
`--json` 继续保持原有 raw shape。

### 发现协议

Agent 应查询 capability 与 schema，不需要解析帮助文本：

```bash
ontrack capabilities --output agent-json
ontrack schema task.show --output agent-json
```

`--output agent-json` 返回稳定的 `ontrack.agent/v1` envelope，包含 request
id、command path、状态、结构化数据、warnings、next actions 与 artifacts。
错误使用稳定 code 和退出码。原来的裸 `--json` 在 0.5 中继续保持旧的原始
shape。

### 传入结构化输入

```bash
ontrack task show \
  --input-json '{"project_id":87,"abbreviation":"D4"}' \
  --output agent-json
```

也可以使用有大小上限的非交互 stdin：

```bash
printf '%s' '{"project_id":87,"task_definition_id":501}' |
  ontrack task show --input - --output agent-json
```

只接受 command schema 已声明的字段。未知字段、重复且有歧义的 flag、危险
object key、错误类型以及 TTY stdin 都会在发出业务请求前被拒绝。

### 使用鉴权 MCP

包内另带一个职责严格受限的 stdio server：

```json
{
  "mcpServers": {
    "ontrack-auth": {
      "command": "ontrack-auth-mcp"
    }
  }
}
```

它只暴露 `auth_status`、`auth_ensure`、`auth_logout`，不会向 Agent 返回密码、
Okta challenge 数字、cookie、refresh token、OnTrack access token 或 SSO
表单数据。MCP 调用方不能自行选择网络 origin；非生产环境必须由可信 host 在
server 启动前通过 `ONTRACK_BASE_URL` 配置。

自主运行时使用 `auth_ensure` 的 `interaction: "never"`。运行时会先复用有效
token，再尝试从受限浏览器状态静默刷新。如果 Monash 策略要求 number
challenge，它会返回结构化 human handoff。用户在场时可以改用
`interaction: "if_required"`，此时最多开启一次可见浏览器流程；用户完成
Monash 控制的验证后，Agent 继续工作。
默认剩余有效期门槛为 60 秒；特定操作需要更长时间时，可传入
`min_ttl_seconds`（或 CLI 的 `--min-ttl-seconds`）。

CLI 使用同一个生命周期。读请求被拒绝时最多静默刷新并安全重放一次；写请求
永远不会被自动重放。

### 安全执行写操作

写命令默认仍为 dry-run。Agent 确认真实写入时还必须提供稳定的幂等键：

```bash
ontrack plan set-dates \
  --project-id 87 \
  --abbr D4 \
  --start 2026-08-01 \
  --target 2026-08-10 \
  --confirm \
  --idempotency-key plan-87-D4-2026-08-10 \
  --output agent-json
```

已经完成的 operation 会从安全日志重放结果，不会再次 dispatch；相同 key
对应不同输入时会被拒绝；如果传输失败或进程中断导致远端结果无法确定，该 key
会保持阻断，直到 Agent 先读取远端状态完成核对。

## 快速开始

下面是一套最短、最稳的上手路径。

欢迎页动作现在支持引导选择任务：

- `7/8/11/12` 支持引导单任务与批量任务选择
- 可以选 `single`、`multiple`（逗号分隔）或 `all tasks`
- 任务输入支持 task 代号（如 `P1`、`D4`）或数字 task definition id
- 也支持切换到手动输入 `--project-id` + selector
- 上传动作 `13/14` 仍保持单任务引导，避免误上传

### 1. 检查认证方式

```bash
ontrack auth-method
```

### 2. 登录

推荐默认方式:

```bash
ontrack login
```

显式无头模式（与默认行为一致）:

```bash
ontrack login --hide-browser
```

### 3. 查看当前账号

```bash
ontrack whoami
```

### 4. 列出你的课程和任务

```bash
ontrack projects
ontrack units
ontrack tasks
```

### 5. 查看某个具体任务

```bash
ontrack task show --project-id 87 --abbr D4
```

批量示例：

```bash
ontrack task show --project-id 87 --abbr P1,D4
ontrack task show --project-id 87 --all-tasks
```

### 6. 查看反馈与实时消息

```bash
ontrack feedback list --project-id 87 --abbr D4
ontrack feedback watch --project-id 87 --abbr D4
```

批量读取示例：

```bash
ontrack feedback list --project-id 87 --abbr P1,D4
```

### 7. 下载 PDF

```bash
ontrack pdf task --project-id 87 --abbr D4
ontrack pdf submission --project-id 87 --abbr D4
```

批量下载示例：

```bash
ontrack pdf task --project-id 87 --all-tasks
```

### 8. 先预检，再确认上传 submission 或补充文件

```bash
ontrack submission upload --project-id 87 --abbr D4 --file ./report.pdf
ontrack submission upload --project-id 87 --abbr D4 --file ./report.pdf --confirm
```

```bash
ontrack submission upload-new-files --project-id 87 --abbr D4 --file ./evidence.pdf
ontrack submission upload-new-files --project-id 87 --abbr D4 --file ./evidence.pdf --confirm
```

不带 `--confirm` 时，两条命令都只做安全预检，不发送写请求。

## 核心概念

为了更容易理解命令参数，先把几个常见概念说明清楚。

### `unit`

对应课程，例如 `FIT1045`。

### `project`

对应你在某个 `unit` 下的个人项目实例。很多任务级命令都需要 `--project-id`。

### `task`

对应具体任务，例如 `P1`、`D4`、`T2`。

### `abbr`

任务缩写，通常是最适合用户输入的选择器，例如:

- `P1`
- `D4`
- `T2`

相比纯数字 ID，`--abbr` 更适合日常使用。

### `taskDefinitionId`

数字选择器请使用无歧义的 `--task-definition-id`。旧 `--task-id` 仅作为弃用兼容 Adapter：它可解析唯一的旧 task instance/definition id，会在 stderr 提示弃用，并在 identity 冲突时拒绝执行。

### 批量任务选择器

支持批量选择的命令（`task show`、`feedback list`、`pdf task`、`pdf submission`）可使用：

- 重复参数：`--abbr P1 --abbr D4`
- 逗号参数：`--abbr P1,D4`
- 混合参数：`--task-definition-id 501 --abbr D4`
- 整个项目：`--all-tasks`

### `--json`

几乎所有读命令都支持 `--json`，用于兼容原始脚本输出。Agent 应使用
`--output agent-json`，以获得版本化 envelope、schema、稳定错误和 next
actions。

## 登录与会话

### 推荐方式: `ontrack login`

这是默认推荐的登录方式:

```bash
ontrack login
```

这个流程会:

1. 先尝试复用 CLI 已保存且仅包含 OnTrack 的浏览器状态
2. 如果没有可复用会话，再在 CLI 输入 Monash username/password（密码隐藏输入）
3. 默认使用隐藏浏览器（headless）进入引导式 SSO 自动化
4. 在终端显示结构化登录进度面板
5. 如果出现多个 MFA 方法，在 CLI 中给出编号选项供你选择
6. 若选择代码型方法（`Google Authenticator` / `Enter a code`），CLI 会提示输入验证码并自动提交
7. 若选择推送型方法（`Get a push notification`），CLI 会高亮显示 Okta Verify number challenge 数字
8. 捕获凭据并调用 `/api/auth`
9. 保存本地会话缓存
10. 缺少 Chromium runtime 时提示你手动安装

`ontrack login` 现在默认在本地和服务器都走隐藏浏览器（headless）模式。  
只有排查问题时才建议使用 `ontrack login --show-browser`。  
`ontrack login --sso` 可作为显式引导式 SSO 别名。

系统浏览器 profile 复用默认关闭。如确有需要，显式设置
`ONTRACK_ENABLE_SYSTEM_BROWSER_PROFILE=1`，并可配合
`ONTRACK_BROWSER_USER_DATA_DIR` / `ONTRACK_BROWSER_PROFILE_DIR`。该模式可能会
打开所选 profile 以发现凭据；CLI 不会复制完整 profile storage state，只会保存
精确匹配的 OnTrack origin。请勿在共享或不受信任的 profile 上启用。

### 浏览器捕获模式: `ontrack login --auto`

`--auto` 保留旧的“仅浏览器捕获”流程，不做用户名/密码引导输入。

当前实现会从以下来源捕获凭据:

- URL query 参数
- `/api/auth` request payload
- `/api/auth` response body
- `localStorage`
- cookies

### 手动 redirect 导入（备用）

如果你已经拿到最终 redirect URL，也可以直接导入:

```bash
ontrack login --redirect-url "https://ontrack.infotech.monash.edu/sign_in?authToken=...&username=..."
```

期望格式:

```text
https://ontrack.infotech.monash.edu/sign_in?authToken=...&username=...
```

该方式是备用路径，不建议作为日常登录主流程。

### 直接传入 token

如果你已经拿到 `auth token` 和 `username`:

```bash
ontrack login --auth-token <token> --username <username>
```

### 登录后会发生什么

CLI 会把 access token 保存到本地，并将浏览器 refresh state 单独保存在受限
文件中。authenticated command 会尽量在 token 临近过期时静默续期，因此一般
不需要每次重新登录；当 Monash 的 refresh 或 SSO 策略到期时，仍可能要求用户
完成验证。

使用的认证头为:

- `Auth-Token`
- `Username`

### 退出登录

```bash
ontrack logout
```

## 命令总览

### 账号与连接

| 命令 | 作用 | 典型用途 |
| --- | --- | --- |
| `ontrack` | 打开交互式命令启动器 | 用序号快速执行常用流程 |
| `ontrack welcome` | 显式打开交互式命令启动器 | 适合脚本/别名场景 |
| `ontrack agent list` | 列出原生 caller-first 命令 | 离线执行，不需要 credential |
| `ontrack agent describe <command>` | 读取原生命令的 schema 与 policy | 离线执行，不需要 credential |
| `ontrack agent call <command> --input-json <object>` | 执行原生 caller-first 命令 | 一个结构化 envelope；当前支持 `auth.status`、`task.show` |
| `ontrack capabilities --output agent-json` | 发现 Agent 协议 | 离线执行，不需要 credential |
| `ontrack schema <command> --output agent-json` | 读取单个 command schema | 离线执行，不需要 credential |
| `ontrack auth-method` | 检查站点认证方式 | 确认当前站点是否走 SSO |
| `ontrack auth status --output agent-json` | 读取 credential 生命周期元数据 | 不返回 credential 或 identity |
| `ontrack auth ensure --output agent-json` | 保证 credential 可用 | 默认静默；必要时返回结构化 handoff |
| `ontrack login` | 引导式 Monash SSO 登录（默认） | 主登录入口 |
| `ontrack login --sso` | 引导式 Monash SSO 登录 | 显式别名模式 |
| `ontrack login --show-browser` | 显示浏览器执行引导式登录 | 调试 selector/MFA 边缘场景 |
| `ontrack login --hide-browser` | 显式保持无头引导式登录 | 可选显式参数（默认行为） |
| `ontrack login --auto` | 浏览器捕获模式登录 | 仅需被动捕获时使用 |
| `ontrack logout` | 清理本地 session 和浏览器 refresh state | 切账号、重登、排障 |
| `ontrack whoami` | 查看当前缓存账号 | 确认登录身份 |
| `ontrack doctor` | 检查关键 API 是否可用 | 快速定位权限或会话问题 |

### 读取课程、项目、任务

| 命令 | 作用 | 说明 |
| --- | --- | --- |
| `ontrack projects` | 列出当前账号可访问项目 | 最常用的总入口之一 |
| `ontrack project show --project-id <id>` | 查看某个项目详情 | 适合确认 unit、成绩、任务分布 |
| `ontrack units` | 列出课程 | 某些账号会 fallback 到 `/projects` 推导结果 |
| `ontrack unit show --unit-id <id>` | 查看课程详情 | 包括 task definitions 等 |
| `ontrack tasks` | 列出任务 | 可按 `--project-id`、`--status` 过滤 |
| `ontrack unit tasks --unit-id <id>` | 查看某门课的任务 | 按 unit 聚合 |
| `ontrack inbox` | 读取 inbox / fallback task list | 优先走 `/units/:id/tasks/inbox`，失败时回退 |
| `ontrack task show --project-id <id> --abbr <abbr>` | 查看单个或多个任务 | 支持重复/逗号 selector 与 `--all-tasks` |

### 反馈与实时跟踪

| 命令 | 作用 | 说明 |
| --- | --- | --- |
| `ontrack feedback list --project-id <id> --abbr <abbr>` | 拉取一个或多个任务的评论与事件 | 支持重复/逗号 selector 与 `--all-tasks` |
| `ontrack feedback watch --project-id <id> --abbr <abbr>` | 实时轮询任务聊天/反馈 | 默认 `15s` 轮询 |
| `ontrack watch` | 监控任务状态、due、最新评论变化 | 默认 `60s` 轮询 |

### PDF 与上传

| 命令 | 作用 | 说明 |
| --- | --- | --- |
| `ontrack pdf task --project-id <id> --abbr <abbr>` | 下载一个或多个 task PDF | 支持重复/逗号 selector 与 `--all-tasks`；默认保存到 `./downloads` |
| `ontrack pdf submission --project-id <id> --abbr <abbr>` | 下载一个或多个 submission PDF | 支持重复/逗号 selector 与 `--all-tasks`；默认保存到 `./downloads` |
| `ontrack submission upload ...` | 预检或上传 submission | 默认 dry-run；`--confirm` 才单次 dispatch；可选 `--trigger`、`--comment` |
| `ontrack submission upload-new-files ...` | 预检或追加 evidence 文件 | 必须先观察到 existing submission；默认 dry-run；`--confirm` 才单次 dispatch |

### 诊断与接口发现

| 命令 | 作用 | 说明 |
| --- | --- | --- |
| `ontrack discover` | 扫描 OnTrack 前端 bundle，提取 route/API 模板 | 偏工程用途 |
| `ontrack discover --probe` | 用当前会话探测发现的 API 模板 | 适合真实账号排查 |

## 常见工作流

### 工作流 1: 第一次登录并找到任务

```bash
ontrack login
ontrack whoami
ontrack projects
ontrack tasks
```

如果任务太多，可以先缩小范围:

```bash
ontrack tasks --project-id 87
```

或者按课程看:

```bash
ontrack units
ontrack unit tasks --unit-id 1
```

### 工作流 2: 找某个任务的完整上下文

```bash
ontrack task show --project-id 87 --abbr D4
ontrack feedback list --project-id 87 --abbr D4
ontrack pdf task --project-id 87 --abbr D4
ontrack pdf submission --project-id 87 --abbr D4
```

### 工作流 3: 实时看聊天和状态变化

看单个任务的评论流:

```bash
ontrack feedback watch --project-id 87 --abbr D4
```

只看新消息，不回放历史:

```bash
ontrack feedback watch --project-id 87 --abbr D4 --history 0
```

看整个项目或课程的状态变化:

```bash
ontrack watch --project-id 87
```

```bash
ontrack watch --unit-id 1
```

### 工作流 4: 下载 PDF

```bash
ontrack pdf task --project-id 87 --abbr D4
```

```bash
ontrack pdf submission --project-id 87 --abbr D4
```

自定义输出目录:

```bash
ontrack pdf submission --project-id 87 --abbr D4 --out-dir ./exports
```

默认命名规则:

```text
<unitCode>_<abbr>_<type>.pdf
```

例如:

```text
FIT1045_D4_submission.pdf
```

### 工作流 5: 上传 submission

安全预检:

```bash
ontrack submission upload --project-id 87 --abbr D4 --file ./report.pdf
```

确认上传多个文件:

```bash
ontrack submission upload \
  --project-id 87 \
  --abbr D4 \
  --file ./report.pdf \
  --file ./demo.mp4 \
  --confirm
```

显式映射上传键:

```bash
ontrack submission upload \
  --project-id 87 \
  --abbr D4 \
  --file file0=./report.pdf \
  --file file1=./demo.mp4 \
  --confirm
```

上传后顺便发评论:

```bash
ontrack submission upload \
  --project-id 87 \
  --abbr D4 \
  --file ./report.pdf \
  --comment "Updated submission with revised report." \
  --confirm
```

显式指定 trigger:

```bash
ontrack submission upload \
  --project-id 87 \
  --abbr D4 \
  --file ./report.pdf \
  --trigger ready_for_feedback \
  --confirm
```

### submission upload 和 submission upload-new-files 的区别

- `submission upload`
  - 面向常规提交
  - 如果当前任务状态是 `working_on_it` 或 `need_help`，CLI 会默认推断 `trigger=need_help`
  - 其他情况交给服务端默认行为
- `submission upload-new-files`
  - 更接近“补充证据 / new evidence”
  - 必须先由 `submission status` 证明 existing submission
  - 不主动施加默认 trigger

### 上传文件匹配规则

如果任务定义里声明了上传要求，CLI 会按任务定义顺序去匹配 `file0`、`file1` 等 key。

规则如下:

- 至少提供一个 `--file`
- 如果任务要求 2 个文件，你就必须传 2 个文件
- 如果同时提供显式 key 和普通路径，CLI 会把未指定 key 的路径按剩余 key 顺序补齐
- 如果 `--task-definition-id` 和 `--abbr` 同时存在，必须指向同一个任务
- 弃用的 `--task-id` 只有在 legacy definition/instance 含义唯一时才接受
- 如果使用 `--all-tasks`，不要再同时传任何 id selector 或 `--abbr`

## 输出、高亮与 JSON

### 默认输出

默认是彩色表格输出，重点字段会高亮:

- 表头: 青色加粗
- `task`: 加粗
- `unit`: 青色
- `status`: 按状态着色
- `due`: 即将到期或已逾期会高亮

### 登录流程输出

`ontrack login` 会显示结构化登录 UI，包括:

- 引导式 SSO 启动面板
- MFA 方法选择面板（同时保留纯文本列表兜底）
- Okta Verify number challenge 面板（数字高亮）
- 登录成功面板（账号、角色、下一步命令）

### 强制开启或关闭颜色

强制开启:

```bash
FORCE_COLOR=1 ontrack inbox
```

关闭颜色:

```bash
NO_COLOR=1 ontrack inbox
```

### JSON 输出

适合脚本、自动化或二次集成:

```bash
ontrack tasks --project-id 87 --json
```

### watch 命令在 `--json` 下的行为

`watch` 和 `feedback watch` 在 `--json` 模式下不是一次性输出一个大数组，而是按时间持续输出多个 JSON document。

这意味着它更适合被:

- `jq`
- 自定义 Node script
- 日志采集进程
- 长连接式自动化逻辑

进行流式消费。

## 环境变量

| 环境变量 | 作用 | 备注 |
| --- | --- | --- |
| `ONTRACK_BASE_URL` | 覆盖默认 API base URL | 默认值为 Monash OnTrack API |
| `ONTRACK_BROWSER_PATH` | 指定自动登录用的浏览器可执行文件 | 当自动探测浏览器失败时使用 |
| `ONTRACK_BROWSER_STATE_PATH` | 覆盖浏览器会话状态文件路径 | 静默复用仅接受 canonical 路径仍位于当前 operator home 内的文件 |
| `ONTRACK_ENABLE_SYSTEM_BROWSER_PROFILE` | 显式允许读取系统浏览器 profile 以发现凭据 | 默认关闭；请勿用于共享/不受信任 profile |
| `ONTRACK_BROWSER_USER_DATA_DIR` | 覆盖 Chromium/Chrome 用户数据根目录 | 仅在显式启用 profile 复用时生效 |
| `ONTRACK_BROWSER_PROFILE_DIR` | 覆盖用户数据目录下的 profile 名称 | 仅在显式启用时生效；默认 `Default` |
| `FORCE_COLOR` | 强制终端彩色输出 | 例如 `FORCE_COLOR=1` |
| `NO_COLOR` | 关闭彩色输出 | 适合日志或纯文本环境 |
| `XDG_CONFIG_HOME` | 控制 Linux/macOS 配置根目录 | 影响 session 存储路径 |
| `APPDATA` | Windows 配置根目录 | 影响 session 存储路径 |

## 文件与目录

### Session 缓存

默认 session 文件位置:

- macOS / Linux: `~/.config/ontrack-cli/session.json`
- Windows: `%APPDATA%\ontrack-cli\session.json`

CLI 会自动创建目录，并尽量以更安全的权限写入 session 文件。

### 浏览器 refresh state

静默续期使用的 exact-origin 浏览器状态单独保存：

- macOS / Linux：`~/.config/ontrack-cli/browser-state.json`
- Windows：`%APPDATA%\ontrack-cli\browser-state.json`

平台支持时目录权限为 `0700`、文件权限为 `0600`。Auth MCP 只在内部使用该
状态，绝不会向调用方返回。

### Agent execution journal

Agent 确认写操作的无凭证记录位于：

- macOS / Linux：`~/.config/ontrack-cli/executions/`
- Windows：`%APPDATA%\ontrack-cli\executions\`

journal 只存储 hash、生命周期状态和经过清理的结果，不存储上传路径、文件内容、
评论、身份数据或 credential。

### 下载目录

默认 PDF 下载目录:

```text
./downloads
```

真实烟测脚本默认使用:

```text
./downloads-smoke
```

### 构建输出

编译产物位于:

```text
dist/
```

## 本地开发

### 安装依赖

```bash
bun install
```

### 构建

```bash
bun run build
```

### 测试

```bash
bun test
```

### 开发调试

```bash
bun run dev -- tasks --project-id 87
```

### 真实账号烟测

```bash
bun run smoke:real -- --project-id 87 --abbr D4
```

这个脚本会验证以下流程:

- `auth-method`
- `whoami`
- `doctor`
- `discover`
- `discover --probe`
- `projects`
- `tasks`
- `task show`
- `units`
- `project show`
- `unit show`
- `unit tasks`
- `inbox`
- `feedback list`
- `pdf task`
- `pdf submission`
- `watch`
- `feedback watch`

这个脚本当前不会主动做上传操作，避免误改真实账号数据。

## 测试与验证

项目当前包含以下测试维度:

- [api.test.ts](/Users/mark/ontrack-cli/test/api.test.ts)
  - API client 请求头
  - 错误处理
  - PDF 下载
  - submission upload
  - comment post
- [cli-helpers.test.ts](/Users/mark/ontrack-cli/test/cli-helpers.test.ts)
  - task selector
  - watch diff
  - 文件名规则
  - upload 参数解析
- [auto-login.test.ts](/Users/mark/ontrack-cli/test/auto-login.test.ts)
  - SSO credential capture 辅助逻辑
  - OnTrack origin/domain 隔离
  - 私有且经过滤的 browser-state 持久化
- [discovery.test.ts](/Users/mark/ontrack-cli/test/discovery.test.ts)
  - 前端 bundle route/API 抽取逻辑
- [logout.test.ts](/Users/mark/ontrack-cli/test/logout.test.ts)
  - 远端注销失败时仍清理本地 session
  - 失败输出脱敏
- [utils.test.ts](/Users/mark/ontrack-cli/test/utils.test.ts)
  - base URL、redirect URL 等基础工具
- [whoami.test.ts](/Users/mark/ontrack-cli/test/whoami.test.ts)
  - allowlist 身份投影
  - JSON 与人类输出的 secret 回归测试

如果你要发版，最少建议执行:

```bash
bun test
bun run test:coverage
bun run build
```

如果你已经登录真实账号，再加上:

```bash
bun run smoke:real -- --project-id <id> --abbr <abbr>
```

## 项目结构

```text
.
├── always-ontrack-logo.png      # README logo
├── package.json                 # Bun package metadata and scripts
├── scripts/
│   └── smoke-real.mjs           # real-account smoke verification
├── src/
│   ├── cli.ts                   # command router and top-level handlers
│   └── lib/
│       ├── api.ts               # API client, downloads, uploads
│       ├── auto-login.ts        # browser-based SSO credential capture
│       ├── discovery.ts         # frontend surface discovery and probe
│       ├── session.ts           # local session persistence
│       ├── types.ts             # shared types
│       ├── utils.ts             # selectors, formatting, colors, helpers
│       └── whoami.ts            # allowlist、secret-safe 身份投影
├── test/                        # unit tests
└── tsconfig.json                # TypeScript build config
```

## 故障排查

### `Error: 403 Forbidden: Unable to list units`

某些账号没有直接访问 `/units` 的权限。这不是 CLI 崩溃，而是账号能力差异。

当前实现会尽量从 `/projects` 推导 unit 数据。你可以优先改用:

```bash
ontrack projects
ontrack tasks
```

### `Inbox endpoint unavailable ... Showing fallback task list`

这说明 `/units/:id/tasks/inbox` 当前账号不可访问，CLI 已经自动回退到 `/projects` 派生的任务列表。

这通常意味着:

- 你的账号权限较受限
- 某些 endpoint 对当前角色不可见
- 某个 unit 的 inbox API 不开放

### `No browser executable found ...`

手动指定浏览器路径:

```bash
ONTRACK_BROWSER_PATH="/path/to/browser" ontrack login
```

或者手动安装经过审核、版本固定的 Playwright Chromium runtime:

```bash
bunx playwright@1.58.2 install chromium
```

### `419 Authentication Timeout`

说明服务端拒绝了缓存的 access token。先让 auth runtime 尝试续期：

```bash
ontrack auth ensure --interaction never --output agent-json
```

如果返回 `HUMAN_VERIFICATION_REQUIRED`，请在用户可操作时改用
`--interaction if_required`。普通读命令本身也会自动尝试一次静默刷新和安全
重放。

### `Task abbreviation "... " is ambiguous`

说明同一个 project 里任务缩写不够唯一。改用:

```bash
ontrack task show --project-id <id> --task-definition-id <id>
```

### `Upload key mismatch` 或文件数量不匹配

先看任务详情和任务要求，再按显式 key 上传:

```bash
ontrack task show --project-id 87 --abbr D4 --json
```

```bash
ontrack submission upload \
  --project-id 87 \
  --abbr D4 \
  --file file0=./report.pdf \
  --file file1=./demo.mp4 \
  --confirm
```

### 没有颜色高亮

手动强制开启:

```bash
FORCE_COLOR=1 ontrack tasks --project-id 87
```

## 当前边界

当前版本已经支持真实账号驱动的高频读能力、反馈实时跟踪、PDF 下载和上传操作，但仍然保持了比较克制的写能力范围。

目前已支持:

- 登录
- 读取课程、项目、任务、inbox
- 读取评论与实时反馈流
- 下载 task / submission PDF
- 上传 submission
- 上传 new evidence / new files
- 上传后附带评论

当前没有扩展到的方向包括:

- 更大范围的任务状态写操作
- 更复杂的 staff workflow mutation
- 交互式任务选择器
- 长期持久化 watch 去重状态

如果你准备继续扩展，这个仓库最核心的入口文件是 [cli.ts](/Users/mark/ontrack-cli/src/cli.ts)，最关键的协议层在 [api.ts](/Users/mark/ontrack-cli/src/lib/api.ts)。
