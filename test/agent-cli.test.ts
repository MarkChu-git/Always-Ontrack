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

test("Agent stdout remains one JSON envelope when staff scope hints are emitted", async () => {
  const configRoot = await mkdtemp(join(tmpdir(), "ontrack-agent-hint-"));
  const server = createServer((request, response) => {
    assert.equal(request.url, "/api/units");
    response.writeHead(200, { "content-type": "application/json" });
    response.end("[]");
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
        user: { role: "convenor" },
        savedAt: "2026-07-31T00:00:00.000Z",
      }),
      "utf8",
    );

    const result = await runCli(["inbox", "--output", "agent-json"], configRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stderr, /^\[hint\]/);
    const envelope = JSON.parse(result.stdout) as Record<string, unknown>;
    assert.equal(envelope.command, "inbox.list");
    assert.deepEqual(envelope.data, []);
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

test("agent call executes auth.status through the native typed interface", async () => {
  const configRoot = await mkdtemp(join(tmpdir(), "ontrack-agent-call-auth-"));
  try {
    const result = await runCli(
      ["agent", "call", "auth.status", "--input-json", "{}"],
      configRoot,
    );
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");

    const envelope = JSON.parse(result.stdout) as Record<string, unknown>;
    assert.equal(envelope.schema_version, "ontrack.agent/v1");
    assert.equal(envelope.command, "auth.status");
    assert.equal(envelope.status, "success");
    assert.equal(
      (envelope.data as Record<string, unknown>).status,
      "signed_out",
    );

    const invalid = await runCli(
      [
        "agent",
        "call",
        "auth.status",
        "--input-json",
        '{"unexpected":"secret-shaped-value"}',
      ],
      configRoot,
    );
    assert.equal(invalid.exitCode, 2);
    assert.equal(invalid.stderr, "");
    const failure = JSON.parse(invalid.stdout) as Record<string, unknown>;
    assert.equal(
      (failure.error as Record<string, unknown>).code,
      "INVALID_ARGUMENT",
    );
    assert.equal(invalid.stdout.includes("secret-shaped-value"), false);
  } finally {
    await rm(configRoot, { recursive: true, force: true });
  }
});

test("agent call task.show uses definition-first tasks when project instances are empty", async () => {
  const configRoot = await mkdtemp(join(tmpdir(), "ontrack-agent-call-task-"));
  const server = createServer((request, response) => {
    assert.equal(request.headers["auth-token"], "fixture-token");
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/projects") {
      response.end(
        JSON.stringify([
          { id: 87, unit_id: 55 },
        ]),
      );
      return;
    }
    if (request.url === "/api/projects/87") {
      response.end(
        JSON.stringify({
          id: 87,
          unit_id: 55,
          tasks: [],
        }),
      );
      return;
    }
    if (request.url === "/api/units/55") {
      response.end(
        JSON.stringify({
          id: 55,
          code: "FIT0001",
          task_definitions: [
            { id: 501, abbreviation: "D4", name: "Design task" },
          ],
        }),
      );
      return;
    }
    response.writeHead(404);
    response.end(JSON.stringify({ error: "not found" }));
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
        expiresAt: "2099-01-01T00:00:00.000Z",
        source: "access-token",
        refreshedAt: "2026-07-31T00:00:00.000Z",
      }),
      "utf8",
    );

    const result = await runCli(
      [
        "agent",
        "call",
        "task.show",
        "--input-json",
        '{"project_id":87,"abbreviation":["D4"]}',
      ],
      configRoot,
    );
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    const envelope = JSON.parse(result.stdout) as Record<string, unknown>;
    assert.equal(envelope.command, "task.show");
    assert.equal(envelope.status, "success");
    const data = envelope.data as Record<string, unknown>;
    assert.equal(data.project_id, 87);
    assert.equal(data.count, 1);
    assert.deepEqual(data.tasks, [
      {
        project_id: 87,
        unit_id: 55,
        unit_code: "FIT0001",
        task_definition_id: 501,
        task_instance_id: null,
        abbreviation: "D4",
        name: "Design task",
        status: "not_instantiated",
        due_date: null,
        completion_date: null,
        grade: null,
        quality_points: null,
        instantiated: false,
        visibility: "within_target",
      },
    ]);
  } finally {
    server.close();
    await rm(configRoot, { recursive: true, force: true });
  }
});

