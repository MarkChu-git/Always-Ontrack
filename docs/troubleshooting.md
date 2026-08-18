# Troubleshooting

← [README](../README.md)

## `Error: 403 Forbidden: Unable to list units`

Some accounts do not have direct access to `/units`. This is an account capability difference, not a CLI crash.

The current implementation tries to derive unit data from `/projects` when necessary. In practice, these commands are usually more reliable:

```bash
ontrack projects
ontrack tasks
```

## `Inbox endpoint unavailable ... Showing fallback task list`

This means `/units/:id/tasks/inbox` is not accessible for the current account, and the CLI has already fallen back to a task list derived from `/projects`.

Typical reasons:

- the account has limited permissions
- the endpoint is role-restricted
- the inbox API is unavailable for that unit

## `No browser executable found ...`

Set the browser path explicitly:

```bash
ONTRACK_BROWSER_PATH="/path/to/browser" ontrack login
```

Or install a reviewed, pinned Playwright Chromium runtime manually:

```bash
bunx playwright@1.58.2 install chromium
```

## `419 Authentication Timeout`

The server rejected the cached access token. First ask the auth runtime to renew
it:

```bash
ontrack auth ensure --interaction never --output agent-json
```

If the result is `HUMAN_VERIFICATION_REQUIRED`, run the same command with
`--interaction if_required` while the user is available. Ordinary read commands
already attempt one silent refresh and safe replay automatically.

## `Task abbreviation "... " is ambiguous`

The abbreviation is not unique inside that project. Use the task-definition id:

```bash
ontrack task show --project-id <id> --task-definition-id <id>
```

## Upload key mismatch or incorrect file count

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

## No color highlighting

Force color manually:

```bash
FORCE_COLOR=1 ontrack tasks --project-id 87
```
