# Always Ontrack (ontrack-cli)

[简体中文](./README.zh-CN.md)

<p align="center">
  <img src="./always-ontrack-poster.png" alt="Always OnTrack — agent-first CLI for Monash OnTrack / Doubtfire" width="720" />
</p>

<p align="center">
  An agent-first CLI and authentication MCP for Monash OnTrack / Doubtfire
</p>

`ontrack-cli` turns common Monash OnTrack workflows into a single command
surface (`ontrack <command>`), targeting the Monash OnTrack API by default
(`https://ontrack.infotech.monash.edu/api`). The primary interface is a
versioned, schema-discoverable Agent protocol; human tables and the interactive
launcher remain available over the same execution engine.

Detailed guides: [authentication](docs/authentication.md) ·
[agent usage](docs/agent-usage.md) · [commands](docs/commands.md) ·
[workflows](docs/workflows.md) · [troubleshooting](docs/troubleshooting.md) · [development](docs/development.md)

## Contents

- [What it does](#what-it-does)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Authentication](#authentication)
- [Agent-first usage](#agent-first-usage)
- [Command reference](#command-reference)
- [Environment variables](#environment-variables)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Project structure](#project-structure)
- [Current scope](#current-scope)
- [License](#license)

## What it does

- Authentication and session handling — pairing-relay sign-in (default on every
  environment), controlled-browser capture, manual redirect import, direct token
  login, silent token renewal from a restricted browser state, and a local
  `ontrack-auth-mcp` control plane
- Read access — `projects`, `units`, `tasks`, `inbox`, `task show`, `task resources`
- Feedback and live tracking — `feedback list`, `feedback watch`, `watch`
- File operations — `pdf task`, `pdf submission`, `task resources`,
  `submission upload`, `submission upload-new-files`
- Engineering and diagnostics — `doctor`, `discover`, `discover --probe`
- Terminal UX — colored tables by default, `--output agent-json` for versioned
  Agent automation, legacy `--json` for compatible raw scripting output, and
  fallback handling when some endpoints are not accessible for the current account

## Installation

Requirements: Bun `1.3.14+` (the experimental Lightpanda provider additionally
requires Bun `1.4.0+`); macOS, Linux, or Windows (the Lightpanda spike is
currently limited to macOS/Linux — Windows fails closed until executable ACL
validation is implemented); network access when you choose to install a reviewed
browser runtime manually.

Global install (recommended):

```bash
bun add --global ontrack-cli
```

This provides the `ontrack` and `ontrack-auth-mcp` executables. To run from a
source checkout instead:

```bash
bun install
bun run build
bun dist/cli.js auth-method   # or: bun run dev -- auth-method
```

## Quick start

The shortest stable path from install to useful output.

1. Sign in — `ontrack login` prints a one-time pairing link; sign in in your own
   browser, on any device:

   ```bash
   ontrack login
   ```

2. Confirm the cached account and list your data:

   ```bash
   ontrack whoami
   ontrack projects
   ontrack units
   ontrack tasks
   ```

3. Inspect a specific task (batch selectors work too: `--abbr P1,D4`, `--all-tasks`):

   ```bash
   ontrack task show --project-id 87 --abbr D4
   ```

4. Read feedback, watch live updates, and download PDFs:

   ```bash
   ontrack feedback list --project-id 87 --abbr D4
   ontrack feedback watch --project-id 87 --abbr D4
   ontrack pdf task --project-id 87 --abbr D4
   ontrack pdf submission --project-id 87 --abbr D4
   ```

5. Preview, then confirm an upload (without `--confirm` it is a safe preflight
   that sends no write request):

   ```bash
   ontrack submission upload --project-id 87 --abbr D4 --file ./report.pdf
   ontrack submission upload --project-id 87 --abbr D4 --file ./report.pdf --confirm
   ```

Running `ontrack` with no arguments opens the interactive launcher with guided
task selection. End-to-end recipes: [docs/workflows.md](docs/workflows.md).

## Authentication

`ontrack login` defaults to pairing-relay sign-in on every environment: you sign
in through the real Monash SSO pages in your own browser and the credential
arrives end-to-end encrypted. `--auto` opts into controlled-browser capture,
manual redirect URL import and direct `--auth-token` login remain as fallbacks.
A session captured in a browser renews silently from a restricted refresh cookie.
A paired one earns the same cookie when the pairing could still exchange a
one-time login token; otherwise it lasts only as long as its access token, and
`login` tells you which of the two you got. See
[docs/authentication.md](docs/authentication.md) for every login flow, the
session cache locations, login output, and logout.

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
Task Definition for a task-specific read. Use `--input -` for bounded,
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

Every command returns a bounded, PII-minimized projection. Task-scoped reads
use the definition-first Student Task View, so a project with an empty `tasks`
array can still expose tasks from its unit task-definition catalogue; downloads
validate artifacts before writing them; malformed or conflicting input aliases
fail closed. The existing `--output agent-json` commands remain a compatibility
Adapter for the broader command set, and bare `--json` keeps its legacy raw shape.

### Discover the protocol

Native callers should discover their executable surface instead of scraping help text:

```bash
ontrack agent list
ontrack agent describe pdf.submission
```

Per-command behavior, the `ontrack.agent/v1` envelope and next actions,
structured input, the authentication MCP, watch streams, and safe writes with
idempotency keys: [docs/agent-usage.md](docs/agent-usage.md).

## Command reference

| Command | Purpose |
| --- | --- |
| `ontrack` / `ontrack welcome` | Interactive launcher with guided task selection |
| `ontrack login` / `logout` / `whoami` | Pairing sign-in (default), session cleanup, cached account |
| `ontrack auth-method` / `auth status` / `auth ensure` | Authentication method and credential lifecycle |
| `ontrack projects` / `units` / `tasks` / `inbox` | List project, unit, and task data |
| `ontrack task show` / `task resources` / `task set-status` | Task detail, resource archives, student status transitions |
| `ontrack feedback list` / `feedback watch` / `watch` | Feedback reads and live tracking |
| `ontrack pdf task` / `pdf submission` | Download task and submission PDFs |
| `ontrack submission upload` / `upload-new-files` | Dry-run by default; `--confirm` dispatches once |
| `ontrack doctor` / `discover` / `discover --probe` | Diagnostics and API discovery |
| `ontrack capabilities` / `schema` | Agent protocol discovery (compatibility Adapter) |

The full reference with every flag and safety note: [docs/commands.md](docs/commands.md).

## Environment variables

| Variable | Purpose | Notes |
| --- | --- | --- |
| `ONTRACK_BASE_URL` | Override the default API base URL | Defaults to Monash OnTrack API |
| `ONTRACK_RELAY_URL` | Override the pairing-relay base URL | Set empty to disable pairing; https required except loopback |
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

Lightpanda is an explicit, local-only, credential-free experiment; see
[docs/development.md](docs/development.md#lightpanda-experiment) for the gates
and the public-page probe.

## Troubleshooting

All known issues and fixes — unit-listing 403s, inbox fallback, missing browser
executables, `419 Authentication Timeout`, ambiguous abbreviations, upload key
mismatches, and missing colors — live in
[docs/troubleshooting.md](docs/troubleshooting.md).

## Development

Local setup, tests, coverage gates, the real-account smoke check, and the
Lightpanda spike live in [docs/development.md](docs/development.md).

## Project structure

```text
.
├── always-ontrack-logo.png      # README logo
├── package.json                 # Bun package metadata and scripts
├── docs/                        # detailed guides (authentication, agent usage, commands, workflows, troubleshooting, development)
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

## Current scope

The current version supports real-account-driven read flows, live feedback
tracking, PDF download, and upload operations, but keeps write capabilities
intentionally narrow.

Supported now: login; units, projects, tasks, and inbox reads; feedback reads
and live conversation watch; task and submission PDF download; submission
upload; new evidence or new file upload; posting a comment after upload; student
task status transitions (`task set-status`).

Not expanded yet: more complex staff-side write workflows, interactive task
pickers, and persistent long-term watch deduplication across processes.

If you plan to extend the project, the main entry point is [cli.ts](src/cli.ts)
and the protocol layer is [api.ts](src/lib/api.ts).

## License

[Apache-2.0](./LICENSE)
