# Agent usage

← [README](../README.md)

Deep reference for the Agent protocol surface. The
[README](../README.md#agent-first-usage) holds the copy-paste example block and
the native command inventory table; this file explains the envelope,
per-command behavior, structured input, the authentication MCP, watch streams,
and safe writes.

## Native caller-first interface

New Agent integrations should use the explicit caller-first surface. It accepts
one bounded JSON object and never translates that object into human CLI flags.
`agent call` emits exactly one `ontrack.agent/v1` envelope; `agent stream` emits
one NDJSON envelope per bounded frame.

Start with `projects.list`, then use its `project_id` to inspect the matching
`unit.show`, `tutorials.status`, and `tasks.list` projections before selecting a
Task Definition for a task-specific read. The native surface currently covers
`auth.status`, `projects.list`, `unit.show`, `tutorials.status`, `tasks.list`,
`task.show`, `task.prerequisites`, `feedback.list`, `feedback.watch`,
`task.resources`, `pdf.task`, `pdf.submission`, `plan.show`, and
`submission.status`. More commands are added only as individually reviewed
vertical slices. Use `--input -` for bounded, non-interactive stdin.

### Per-command behavior

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

## Discover the protocol

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

## Pass structured input

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

## Use the authentication MCP

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

## Apply writes safely

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

### Agent execution journal

Confirmed Agent writes keep credential-free records under:

- macOS / Linux: `~/.config/ontrack-cli/executions/`
- Windows: `%APPDATA%\ontrack-cli\executions\`

The journal stores hashes, lifecycle state, and sanitized results. It never stores
upload paths, file contents, comments, identity data, or credentials.

## Agent watch streams

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
