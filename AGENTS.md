## TUI (experimental)

An OpenTUI/React TUI lives in `src/tui/` (separate from the agent-first CLI
core in `src/lib/`). It loads the real Student Task View through
`src/tui/data.ts` (auth broker + API client + `buildStudentTaskViews`),
and its default view hides completed units (`isCurrentUnit`: web-parity
with the home page's "all courses" split — `active: false` or a past
teaching-period `end_date` excludes the unit).
has an in-TUI login wizard with no credential fields (`src/tui/login.tsx`,
driver in `src/tui/auth.ts` — both thin compositions over
`src/lib/auto-login.ts`, `src/lib/pair-login.ts`, and
`src/lib/login-finalize.ts`): it pops a visible browser for SSO sign-in on
machines with a display, and runs the pairing-relay flow (pairing link +
code rendered in the wizard) on headless environments. It is not yet wired
into the `ontrack` entry point.

Interactive write/read actions are injectable props with production
defaults, so the smoke test never touches network or disk state:
`setStatus` (`src/tui/status.ts` over `src/lib/set-task-status.ts`),
`extras` (`src/tui/task-extras.ts` over `src/lib/agent-task-reads.ts` —
prerequisites, submission status, task/resource/submission downloads),
and `submit` (`src/tui/submit.ts` over `src/lib/submission-upload.ts`).
The submit wizard (`src/tui/submit-wizard.tsx`) keeps the input-handling
discipline documented below: self-drawn fields, ref mirrors, one idempotency
key (`tui:<uuid>`) per attempt, and unknown transport outcomes are surfaced
without auto-retry.

- `bun run tui` starts it; `bun run typecheck:tui` type-checks it against
  `tsconfig.tui.json` (the main `tsconfig.json` excludes `src/tui`, so the
  published `dist/` build is unaffected).
- `bun scripts/smoke-tui.tsx` is the headless smoke test; it injects fixture
  loaders/auth drivers, so no network or session is needed. Quirks it
  encapsulates: capture before first paint returns an uninitialized buffer;
  under `testRender` a state update needs a short settle before input typing
  works again; a lone ESC byte needs a beat for the key parser; an async
  loader resolution needs one extra act tick to paint; a `useKeyboard`
  handler can observe a stale render closure under `testRender` (read state
  through ref mirrors instead, like `src/tui/login.tsx` does); a mode-change
  focus effect only flushes at an act boundary (split palette interactions
  into separate `act` blocks); the detail pane's lazy extras fetch resolves
  outside the act batch (add one more `act` settle after opening it, or
  React prints a "not wrapped in act" warning; a few residual warnings from
  spinner/poll intervals firing outside `act` are cosmetic and tolerated).
- In `src/tui`, focus inputs imperatively via refs on mode changes; the
  `focused` prop alone races when overlays mount/unmount. OpenTUI inputs
  have no secure-echo mode, so password-style fields are self-drawn.
  Self-drawn fields must also wire `usePaste`: bracketed paste is not a
  keypress, so `useKeyboard` never sees it (decode with
  `decodePasteBytes` + `stripAnsiSequences` from `@opentui/core`).

## Pull request workflow

- Never merge a pull request on green CI alone. Before merging, self-review
  the full diff with the repository `code-review` skill (Standards and Spec
  axes), report the conclusion to the user, and only then merge. Resolve
  review findings first, or get the user's explicit acceptance of them.
- Merge only when every check is green, not just the required ones.

## graphify

This project uses Graphify 0.9.31 for a knowledge graph in `graphify-out/`.
The portable core graph is committed; caches, cost data, query memory, and
machine-specific interpreter paths are not.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For product-code and product-architecture questions, first run `GRAPHIFY_QUERY_LOG_DISABLE=1 graphify query "<question>"` when `graphify-out/graph.json` exists. Use the same environment setting with `graphify path "<A>" "<B>"` and `graphify explain "<concept>"`. These return a scoped subgraph, usually much smaller than `GRAPH_REPORT.md` or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- On a clean clone, run `bun run graphify:setup` and `bun run graphify:build` before the first query.
- After modifying product code, run `bun run graphify:update` only when `graphify-out/graph.json` already exists.
- Do not persist Graphify query/answer memory unless the user explicitly opts in. Redact secrets and personal data before any opt-in persistence.
- Do not send repository documents or media to a remote semantic backend unless the user explicitly selects that backend and approves the files in scope.
- See `docs/agents/graphify.md` for versioning, platform copies, exclusions, and update procedure.

## Agent skills

### GitNexus

GitNexus 1.6.9 is an optional, local code-intelligence index. It complements
Graphify: Graphify is the portable committed architecture graph, while
GitNexus provides live symbol context and blast-radius analysis. It is not a
project dependency: it is installed once per machine as a global Bun tool
(`bun install -g gitnexus@1.6.9` + `bun pm -g trust @ladybugdb/core
tree-sitter gitnexus`, see `docs/agents/gitnexus.md`), keeping its ~1 GB
dependency tree out of `node_modules`.

- All project commands use the ignored `.gitnexus-home/` registry so the MCP
  cannot enumerate repositories from the user's global GitNexus registry.
- Do not run `gitnexus setup`; it writes user-global editor configuration.
- Do not run bare `gitnexus analyze`; use `bun run gitnexus:analyze`, which
  deliberately uses `--index-only` and cannot modify `AGENTS.md`, `CLAUDE.md`,
  or install generated skills.
- Before editing a product-code symbol, use `bun run gitnexus:impact --
  "<symbol>" --file <path>` when `.gitnexus/` is available. Use Graphify first
  for broad architecture questions; use GitNexus for precise, live code impact.
- After product-code changes, refresh with `bun run gitnexus:analyze`; before a
  commit, run `bun run gitnexus:detect-changes`, which checks both staged and
  unstaged changes. Treat HIGH or CRITICAL impact findings as a reason to
  inspect the affected code before proceeding.
- Keep the MCP transport on stdio. Do not expose `gitnexus mcp --http` or send
  repository data to a remote embeddings provider without explicit approval.

See `docs/agents/gitnexus.md` for setup, update, and recovery instructions.

### Issue tracker

Issues and PRDs are tracked in this repository's GitHub Issues. See `docs/agents/issue-tracker.md`.

### Domain docs

This is a single-context repository with its glossary in `CONTEXT.md`. See `docs/agents/domain.md`.

### Installed skill security

Generate architecture reports offline with local or embedded assets, escape all repository-derived text, and do not auto-open content that loads remote scripts.
