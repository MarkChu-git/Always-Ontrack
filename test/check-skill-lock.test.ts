import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scriptPath = join(import.meta.dir, "..", "scripts", "check-skill-lock.ts");
let fixtureRoots: readonly string[] = [];

afterEach(async () => {
  const rootsToRemove = fixtureRoots;
  fixtureRoots = [];
  await Promise.all(
    rootsToRemove.map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function makeFixture(
  computedHash: string,
  ref = "2ab958093e83e0ec752e6c1c5932da465bf23e0c",
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ontrack-skill-lock-"));
  fixtureRoots = [...fixtureRoots, root];

  const skillDir = join(root, ".agents", "skills", "example");
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, "SKILL.md"), "hello\n", "utf8");
  await writeFile(
    join(root, "skills-lock.json"),
    `${JSON.stringify(
      {
        version: 1,
        skills: {
          example: {
            source: "example/skills",
            sourceType: "github",
            ref,
            skillPath: "skills/example/SKILL.md",
            computedHash,
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return root;
}

describe("project skill lock checker", () => {
  test("accepts a pinned entry whose complete directory hash matches", async () => {
    const root = await makeFixture(
      "32558c601120f0fa81b3c4745f32d8dee5187a5a96fe7b28ff70fb3d7a032933",
    );

    const result = Bun.spawnSync({
      cmd: [process.execPath, scriptPath, "--root", root],
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe(
      "Verified 1 project skill lock entry.\n",
    );
    expect(result.stderr.toString()).toBe("");
  });

  test("rejects a changed skill directory", async () => {
    const root = await makeFixture("0".repeat(64));

    const result = Bun.spawnSync({
      cmd: [process.execPath, scriptPath, "--root", root],
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout.toString()).toBe("");
    expect(result.stderr.toString()).toBe(
      "Skill lock verification failed: Skill directory hash mismatch: example\n",
    );
  });

  test("rejects an untracked extra skill directory", async () => {
    const root = await makeFixture(
      "32558c601120f0fa81b3c4745f32d8dee5187a5a96fe7b28ff70fb3d7a032933",
    );
    await mkdir(join(root, ".agents", "skills", "untracked"), {
      recursive: true,
    });
    await writeFile(
      join(root, ".agents", "skills", "untracked", "SKILL.md"),
      "untracked\n",
      "utf8",
    );

    const result = Bun.spawnSync({
      cmd: [process.execPath, scriptPath, "--root", root],
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout.toString()).toBe("");
    expect(result.stderr.toString()).toBe(
      "Skill lock verification failed: Installed skill directories do not match skills-lock.json\n",
    );
  });

  test("rejects a mutable branch reference", async () => {
    const root = await makeFixture(
      "32558c601120f0fa81b3c4745f32d8dee5187a5a96fe7b28ff70fb3d7a032933",
      "main",
    );

    const result = Bun.spawnSync({
      cmd: [process.execPath, scriptPath, "--root", root],
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout.toString()).toBe("");
    expect(result.stderr.toString()).toBe(
      "Skill lock verification failed: Skill example must pin a full commit and a SHA-256 directory hash\n",
    );
  });
});
