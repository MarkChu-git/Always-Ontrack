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
ontrack discover --limit 20
ontrack inbox --unit-id 123
ontrack task show --project-id 456 --abbr T1
ontrack feedback list --project-id 456 --abbr T1
ontrack feedback watch --project-id 456 --abbr T1 --interval 10
ontrack pdf task --project-id 456 --abbr T1
ontrack submission upload --project-id 456 --abbr T1 --file ./report.pdf
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
- `ontrack project show --project-id ID [--json]`
- `ontrack units [--json]`
- `ontrack unit show --unit-id ID [--json]`
- `ontrack unit tasks --unit-id ID [--status STATUS] [--json]`
- `ontrack tasks [--project-id ID] [--status STATUS] [--json]`
- `ontrack doctor [--json]`
- `ontrack discover [--site-url URL] [--base-url URL] [--probe] [--limit N] [--json]`
- `ontrack inbox [--unit-id ID] [--status STATUS] [--json]`
- `ontrack task show --project-id ID (--task-id ID | --abbr ABBR) [--json]`
- `ontrack feedback list --project-id ID (--task-id ID | --abbr ABBR) [--json]`
- `ontrack feedback watch --project-id ID (--task-id ID | --abbr ABBR) [--interval SEC] [--history N] [--json]`
- `ontrack pdf task --project-id ID (--task-id ID | --abbr ABBR) [--out-dir PATH]`
- `ontrack pdf submission --project-id ID (--task-id ID | --abbr ABBR) [--out-dir PATH]`
- `ontrack submission upload --project-id ID (--task-id ID | --abbr ABBR) --file PATH [--file PATH|fileN=PATH ...] [--trigger need_help|ready_for_feedback] [--comment TEXT] [--json]`
- `ontrack submission upload-new-files --project-id ID (--task-id ID | --abbr ABBR) --file PATH [--file PATH|fileN=PATH ...] [--trigger need_help|ready_for_feedback] [--comment TEXT] [--json]`
- `ontrack watch [--unit-id ID] [--project-id ID] [--interval SEC] [--json]`

### Live Chat Feed

- `ontrack feedback watch` continuously reads task conversation/comments.
- Baseline output shows recent history (default `30` items), then only new messages.
- Use `--history 0` to skip baseline and watch new incoming messages only.

### Selector Rules

- Task-level commands require `--project-id` and one of `--task-id` or `--abbr`.
- If both `--task-id` and `--abbr` are provided, they must resolve to the same task.
- No interactive task picker is used in task-level commands.

### PDF Download Defaults

- Default output directory: `./downloads`
- Override with: `--out-dir <path>`
- Filename format: `<unitCode>_<abbr>_<type>.pdf` (`type`: `task` or `submission`)

### Submission Upload

- Use repeated `--file` flags to upload required task files.
- If the task expects exact upload keys (`file0`, `file1`, ...), the CLI auto-maps by task definition order.
- You can map manually with key syntax: `--file file0=./report.pdf --file file1=./demo.mp4`.
- `submission upload` defaults trigger from current task status (`working_on_it/need_help` -> `need_help`; otherwise server default).
- `submission upload-new-files` uploads evidence without forcing a default trigger.

### Surface Discovery

- `ontrack discover` scans the live OnTrack frontend bundles and extracts route/API templates used by the web app.
- Add `--probe` to check discovered API templates against your current login session.
- Use `--limit N` to cap output volume for faster inspection.

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
