# GitNexus

GitNexus is this repository's optional local code-intelligence companion to
Graphify. It uses a local `.gitnexus/` LadybugDB index for symbol context,
execution-flow search, and change-impact analysis. The index is deliberately
ignored by Git; Graphify remains the committed, portable architecture graph.
The MCP registry is isolated in the ignored `.gitnexus-home/` directory, so an
OnTrack agent cannot enumerate repositories from the user's global registry.

## Pinned toolchain

- Package: `gitnexus`
- Version: `1.6.9` (exact pin in `scripts/check-gitnexus-skill-sync.ts`)
- Execution: one global install per machine — GitNexus is deliberately **not**
  a project dependency. Its ~1 GB dependency tree (ONNX runtimes, HuggingFace
  transformers, tree-sitter grammars) would otherwise land in every
  checkout's `node_modules`. Do not re-add it to `devDependencies`, and do not
  switch the scripts to `bunx`: Bun's ephemeral/cache installs skip the
  lifecycle scripts that build LadybugDB and tree-sitter, and the CLI refuses
  to run without them.
- Package manager: Bun
- Runtime: Node.js `>=22` (`24.18.0` in CI)
- MCP transport: local stdio only, through `.codex/config.toml`

GitNexus is licensed under PolyForm Noncommercial 1.0.0. It is a local
development tool and is not part of the published `ontrack-cli` package or its
runtime dependencies. Review that license before using this tooling in a
commercial setting.

Do not run `gitnexus setup` in this repository: upstream setup writes global
editor configuration and installs global skills. The project provides the
necessary Codex configuration and Codex/Pi skills itself.

## Initial index and refresh

One-time toolchain setup (global install with trusted native builds):

```bash
bun install -g gitnexus@1.6.9
# Run the native build scripts Bun blocks by default (LadybugDB + tree-sitter).
# @scarf/scarf (telemetry) and onnxruntime-node (unused embeddings path) stay blocked.
bun pm -g trust @ladybugdb/core tree-sitter gitnexus
```

Then index and verify:

```bash
bun run gitnexus:analyze
bun run gitnexus:status
```

`gitnexus:analyze` always performs a clean rebuild with
`--force --index-only --name ontrack-cli` and the stable 64 MiB WAL checkpoint
threshold. This prevents GitNexus from writing to `AGENTS.md`, `CLAUDE.md`, or
agent skill directories and avoids the upstream incremental FTS/WAL failures
observed on this repository. A full rebuild takes only a few seconds here.
Re-run it after product-code changes or when `status` reports a stale index.

The first index is local and may take a little longer. It does not enable
embeddings, remote providers, PDG analysis, or HTTP serving.
Dependency installation and command orchestration use Bun. GitNexus itself runs
under Node.js because its LadybugDB N-API analysis path crashes under Bun
1.3.14 — the `bunx` invocations rely on the package bin's `node` shebang, so
do not add `bun --bun` / `bunx --bun` to these scripts until upstream
compatibility is verified.

## Agent workflow

Use Graphify first for broad product/architecture questions. Use GitNexus when
the task is narrow and code-sensitive:

```bash
# Find execution flows for a concept.
bun run gitnexus:query -- "authentication broker"

# Inspect callers, callees, and flows around one symbol.
bun run gitnexus:context -- "createOnTrackAuthBroker" --file src/lib/auth-broker.ts

# Inspect the blast radius before changing a symbol.
bun run gitnexus:impact -- "createOnTrackAuthBroker" --file src/lib/auth-broker.ts

# Check staged and unstaged code-level impact before a commit.
bun run gitnexus:detect-changes

# Detect circular imports in the local graph.
bun run gitnexus:check
```

Use `--file <path>` (and, if necessary, `--kind` or `--uid`) for ambiguous
symbols. Review HIGH or CRITICAL findings before editing or committing.

Codex launches the project-local MCP with `bun run gitnexus:mcp`. It is a
stdio server backed only by `.gitnexus-home/`, not a network service. Pi uses
the project skill and the same Bun commands directly. Do not use
`gitnexus mcp --http` or remote embedding configuration without explicit
approval, because either can expose repository information beyond this machine.

## Updating GitNexus

Check the registry and update the exact pin deliberately — the pin lives in
`scripts/check-gitnexus-skill-sync.ts` (`PINNED_VERSION`):

```bash
bun pm view gitnexus version
# edit PINNED_VERSION in scripts/check-gitnexus-skill-sync.ts
# update the Version entry above (docs must match the pin)
bun install -g gitnexus@<reviewed-version>
bun pm -g trust @ladybugdb/core tree-sitter gitnexus
bun run skills:check   # verifies skills + docs agree with the pin
bun run gitnexus:analyze
bun run gitnexus:status
```

After a version change, run the normal validation suite and inspect the
dependency diff. If GitNexus reports an inconsistent full-text index, run
`bun run gitnexus:repair` and then `bun run gitnexus:analyze`. If a fresh index
is still needed, remove only this repository's `.gitnexus/` directory and rerun
the analyze command; never run a broad or global cleanup command.