test("agent list and describe are offline projections of the executable commands", async () => {
  const configRoot = await mkdtemp(join(tmpdir(), "ontrack-agent-discovery-"));
  try {
    const listed = await runCli(["agent", "list"], configRoot);
    assert.equal(listed.exitCode, 0, listed.stderr);
    assert.equal(listed.stderr, "");
    const listEnvelope = JSON.parse(listed.stdout) as Record<string, unknown>;
    assert.equal(listEnvelope.command, "agent.list");
    const commands = (listEnvelope.data as Record<string, unknown>)
      .commands as Array<Record<string, unknown>>;
    assert.deepEqual(
      commands.map((command) => command.path),
      ["auth.status", "task.show"],
    );

    const described = await runCli(
      ["agent", "describe", "task.show"],
      configRoot,
    );
    assert.equal(described.exitCode, 0, described.stderr);
    const description = JSON.parse(described.stdout) as Record<string, unknown>;
    assert.equal(description.command, "agent.describe");
    const data = description.data as Record<string, unknown>;
    assert.equal(data.path, "task.show");
    const inputSchema = data.input_schema as Record<string, unknown>;
    assert.ok(Array.isArray(inputSchema.anyOf));
    assert.match(JSON.stringify(inputSchema), /\\\\S/);

    const missing = await runCli(
      ["agent", "describe", "missing.command"],
      configRoot,
    );
    assert.equal(missing.exitCode, 2);
    assert.equal(
      (JSON.parse(missing.stdout).error as Record<string, unknown>).code,
      "INVALID_ARGUMENT",
    );

    const malformedList = await runCli(["agent", "list", "extra"], configRoot);
    assert.equal(malformedList.exitCode, 2);
    assert.equal(JSON.parse(malformedList.stdout).command, "agent.list");

    const malformedDescribe = await runCli(["agent", "describe"], configRoot);
    assert.equal(malformedDescribe.exitCode, 2);
    assert.equal(JSON.parse(malformedDescribe.stdout).command, "agent.describe");
  } finally {
    await rm(configRoot, { recursive: true, force: true });
  }
});

test("native task.show preserves an auth handoff when enrichment returns 401", async () => {
  const configRoot = await mkdtemp(join(tmpdir(), "ontrack-agent-auth-handoff-"));
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/projects") {
      response.end(JSON.stringify([{ id: 87, unit_id: 55 }]));
      return;
    }
    response.writeHead(401);
    response.end(JSON.stringify({ error: "expired" }));
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

    const result = await runCli(
      ["agent", "call", "task.show", "--input-json", '{"project_id":87,"all_tasks":true}'],
      configRoot,
    );
    assert.equal(result.exitCode, 3);
    const envelope = JSON.parse(result.stdout) as Record<string, unknown>;
    assert.equal((envelope.error as Record<string, unknown>).code, "AUTH_REQUIRED");
    assert.equal(result.stdout.includes("expired"), false);
  } finally {
    server.close();
    await rm(configRoot, { recursive: true, force: true });
  }
});

test("native task.show classifies a closed transport as retryable remote unavailability", async () => {
  const configRoot = await mkdtemp(join(tmpdir(), "ontrack-agent-remote-handoff-"));
  const server = createServer();
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));

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

    const result = await runCli(
      ["agent", "call", "task.show", "--input-json", '{"project_id":87,"all_tasks":true}'],
      configRoot,
    );
    assert.equal(result.exitCode, 7);
    const envelope = JSON.parse(result.stdout) as Record<string, unknown>;
    assert.equal((envelope.error as Record<string, unknown>).code, "REMOTE_UNAVAILABLE");
    assert.equal((envelope.error as Record<string, unknown>).retryable, true);
  } finally {
    await rm(configRoot, { recursive: true, force: true });
  }
});
