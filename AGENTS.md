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

### Issue tracker

Issues and PRDs are tracked in this repository's GitHub Issues. See `docs/agents/issue-tracker.md`.

### Domain docs

This is a single-context repository with its glossary in `CONTEXT.md`. See `docs/agents/domain.md`.

### Installed skill security

Generate architecture reports offline with local or embedded assets, escape all repository-derived text, and do not auto-open content that loads remote scripts.
