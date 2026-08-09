# Graphify

Graphify is a local, generated navigation aid for product-code and
product-architecture questions. Its portable core is committed under
`graphify-out/`; machine-local state is ignored.

## Pinned toolchain

- Package: `graphifyy`
- Version: `0.9.31`
- Wheel SHA-256: `b0d47f823f924e7f89acfee390b9f18dc3410917617c5f6f2731bd2642abf16f`
- Universal dependency lock: `tools/graphify-requirements.lock`
- Source: <https://github.com/Graphify-Labs/graphify>
- Project adapters:
  - Codex: `.codex/skills/graphify/`
  - Pi: `.pi/agent/skills/graphify/`

Both platform copies intentionally contain platform-specific subagent
instructions. Their `.graphify_version` files must remain equal even though
their `SKILL.md` hashes differ.

## First run

`uv` is an explicit prerequisite for the pinned Python tool install.

```bash
bun run graphify:setup
bun run graphify:build
```

The bootstrap graph is code-only and requires no model credentials. An agent
may later invoke the installed Graphify skill for semantic documentation
extraction and a richer report.

## Normal use

```bash
GRAPHIFY_QUERY_LOG_DISABLE=1 graphify query "<question>"
GRAPHIFY_QUERY_LOG_DISABLE=1 graphify path "<A>" "<B>"
GRAPHIFY_QUERY_LOG_DISABLE=1 graphify explain "<concept>"
bun run graphify:update
bun run graphify:check
```

Only run the incremental update when a graph already exists. The committed
portable files are `graph.json`, `GRAPH_REPORT.md`,
`.graphify_labels.json`, and its signature. The generated `graph.html`
report stays local and is gitignored — no HTML is committed to this
repository. The stat/mtime-based `manifest.json` stays local because
checkout timestamps are machine-specific.

## Updating Graphify

1. Review the upstream release and choose an exact version.
2. Update the pin in `package.json` and both installed platform skill trees.
3. Reinstall both adapters with that exact CLI version.
4. Confirm the two `.graphify_version` files match.
5. Build a fresh graph, run a query, and run the repository verification suite.

Do not add an automatic unpinned install, global upgrade, or
`--break-system-packages` fallback to either project skill.

## Privacy

- Query logging is disabled in repository instructions.
- Query/answer memory is opt-in and must be redacted before persistence.
- Remote semantic extraction is opt-in. The user must select the backend and
  approve the document/media scope first.
- Code-only extraction stays local.
- Delete any opt-in memory under `graphify-out/memory/` and
  `graphify-out/reflections/` when it is no longer needed.

## Scan scope

`.graphifyignore` excludes generated output, dependencies, personal/course
artifacts, and agent-tool implementation files. This keeps the graph focused on
the OnTrack product. Use the repository files directly for questions about
agent process or skill configuration.
