import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const packageValue: unknown = JSON.parse(
  await readFile(resolve(root, 'package.json'), 'utf8'),
);
const packageRecord = packageValue as {
  readonly devDependencies?: Readonly<Record<string, string>>;
};
const version = packageRecord.devDependencies?.gitnexus;
if (!version || !/^\d+\.\d+\.\d+$/u.test(version)) {
  throw new Error('gitnexus must be an exact development dependency');
}

const codexSkill = await readFile(
  resolve(root, '.codex/skills/gitnexus/SKILL.md'),
);
const piSkill = await readFile(
  resolve(root, '.pi/agent/skills/gitnexus/SKILL.md'),
);
if (!codexSkill.equals(piSkill)) {
  throw new Error('Codex and Pi GitNexus skills are out of sync');
}
if (!codexSkill.includes(Buffer.from(`GitNexus ${version}`))) {
  throw new Error('GitNexus skill version does not match package.json');
}

process.stdout.write(`Verified GitNexus ${version} agent skill copies.\n`);
