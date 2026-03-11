# ontrack-cli

`ontrack-cli` is a command line client for Monash OnTrack (Doubtfire).

## Install

Use Node.js 22+.

Global install (recommended):

```bash
npm install -g ontrack-cli
```

After install, commands are available as:

```bash
ontrack <command>
```

No base URL config is required for Monash OnTrack.
Default API endpoint is:

`https://ontrack.infotech.monash.edu/api`

## Quick Start

```bash
ontrack auth-method
ontrack login --auto
ontrack whoami
ontrack units
ontrack projects
ontrack tasks
ontrack inbox --unit-id 123
ontrack task show --project-id 456 --abbr T1
ontrack feedback list --project-id 456 --abbr T1
ontrack pdf task --project-id 456 --abbr T1
ontrack watch --interval 60
```

For SSO login you can use:

- Auto mode (recommended): `ontrack login --auto`
- Manual mode: `ontrack login` and paste final redirect URL (`/sign_in?authToken=...&username=...`)

Auto mode opens a controlled browser, then captures credentials from URL/auth request/local storage (and cookie fallback).
If your browser is not auto-detected, set `ONTRACK_BROWSER_PATH` to the browser executable path.

## Commands

- `ontrack auth-method [--base-url URL] [--json]`
- `ontrack login [--base-url URL] [--redirect-url URL]`
- `ontrack login [--base-url URL] --auth-token TOKEN --username USERNAME`
- `ontrack login [--base-url URL] --auto [--auto-timeout-sec N]`
- `ontrack logout`
- `ontrack whoami [--json]`
- `ontrack projects [--json]`
- `ontrack units [--json]`
- `ontrack tasks [--project-id ID] [--status STATUS] [--json]`
- `ontrack doctor [--json]`
- `ontrack inbox [--unit-id ID] [--status STATUS] [--json]`
- `ontrack task show --project-id ID (--task-id ID | --abbr ABBR) [--json]`
- `ontrack feedback list --project-id ID (--task-id ID | --abbr ABBR) [--json]`
- `ontrack pdf task --project-id ID (--task-id ID | --abbr ABBR) [--out-dir PATH]`
- `ontrack pdf submission --project-id ID (--task-id ID | --abbr ABBR) [--out-dir PATH]`
- `ontrack watch [--unit-id ID] [--project-id ID] [--interval SEC] [--json]`

### Selector Rules

- Task-level commands require `--project-id` and one of `--task-id` or `--abbr`.
- If both `--task-id` and `--abbr` are provided, they must resolve to the same task.
- No interactive task picker is used in task-level commands.

### PDF Download Defaults

- Default output directory: `./downloads`
- Override with: `--out-dir <path>`
- Filename format: `<unitCode>_<abbr>_<type>.pdf` (`type`: `task` or `submission`)

## Local Development

```bash
npm install
npm run build
node dist/cli.js auth-method
```

Or run without build:

```bash
npm run dev -- auth-method
```

Run real-account smoke verification:

```bash
npm run smoke:real -- --project-id 87 --abbr D4
```
