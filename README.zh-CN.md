# Always Ontrack (ontrack-cli)

[English](./README.md)

<p align="center">
  <img src="./always-ontrack-logo.png" alt="Always OnTrack logo" width="480" />
</p>

<p align="center">
  Monash OnTrack / Doubtfire 的命令行客户端
</p>

`ontrack-cli` 把 Monash OnTrack 中常见的登录、查看任务、跟踪反馈、下载 PDF、上传 submission 等操作统一到一个命令面里:

```bash
ontrack <command>
```

项目默认面向 Monash OnTrack 站点:

`https://ontrack.infotech.monash.edu/api`

不需要用户先做复杂配置，安装后即可直接使用。

## 目录

- [功能概览](#功能概览)
- [安装](#安装)
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
  - `--json` 便于脚本集成
  - 自动处理部分 endpoint 权限差异和 fallback

## 安装

### 运行环境

- Node.js `22+`
- macOS / Linux / Windows
- 建议有一个 Chromium 系浏览器用于 `ontrack login`（默认引导式 SSO）或 `ontrack login --auto`

### 全局安装

推荐直接全局安装:

```bash
npm install -g ontrack-cli
```

安装完成后，命令入口为:

```bash
ontrack
```

### 本地安装

如果你只想在当前项目里使用:

```bash
npm install
npm exec ontrack -- auth-method
```

### 从源码运行

```bash
npm install
npm run build
node dist/cli.js auth-method
```

开发模式:

```bash
npm run dev -- auth-method
```

## 快速开始

下面是一套最短、最稳的上手路径。

欢迎页动作现在支持引导选择任务：

- `7/8/11/12` 支持引导单任务与批量任务选择
- 可以选 `single`、`multiple`（逗号分隔）或 `all tasks`
- 任务输入支持 task 代号（如 `P1`、`D4`）或数字 task id
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

无图形环境（服务器）可强制无头模式:

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

### 8. 上传 submission 或补充文件

```bash
ontrack submission upload --project-id 87 --abbr D4 --file ./report.pdf
```

```bash
ontrack submission upload-new-files --project-id 87 --abbr D4 --file ./evidence.pdf
```

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

### `taskId`

CLI 支持 `--task-id`，但实际使用里更推荐优先用 `--abbr`，因为更稳定、更易读。

### 批量任务选择器

支持批量选择的命令（`task show`、`feedback list`、`pdf task`、`pdf submission`）可使用：

- 重复参数：`--abbr P1 --abbr D4`
- 逗号参数：`--abbr P1,D4`
- 混合参数：`--task-id 501 --abbr D4`
- 整个项目：`--all-tasks`

### `--json`

几乎所有读命令都支持 `--json`。如果你要把 CLI 接到 shell script、Node script、CI 或其他自动化流程里，优先用这个输出模式。

## 登录与会话

### 推荐方式: `ontrack login`

这是默认推荐的登录方式:

```bash
ontrack login
```

这个流程会:

1. 在 CLI 里输入 Monash username/password（密码隐藏输入）
2. 默认打开可见浏览器并进入引导式 SSO 自动化
3. 在终端显示结构化登录进度面板
4. 如果出现多个 MFA 方法，在 CLI 中给出编号选项供你选择
5. 在 Okta Verify number challenge 时高亮显示页面数字
6. 捕获凭据并调用 `/api/auth`
7. 保存本地会话缓存

`ontrack login` 默认使用可见浏览器。  
服务器/无 GUI 环境可使用 `ontrack login --hide-browser` 强制无头模式。  
`ontrack login --sso` 可作为显式引导式 SSO 别名。

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

CLI 会把会话保存到本地，后续命令默认复用，不需要每次重新登录。

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
| `ontrack auth-method` | 检查站点认证方式 | 确认当前站点是否走 SSO |
| `ontrack login` | 引导式 Monash SSO 登录（默认） | 主登录入口 |
| `ontrack login --sso` | 引导式 Monash SSO 登录 | 显式别名模式 |
| `ontrack login --hide-browser` | 强制无头引导式登录 | 服务器/无 GUI 环境推荐 |
| `ontrack login --auto` | 浏览器捕获模式登录 | 仅需被动捕获时使用 |
| `ontrack logout` | 清理本地会话 | 切账号、重登、排障 |
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
| `ontrack submission upload ...` | 上传 submission | 可选 `--trigger`、`--comment` |
| `ontrack submission upload-new-files ...` | 追加/补充 evidence 文件 | 不强制默认 trigger |

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

最简单的上传:

```bash
ontrack submission upload --project-id 87 --abbr D4 --file ./report.pdf
```

上传多个文件:

```bash
ontrack submission upload \
  --project-id 87 \
  --abbr D4 \
  --file ./report.pdf \
  --file ./demo.mp4
```

显式映射上传键:

```bash
ontrack submission upload \
  --project-id 87 \
  --abbr D4 \
  --file file0=./report.pdf \
  --file file1=./demo.mp4
```

上传后顺便发评论:

```bash
ontrack submission upload \
  --project-id 87 \
  --abbr D4 \
  --file ./report.pdf \
  --comment "Updated submission with revised report."
```

显式指定 trigger:

```bash
ontrack submission upload \
  --project-id 87 \
  --abbr D4 \
  --file ./report.pdf \
  --trigger ready_for_feedback
```

### submission upload 和 submission upload-new-files 的区别

- `submission upload`
  - 面向常规提交
  - 如果当前任务状态是 `working_on_it` 或 `need_help`，CLI 会默认推断 `trigger=need_help`
  - 其他情况交给服务端默认行为
- `submission upload-new-files`
  - 更接近“补充证据 / new evidence”
  - 不主动施加默认 trigger

### 上传文件匹配规则

如果任务定义里声明了上传要求，CLI 会按任务定义顺序去匹配 `file0`、`file1` 等 key。

规则如下:

- 至少提供一个 `--file`
- 如果任务要求 2 个文件，你就必须传 2 个文件
- 如果同时提供显式 key 和普通路径，CLI 会把未指定 key 的路径按剩余 key 顺序补齐
- 如果 `--task-id` 和 `--abbr` 同时存在，必须指向同一个任务

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
| `ONTRACK_HEADLESS` | 强制覆盖是否无头模式（`true/false` 或 `1/0`） | 适合容器、CI 或 SSH 误判场景 |
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
npm install
```

### 构建

```bash
npm run build
```

### 测试

```bash
npm test
```

### 开发调试

```bash
npm run dev -- tasks --project-id 87
```

### 真实账号烟测

```bash
npm run smoke:real -- --project-id 87 --abbr D4
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
- [discovery.test.ts](/Users/mark/ontrack-cli/test/discovery.test.ts)
  - 前端 bundle route/API 抽取逻辑
- [utils.test.ts](/Users/mark/ontrack-cli/test/utils.test.ts)
  - base URL、redirect URL 等基础工具

如果你要发版，最少建议执行:

```bash
npm test
npm run build
```

如果你已经登录真实账号，再加上:

```bash
npm run smoke:real -- --project-id <id> --abbr <abbr>
```

## 项目结构

```text
.
├── always-ontrack-logo.png      # README logo
├── package.json                 # npm metadata and scripts
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
│       └── utils.ts             # selectors, formatting, colors, helpers
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

或者安装 Playwright bundled Chromium:

```bash
npx playwright install chromium
```

### `419 Authentication Timeout`

说明缓存 session 已过期。直接重新登录:

```bash
ontrack logout
ontrack login
```

### `Task abbreviation "... " is ambiguous`

说明同一个 project 里任务缩写不够唯一。改用:

```bash
ontrack task show --project-id <id> --task-id <id>
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
  --file file1=./demo.mp4
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
