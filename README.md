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

- Bun `1.3.14+`
- macOS, Linux, or Windows
- Network access when you choose to install a reviewed browser runtime manually

### Global install

Recommended:

```bash
bun add --global ontrack-cli
```

After installation, the CLI is available as:

```bash
ontrack
```

### Local install

If you prefer to keep the package local to a workspace:

```bash
bun install
bun run ontrack -- auth-method
```

### Run from source

```bash
bun install
bun run build
bun dist/cli.js auth-method
```

Development mode:

```bash
bun run dev -- auth-method
```

## Quick start

This is the shortest stable path from install to useful output.

### 0. Open the interactive launcher

```bash
ontrack
```

The launcher displays the ALWAYS ONTRACK digital-style menu. Enter a number to run a command path directly.

Launcher actions now include guided task selection:

- actions `7/8/11/12` support guided single-task and batch selection
- you can choose `single`, `multiple` (comma-separated selectors), or `all tasks`
- task selection is based on `task` code (for example `P1`, `D4`) or numeric task-definition id
- you can still switch to manual `--project-id` + selector input
- upload actions `13/14` remain single-task guided by design

### 1. Check the authentication method

```bash
ontrack auth-method
```

### 2. Sign in

Recommended:

```bash
ontrack login
```

Explicit headless mode (same as default behavior):

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

Batch examples:

```bash
ontrack task show --project-id 87 --abbr P1,D4
ontrack task show --project-id 87 --all-tasks
```

### 6. Read feedback and watch live updates

```bash
ontrack feedback list --project-id 87 --abbr D4
ontrack feedback watch --project-id 87 --abbr D4
```

Batch list example:

```bash
ontrack feedback list --project-id 87 --abbr P1,D4
```

### 7. Download PDFs

```bash
ontrack pdf task --project-id 87 --abbr D4
ontrack pdf submission --project-id 87 --abbr D4
```

Batch PDF example:

```bash
ontrack pdf task --project-id 87 --all-tasks
```

### 8. Preview, then confirm a submission or extra evidence

```bash
ontrack submission upload --project-id 87 --abbr D4 --file ./report.pdf
ontrack submission upload --project-id 87 --abbr D4 --file ./report.pdf --confirm
```

```bash
ontrack submission upload-new-files --project-id 87 --abbr D4 --file ./evidence.pdf
ontrack submission upload-new-files --project-id 87 --abbr D4 --file ./evidence.pdf --confirm
```

Without `--confirm`, both commands perform a safe preflight and send no write request.

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

### `taskDefinitionId`

Use `--task-definition-id` for an unambiguous numeric selector. The old `--task-id`
is a deprecated compatibility adapter: it can resolve a unique legacy task-instance
or task-definition id, warns on stderr, and rejects identity collisions.

### Batch task selectors

Batch-capable commands (`task show`, `feedback list`, `pdf task`, `pdf submission`) support:

- repeated selectors: `--abbr P1 --abbr D4`
- comma selectors: `--abbr P1,D4`
- mixed selectors: `--task-definition-id 501 --abbr D4`
- project-wide selection: `--all-tasks`

### `--json`

Most read commands support `--json`. Use it when you want to pipe results into scripts, CI steps, or your own tooling.

## Authentication and session management

### Recommended login: `ontrack login`

This is the default recommended path on all environments:

```bash
ontrack login
```

This flow:

1. first probes the CLI's previously saved, OnTrack-only browser state and reuses it when valid
2. if no reusable state is found, prompts for Monash username/password in CLI (password is hidden)
3. launches guided SSO automation in hidden-browser (headless) mode by default
4. shows structured login progress in terminal panels
5. prompts MFA method selection in CLI when multiple methods are available
6. for code-based methods (`Google Authenticator` / `Enter a code`), prompts for your app code and submits it
7. for push-based method (`Get a push notification`), highlights Okta Verify number challenge values
8. captures credentials and signs in through `/api/auth`
9. stores a local session cache
10. tells you how to install a browser runtime manually if one is missing

`ontrack login` now defaults to hidden-browser (headless) mode across local and server environments.  
Use `ontrack login --show-browser` only for debugging.  
You can still use `ontrack login --sso` as an explicit guided alias.

System browser-profile reuse is disabled by default. To opt in explicitly, set
`ONTRACK_ENABLE_SYSTEM_BROWSER_PROFILE=1` (and, if needed,
`ONTRACK_BROWSER_USER_DATA_DIR` / `ONTRACK_BROWSER_PROFILE_DIR`). This may open
your selected profile for credential discovery; the CLI never copies that
profile's complete storage state and persists only the exact OnTrack origin.
Do not enable it for a shared or untrusted system profile.

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
| `ontrack login` | Run guided Monash SSO with MFA method selection (push/number/code) | Primary login command |
| `ontrack login --sso` | Run guided Monash SSO with MFA method selection (push/number/code) | Explicit guided alias |
| `ontrack login --show-browser` | Force visible browser mode for guided SSO | Debug selector or MFA edge cases |
| `ontrack login --hide-browser` | Keep explicit headless guided SSO | Optional explicit flag (default behavior) |
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
| `ontrack task show --project-id <id> --abbr <abbr>` | Show one or many tasks | Supports repeated/comma selectors and `--all-tasks` |

### Feedback and live tracking

