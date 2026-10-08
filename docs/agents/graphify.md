# Graphify

Graphify is a local, generated navigation aid for product-code and
product-architecture questions. Every checkout builds its own graph in
`graphify-out/`, which is gitignored; nothing in it is committed.

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

`graphify:setup` installs the pinned tool once per machine. `graphify:build`
is needed once per checkout, including each new worktree, and takes a few
seconds. The bootstrap graph is code-only and requires no model credentials.
An agent may later invoke the installed Graphify skill for semantic
documentation extraction and a richer report.

## Normal use

```bash
GRAPHIFY_QUERY_LOG_DISABLE=1 graphify query "<question>"
GRAPHIFY_QUERY_LOG_DISABLE=1 graphify path "<A>" "<B>"
GRAPHIFY_QUERY_LOG_DISABLE=1 graphify explain "<concept>"
bun run graphify:update
bun run graphify:check
```

Only run the incremental update when a graph already exists. Everything under
`graphify-out/` stays local: `graph.json`, `GRAPH_REPORT.md`, the community
labels, the `graph.html` report and the caches. The graph used to be committed,
but then every product-code pull request carried thousands of generated lines
and conflicted with any other pull request that refreshed it first.

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
