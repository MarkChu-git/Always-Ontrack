# OnTrack CLI domain context

This glossary names the domain concepts that define the repository's deep Modules.
It records meaning, not TypeScript signatures or endpoint guesses.

## Identity

- **Security Identity** — the authenticated OnTrack user projection that is safe to
  show to callers. It never contains credentials.
- **Credential** — secret authentication material plus lifecycle metadata such as
  source and expiry. A Credential is not a Security Identity.
- **Auth Lifecycle** — obtaining, validating, expiring, refreshing, and revoking a
  Credential. HTTP 401/419 interpretation belongs here.

## Student work

- **Task Definition** — the unit-level catalogue entry describing a task. Its
  identity is distinct from a student's Task Instance.
- **Task Instance** — a project-level student record for a Task Definition. It may
  not exist yet even when the Task Definition is visible.
- **Student Task View** — the stable, read-only projection formed from Task
  Definitions, optional Task Instances, project target grade, tutorial context,
  prerequisites, and date policy.
- **Task Reference** — an unambiguous project plus Task Definition identity used by
  downstream read and write workflows. It never guesses from a Task Instance id.
- **Status Trigger** — a student-settable Task Instance transition
  (`working_on_it`, `need_help`, `not_started`, `ready_for_feedback`,
  `assess_in_portfolio`) applied through `task set-status`. The server may refuse
  a trigger with an unchanged 200 response or remap it (for example past-due
  submissions), so the resulting status is always verified from the response.

## Submission

- **Submission Attempt** — one explicit preflight, single dispatch, server-rejected/
  transport-unknown/response-accepted/status-observed result, or pre-dispatch
  cancel lifecycle for a Task Reference.
- **Evidence Slot** — a named upload requirement within a Submission Attempt.
- **Unknown Outcome** — a non-idempotent operation whose server result cannot be
  proven after transport failure. It must not be retried automatically.

## Planning

- **Plan Date** — a date with an explicit kind, source, timezone interpretation,
  editability, and missing-value meaning.
- **Unit Default Date** — the unit-provided start, target, or feedback deadline.
- **Personal Date** — the student's override for a Task Definition.
- **Effective Date** — the date selected for display after applying documented
  precedence; it does not erase its source.

## Production contracts

- **Observed Contract** — a sanitized, versioned record of an OnTrack request or
  response shape with capture date, role, risk, and trust metadata.
- **Contract Fixture** — a non-personal, non-secret example used to validate an
  Adapter without connecting CI to production.
- **Contract Drift** — a field, type, enum, method, or route change between an
  Observed Contract and the current Adapter expectation.