| Command | Purpose | Notes |
| --- | --- | --- |
| `ontrack feedback list --project-id <id> --abbr <abbr>` | Fetch comments/events for one or many tasks | Supports repeated/comma selectors and `--all-tasks` |
| `ontrack feedback watch --project-id <id> --abbr <abbr>` | Poll task feedback in real time | Default interval is `15s` |
| `ontrack watch` | Monitor task status, due date, and new comment changes | Default interval is `60s` |

### PDF and uploads

| Command | Purpose | Notes |
| --- | --- | --- |
| `ontrack pdf task --project-id <id> --abbr <abbr>` | Download task PDF(s) | Supports repeated/comma selectors and `--all-tasks`; saves to `./downloads` by default |
| `ontrack pdf submission --project-id <id> --abbr <abbr>` | Download submission PDF(s) | Supports repeated/comma selectors and `--all-tasks`; saves to `./downloads` by default |
| `ontrack submission upload ...` | Preview or upload a submission | Dry-run by default; `--confirm` dispatches once; supports `--trigger` and `--comment` |
| `ontrack submission upload-new-files ...` | Preview or upload extra evidence files | Requires an observed existing submission; dry-run by default; `--confirm` dispatches once |

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

Safe preflight:

```bash
ontrack submission upload --project-id 87 --abbr D4 --file ./report.pdf
```

Confirmed upload with multiple files:

```bash
ontrack submission upload \
  --project-id 87 \
  --abbr D4 \
  --file ./report.pdf \
  --file ./demo.mp4 \
  --confirm
```

Explicit upload key mapping:

```bash
ontrack submission upload \
  --project-id 87 \
  --abbr D4 \
  --file file0=./report.pdf \
  --file file1=./demo.mp4 \
  --confirm
```

Upload and post a comment:

```bash
ontrack submission upload \
  --project-id 87 \
  --abbr D4 \
  --file ./report.pdf \
  --comment "Updated submission with revised report." \
  --confirm
```

Set the trigger explicitly:

```bash
ontrack submission upload \
  --project-id 87 \
  --abbr D4 \
  --file ./report.pdf \
  --trigger ready_for_feedback \
  --confirm
```

### Difference between `submission upload` and `submission upload-new-files`

- `submission upload`
  - designed for normal submission flows
  - infers `trigger=need_help` when the current task status is `working_on_it` or `need_help`
  - otherwise leaves trigger handling to server defaults
- `submission upload-new-files`
  - closer to a "new evidence" flow
  - requires `submission status` to prove an existing submission first
  - does not apply a default trigger automatically

### Upload matching rules

If the task definition exposes upload requirements, the CLI maps files to the required keys such as `file0`, `file1`, and so on.

Rules:

- at least one `--file` is required
- if a task requires two files, you must provide two files
- if you mix explicit keys and plain paths, the CLI fills remaining keys in definition order
- if `--task-definition-id` and `--abbr` are both provided, they must resolve to the same task
- deprecated `--task-id` is accepted only when its legacy definition/instance meaning is unique
- if `--all-tasks` is provided, do not combine it with any id selector or `--abbr`

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
| `ONTRACK_BROWSER_STATE_PATH` | Override persisted browser session state file path | Used for cookie/localStorage reuse during login |
| `ONTRACK_ENABLE_SYSTEM_BROWSER_PROFILE` | Explicitly allow live browser-profile credential discovery | Disabled by default; do not enable for shared/untrusted profiles |
| `ONTRACK_BROWSER_USER_DATA_DIR` | Override Chromium/Chrome user data root | Used only with `ONTRACK_ENABLE_SYSTEM_BROWSER_PROFILE=1` |
| `ONTRACK_BROWSER_PROFILE_DIR` | Override profile directory name under user data root | Used only with explicit profile reuse; defaults to `Default` |
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
bun install
```

### Build

```bash
bun run build
```

### Run tests

```bash
bun test
```

### Development runs

```bash
bun run dev -- tasks --project-id 87
```

### Real-account smoke verification

```bash
bun run smoke:real -- --project-id 87 --abbr D4
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
  - OnTrack origin/domain isolation
  - private, filtered browser-state persistence
- [discovery.test.ts](/Users/mark/ontrack-cli/test/discovery.test.ts)
  - frontend bundle route and API extraction
- [logout.test.ts](/Users/mark/ontrack-cli/test/logout.test.ts)
  - local cleanup when remote sign-out fails
  - redacted failure output
- [utils.test.ts](/Users/mark/ontrack-cli/test/utils.test.ts)
  - base URL and redirect URL utilities
- [whoami.test.ts](/Users/mark/ontrack-cli/test/whoami.test.ts)
  - allowlisted identity projection
  - JSON and human-output secret regression checks

Minimum recommended validation before release:

```bash
bun test
bun run test:coverage
bun run build
```

If you have a valid real session, add:

```bash
bun run smoke:real -- --project-id <id> --abbr <abbr>
```

## Project structure

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
│       └── whoami.ts            # allowlisted, secret-safe identity projection
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

Or install a reviewed, pinned Playwright Chromium runtime manually:

```bash
bunx playwright@1.58.2 install chromium
```

### `419 Authentication Timeout`

The cached session has expired. Re-authenticate:

```bash
ontrack logout
ontrack login
```

### `Task abbreviation "... " is ambiguous`

The abbreviation is not unique inside that project. Use the task-definition id:

```bash
ontrack task show --project-id <id> --task-definition-id <id>
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
  --file file1=./demo.mp4 \
  --confirm
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
