# Always Ontrack (ontrack-cli)

[简体中文](./README.zh-CN.md)

<p align="center">
  <img src="./always-ontrack-poster.png" alt="Always OnTrack — agent-first CLI for Monash OnTrack / Doubtfire" width="720" />
</p>

<p align="center">
  An agent-first CLI and authentication MCP for Monash OnTrack / Doubtfire
</p>

`ontrack-cli` turns common Monash OnTrack workflows into a single command surface:

```bash
ontrack <command>
```

The CLI targets the Monash OnTrack API by default:

`https://ontrack.infotech.monash.edu/api`

The primary interface is a versioned, schema-discoverable Agent protocol. Human
tables and the interactive launcher remain available over the same execution
engine.

## Contents

- [What it does](#what-it-does)
- [Installation](#installation)
- [Agent-first usage](#agent-first-usage)
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
  - silent token renewal from a restricted browser state
  - structured human handoff only when Monash requires verification
  - local `ontrack-auth-mcp` control plane
  - SSO auto capture
  - manual redirect URL login
  - direct `auth token + username` login
- Read access for account, unit, project, and task data
  - `projects`
  - `units`
  - `tasks`
  - `inbox`
  - `task show`
  - `task resources`
- Feedback and live tracking
  - `feedback list`
  - `feedback watch`
  - `watch`
- File operations
  - `task resources`
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
  - `--output agent-json` for versioned Agent automation
  - legacy `--json` for compatible raw scripting output
  - fallback handling when some endpoints are not accessible for the current account

## Installation

### Requirements

- Bun `1.3.14+` for the HTTP CLI and Auth MCP. The experimental Lightpanda
  provider additionally requires Bun `1.4.0+`.
- macOS, Linux, or Windows
- The Lightpanda spike is currently limited to macOS/Linux; Windows fails
  closed until executable ACL validation is implemented.
- Network access when you choose to install a reviewed browser runtime manually

### Global install

Recommended:

```bash
bun add --global ontrack-cli
```

After installation, the CLI is available as:

```bash
ontrack
ontrack-auth-mcp
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

## Agent-first usage

### Native caller-first interface

New Agent integrations should use the explicit caller-first surface. It accepts
one bounded JSON object and never translates that object into human CLI flags.
`agent call` emits exactly one `ontrack.agent/v1` envelope; `agent stream` emits
one NDJSON envelope per bounded frame:

```bash
ontrack agent list
ontrack agent describe task.show
ontrack agent call auth.status --input-json '{}'
ontrack agent call projects.list --input-json '{}'
ontrack agent call unit.show --input-json '{"project_id":87}'
ontrack agent call tutorials.status --input-json '{"project_id":87}'
ontrack agent call tasks.list --input-json '{"project_id":87}'
ontrack agent call task.show \
  --input-json '{"project_id":87,"abbreviation":["D4"]}'
ontrack agent call task.prerequisites \
  --input-json '{"project_id":87,"abbreviation":"D4"}'
ontrack agent call feedback.list \
  --input-json '{"project_id":87,"abbreviation":"D4"}'
ontrack agent stream feedback.watch \
  --input-json '{"project_id":87,"abbreviation":"D4","interval_seconds":15,"history":30}'
ontrack agent call plan.show \
  --input-json '{"project_id":87,"include_beyond_target":false}'
ontrack agent call submission.status \
  --input-json '{"project_id":87,"abbreviation":"D4"}'
ontrack agent call task.resources \
  --input-json '{"project_id":87,"abbreviation":["D4"],"out_dir":"downloads"}'
ontrack agent call pdf.task \
  --input-json '{"project_id":87,"abbreviation":"D4","out_dir":"downloads"}'
ontrack agent call pdf.submission \
  --input-json '{"project_id":87,"abbreviation":"D4","out_dir":"downloads"}'
```

Start with `projects.list`, then use its `project_id` to inspect the matching
`unit.show`, `tutorials.status`, and `tasks.list` projections before selecting a
Task Definition for a task-specific read. The native surface currently covers
`auth.status`, `projects.list`, `unit.show`, `tutorials.status`, `tasks.list`,
`task.show`, `task.prerequisites`, `feedback.list`, `feedback.watch`, `task.resources`, `pdf.task`,
`pdf.submission`, `plan.show`, and `submission.status`. More commands are added only as
individually reviewed vertical slices. Use `--input -` for bounded,
non-interactive stdin.

#### Native command inventory

| Command | Safe projection or operation |
| --- | --- |
| `auth.status` | Local authentication lifecycle metadata |
| `projects.list` | PII-minimized project directory |
| `unit.show` | Project-scoped Student Unit View |
| `tutorials.status` | Tutorial stream and change-policy status |
| `tasks.list` | Project-scoped Student Task View catalogue |
| `task.show` | Definition-first task detail |
| `task.prerequisites` | One task's prerequisite status |
| `feedback.list` | One task's bounded, person-free feedback timeline |
| `feedback.watch` | Cancellable bounded feedback delta stream |
| `task.resources` | Definition-first resource artifacts and metadata |
| `pdf.task` | One Task Definition's task-sheet PDF artifact |
| `pdf.submission` | One ready submission PDF artifact |
| `plan.show` | Definition-first plan and date-source view |
| `submission.status` | Definition-first submission lifecycle status |

`task.show` uses the definition-first Student Task View, so a project with an
empty `tasks` array can still expose tasks from its unit task-definition
catalogue. It explicitly reports uninstantiated tasks instead of guessing an
instance id. `unit.show` uses `projects.list` identity as its scope, then reads
the matching Unit Detail only to return a PII-minimized unit summary and task
definition count. It never returns staff, tutorials, groups, people, or raw task
payloads. `tutorials.status` is a separate read-only projection of the verified
tutorial-enrolment join: stream state and change policy only, never tutorial,
room, tutor, or learner details. `tasks.list` is the bounded catalogue projection
for selecting a Task Definition. `submission.status` resolves
the task definition even when no task instance exists, reads OnTrack's observed
per-definition submission-details route, and returns explicit PDF state plus
`submission_observed` (including submitted/processing lifecycle statuses).
The response is bounded to 64 KiB and malformed or
conflicting snake/camel aliases fail closed as `REMOTE_UNAVAILABLE`.
`task.resources` returns
bounded artifact metadata (filename, relative path, byte count, content type,
and SHA-256) and reports unavailable archives without writing placeholders.
`pdf.task` is deliberately single-definition only: it resolves one Task Definition,
validates the downloaded `%PDF-` signature, and returns the same bounded artifact
metadata without guessing a Task Instance. It accepts `application/octet-stream`
only when the downloaded bytes are a valid PDF signature.
`pdf.submission` uses the same single-Task-Definition selector, first reads the
strict observed submission state, and downloads only when its PDF is ready. A
processing PDF returns retryable `CONFLICT` with a `submission.status` next action;
an unavailable PDF returns `NOT_FOUND`. Its native download rejects placeholders
and invalid `%PDF-` bytes before the existing artifact can be overwritten. The
legacy batch `pdf submission --json` and `pdf submission --output agent-json`
commands retain their compatibility behavior.
`feedback.list` resolves one task from the same authoritative catalogue and
returns at most 200 bounded comment/event records. It retains actionable feedback
text, but redacts person- and credential-shaped text and never returns
author/recipient profiles, attachments, or unknown remote fields; malformed aliases
and oversized responses fail closed.
`feedback.watch` resolves that same Task Definition once, emits one baseline, then
only unseen feedback deltas. Every emitted record has a stable server feedback ID;
records without one fail closed rather than risking a lost delta. It is cancellable
with `SIGINT`, which aborts active reads and adds no human text or error frame to
stdout. Use `agent stream feedback.watch`, not `agent call`, because the former
preserves the one-envelope-per-line NDJSON contract.
`plan.show` uses the same definition-first catalogue, reports optional task
instance identity and status, keeps personal/grade/unit/missing date sources
explicit, treats the feedback deadline independently, and exposes normalized
prerequisites with both required and current status. It retains tutorial-mismatch
and unknown visibility states so an Agent can distinguish unavailable context
from a filtered task; missing flexible-date capability fails closed. Its
unit-wide prerequisite response and canonical output are bounded to 512 KiB;
malformed dates or conflicting aliases fail closed.

`projects.list` is the native discovery bootstrap for those project-scoped
commands. Its strict `{}` input returns at most 200 PII-minimized project rows
with project/unit identity plus bounded grade and capability summaries. The
Agent `/projects` response and complete Agent envelope are each limited to 512 KiB;
conflicting aliases, duplicate identities, control characters, invalid types,
or excess rows fail closed as `REMOTE_UNAVAILABLE`. `projects --output
agent-json` shares this projection, while bare `projects --json` retains its
legacy raw shape.

The existing `--output agent-json` commands remain a compatibility Adapter for
the broader command set while it migrates to this interface. Bare `--json`
continues to keep its legacy raw shape.

### Discover the protocol

Native callers should discover their executable surface instead of scraping help text:

```bash
ontrack agent list
ontrack agent describe pdf.submission
```

The existing `capabilities`, `schema`, and `--output agent-json` commands are a
broader compatibility Adapter; their schemas describe that adapter's batch-capable
surfaces. `--output agent-json` returns the stable `ontrack.agent/v1` envelope with a
request id, command path, status, structured data, warnings, next actions, and
artifacts. Errors use stable codes and exit statuses. Existing bare `--json`
keeps its pre-0.5 raw shape.

### Pass structured input

```bash
ontrack task show \
  --input-json '{"project_id":87,"abbreviation":["D4"]}' \
  --output agent-json
```

Or use bounded, non-interactive stdin:

```bash
printf '%s' '{"project_id":87,"task_definition_id":501}' |
  ontrack task show --input - --output agent-json
```

Only fields declared by the command schema are accepted. Unknown fields,
ambiguous duplicate flags, unsafe object keys, invalid types, and TTY stdin are
rejected before a business request is sent.

### Use the authentication MCP

The package installs a separate stdio server whose scope is deliberately limited
to authentication:

```json
{
  "mcpServers": {
    "ontrack-auth": {
      "command": "ontrack-auth-mcp"
    }
  }
}
```

It exposes `auth_status`, `auth_ensure`, and `auth_logout`. It never returns
passwords, Okta challenge values, cookies, refresh tokens, OnTrack access tokens,
or SSO form data. MCP callers cannot choose a network origin; a non-production
deployment must be configured by the trusted host through `ONTRACK_BASE_URL`
before the server starts.

Use `auth_ensure` with `interaction: "never"` during autonomous work. It first
reuses a valid token, then attempts a silent renewal over plain HTTP using the
restricted refresh cookie captured at sign-in, and only then falls back to the
restricted browser state. If Monash policy requires a number challenge, it
returns a structured human handoff. `interaction: "if_required"` may open one
visible browser flow; the Agent resumes after the user completes the
Monash-controlled step. The default remaining-validity margin is 60 seconds;
pass `min_ttl_seconds` (or CLI `--min-ttl-seconds`) to require a longer margin
for a specific operation.

The CLI applies the same lifecycle automatically. A rejected read may silently
refresh and replay once. Mutations are never automatically replayed.

### Apply writes safely

Writes remain dry-run by default. A confirmed Agent write also requires a stable
idempotency key:

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

Completed operations replay their safe recorded result without dispatching
again. Reusing a key with different input is rejected. If a transport failure or
process interruption makes the remote outcome unknowable, that key is blocked
until the Agent verifies remote state.

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

Human-readable output shows only the validated SSO origin and path; query and
fragment data are omitted from terminal metadata. Server-provided method labels
are bounded and rejected when they contain terminal control characters.

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

Most read commands support `--json` for compatible raw output. Agents should use
`--output agent-json` for the versioned envelope, schemas, stable errors, and
next actions.

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
When the CLI must print the SSO entry URL for manual use, it preserves the full
query only after HTTP(S), credential, control-character, and length validation.
Unsafe server-provided URLs are not echoed to the terminal.

### Direct token login

If you already have a token and username:

```bash
ontrack login --auth-token <token> --username <username>
```

### What gets cached

After login, the CLI stores the access token locally and requests a persistent
session, so the server's refresh cookie (about one week) is kept in a separate
restricted browser-state file. Authenticated commands renew near-expiry tokens
silently over plain HTTP when possible, without launching a browser, so users
do not normally sign in for every run. Monash can still require verification
when its refresh or SSO policy expires.

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
| `ontrack agent list` | List native caller-first commands | Offline; no credential required |
| `ontrack agent describe <command>` | Read a native command's executable schema and policy | Offline; no credential required |
| `ontrack agent call <command> --input-json <object>` | Execute a native caller-first command | One structured envelope. Current commands: `auth.status`, `projects.list`, `unit.show`, `tutorials.status`, `tasks.list`, `task.show`, `task.prerequisites`, `feedback.list`, `task.resources`, `pdf.task`, `pdf.submission`, `plan.show`, and `submission.status` |
| `ontrack agent stream <command> --input-json <object>` | Run a native caller-first stream | NDJSON envelope frames. Current stream: `feedback.watch` |
| `ontrack capabilities --output agent-json` | Discover the Agent protocol | Offline; no credential required |
| `ontrack schema <command> --output agent-json` | Read one command schema | Offline; no credential required |
| `ontrack auth-method` | Show the advertised authentication method | Verify whether the server is using SSO |
| `ontrack auth status --output agent-json` | Read credential lifecycle metadata | Never returns a credential or identity |
| `ontrack auth ensure --output agent-json` | Ensure a usable credential | Silent by default; structured handoff when required |
| `ontrack login` | Run guided Monash SSO with MFA method selection (push/number/code) | Primary login command |
| `ontrack login --sso` | Run guided Monash SSO with MFA method selection (push/number/code) | Explicit guided alias |
| `ontrack login --show-browser` | Force visible browser mode for guided SSO | Debug selector or MFA edge cases |
| `ontrack login --hide-browser` | Keep explicit headless guided SSO | Optional explicit flag (default behavior) |
| `ontrack login --auto` | Run browser-only capture mode | Use when you only need passive capture |
| `ontrack logout` | Clear local session and browser refresh state | Switch accounts, reset state, troubleshoot |
| `ontrack whoami` | Show the cached account | Confirm who is currently logged in |
| `ontrack doctor` | Probe key endpoints | Quickly identify session or permission issues |

### Units, projects, and tasks

| Command | Purpose | Notes |
| --- | --- | --- |
| `ontrack projects` | List accessible projects | Agent mode uses the safe typed `projects.list` directory; bare `--json` keeps the legacy raw response |
| `ontrack project show --project-id <id>` | Show detailed project information | Useful for unit, grading, and task overview |
| `ontrack units` | List units | Some accounts fall back to units derived from `/projects` |
| `ontrack unit show --unit-id <id>` | Show detailed unit information | Bare `--json` retains the raw legacy payload; Agent mode requires `--project-id` and returns the safe typed `unit.show` projection |
| `ontrack tasks` | List tasks | Supports `--project-id` and `--status` |
| `ontrack unit tasks --unit-id <id>` | List tasks for one unit | Unit-scoped view |
| `ontrack inbox` | Load inbox tasks or fallback task list | Prefers `/units/:id/tasks/inbox` and falls back when needed |
| `ontrack task show --project-id <id> --abbr <abbr>` | Show one or many tasks | Supports repeated/comma selectors and `--all-tasks` |
| `ontrack task resources --project-id <id> --abbr <abbr>` | Download task resource archive(s) | Uses the real `/units/:unitId/task_definitions/:taskDefId/task_resources.json?as_attachment=true` route; definition-first and batch-capable; saves `FIT0001-P1-TaskResources.zip`-style files; external output requires `--allow-external-dir` |

### Feedback and live tracking

| Command | Purpose | Notes |
| --- | --- | --- |
| `ontrack feedback list --project-id <id> --abbr <abbr>` | Fetch comments/events for one or many tasks | Bare JSON supports repeated/comma selectors, `--all-tasks`, and legacy `--task-id`; `--output agent-json` requires one `--task-definition-id` or `--abbr` and returns the safe native `feedback.list` projection |
| `ontrack feedback watch --project-id <id> --abbr <abbr>` | Poll task feedback in real time | Default interval is `15s` |
| `ontrack watch` | Monitor task status, due date, and new comment changes | Default interval is `60s` |

### PDF and uploads

| Command | Purpose | Notes |
| --- | --- | --- |
| `ontrack pdf task --project-id <id> --abbr <abbr>` | Download task PDF(s) | Supports repeated/comma selectors and `--all-tasks`; saves to `./downloads` by default; use `--allow-external-dir` for an external output directory |
| `ontrack pdf submission --project-id <id> --abbr <abbr>` | Download submission PDF(s) | Supports repeated/comma selectors and `--all-tasks`; saves to `./downloads` by default; use `--allow-external-dir` for an external output directory |
| `ontrack submission upload ...` | Preview or upload a submission | Dry-run by default; `--confirm` dispatches once; local files must be inside the workspace unless `--allow-external-file` is explicit |
| `ontrack submission upload-new-files ...` | Preview or upload extra evidence files | Requires an observed existing submission; dry-run by default; `--confirm` dispatches once; local files must be inside the workspace unless `--allow-external-file` is explicit |

### Diagnostics and discovery

| Command | Purpose | Notes |
| --- | --- | --- |
| `ontrack discover` | Scan frontend bundles for route and API templates | Engineering-focused inspection tool |
| `ontrack discover --probe` | Probe allowlisted read-only API templates with the current session | Use explicit `--project-id`, `--unit-id`, and `--task-definition-id` selectors as needed; the default budget is 10 requests (maximum 25) |

For a bounded, task-scoped probe suitable for an agent workflow:

```bash
ontrack discover --probe --project-id 101 --unit-id 55 --task-definition-id 501 --limit 10 --json
```

Missing selector values cause only the affected API templates to be reported as `skip`; the command never selects a project or task on your behalf.

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

PDF output directories are workspace-scoped by default. The CLI rejects symlink
components and hard-linked destinations, and refuses binary responses larger than 100 MiB. Use
`--allow-external-dir` only when an automation explicitly needs a directory outside
the current workspace. In the interactive launcher, an external directory is accepted
only after the user types the exact approval word `ALLOW`.

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
- upload files must be regular, non-symlink, non-hard-link files no larger than 50 MiB each
- upload paths are workspace-scoped by default; use `--allow-external-file` only for an explicitly approved external path
- the interactive launcher adds that external-file authorization only after the user types the exact approval word `ALLOW`

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

### Agent watch streams

Use `--output agent-json` for a versioned NDJSON stream. Every stdout line is one
compact `ontrack.agent/v1` envelope; the initial line contains a `baseline` frame
and later lines contain only `events` or incremental `feedback` frames. The CLI
does not append human stop text to an Agent stream.

```bash
ontrack watch --project-id 87 --interval 60 --output agent-json
ontrack feedback watch --project-id 87 --abbr D4 --history 0 --output agent-json
```

`watch` projects the strict definition-first plan: `start`, `target`, and
`feedback_deadline` are independent Plan Dates with `kind`, `source`,
`editable`, and `unit_local_calendar_date` interpretation. A full poll is split
into frames of at most 800 events and every frame is bounded to 512 KiB.
`feedback watch` returns only allowlisted task identity and feedback fields; it
excludes people, attachments, and unknown remote fields. Agent timestamps are
validated RFC 3339 instants. Bare `--json` remains the legacy stream shape.

## Environment variables

| Variable | Purpose | Notes |
| --- | --- | --- |
| `ONTRACK_BASE_URL` | Override the default API base URL | Defaults to Monash OnTrack API |
| `ONTRACK_BROWSER_PATH` | Set the Chromium-family browser executable path for SSO automation | Used unless the explicit Lightpanda experiment is enabled |
| `ONTRACK_BROWSER` | Set to `lightpanda` only with the two Lightpanda gates below | Credential-free compatibility spike; real login fails closed |
| `ONTRACK_EXPERIMENTAL_LIGHTPANDA` | Set to `1` to acknowledge the Lightpanda experiment | Required together with `ONTRACK_BROWSER=lightpanda` |
| `ONTRACK_LIGHTPANDA_PATH` | Absolute path to the reviewed local Lightpanda binary | Required for the experiment; the CLI never discovers Lightpanda from `PATH` |
| `ONTRACK_ENABLE_SYSTEM_BROWSER_PROFILE` | Explicitly allow live browser-profile credential discovery | Disabled by default; do not enable for shared/untrusted profiles |
| `ONTRACK_BROWSER_USER_DATA_DIR` | Override Chromium/Chrome user data root | Used only with `ONTRACK_ENABLE_SYSTEM_BROWSER_PROFILE=1` |
| `ONTRACK_BROWSER_PROFILE_DIR` | Override profile directory name under user data root | Used only with explicit profile reuse; defaults to `Default` |
| `FORCE_COLOR` | Force colored terminal output | Example: `FORCE_COLOR=1` |
| `NO_COLOR` | Disable colored output | Useful for plain logs or CI |
| `XDG_CONFIG_HOME` | Override the config root on Linux and macOS | Affects session storage |
| `APPDATA` | Config root on Windows | Affects session storage |

Lightpanda is an explicit, local-only, credential-free experiment. It is enabled only when all
of the following are true: `ONTRACK_BROWSER=lightpanda`,
`ONTRACK_EXPERIMENTAL_LIGHTPANDA=1`, an absolute
`ONTRACK_LIGHTPANDA_PATH`, and Bun `1.4.0+`. The provider starts a local
Lightpanda process with a minimal environment and an OS-assigned loopback CDP
endpoint. It validates both the reviewed executable and the returned endpoint
before connecting. Compatibility work has a hard end-to-end deadline; an
unsupported provider, failed validation, or deadline returns a stable error
rather than silently falling back or retrying forever.

The normal HTTP CLI and Auth MCP do not load Playwright or any browser provider.
Lightpanda `serve` currently exposes unauthenticated loopback CDP, so the CLI
refuses to use it for saved cookies, username/password, MFA, token capture, or
any real authentication. Real login must use the reviewed Chromium/system
provider. Do not use this experiment as a server default or assume it can bypass
Monash/Okta policy. Lightpanda can become an auth provider only after it offers
an authenticated transport, inherited listener FD, protected Unix socket, or an
equivalent peer-ownership guarantee.

From a development checkout, the only supported Lightpanda entrypoint is the
credential-free public-page probe:

```bash
ONTRACK_BROWSER=lightpanda \
ONTRACK_EXPERIMENTAL_LIGHTPANDA=1 \
ONTRACK_LIGHTPANDA_PATH=/absolute/path/to/lightpanda \
bun run spike:lightpanda
```

It fetches the public OnTrack auth-method redirect, inspects only the allowlisted
Okta login origin, returns counts/booleans instead of DOM or cookie values, and
never fills, clicks, submits, loads saved state, or captures tokens.

## Files and directories

### Session cache

Default session file location:

- macOS / Linux: `~/.config/ontrack-cli/session.json`
- Windows: `%APPDATA%\ontrack-cli\session.json`

The CLI creates the directory automatically and writes the session file with stricter permissions where the platform allows it.

### Browser refresh state

The exact-origin browser state used for silent renewal is stored separately:

- macOS / Linux: `~/.config/ontrack-cli/browser-state.json`
- Windows: `%USERPROFILE%\AppData\Roaming\ontrack-cli\browser-state.json`

The directory is restricted to `0700` and the file to `0600` where supported.
The path is fixed under the operator home and cannot be redirected by
environment variables.
The Auth MCP consumes this state internally but never returns it to its caller.

### Agent execution journal

Confirmed Agent writes keep credential-free records under:

- macOS / Linux: `~/.config/ontrack-cli/executions/`
- Windows: `%APPDATA%\ontrack-cli\executions\`

The journal stores hashes, lifecycle state, and sanitized results. It never stores
upload paths, file contents, comments, identity data, or credentials.

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

The server rejected the cached access token. First ask the auth runtime to renew
it:

```bash
ontrack auth ensure --interaction never --output agent-json
```

If the result is `HUMAN_VERIFICATION_REQUIRED`, run the same command with
`--interaction if_required` while the user is available. Ordinary read commands
already attempt one silent refresh and safe replay automatically.

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
