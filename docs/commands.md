# Command reference

← [README](../README.md)

The full command surface. For the native Agent protocol see
[agent-usage.md](agent-usage.md); for end-to-end recipes see
[workflows.md](workflows.md); for login flows in depth see
[authentication.md](authentication.md).

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

## Account and connectivity

| Command | Purpose | Typical use |
| --- | --- | --- |
| `ontrack` | Open the full-screen task TUI in an interactive terminal | Default human-facing experience |
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
| `ontrack login` | Recommend this-machine browser sign-in; pairing and terminal remain available | Primary login command; interactive method prompt |
| `ontrack login --show-browser` | Force visible browser mode | Explicit override (this-machine or --sso) |
| `ontrack login --hide-browser` | Force hidden browser capture | Headless environments, typically with --no-pair |
| `ontrack login --auto` | This-machine browser capture (skips the method prompt) | Renewable session on this computer |
| `ontrack login --sso` | Terminal username/password; hidden browser fills Okta | Previous default; MFA stays in the terminal |
| `ontrack login --pair` | Pairing-relay sign-in (skips the method prompt) | Sign in on any device; credential arrives E2E-encrypted |
| `ontrack login --no-pair` | Opt out of pairing | Falls back to --auto browser-capture/manual flows |
| `ontrack logout` | Clear local session and browser refresh state | Switch accounts, reset state, troubleshoot |
| `ontrack whoami` | Show the cached account | Confirm who is currently logged in |
| `ontrack doctor` | Probe key endpoints | Quickly identify session or permission issues |

### Interactive terminal interfaces

Running `ontrack` with no arguments opens the full-screen task TUI when stdin
and stdout are interactive terminals. In non-interactive contexts it prints
help and exits. Run `ontrack welcome` to open the legacy ALWAYS ONTRACK
numbered launcher explicitly.

Launcher actions include guided task selection:

- actions `7/8/11/12` support guided single-task and batch selection
- you can choose `single`, `multiple` (comma-separated selectors), or `all tasks`
- task selection is based on `task` code (for example `P1`, `D4`) or numeric task-definition id
- you can still switch to manual `--project-id` + selector input
- upload actions `13/14` remain single-task guided by design

## Units, projects, and tasks

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
| `ontrack task set-status --project-id <id> --abbr <abbr> --status <status>` | Preview or apply a student status transition | Student-settable: `working_on_it`, `need_help`, `not_started`, `ready_for_feedback`, `assess_in_portfolio` (aliases `rtm`/`rff`, `ns`, `aip`); dry-run by default; `--confirm` applies once; the resulting status is verified from the response |

## Feedback and live tracking

| Command | Purpose | Notes |
| --- | --- | --- |
| `ontrack feedback list --project-id <id> --abbr <abbr>` | Fetch comments/events for one or many tasks | Bare JSON supports repeated/comma selectors, `--all-tasks`, and legacy `--task-id`; `--output agent-json` requires one `--task-definition-id` or `--abbr` and returns the safe native `feedback.list` projection |
| `ontrack feedback watch --project-id <id> --abbr <abbr>` | Poll task feedback in real time | Default interval is `15s` |
| `ontrack watch` | Monitor task status, due date, and new comment changes | Default interval is `60s` |

## PDF and uploads

| Command | Purpose | Notes |
| --- | --- | --- |
| `ontrack pdf task --project-id <id> --abbr <abbr>` | Download task PDF(s) | Supports repeated/comma selectors and `--all-tasks`; saves to `./downloads` by default; use `--allow-external-dir` for an external output directory |
| `ontrack pdf submission --project-id <id> --abbr <abbr>` | Download submission PDF(s) | Supports repeated/comma selectors and `--all-tasks`; saves to `./downloads` by default; use `--allow-external-dir` for an external output directory |
| `ontrack submission upload ...` | Preview or upload a submission | Dry-run by default; `--confirm` dispatches once; local files must be inside the workspace unless `--allow-external-file` is explicit |
| `ontrack submission upload-new-files ...` | Preview or upload extra evidence files | Requires an observed existing submission; dry-run by default; `--confirm` dispatches once; local files must be inside the workspace unless `--allow-external-file` is explicit |

## Diagnostics and discovery

| Command | Purpose | Notes |
| --- | --- | --- |
| `ontrack discover` | Scan frontend bundles for route and API templates | Engineering-focused inspection tool |
| `ontrack discover --probe` | Probe allowlisted read-only API templates with the current session | Use explicit `--project-id`, `--unit-id`, and `--task-definition-id` selectors as needed; the default budget is 10 requests (maximum 25) |

For a bounded, task-scoped probe suitable for an agent workflow:

```bash
ontrack discover --probe --project-id 101 --unit-id 55 --task-definition-id 501 --limit 10 --json
```

Missing selector values cause only the affected API templates to be reported as
`skip`; the command never selects a project or task on your behalf.

## Output, highlighting, and JSON

### Default output

The default output mode is a colored terminal table. Important fields are highlighted:

- header: bold cyan
- `task`: bold
- `unit`: cyan
- `status`: color-coded by status
- `due`: highlighted when a deadline is close or overdue

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

`watch` and `feedback watch` do not emit a single final JSON array. They emit
multiple JSON documents over time as a stream.

That makes them a better fit for:

- `jq`
- custom Node scripts
- log collectors
- stream-oriented automation

For the versioned `--output agent-json` NDJSON stream contract, see
[Agent watch streams](agent-usage.md#agent-watch-streams).

## Download directory

Default PDF download directory:

```text
./downloads
```

The real smoke test script uses:

```text
./downloads-smoke
```
