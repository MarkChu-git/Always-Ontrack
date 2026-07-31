# Engineering skills provenance

The project-level engineering skills under `.agents/skills/` were vendored from
`mattpocock/skills` at reviewed commit:

`2ab958093e83e0ec752e6c1c5932da465bf23e0c`

`improve-codebase-architecture` is a project-hardened fork of that commit.
Its report instructions require escaped repository text, embedded CSS/SVG, a
restrictive CSP, and no remote assets or scripts. The fork's final content is
pinned by its directory `computedHash` in `skills-lock.json`; its `ref` records
derived-from provenance and does not claim byte-identical upstream files.

`skills-lock.json` records the source path and computed content hash for each
installed skill. The copied files are the executable source of truth for the
repository; agents must not auto-update them.

## Update procedure

1. Review a specific upstream commit.
2. Install from that reviewed revision into a temporary directory.
3. Compare every changed skill and reference file.
4. Copy the approved result into `.agents/skills/`.
5. Refresh `skills-lock.json`, record the new commit here, and run the full
   repository verification suite.

Run `bun run skills:check` after any intentional skill edit. It uses the same
whole-directory hash algorithm as the `skills` CLI and rejects mutable branch
references.

Do not install from a moving branch during an ordinary coding task.
