# Typical workflows

← [README](../README.md)

Command flags and safety rules live in [commands.md](commands.md).

## Workflow 1: sign in and find your tasks

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

## Workflow 2: inspect one task end to end

```bash
ontrack task show --project-id 87 --abbr D4
ontrack feedback list --project-id 87 --abbr D4
ontrack pdf task --project-id 87 --abbr D4
ontrack pdf submission --project-id 87 --abbr D4
```

## Workflow 3: watch live conversation and status changes

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

## Workflow 4: download PDFs

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

## Workflow 5: upload a submission

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

Extra evidence uses the companion command, with the same dry-run-then-confirm
shape:

```bash
ontrack submission upload-new-files --project-id 87 --abbr D4 --file ./evidence.pdf
ontrack submission upload-new-files --project-id 87 --abbr D4 --file ./evidence.pdf --confirm
```

Without `--confirm`, both commands perform a safe preflight and send no write request.

## Difference between `submission upload` and `submission upload-new-files`

- `submission upload`
  - designed for normal submission flows
  - infers `trigger=need_help` when the current task status is `working_on_it` or `need_help`
  - otherwise leaves trigger handling to server defaults
- `submission upload-new-files`
  - closer to a "new evidence" flow
  - requires `submission status` to prove an existing submission first
  - does not apply a default trigger automatically

## Upload matching rules

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
