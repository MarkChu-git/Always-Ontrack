## Pull request workflow

- Never merge a pull request on green CI alone. Before merging, self-review
  the full diff with the repository `code-review` skill (Standards and Spec
  axes), report the conclusion to the user, and only then merge.
- Squash-merge only after every required check passes.

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
GitNexus provides live symbol context and blast-radius analysis.

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
