# Always Ontrack (ontrack-cli)

[简体中文](./README.zh-CN.md)

<p align="center">
  <img src="./always-ontrack-logo.png" alt="Always OnTrack logo" width="480" />
</p>

<p align="center">
  A terminal-first CLI for Monash OnTrack / Doubtfire
</p>

`ontrack-cli` turns common Monash OnTrack workflows into a single command surface:

```bash
ontrack <command>
```

The CLI targets the Monash OnTrack API by default:

`https://ontrack.infotech.monash.edu/api`

It is designed to work out of the box, with no mandatory base URL setup and a command set that is suitable for both interactive terminal use and scriptable automation.

## Contents

- [What it does](#what-it-does)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Core concepts](#core-concepts)
- [Authentication and session management](#authentication-and-session-management)
- [Command reference](#command-reference)
- [Typical workflows](#typical-workflows)
- [Output, highlighting, and JSON](#output-highlighting-and-json)
- [Environment variables](#environment-variables)
- [Files and directories](#files-and-directories)
- [Local development](#local-development)
- [Testing and verification](#testing-and-verification)
- [Project structure](#project-structure)
- [Troubleshooting](#troubleshooting)
- [Current scope](#current-scope)

## What it does

`ontrack-cli` currently covers the following areas:

- Authentication and session handling
  - SSO auto capture
  - manual redirect URL login
  - direct `auth token + username` login
- Read access for account, unit, project, and task data
  - `projects`
  - `units`
  - `tasks`
  - `inbox`
  - `task show`
- Feedback and live tracking
  - `feedback list`
  - `feedback watch`
  - `watch`
- File operations
  - `pdf task`
  - `pdf submission`
  - `submission upload`
  - `submission upload-new-files`
- Engineering and diagnostics
  - `doctor`
  - `discover`
  - `discover --probe`
- Terminal UX
  - colored table output by default
  - `--json` for automation and scripting
  - fallback handling when some endpoints are not accessible for the current account

## Installation

### Requirements

- Node.js `22+`
- macOS, Linux, or Windows
- A Chromium-based browser is recommended for `ontrack login` (default guided SSO) or `ontrack login --auto`

### Global install

Recommended:

```bash
npm install -g ontrack-cli
```

After installation, the CLI is available as:

```bash
ontrack
```

### Local install

If you prefer to keep the package local to a workspace:

```bash
npm install
npm exec ontrack -- auth-method
```

### Run from source

```bash
npm install
npm run build
node dist/cli.js auth-method
```

Development mode:

```bash
npm run dev -- auth-method
```

## Quick start

This is the shortest stable path from install to useful output.

### 0. Open the interactive launcher

```bash
ontrack
```

The launcher displays the ALWAYS ONTRACK digital-style menu. Enter a number to run a command path directly.

For launcher actions `11-14` (task/submission PDF and upload flows), the CLI now opens a guided selector:

- pick a task from your live task list by index (recommended), or
- enter `--project-id` + `--abbr/--task-id` manually

### 1. Check the authentication method

```bash
ontrack auth-method
```

### 2. Sign in

Recommended:

```bash
ontrack login
```

Server/no-GUI override (headless):

```bash
ontrack login --hide-browser
```

### 3. Confirm the cached account

```bash
ontrack whoami
```

### 4. List projects, units, and tasks

```bash
ontrack projects
ontrack units
ontrack tasks
```

### 5. Inspect a specific task

```bash
ontrack task show --project-id 87 --abbr D4
```

### 6. Read feedback and watch live updates

```bash
ontrack feedback list --project-id 87 --abbr D4
ontrack feedback watch --project-id 87 --abbr D4
```

### 7. Download PDFs

```bash
ontrack pdf task --project-id 87 --abbr D4
ontrack pdf submission --project-id 87 --abbr D4
```

### 8. Upload a submission or extra evidence

```bash
ontrack submission upload --project-id 87 --abbr D4 --file ./report.pdf
```

```bash
ontrack submission upload-new-files --project-id 87 --abbr D4 --file ./evidence.pdf
```

## Core concepts

Understanding a few OnTrack terms makes the command surface much easier to use.

### `unit`

A teaching unit, for example `FIT1045`.

### `project`

Your project instance inside a unit. Most task-level commands require `--project-id`.

### `task`

A concrete task such as `P1`, `D4`, or `T2`.

### `abbr`

The task abbreviation. This is usually the most practical selector for day-to-day use:

- `P1`
- `D4`
- `T2`

In most cases, `--abbr` is easier to read and remember than a numeric ID.

### `taskId`

The CLI supports `--task-id`, but for normal usage `--abbr` is usually the better default.

### `--json`

Most read commands support `--json`. Use it when you want to pipe results into scripts, CI steps, or your own tooling.

## Authentication and session management

### Recommended login: `ontrack login`

This is the default recommended path on all environments:

```bash
ontrack login
```

This flow:

1. prompts for Monash username/password in CLI (password is hidden)
2. launches guided SSO automation in a visible browser by default
3. shows structured login progress in terminal panels
4. prompts MFA method selection in CLI when multiple methods are available
5. highlights Okta Verify number challenge values in terminal output
6. captures credentials and signs in through `/api/auth`
7. stores a local session cache

`ontrack login` now opens a visible browser by default for guided SSO.  
Use `ontrack login --hide-browser` to force headless mode (for server/no-GUI environments).  
You can still use `ontrack login --sso` as an explicit guided alias.

### Browser-only capture mode: `ontrack login --auto`

`--auto` keeps the previous browser-driven capture behavior without guided credential entry.

The current implementation can capture credentials from:

- URL query parameters
- `/api/auth` request payload
- `/api/auth` response body
- `localStorage`
- cookies

### Manual redirect import (backup only)

If you already have the final redirect URL, you can import it directly:

```bash
ontrack login --redirect-url "https://ontrack.infotech.monash.edu/sign_in?authToken=...&username=..."
```

The expected redirect format looks like this:

```text
https://ontrack.infotech.monash.edu/sign_in?authToken=...&username=...
```

Guided SSO automatically falls back to this manual redirect mode when it detects unsupported MFA, captcha, selector mismatch, or timeout.
Treat this as a backup path rather than a daily login path.

### Direct token login

If you already have a token and username:

```bash
ontrack login --auth-token <token> --username <username>
```

### What gets cached

After login, the CLI stores a session locally and reuses it for subsequent commands. You do not need to sign in again for each run unless the session expires or you log out.

The API client authenticates with these headers:

- `Auth-Token`
- `Username`

### Logout

```bash
ontrack logout
```

## Command reference

### Account and connectivity

| Command | Purpose | Typical use |
| --- | --- | --- |
| `ontrack` | Open the interactive command launcher | Fastest way to run common workflows by number |
| `ontrack welcome` | Open the interactive command launcher explicitly | Useful for scripts/aliases that pass arguments |
| `ontrack auth-method` | Show the advertised authentication method | Verify whether the server is using SSO |
| `ontrack login` | Run guided Monash SSO with Okta Verify push/number (default path) | Primary login command |
| `ontrack login --sso` | Run guided Monash SSO with Okta Verify push/number | Explicit guided alias |
| `ontrack login --hide-browser` | Force headless guided SSO | Recommended for server/no-GUI environments |
| `ontrack login --auto` | Run browser-only capture mode | Use when you only need passive capture |
| `ontrack logout` | Clear the local session | Switch accounts, reset state, troubleshoot |
| `ontrack whoami` | Show the cached account | Confirm who is currently logged in |
| `ontrack doctor` | Probe key endpoints | Quickly identify session or permission issues |

### Units, projects, and tasks

| Command | Purpose | Notes |
| --- | --- | --- |
| `ontrack projects` | List accessible projects | One of the main starting points |
| `ontrack project show --project-id <id>` | Show detailed project information | Useful for unit, grading, and task overview |
| `ontrack units` | List units | Some accounts fall back to units derived from `/projects` |
| `ontrack unit show --unit-id <id>` | Show detailed unit information | Includes task definitions when available |
| `ontrack tasks` | List tasks | Supports `--project-id` and `--status` |
| `ontrack unit tasks --unit-id <id>` | List tasks for one unit | Unit-scoped view |
| `ontrack inbox` | Load inbox tasks or fallback task list | Prefers `/units/:id/tasks/inbox` and falls back when needed |
| `ontrack task show --project-id <id> --abbr <abbr>` | Show one task | Best option for precise task inspection |

### Feedback and live tracking

| Command | Purpose | Notes |
| --- | --- | --- |
| `ontrack feedback list --project-id <id> --abbr <abbr>` | Fetch task comments and events | Read the task conversation |
| `ontrack feedback watch --project-id <id> --abbr <abbr>` | Poll task feedback in real time | Default interval is `15s` |
| `ontrack watch` | Monitor task status, due date, and new comment changes | Default interval is `60s` |

### PDF and uploads

| Command | Purpose | Notes |
| --- | --- | --- |
| `ontrack pdf task --project-id <id> --abbr <abbr>` | Download the task PDF | Saves to `./downloads` by default |
| `ontrack pdf submission --project-id <id> --abbr <abbr>` | Download the submission PDF | Saves to `./downloads` by default |
| `ontrack submission upload ...` | Upload a submission | Supports `--trigger` and `--comment` |
| `ontrack submission upload-new-files ...` | Upload extra evidence files | Does not force a default trigger |

### Diagnostics and discovery

| Command | Purpose | Notes |
| --- | --- | --- |
| `ontrack discover` | Scan frontend bundles for route and API templates | Engineering-focused inspection tool |
| `ontrack discover --probe` | Probe discovered API templates with the current session | Useful for real-account investigation |

## Typical workflows

### Workflow 1: sign in and find your tasks

```bash
ontrack login
ontrack whoami
ontrack projects
ontrack tasks
```

To narrow the result set:

```bash
ontrack tasks --project-id 87
```

Or scope by unit:

```bash
ontrack units
ontrack unit tasks --unit-id 1
```

### Workflow 2: inspect one task end to end

```bash
ontrack task show --project-id 87 --abbr D4
ontrack feedback list --project-id 87 --abbr D4
ontrack pdf task --project-id 87 --abbr D4
ontrack pdf submission --project-id 87 --abbr D4
```

### Workflow 3: watch live conversation and status changes

For one task conversation:

```bash
ontrack feedback watch --project-id 87 --abbr D4
```

To watch only new messages, with no history replay:

```bash
ontrack feedback watch --project-id 87 --abbr D4 --history 0
```

For project-wide or unit-wide status monitoring:

```bash
ontrack watch --project-id 87
```

```bash
ontrack watch --unit-id 1
```

### Workflow 4: download PDFs

```bash
ontrack pdf task --project-id 87 --abbr D4
```

```bash
ontrack pdf submission --project-id 87 --abbr D4
```

Custom output directory:

```bash
ontrack pdf submission --project-id 87 --abbr D4 --out-dir ./exports
```

Default filename format:

```text
<unitCode>_<abbr>_<type>.pdf
```

For example:

```text
FIT1045_D4_submission.pdf
```

### Workflow 5: upload a submission

Simplest form:

```bash
ontrack submission upload --project-id 87 --abbr D4 --file ./report.pdf
```

Multiple files:

```bash
ontrack submission upload \
  --project-id 87 \
  --abbr D4 \
  --file ./report.pdf \
  --file ./demo.mp4
```

Explicit upload key mapping:

```bash
ontrack submission upload \
  --project-id 87 \
  --abbr D4 \
  --file file0=./report.pdf \
  --file file1=./demo.mp4
```

Upload and post a comment:

```bash
ontrack submission upload \
  --project-id 87 \
  --abbr D4 \
  --file ./report.pdf \
  --comment "Updated submission with revised report."
```

Set the trigger explicitly:

```bash
ontrack submission upload \
  --project-id 87 \
  --abbr D4 \
  --file ./report.pdf \
  --trigger ready_for_feedback
```

### Difference between `submission upload` and `submission upload-new-files`

- `submission upload`
  - designed for normal submission flows
  - infers `trigger=need_help` when the current task status is `working_on_it` or `need_help`
  - otherwise leaves trigger handling to server defaults
- `submission upload-new-files`
  - closer to a "new evidence" flow
  - does not apply a default trigger automatically

### Upload matching rules

If the task definition exposes upload requirements, the CLI maps files to the required keys such as `file0`, `file1`, and so on.

Rules:

- at least one `--file` is required
- if a task requires two files, you must provide two files
- if you mix explicit keys and plain paths, the CLI fills remaining keys in definition order
- if `--task-id` and `--abbr` are both provided, they must resolve to the same task

## Output, highlighting, and JSON

### Default output

The default output mode is a colored terminal table. Important fields are highlighted:

- header: bold cyan
- `task`: bold
- `unit`: cyan
- `status`: color-coded by status
- `due`: highlighted when a deadline is close or overdue

### Login flow output

`ontrack login` now renders guided SSO status with styled terminal panels and event lines:

- guided SSO start panel
- MFA method selection panel (plus a plain-text fallback list)
- Okta Verify number challenge panel with highlighted numbers
- login success panel with account, role, and suggested next commands

### Force colors on or off

Force color:

```bash
FORCE_COLOR=1 ontrack inbox
```

Disable color:

```bash
NO_COLOR=1 ontrack inbox
```

### JSON output

Use `--json` for scripting, automation, or downstream tooling:

```bash
ontrack tasks --project-id 87 --json
```

### JSON behavior for watch commands

`watch` and `feedback watch` do not emit a single final JSON array. They emit multiple JSON documents over time as a stream.

That makes them a better fit for:

- `jq`
- custom Node scripts
- log collectors
- stream-oriented automation

## Environment variables

| Variable | Purpose | Notes |
| --- | --- | --- |
| `ONTRACK_BASE_URL` | Override the default API base URL | Defaults to Monash OnTrack API |
| `ONTRACK_BROWSER_PATH` | Set the browser executable path for SSO automation | Highest priority browser override |
| `ONTRACK_HEADLESS` | Force headless detection (`true/false` or `1/0`) | Useful when runtime detection is incorrect |
| `FORCE_COLOR` | Force colored terminal output | Example: `FORCE_COLOR=1` |
| `NO_COLOR` | Disable colored output | Useful for plain logs or CI |
| `XDG_CONFIG_HOME` | Override the config root on Linux and macOS | Affects session storage |
| `APPDATA` | Config root on Windows | Affects session storage |

## Files and directories

### Session cache

Default session file location:

- macOS / Linux: `~/.config/ontrack-cli/session.json`
- Windows: `%APPDATA%\ontrack-cli\session.json`

The CLI creates the directory automatically and writes the session file with stricter permissions where the platform allows it.

### Download directory

Default PDF download directory:

```text
./downloads
```

The real smoke test script uses:

```text
./downloads-smoke
```

### Build output

Compiled output is written to:

```text
dist/
```

## Local development

### Install dependencies

```bash
npm install
```

### Build

```bash
npm run build
```

### Run tests

```bash
npm test
```

### Development runs

```bash
npm run dev -- tasks --project-id 87
```

### Real-account smoke verification

```bash
npm run smoke:real -- --project-id 87 --abbr D4
```

This script verifies:

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

It currently avoids upload actions on purpose, to reduce the chance of mutating real account data during a smoke check.

## Testing and verification

The repository currently includes:

- [api.test.ts](/Users/mark/ontrack-cli/test/api.test.ts)
  - API client auth headers
  - error handling
  - PDF download
  - submission upload
  - comment posting
- [cli-helpers.test.ts](/Users/mark/ontrack-cli/test/cli-helpers.test.ts)
  - task selector parsing
  - watch diff logic
  - filename rules
  - upload argument parsing
- [auto-login.test.ts](/Users/mark/ontrack-cli/test/auto-login.test.ts)
  - SSO credential capture helpers
- [discovery.test.ts](/Users/mark/ontrack-cli/test/discovery.test.ts)
  - frontend bundle route and API extraction
- [utils.test.ts](/Users/mark/ontrack-cli/test/utils.test.ts)
  - base URL and redirect URL utilities

Minimum recommended validation before release:

```bash
npm test
npm run build
```

If you have a valid real session, add:

```bash
npm run smoke:real -- --project-id <id> --abbr <abbr>
```

## Project structure

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

## Troubleshooting

### `Error: 403 Forbidden: Unable to list units`

Some accounts do not have direct access to `/units`. This is an account capability difference, not a CLI crash.

The current implementation tries to derive unit data from `/projects` when necessary. In practice, these commands are usually more reliable:

```bash
ontrack projects
ontrack tasks
```

### `Inbox endpoint unavailable ... Showing fallback task list`

This means `/units/:id/tasks/inbox` is not accessible for the current account, and the CLI has already fallen back to a task list derived from `/projects`.

Typical reasons:

- the account has limited permissions
- the endpoint is role-restricted
- the inbox API is unavailable for that unit

### `No browser executable found ...`

Set the browser path explicitly:

```bash
ONTRACK_BROWSER_PATH="/path/to/browser" ontrack login
```

Or install bundled Chromium support:

```bash
npx playwright install chromium
```

### `419 Authentication Timeout`

The cached session has expired. Re-authenticate:

```bash
ontrack logout
ontrack login
```

### `Task abbreviation "... " is ambiguous`

The abbreviation is not unique inside that project. Use `--task-id` instead:

```bash
ontrack task show --project-id <id> --task-id <id>
```

### Upload key mismatch or incorrect file count

Inspect the task in JSON and then upload with explicit keys:

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

### No color highlighting

Force color manually:

```bash
FORCE_COLOR=1 ontrack tasks --project-id 87
```

## Current scope

The current version already supports real-account-driven read flows, live feedback tracking, PDF download, and upload operations, but it still keeps write capabilities intentionally narrow.

Supported now:

- login
- units, projects, tasks, and inbox reads
- feedback reads and live conversation watch
- task and submission PDF download
- submission upload
- new evidence or new file upload
- posting a comment after upload

Not expanded yet:

- broader task status mutations
- more complex staff-side write workflows
- interactive task pickers
- persistent long-term watch deduplication across processes

If you plan to extend the project, the main entry point is [cli.ts](/Users/mark/ontrack-cli/src/cli.ts) and the protocol layer is [api.ts](/Users/mark/ontrack-cli/src/lib/api.ts).
