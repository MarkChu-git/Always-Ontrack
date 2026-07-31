import { test } from "bun:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

async function runCli(
  args: string[],
  configRoot: string,
  stdin?: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(
      process.execPath,
      [resolve(process.cwd(), "src/cli.ts"), ...args],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          XDG_CONFIG_HOME: configRoot,
          NO_COLOR: "1",
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      resolveResult({ stdout, stderr, exitCode: code ?? 1 });
    });
    child.stdin.end(stdin);
  });
}

test("capabilities and schema are offline Agent protocol commands", async () => {
  const configRoot = await mkdtemp(
    join(tmpdir(), "ontrack-agent-capabilities-"),
  );
  try {
    const capabilities = await runCli(
      ["capabilities", "--output", "agent-json"],
      configRoot,
    );
    assert.equal(capabilities.exitCode, 0, capabilities.stderr);
    assert.equal(capabilities.stderr, "");
    const envelope = JSON.parse(capabilities.stdout) as Record<string, unknown>;
    assert.equal(envelope.schema_version, "ontrack.agent/v1");
    assert.equal(envelope.command, "capabilities");
    const data = envelope.data as Record<string, unknown>;
    assert.equal(data.protocol, "ontrack.agent/v1");

    const schema = await runCli(
      ["schema", "task.show", "--output", "agent-json"],
      configRoot,
    );
    assert.equal(schema.exitCode, 0, schema.stderr);
    const schemaEnvelope = JSON.parse(schema.stdout) as Record<string, unknown>;
    assert.equal(schemaEnvelope.command, "schema");
    assert.equal(
      (schemaEnvelope.data as Record<string, unknown>).path,
      "task.show",
    );
  } finally {
    await rm(configRoot, { recursive: true, force: true });
  }
});

test("Agent output wraps command data while legacy --json remains unchanged", async () => {
  const configRoot = await mkdtemp(join(tmpdir(), "ontrack-agent-output-"));
  const server = createServer((request, response) => {
    assert.equal(request.headers["auth-token"], "fixture-token");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify([{ id: 101, unit: { code: "FIT0001" } }]));
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const sessionDir = join(configRoot, "ontrack-cli");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, "session.json"),
      JSON.stringify({
        baseUrl: `http://127.0.0.1:${address.port}/api`,
        username: "fixture-user",
        authToken: "fixture-token",
        user: { id: 1, username: "fixture-user" },
        savedAt: "2026-07-31T00:00:00.000Z",
      }),
      "utf8",
    );

    const legacy = await runCli(["projects", "--json"], configRoot);
    assert.equal(legacy.exitCode, 0, legacy.stderr);
    assert.deepEqual(JSON.parse(legacy.stdout), [
      { id: 101, unit: { code: "FIT0001" } },
    ]);

    const agent = await runCli(
      ["projects", "--output", "agent-json"],
      configRoot,
    );
    assert.equal(agent.exitCode, 0, agent.stderr);
    const envelope = JSON.parse(agent.stdout) as Record<string, unknown>;
    assert.equal(envelope.command, "projects.list");
    assert.deepEqual(envelope.data, [{ id: 101, unit: { code: "FIT0001" } }]);
  } finally {
    server.close();
    await rm(configRoot, { recursive: true, force: true });
  }
});

test("Agent JSON stdin maps only registered fields and failures have stable exit codes", async () => {
  const configRoot = await mkdtemp(join(tmpdir(), "ontrack-agent-input-"));
  try {
    const invalid = await runCli(
      ["project", "show", "--input", "-", "--output", "agent-json"],
      configRoot,
      '{"unknown":"value"}',
    );
    assert.equal(invalid.exitCode, 2);
    assert.equal(invalid.stderr, "");
    const envelope = JSON.parse(invalid.stdout) as Record<string, unknown>;
    assert.equal(
      (envelope.error as Record<string, unknown>).code,
      "INVALID_ARGUMENT",
    );
    assert.equal(invalid.stdout.includes("value"), false);
  } finally {
    await rm(configRoot, { recursive: true, force: true });
  }
});

test("Agent mode rejects interactive login, validates required fields, and confirms logout", async () => {
  const configRoot = await mkdtemp(join(tmpdir(), "ontrack-agent-boundary-"));
  try {
    const login = await runCli(["login", "--output", "agent-json"], configRoot);
    assert.equal(login.exitCode, 2);
    assert.equal(login.stderr, "");
    assert.equal(
      (JSON.parse(login.stdout).error as Record<string, unknown>).code,
      "INVALID_ARGUMENT",
    );
    assert.equal(login.stdout.includes("GUIDED MONASH SSO"), false);

    const missingField = await runCli(
      ["project", "show", "--output", "agent-json"],
      configRoot,
    );
    assert.equal(missingField.exitCode, 2);
    assert.equal(
      (JSON.parse(missingField.stdout).error as Record<string, unknown>).code,
      "INVALID_ARGUMENT",
    );

    const unconfirmedLogout = await runCli(
      ["logout", "--output", "agent-json"],
      configRoot,
    );
    assert.equal(unconfirmedLogout.exitCode, 6);
    assert.equal(
      (JSON.parse(unconfirmedLogout.stdout).error as Record<string, unknown>)
        .code,
      "CONFIRMATION_REQUIRED",
    );

    const logout = await runCli(
      ["logout", "--confirm", "--output", "agent-json"],
      configRoot,
    );
    assert.equal(logout.exitCode, 0, logout.stderr);
    assert.equal(JSON.parse(logout.stdout).data.status, "signed_out");
  } finally {
    await rm(configRoot, { recursive: true, force: true });
  }
});

test("Agent mode rejects stray positional arguments and boolean flag values before I/O", async () => {
  const configRoot = await mkdtemp(join(tmpdir(), "ontrack-agent-argv-"));
  try {
    for (const args of [
      ["schema", "task.show", "unexpected", "--output", "agent-json"],
      [
        "plan",
        "reset",
        "--project-id",
        "101",
        "--confirm",
        "false",
        "--idempotency-key",
        "key",
        "--output",
        "agent-json",
      ],
    ]) {
      const result = await runCli(args, configRoot);
      assert.equal(result.exitCode, 2);
      assert.equal(result.stderr, "");
      assert.equal(
        (JSON.parse(result.stdout).error as Record<string, unknown>).code,
        "INVALID_ARGUMENT",
      );
    }
  } finally {
    await rm(configRoot, { recursive: true, force: true });
  }
});
