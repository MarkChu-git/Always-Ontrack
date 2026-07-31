import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";

interface SkillLockEntry {
  readonly ref: string;
  readonly computedHash: string;
}

interface SkillLock {
  readonly version: number;
  readonly skills: Readonly<Record<string, SkillLockEntry>>;
}

interface HashedFile {
  readonly relativePath: string;
  readonly content: Buffer;
}

const SHA1_PATTERN = /^[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SKILL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseLock(value: unknown): SkillLock {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.skills)) {
    throw new Error("skills-lock.json must use version 1 with a skills object");
  }

  const entries = Object.entries(value.skills).map(([name, entry]) => {
    if (!SKILL_NAME_PATTERN.test(name) || !isRecord(entry)) {
      throw new Error("skills-lock.json contains an invalid skill entry");
    }
    if (
      typeof entry.ref !== "string" ||
      !SHA1_PATTERN.test(entry.ref) ||
      typeof entry.computedHash !== "string" ||
      !SHA256_PATTERN.test(entry.computedHash)
    ) {
      throw new Error(
        `Skill ${name} must pin a full commit and a SHA-256 directory hash`,
      );
    }
    return [name, { ref: entry.ref, computedHash: entry.computedHash }] as const;
  });

  if (entries.length === 0) {
    throw new Error("skills-lock.json must contain at least one skill");
  }

  return {
    version: 1,
    skills: Object.fromEntries(entries),
  };
}

async function collectFiles(
  baseDir: string,
  currentDir: string,
): Promise<readonly HashedFile[]> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const collected = await Promise.all(
    entries.map(async (entry): Promise<readonly HashedFile[]> => {
      if (
        entry.isDirectory() &&
        (entry.name === ".git" || entry.name === "node_modules")
      ) {
        return [];
      }

      const fullPath = resolve(currentDir, entry.name);
      const relativePath = relative(baseDir, fullPath).split("\\").join("/");
      if (relativePath.startsWith("../") || relativePath === "..") {
        throw new Error("Skill directory traversal detected");
      }
      if (entry.isDirectory()) return collectFiles(baseDir, fullPath);
      if (!entry.isFile()) {
        throw new Error(`Unsupported entry in skill directory: ${relativePath}`);
      }
      return [{ relativePath, content: await readFile(fullPath) }];
    }),
  );

  return collected.flat();
}

async function computeSkillFolderHash(skillDir: string): Promise<string> {
  const files = [...(await collectFiles(skillDir, skillDir))].sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath),
  );
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.relativePath);
    hash.update(file.content);
  }
  return hash.digest("hex");
}

async function listInstalledSkillNames(
  skillsRoot: string,
): Promise<readonly string[]> {
  const entries = await readdir(skillsRoot, { withFileTypes: true });
  return entries
    .map((entry) => {
      if (!entry.isDirectory() || !SKILL_NAME_PATTERN.test(entry.name)) {
        throw new Error("Installed skills contain an invalid directory entry");
      }
      return entry.name;
    })
    .sort((a, b) => a.localeCompare(b));
}

async function main(): Promise<void> {
  if (process.argv.length !== 2) {
    throw new Error("Usage: bun scripts/check-skill-lock.ts");
  }
  const root = process.cwd();
  const lockValue: unknown = JSON.parse(
    await readFile(resolve(root, "skills-lock.json"), "utf8"),
  );
  const lock = parseLock(lockValue);
  const lockedNames = Object.keys(lock.skills).sort((a, b) =>
    a.localeCompare(b),
  );
  const installedNames = await listInstalledSkillNames(
    resolve(root, ".agents", "skills"),
  );
  if (
    lockedNames.length !== installedNames.length ||
    lockedNames.some((name, index) => name !== installedNames[index])
  ) {
    throw new Error(
      "Installed skill directories do not match skills-lock.json",
    );
  }

  for (const [name, entry] of Object.entries(lock.skills)) {
    const skillDir = resolve(root, ".agents", "skills", name);
    const actualHash = await computeSkillFolderHash(skillDir);
    if (actualHash !== entry.computedHash) {
      throw new Error(`Skill directory hash mismatch: ${name}`);
    }
  }

  const count = Object.keys(lock.skills).length;
  process.stdout.write(
    `Verified ${count} project skill lock ${count === 1 ? "entry" : "entries"}.\n`,
  );
}

await main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown failure";
  process.stderr.write(`Skill lock verification failed: ${message}\n`);
  process.exitCode = 1;
});
