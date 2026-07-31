---
name: gitnexus
description: "Use GitNexus for live symbol context, execution-flow search, and blast-radius analysis in ontrack-cli. Use Graphify first for broad architecture questions."
---

# GitNexus for OnTrack CLI

GitNexus 1.6.9 is a local supplement to the committed Graphify graph. Use it
for a precise code question, a symbol-level change, or a pre-commit impact
check. Project commands isolate discovery to `.gitnexus-home/`.

## Safe commands

```bash
bun run gitnexus:status
bun run gitnexus:analyze
bun run gitnexus:query -- "<concept>"
bun run gitnexus:context -- "<symbol>" --file <path>
bun run gitnexus:impact -- "<symbol>" --file <path>
bun run gitnexus:detect-changes
bun run gitnexus:check
```

If the index is missing or stale, run `bun run gitnexus:analyze` before a
query. It is deliberately configured with `--index-only`; never replace it
with bare `gitnexus analyze`, and never run `gitnexus setup`, because those
commands can write agent instructions or user-global editor configuration.

Before editing a product-code symbol, run an `impact` query and inspect HIGH or
CRITICAL findings. After product-code changes, refresh the index; before a
commit, run `detect-changes` and `check` (circular imports).

Use Graphify, not GitNexus, for the portable architecture report, visual graph,
or broad documentation relationships. Keep GitNexus MCP on stdio; do not start
an HTTP server or configure remote embeddings without explicit approval.
