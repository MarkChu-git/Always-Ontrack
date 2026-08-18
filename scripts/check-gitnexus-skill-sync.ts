import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();

// GitNexus is not a project dependency: it is installed once per machine as a
// global Bun tool (`bun install -g gitnexus@<pin>` + `bun pm -g trust ...`),
// keeping its ~1 GB dependency tree out of every checkout's node_modules.
// This constant is the single source of truth for the toolchain pin; the
// agent skills and docs/agents/gitnexus.md must agree with it.
const PINNED_VERSION = '1.6.9';

const codexSkill = await readFile(
  resolve(root, '.codex/skills/gitnexus/SKILL.md'),
);
const piSkill = await readFile(
  resolve(root, '.pi/agent/skills/gitnexus/SKILL.md'),
);
if (!codexSkill.equals(piSkill)) {
  throw new Error('Codex and Pi GitNexus skills are out of sync');
}
if (!codexSkill.includes(Buffer.from(`GitNexus ${PINNED_VERSION}`))) {
  throw new Error('GitNexus skill version does not match the pinned version');
}

const docs = await readFile(resolve(root, 'docs/agents/gitnexus.md'));
if (!docs.includes(Buffer.from(`\`${PINNED_VERSION}\``))) {
  throw new Error('docs/agents/gitnexus.md version does not match the pinned version');
}

process.stdout.write(`Verified GitNexus ${PINNED_VERSION} agent skill copies.\n`);
