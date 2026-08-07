import { test } from "bun:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { MAX_DOWNLOAD_BYTES } from "../src/lib/api.js";

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

async function runStreamingCliUntilFirstFrame(
  args: string[],
  configRoot: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(
      process.execPath,
      [resolve(process.cwd(), "src/cli.ts"), ...args],
      {
        cwd: process.cwd(),
        env: { ...process.env, XDG_CONFIG_HOME: configRoot, NO_COLOR: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    const deadline = setTimeout(() => {
      child.kill("SIGINT");
      reject(
        new Error(`Timed out waiting for streaming frame: ${args.join(" ")}`),
      );
    }, 5_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.includes("\n")) {
        child.kill("SIGINT");
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(deadline);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(deadline);
      resolveResult({ stdout, stderr, exitCode: code ?? 1 });
    });
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

test("native projects.list and compatibility Agent output share a safe project directory", async () => {
  const configRoot = await mkdtemp(join(tmpdir(), "ontrack-agent-output-"));
  const fixture = JSON.parse(
    await readFile(
      resolve(
        process.cwd(),
        "test/fixtures/contracts/project-summaries-shape.json",
      ),
      "utf8",
    ),
  ) as { payload: Array<Record<string, unknown>> };
  const server = createServer((request, response) => {
    assert.equal(request.headers["auth-token"], "fixture-token");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(fixture.payload));
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
      }),
      "utf8",
    );

    const legacy = await runCli(["projects", "--json"], configRoot);
    assert.equal(legacy.exitCode, 0, legacy.stderr);
    assert.deepEqual(JSON.parse(legacy.stdout), fixture.payload);

    const compatibility = await runCli(
      ["projects", "--output", "agent-json"],
      configRoot,
    );
    assert.equal(compatibility.exitCode, 0, compatibility.stderr);
    const compatibilityEnvelope = JSON.parse(
      compatibility.stdout,
    ) as Record<string, unknown>;
    assert.equal(compatibilityEnvelope.command, "projects.list");
    assert.deepEqual(compatibilityEnvelope.data, {
      count: 1,
      projects: [
        {
          project_id: 1001,
          unit_id: 2001,
          unit_code: "FIT0001",
          unit_name: "Foundations of Agent Systems",
          target_grade: 2,
          submitted_grade: null,
          enrolled: null,
          special_consideration_days: 3,
          portfolio_available: true,
          escalation_attempts_remaining: 2,
        },
      ],
    });

    const native = await runCli(
      ["agent", "call", "projects.list", "--input-json", "{}"],
      configRoot,
    );
    assert.equal(native.exitCode, 0, `${native.stderr}\n${native.stdout}`);
    assert.equal(native.stderr, "");
    const nativeEnvelope = JSON.parse(native.stdout) as Record<string, unknown>;
    assert.equal(nativeEnvelope.command, "projects.list");
    assert.deepEqual(nativeEnvelope.data, compatibilityEnvelope.data);
  } finally {
    server.close();
    await rm(configRoot, { recursive: true, force: true });
  }
});

test("native tutorials.status projects the verified tutorial join without tutor details", async () => {
  const configRoot = await mkdtemp(join(tmpdir(), "ontrack-agent-tutorials-"));
  let malformedPolicy = false;
  const server = createServer((request, response) => {
    assert.equal(request.headers["auth-token"], "fixture-token");
    const payload =
      request.url === "/api/projects/1001"
        ? {
            id: 1001,
            unit_id: 2001,
            tasks: [],
            tutorial_enrolments: [{ tutorial_id: 4001 }],
          }
        : request.url === "/api/units/2001"
          ? {
              id: 2001,
              task_definitions: [],
              tutorial_streams: [{ abbreviation: "A" }, { abbreviation: "B" }],
              tutorials: [
                {
                  id: 4001,
                  tutorial_stream_abbr: "A",
                  room: "Private room",
                  tutor: { name: "Private tutor" },
                },
              ],
              allow_student_change_tutorial: malformedPolicy ? "true" : true,
            }
          : undefined;
    if (payload === undefined) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(payload));
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
      }),
      "utf8",
    );

    const result = await runCli(
      ["agent", "call", "tutorials.status", "--input-json", '{"project_id":1001}'],
      configRoot,
    );
    assert.equal(result.exitCode, 0, `${result.stderr}\n${result.stdout}`);
    assert.equal(result.stderr, "");
    const envelope = JSON.parse(result.stdout) as Record<string, unknown>;
    assert.equal(envelope.command, "tutorials.status");
    assert.deepEqual(envelope.data, {
      project_id: 1001,
      unit_id: 2001,
      state: "known",
      available_streams: ["A", "B"],
      enrolled_streams: ["A"],
      applies_to_all_streams: false,
      can_change_tutorial: true,
    });
    assert.equal(result.stdout.includes("Private room"), false);
    assert.equal(result.stdout.includes("Private tutor"), false);

    malformedPolicy = true;
    const malformed = await runCli(
      ["agent", "call", "tutorials.status", "--input-json", '{"project_id":1001}'],
      configRoot,
    );
    assert.equal(malformed.exitCode, 7);
    assert.equal(malformed.stderr, "");
    const malformedEnvelope = JSON.parse(malformed.stdout) as Record<string, unknown>;
    assert.equal(malformedEnvelope.command, "tutorials.status");
    assert.equal(
      (malformedEnvelope.error as Record<string, unknown>).code,
      "REMOTE_UNAVAILABLE",
    );
    assert.equal(malformed.stdout.includes("Private room"), false);
    assert.equal(malformed.stdout.includes("Private tutor"), false);
  } finally {
    server.close();
    await rm(configRoot, { recursive: true, force: true });
  }
});

test("native and compatibility tasks.list share a Student Task View catalogue without changing legacy JSON", async () => {
  const configRoot = await mkdtemp(join(tmpdir(), "ontrack-agent-tasks-list-"));
  const fixture = JSON.parse(
    await readFile(
      resolve(
        process.cwd(),
        "test/fixtures/contracts/project-empty-tasks-with-unit-definitions.json",
      ),
      "utf8",
    ),
  ) as {
    payload: {
      project: Record<string, unknown>;
      unit: Record<string, unknown>;
    };
  };
  const server = createServer((request, response) => {
    assert.equal(request.headers["auth-token"], "fixture-token");
    const payload =
      request.url === "/api/projects"
        ? [{ id: 1001, unit: { id: 2001 } }]
        : request.url === "/api/projects/1001"
          ? fixture.payload.project
          : request.url === "/api/units/2001"
            ? fixture.payload.unit
            : undefined;
    if (payload === undefined) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(payload));
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
        user: { id: 1, username: "fixture-user", role: "student" },
        savedAt: "2026-07-31T00:00:00.000Z",
        expiresAt: "2099-01-01T00:00:00.000Z",
        source: "access-token",
      }),
      "utf8",
    );

    const legacy = await runCli(["tasks", "--json"], configRoot);
    assert.equal(legacy.exitCode, 0, legacy.stderr);
    const legacyTasks = JSON.parse(legacy.stdout) as Array<Record<string, unknown>>;
    assert.equal(legacyTasks.length, 2);
    assert.equal(legacyTasks[0]?.taskDefinitionId, 3001);
    assert.equal(legacyTasks[0]?.status, "not_instantiated");
    assert.equal("project_id" in (legacyTasks[0] ?? {}), false);

    const compatibility = await runCli(
      [
        "tasks",
        "--project-id",
        "1001",
        "--unit-id",
        "2001",
        "--output",
        "agent-json",
      ],
      configRoot,
    );
    assert.equal(compatibility.exitCode, 0, compatibility.stderr);
    const compatibilityEnvelope = JSON.parse(
      compatibility.stdout,
    ) as Record<string, unknown>;
    assert.equal(compatibilityEnvelope.command, "tasks.list");
    assert.deepEqual(compatibilityEnvelope.data, {
      count: 2,
      tasks: [
        {
          project_id: 1001,
          unit_id: 2001,
          unit_code: null,
          task_definition_id: 3001,
          task_instance_id: null,
          abbreviation: "T1",
          name: "Task 1",
          status: "not_instantiated",
          due_date: null,
          completion_date: null,
          instantiated: false,
          visibility: "within_target",
        },
        {
          project_id: 1001,
          unit_id: 2001,
          unit_code: null,
          task_definition_id: 3002,
          task_instance_id: null,
          abbreviation: "T2",
          name: "Task 2",
          status: "not_instantiated",
          due_date: null,
          completion_date: null,
          instantiated: false,
          visibility: "within_target",
        },
      ],
    });

    const native = await runCli(
      [
        "agent",
        "call",
        "tasks.list",
        "--input-json",
        '{"project_id":1001,"unit_id":2001}',
      ],
      configRoot,
    );
    assert.equal(native.exitCode, 0, `${native.stderr}\n${native.stdout}`);
    assert.equal(native.stderr, "");
    const nativeEnvelope = JSON.parse(native.stdout) as Record<string, unknown>;
    assert.equal(nativeEnvelope.command, "tasks.list");
    assert.deepEqual(nativeEnvelope.data, compatibilityEnvelope.data);
  } finally {
    server.close();
    await rm(configRoot, { recursive: true, force: true });
  }
});

test("native and compatibility unit.show share a safe project-scoped unit view without changing legacy JSON", async () => {
  const configRoot = await mkdtemp(join(tmpdir(), "ontrack-agent-unit-show-"));
  const sensitiveMarker = "staff-private-marker@example.invalid";
  const unitPayload = {
    id: 2001,
    code: "FIT0001",
    name: "Foundations",
    active: true,
    task_definitions: [{ id: 3001 }, { id: 3002 }],
    staff: [{ email: sensitiveMarker }],
    tutorials: [{ id: 4001, students: [{ id: 5001 }]}],
  };
  const server = createServer((request, response) => {
    assert.equal(request.headers["auth-token"], "fixture-token");
    const payload =
      request.url === "/api/projects/1001"
        ? {
            id: 1001,
            unit: { id: 2001, code: "FIT0001", name: "Foundations" },
            target_grade: 1,
            submitted_grade: 0,
            enrolled: true,
            student: { email: sensitiveMarker },
          }
        : request.url === "/api/units/2001"
          ? unitPayload
          : undefined;
    if (payload === undefined) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(payload));
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
        user: { id: 1, username: "fixture-user", role: "student" },
        savedAt: "2026-07-31T00:00:00.000Z",
        expiresAt: "2099-01-01T00:00:00.000Z",
        source: "access-token",
      }),
      "utf8",
    );

    const legacy = await runCli(
      ["unit", "show", "--unit-id", "2001", "--json"],
      configRoot,
    );
    assert.equal(legacy.exitCode, 0, legacy.stderr);
    assert.deepEqual(JSON.parse(legacy.stdout), unitPayload);

    const compatibility = await runCli(
      [
        "unit",
        "show",
        "--project-id",
        "1001",
        "--unit-id",
        "2001",
        "--output",
        "agent-json",
      ],
      configRoot,
    );
    assert.equal(compatibility.exitCode, 0, compatibility.stderr);
    const compatibilityEnvelope = JSON.parse(
      compatibility.stdout,
    ) as Record<string, unknown>;
    assert.equal(compatibilityEnvelope.command, "unit.show");
    assert.deepEqual(compatibilityEnvelope.data, {
      project_id: 1001,
      unit_id: 2001,
      unit_code: "FIT0001",
      unit_name: "Foundations",
      target_grade: 1,
      submitted_grade: 0,
      enrolled: true,
      active: true,
      task_definition_count: 2,
    });
    assert.equal(compatibility.stdout.includes(sensitiveMarker), false);
    assert.equal(compatibility.stdout.includes("task_definitions"), false);
    assert.equal(compatibility.stdout.includes("tutorials"), false);

    const native = await runCli(
      [
        "agent",
        "call",
        "unit.show",
        "--input-json",
        '{"project_id":1001,"unit_id":2001}',
      ],
      configRoot,
    );
    assert.equal(native.exitCode, 0, `${native.stderr}\n${native.stdout}`);
    assert.equal(native.stderr, "");
    const nativeEnvelope = JSON.parse(native.stdout) as Record<string, unknown>;
    assert.equal(nativeEnvelope.command, "unit.show");
    assert.deepEqual(nativeEnvelope.data, compatibilityEnvelope.data);
  } finally {
    server.close();
    await rm(configRoot, { recursive: true, force: true });
  }
});

test("unit.show rejects unscoped, malformed, and mismatched Agent input before remote reads", async () => {
  const configRoot = await mkdtemp(join(tmpdir(), "ontrack-agent-unit-input-"));
  try {
    const invocations: string[][] = [
      ["agent", "call", "unit.show", "--input-json", "{}"],
      [
        "agent",
        "call",
        "unit.show",
        "--input-json",
        '{"project_id":1001,"unknown":true}',
      ],
      [
        "unit",
        "show",
        "--unit-id",
        "2001",
        "--output",
        "agent-json",
      ],
      ["unit", "show", "--project-id", "0", "--output", "agent-json"],
    ];
    for (const args of invocations) {
      const result = await runCli(args, configRoot);
      assert.equal(result.exitCode, 2, `${args.join(" ")}\n${result.stdout}`);
      assert.equal(result.stderr, "");
      const envelope = JSON.parse(result.stdout) as Record<string, unknown>;
      assert.equal(envelope.command, "unit.show");
      assert.equal(
        (envelope.error as Record<string, unknown>).code,
        "INVALID_ARGUMENT",
      );
    }
  } finally {
    await rm(configRoot, { recursive: true, force: true });
  }
});

test("native and compatibility unit.show reject malformed project capabilities before unit reads", async () => {
  const configRoot = await mkdtemp(join(tmpdir(), "ontrack-agent-unit-remote-"));
  const sensitiveMarker = "student-private-marker@example.invalid";
  let unitReads = 0;
  const server = createServer((request, response) => {
    if (request.url === "/api/projects/1001") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id: 1001,
          unit_id: 2001,
          targetGrade: 0,
          target_grade: 1,
          student: { email: sensitiveMarker },
        }),
      );
      return;
    }
    if (request.url === "/api/units/2001") {
      unitReads += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: 2001, task_definitions: [] }));
      return;
    }
    response.writeHead(404).end();
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
        user: { id: 1, username: "fixture-user", role: "student" },
        savedAt: "2026-07-31T00:00:00.000Z",
        expiresAt: "2099-01-01T00:00:00.000Z",
        source: "access-token",
      }),
      "utf8",
    );

    for (const args of [
      [
        "agent",
        "call",
        "unit.show",
        "--input-json",
        '{"project_id":1001}',
      ],
      ["unit", "show", "--project-id", "1001", "--output", "agent-json"],
    ]) {
      const result = await runCli(args, configRoot);
      assert.equal(result.exitCode, 7, `${args.join(" ")}\n${result.stdout}`);
      assert.equal(result.stderr, "");
      const envelope = JSON.parse(result.stdout) as Record<string, unknown>;
      assert.equal(envelope.command, "unit.show");
      assert.equal(
        (envelope.error as Record<string, unknown>).code,
        "REMOTE_UNAVAILABLE",
      );
      assert.equal(result.stdout.includes(sensitiveMarker), false);
      assert.equal(result.stdout.includes("targetGrade"), false);
    }
    assert.equal(unitReads, 0);
  } finally {
    server.close();
    await rm(configRoot, { recursive: true, force: true });
  }
});

test("tasks.list rejects invalid or unscoped Agent input before authentication", async () => {
  const configRoot = await mkdtemp(join(tmpdir(), "ontrack-agent-tasks-input-"));
  try {
    const invocations: string[][] = [
      [
        "agent",
        "call",
        "tasks.list",
        "--input-json",
        "{}",
      ],
      [
        "agent",
        "call",
        "tasks.list",
        "--input-json",
        '{"project_id":1001,"unknown":true}',
      ],
      [
        "agent",
        "call",
        "tasks.list",
        "--input-json",
        '{"project_id":1001,"status":"unsafe\\u0007status"}',
      ],
      [
        "tasks",
        "--project-id",
        "1001",
        "--status",
        "unsafe\u0007status",
        "--output",
        "agent-json",
      ],
      ["tasks", "--output", "agent-json"],
    ];

    for (const args of invocations) {
      const result = await runCli(args, configRoot);
      assert.equal(result.exitCode, 2, `${args.join(" ")}\n${result.stdout}`);
      assert.equal(result.stderr, "");
      const envelope = JSON.parse(result.stdout) as Record<string, unknown>;
      assert.equal(envelope.command, "tasks.list");
      assert.equal(
        (envelope.error as Record<string, unknown>).code,
        "INVALID_ARGUMENT",
      );
    }
  } finally {
    await rm(configRoot, { recursive: true, force: true });
  }
});

test("native and compatibility tasks.list fail closed on malformed remote task metadata", async () => {
  const configRoot = await mkdtemp(join(tmpdir(), "ontrack-agent-tasks-remote-"));
  const sensitiveMarker = "student-private-marker@example.invalid";
  const server = createServer((request, response) => {
    const payload =
      request.url === "/api/projects/1001"
        ? {
            id: 1001,
            unit_id: 2001,
            targetGrade: 0,
            target_grade: 1,
            tasks: [],
            student: { email: sensitiveMarker },
          }
        : request.url === "/api/units/2001"
          ? {
              id: 2001,
              task_definitions: [{ id: 3001, abbreviation: "T1" }],
            }
          : undefined;
    if (payload === undefined) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(payload));
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
        user: { id: 1, username: "fixture-user", role: "student" },
        savedAt: "2026-07-31T00:00:00.000Z",
        expiresAt: "2099-01-01T00:00:00.000Z",
        source: "access-token",
      }),
      "utf8",
    );

    for (const args of [
      [
        "agent",
        "call",
        "tasks.list",
        "--input-json",
        '{"project_id":1001,"unit_id":2001}',
      ],
      [
        "tasks",
        "--project-id",
        "1001",
        "--unit-id",
        "2001",
        "--output",
        "agent-json",
      ],
    ]) {
      const result = await runCli(args, configRoot);
      assert.equal(result.exitCode, 7);
      assert.equal(result.stderr, "");
      const envelope = JSON.parse(result.stdout) as Record<string, unknown>;
      assert.equal(envelope.command, "tasks.list");
      assert.equal(
        (envelope.error as Record<string, unknown>).code,
        "REMOTE_UNAVAILABLE",
      );
      assert.equal(result.stdout.includes(sensitiveMarker), false);
      assert.equal(result.stdout.includes("targetGrade"), false);
    }
  } finally {
    server.close();
    await rm(configRoot, { recursive: true, force: true });
  }
});

test("Agent Student Task View listing bounds project detail transport without changing legacy task JSON", async () => {
  const configRoot = await mkdtemp(join(tmpdir(), "ontrack-agent-tasks-boundary-"));
  const oversizedMarker = "x".repeat(512 * 1024);
  const server = createServer((request, response) => {
    const payload =
      request.url === "/api/projects"
        ? [{ id: 1001, unit: { id: 2001 } }]
        : request.url === "/api/projects/1001"
          ? {
              id: 1001,
              unit_id: 2001,
              tasks: [],
              legacy_marker: oversizedMarker,
            }
          : request.url === "/api/units/2001"
            ? {
                id: 2001,
                task_definitions: [{ id: 3001, abbreviation: "T1" }],
              }
            : undefined;
    if (payload === undefined) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(payload));
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
        user: { id: 1, username: "fixture-user", role: "student" },
        savedAt: "2026-07-31T00:00:00.000Z",
        expiresAt: "2099-01-01T00:00:00.000Z",
        source: "access-token",
      }),
      "utf8",
    );

    const legacy = await runCli(["tasks", "--json"], configRoot);
    assert.equal(legacy.exitCode, 0, legacy.stderr);
    const legacyTasks = JSON.parse(legacy.stdout) as Array<Record<string, unknown>>;
    assert.equal(legacyTasks.length, 1);
    assert.equal(legacyTasks[0]?.taskDefinitionId, 3001);

    for (const args of [
      [
        "agent",
        "call",
        "tasks.list",
        "--input-json",
        '{"project_id":1001,"unit_id":2001}',
      ],
      [
        "tasks",
        "--project-id",
        "1001",
        "--unit-id",
        "2001",
        "--output",
        "agent-json",
      ],
    ]) {
      const result = await runCli(args, configRoot);
      assert.equal(result.exitCode, 7);
      assert.equal(result.stderr, "");
      const envelope = JSON.parse(result.stdout) as Record<string, unknown>;
      assert.equal(
        (envelope.error as Record<string, unknown>).code,
        "REMOTE_UNAVAILABLE",
      );
      assert.equal(result.stdout.includes(oversizedMarker), false);
    }
  } finally {
    server.close();
    await rm(configRoot, { recursive: true, force: true });
  }
});

test("native projects.list rejects invalid input before authentication or network I/O", async () => {
  const configRoot = await mkdtemp(
    join(tmpdir(), "ontrack-agent-projects-input-"),
  );
  try {
    for (const input of [{ unknown: true }, []]) {
      const result = await runCli(
        [
          "agent",
          "call",
          "projects.list",
          "--input-json",
          JSON.stringify(input),
        ],
        configRoot,
      );
      assert.equal(result.exitCode, 2);
      assert.equal(result.stderr, "");
      const envelope = JSON.parse(result.stdout) as Record<string, unknown>;
      assert.equal(envelope.command, "projects.list");
      assert.equal(
        (envelope.error as Record<string, unknown>).code,
        "INVALID_ARGUMENT",
      );
    }
  } finally {
    await rm(configRoot, { recursive: true, force: true });
  }
});

test("native and compatibility projects.list fail closed on malformed remote summaries", async () => {
  const configRoot = await mkdtemp(
    join(tmpdir(), "ontrack-agent-projects-remote-"),
  );
  const sensitiveMarker = "student-private-marker@example.invalid";
  const server = createServer((request, response) => {
    assert.equal(request.url, "/api/projects");
    assert.equal(request.headers["auth-token"], "fixture-token");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify([
        {
          id: 1001,
          unit: { id: 2001, code: "FIT0001" },
          targetGrade: 2,
          target_grade: 3,
          student: { email: sensitiveMarker },
        },
      ]),
    );
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
      }),
      "utf8",
    );

    for (const args of [
      ["agent", "call", "projects.list", "--input-json", "{}"],
      ["projects", "--output", "agent-json"],
    ]) {
      const result = await runCli(args, configRoot);
      assert.equal(result.exitCode, 7);
      assert.equal(result.stderr, "");
      const envelope = JSON.parse(result.stdout) as Record<string, unknown>;
      assert.equal(envelope.command, "projects.list");
      assert.equal(
        (envelope.error as Record<string, unknown>).code,
        "REMOTE_UNAVAILABLE",
      );
      assert.equal(result.stdout.includes(sensitiveMarker), false);
      assert.equal(result.stdout.includes("targetGrade"), false);
    }
  } finally {
    server.close();
    await rm(configRoot, { recursive: true, force: true });
  }
});

test("Agent project listing is bounded without changing large legacy projects JSON", async () => {
  const configRoot = await mkdtemp(
    join(tmpdir(), "ontrack-agent-projects-boundary-"),
  );
  const legacyMarker = "x".repeat(512 * 1024);
  const responseBody = JSON.stringify([
    {
      id: 1001,
      unit: { id: 2001, code: "FIT0001" },
      legacy_marker: legacyMarker,
    },
  ]);
  const server = createServer((request, response) => {
    assert.equal(request.url, "/api/projects");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(responseBody);
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
      }),
      "utf8",
    );

    const legacy = await runCli(["projects", "--json"], configRoot);
    assert.equal(legacy.exitCode, 0, legacy.stderr);
    const legacyPayload = JSON.parse(legacy.stdout) as Array<Record<string, unknown>>;
    assert.equal(legacyPayload[0]?.legacy_marker, legacyMarker);

    for (const args of [
      ["agent", "call", "projects.list", "--input-json", "{}"],
      ["projects", "--output", "agent-json"],
    ]) {
      const result = await runCli(args, configRoot);
      assert.equal(result.exitCode, 7);
      assert.equal(result.stderr, "");
      const envelope = JSON.parse(result.stdout) as Record<string, unknown>;
      assert.equal(
        (envelope.error as Record<string, unknown>).code,
        "REMOTE_UNAVAILABLE",
      );
      assert.equal(result.stdout.includes(legacyMarker), false);
    }
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

    const missingSelector = await runCli(
      [
        "task",
        "prerequisites",
        "--input-json",
        '{"project_id":87}',
        "--output",
        "agent-json",
      ],
      configRoot,
    );
    assert.equal(missingSelector.exitCode, 2);
    assert.equal(missingSelector.stderr, "");
    assert.equal(
      (JSON.parse(missingSelector.stdout).error as Record<string, unknown>).code,
      "INVALID_ARGUMENT",
    );

    for (const input of [
      { project_id: -1, abbreviation: "D4" },
      { project_id: 87, abbreviation: "   " },
      { project_id: 87, task_definition_id: -1 },
    ]) {
      const invalidSelector = await runCli(
        [
          "task",
          "prerequisites",
          "--input-json",
          JSON.stringify(input),
          "--output",
          "agent-json",
        ],
        configRoot,
      );
      assert.equal(invalidSelector.exitCode, 2);
      assert.equal(invalidSelector.stderr, "");
      assert.equal(
        (JSON.parse(invalidSelector.stdout).error as Record<string, unknown>).code,
        "INVALID_ARGUMENT",
      );
    }

    for (const input of [
      { project_id: 87 },
      { project_id: 0, abbreviation: "D4" },
      { project_id: 87, abbreviation: "   " },
      { project_id: 87, all_tasks: true },
    ]) {
      const invalidSubmission = await runCli(
        [
          "submission",
          "status",
          "--input-json",
          JSON.stringify(input),
          "--output",
          "agent-json",
        ],
        configRoot,
      );
      assert.equal(invalidSubmission.exitCode, 2);
      assert.equal(invalidSubmission.stderr, "");
      assert.equal(
        (JSON.parse(invalidSubmission.stdout).error as Record<string, unknown>).code,
        "INVALID_ARGUMENT",
      );
    }
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

test("agent call plan.show replays definition-first planner fixtures and matches compatibility output", async () => {
  const configRoot = await mkdtemp(join(tmpdir(), "ontrack-agent-plan-show-"));
  const projectFixture = JSON.parse(
    await readFile(
      resolve(
        process.cwd(),
        "test/fixtures/contracts/project-empty-tasks-with-unit-definitions.json",
      ),
      "utf8",
    ),
  ) as {
    payload: {
      project: Record<string, unknown>;
      unit: Record<string, unknown> & {
        task_definitions: Array<Record<string, unknown>>;
      };
    };
  };
  const prerequisiteFixture = JSON.parse(
    await readFile(
      resolve(
        process.cwd(),
        "test/fixtures/contracts/planner-prerequisites-shape.json",
      ),
      "utf8",
    ),
  ) as { payload: Array<Record<string, unknown>> };
  const requests: Array<{ method: string | undefined; url: string | undefined }> = [];
  const project = {
    ...projectFixture.payload.project,
    target_grade: 1,
    auth_token: "must-not-be-projected",
  };
  const unit = {
    ...projectFixture.payload.unit,
    code: "FIT0001",
    allow_flexible_dates: true,
    task_definitions: projectFixture.payload.unit.task_definitions.map(
      (definition, index) =>
        index === 0
          ? {
              ...definition,
              target_grade: 0,
              start_date: "2026-03-01",
              target_date: "2026-03-08",
              due_date: "2026-03-12",
              grade_due_dates: [
                {
                  target_grade: 1,
                  start_date: "2026-03-02",
                  target_due_date: "2026-03-10",
                },
              ],
            }
          : {
              ...definition,
              target_grade: 2,
              start_date: "2026-04-01",
              target_date: "2026-04-08",
              due_date: "2026-04-12",
            },
    ),
  };
  const server = createServer((request, response) => {
    requests.push({ method: request.method, url: request.url });
    assert.equal(request.method, "GET");
    assert.equal(request.headers["auth-token"], "fixture-token");
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/projects") {
      response.end(JSON.stringify([{ id: 1001, unit_id: 2001, target_grade: 1 }]));
      return;
    }
    if (request.url === "/api/projects/1001") {
      response.end(JSON.stringify(project));
      return;
    }
    if (request.url === "/api/units/2001") {
      response.end(JSON.stringify(unit));
      return;
    }
    if (request.url === "/api/units/2001/task_prerequisites") {
      response.end(JSON.stringify(prerequisiteFixture.payload));
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
      }),
      "utf8",
    );

    const native = await runCli(
      [
        "agent",
        "call",
        "plan.show",
        "--input-json",
        JSON.stringify({ project_id: 1001, include_beyond_target: false }),
      ],
      configRoot,
    );
    assert.equal(native.exitCode, 0, `${native.stderr}\n${native.stdout}`);
    assert.equal(native.stderr, "");
    const nativeEnvelope = JSON.parse(native.stdout) as Record<string, unknown>;
    assert.equal(nativeEnvelope.command, "plan.show");
    assert.deepEqual(nativeEnvelope.data, {
      project_id: 1001,
      unit_id: 2001,
      unit_code: "FIT0001",
      include_beyond_target: false,
      count: 1,
      tasks: [
        {
          task_definition_id: 3001,
          task_instance_id: null,
          abbreviation: "T1",
          name: "Task 1",
          status: "not_instantiated",
          instantiated: false,
          visibility: "within_target",
          flexible_dates: true,
          start: {
            kind: "start",
            value: "2026-03-02",
            source: "grade_default",
            editable: true,
            interpretation: "unit_local_calendar_date",
          },
          target: {
            kind: "target",
            value: "2026-03-10",
            source: "grade_default",
            editable: true,
            interpretation: "unit_local_calendar_date",
          },
          feedback_deadline: {
            kind: "feedback_deadline",
            value: "2026-03-12",
            source: "unit_default",
            editable: false,
            interpretation: "unit_local_calendar_date",
          },
          prerequisites: [
            {
              task_definition_id: 3000,
              required_status: "complete",
              current_status: null,
            },
          ],
        },
      ],
    });
    assert.equal(native.stdout.includes("fixture-token"), false);
    assert.equal(native.stdout.includes("must-not-be-projected"), false);

    const compatibility = await runCli(
      [
        "plan",
        "show",
        "--input-json",
        JSON.stringify({ project_id: 1001, include_beyond_target: false }),
        "--output",
        "agent-json",
      ],
      configRoot,
    );
    assert.equal(compatibility.exitCode, 0, compatibility.stderr);
    const compatibilityEnvelope = JSON.parse(compatibility.stdout) as Record<
      string,
      unknown
    >;
    assert.equal(compatibilityEnvelope.command, "plan.show");
    assert.deepEqual(compatibilityEnvelope.data, nativeEnvelope.data);

    const beyond = await runCli(
      [
        "agent",
        "call",
        "plan.show",
        "--input-json",
        JSON.stringify({ project_id: 1001, include_beyond_target: true }),
      ],
      configRoot,
    );
    assert.equal(beyond.exitCode, 0, beyond.stderr);
    const beyondData = JSON.parse(beyond.stdout).data as Record<string, unknown>;
    assert.equal(beyondData.count, 2);
    assert.equal(
      ((beyondData.tasks as Array<Record<string, unknown>>)[1] ?? {}).visibility,
      "beyond_target",
    );

    const legacy = await runCli(
      ["plan", "show", "--project-id", "1001", "--json"],
      configRoot,
    );
    assert.equal(legacy.exitCode, 0, legacy.stderr);
    const legacyPlans = JSON.parse(legacy.stdout) as Array<Record<string, unknown>>;
    assert.equal(legacyPlans.length, 1);
    assert.equal(
      (legacyPlans[0]?.reference as Record<string, unknown>).taskDefinitionId,
      3001,
    );
    assert.equal("task_definition_id" in (legacyPlans[0] ?? {}), false);
    assert.equal(requests.every((request) => request.method === "GET"), true);
  } finally {
    server.close();
    await rm(configRoot, { recursive: true, force: true });
  }
});

test("native plan.show rejects invalid input before authentication or network I/O", async () => {
  const configRoot = await mkdtemp(join(tmpdir(), "ontrack-agent-plan-input-"));
  const invalidInputs: unknown[] = [
    { project_id: 0 },
    { project_id: -1 },
    { project_id: 1.5 },
    { project_id: "1001" },
    { project_id: 1001, include_beyond_target: 1 },
    { project_id: 1001, unknown: true },
  ];
  try {
    for (const input of invalidInputs) {
      const result = await runCli(
        [
          "agent",
          "call",
          "plan.show",
          "--input-json",
          JSON.stringify(input),
        ],
        configRoot,
      );
      assert.equal(result.exitCode, 2);
      assert.equal(result.stderr, "");
      const envelope = JSON.parse(result.stdout) as Record<string, unknown>;
      assert.equal(
        (envelope.error as Record<string, unknown>).code,
        "INVALID_ARGUMENT",
      );
    }
  } finally {
    await rm(configRoot, { recursive: true, force: true });
  }
});

test("agent call task.prerequisites uses the per-definition OnTrack route and normalizes aliases", async () => {
  const configRoot = await mkdtemp(join(tmpdir(), "ontrack-agent-call-task-prerequisites-"));
  const fixture = JSON.parse(
    await readFile(
      resolve(process.cwd(), "test/fixtures/contracts/definition-prerequisites-shape.json"),
      "utf8",
    ),
  ) as { payload: Array<Record<string, unknown>> };
  const server = createServer((request, response) => {
    assert.equal(request.headers["auth-token"], "fixture-token");
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/projects") {
      response.end(JSON.stringify([{ id: 87, unit_id: 55 }]));
      return;
    }
    if (request.url === "/api/projects/87") {
      response.end(JSON.stringify({ id: 87, unit_id: 55, tasks: [] }));
      return;
    }
    if (request.url === "/api/units/55") {
      response.end(JSON.stringify({
        id: 55,
        code: "FIT0001",
        task_definitions: [{ id: 501, abbreviation: "D4", name: "Design task" }],
      }));
      return;
    }
    if (request.url === "/api/units/55/task_definitions/501/prerequisites") {
      response.end(JSON.stringify([
        ...fixture.payload,
        { id: 3, task_definition_id: 999, prerequisite_id: 402, task_status: "complete" },
      ]));
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
        "task.prerequisites",
        "--input-json",
        JSON.stringify({ project_id: 87, abbreviation: "D4" }),
      ],
      configRoot,
    );
    assert.equal(result.exitCode, 0, `${result.stderr}\n${result.stdout}`);
    assert.equal(result.stderr, "");
    const envelope = JSON.parse(result.stdout) as Record<string, unknown>;
    assert.equal(envelope.command, "task.prerequisites");
    assert.equal(envelope.status, "success");
    assert.deepEqual(envelope.data, {
      project_id: 87,
      unit_id: 55,
      task_definition_id: 501,
      count: 2,
      prerequisites: [
        {
          id: 1,
          task_definition_id: 501,
          prerequisite_task_definition_id: 400,
          required_status: "complete",
        },
        {
          id: 2,
          task_definition_id: 501,
          prerequisite_task_definition_id: 401,
          required_status: "working",
        },
      ],
    });
  } finally {
    server.close();
    await rm(configRoot, { recursive: true, force: true });
  }
});

test("native task.prerequisites rejects batch selectors before authentication or network I/O", async () => {
  const configRoot = await mkdtemp(join(tmpdir(), "ontrack-agent-task-prerequisites-input-"));
  try {
    const result = await runCli(
      [
        "agent",
        "call",
        "task.prerequisites",
        "--input-json",
        '{"project_id":87,"all_tasks":true}',
      ],
      configRoot,
    );
    assert.equal(result.exitCode, 2);
    assert.equal(result.stderr, "");
    const envelope = JSON.parse(result.stdout) as Record<string, unknown>;
    assert.equal((envelope.error as Record<string, unknown>).code, "INVALID_ARGUMENT");
  } finally {
    await rm(configRoot, { recursive: true, force: true });
  }
});

test("native task.prerequisites fails closed on malformed relationship aliases", async () => {
  const configRoot = await mkdtemp(join(tmpdir(), "ontrack-agent-task-prerequisites-malformed-"));
  const malformedPayloads: unknown[] = [
    [{ task_definition_id: "501", prerequisite_id: 400, task_status: "complete" }],
    [42],
    [{}],
    [{ id: "1", task_definition_id: 501, prerequisite_id: 400, task_status: "complete" }],
  ];
  let prerequisiteRequestCount = 0;
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/projects") {
      response.end(JSON.stringify([{ id: 87, unit_id: 55 }]));
      return;
    }
    if (request.url === "/api/projects/87") {
      response.end(JSON.stringify({ id: 87, unit_id: 55, tasks: [] }));
      return;
    }
    if (request.url === "/api/units/55") {
      response.end(JSON.stringify({
        id: 55,
        task_definitions: [{ id: 501, abbreviation: "D4", name: "Design task" }],
      }));
      return;
    }
    if (request.url === "/api/units/55/task_definitions/501/prerequisites") {
      response.end(JSON.stringify(malformedPayloads[prerequisiteRequestCount]));
      prerequisiteRequestCount += 1;
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
      }),
      "utf8",
    );

    for (const _payload of malformedPayloads) {
      const result = await runCli(
        [
          "agent",
          "call",
          "task.prerequisites",
          "--input-json",
          JSON.stringify({ project_id: 87, abbreviation: "D4" }),
        ],
        configRoot,
      );
      assert.equal(result.exitCode, 7);
      assert.equal(result.stderr, "");
      const envelope = JSON.parse(result.stdout) as Record<string, unknown>;
      assert.equal((envelope.error as Record<string, unknown>).code, "REMOTE_UNAVAILABLE");
    }
  } finally {
    server.close();
    await rm(configRoot, { recursive: true, force: true });
  }
});

test("native task.prerequisites classifies malformed and oversized remote payloads", async () => {
  const configRoot = await mkdtemp(join(tmpdir(), "ontrack-agent-task-prerequisites-remote-"));
  let prerequisiteRequestCount = 0;
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/projects") {
      response.end(JSON.stringify([{ id: 87, unit_id: 55 }]));
      return;
    }
    if (request.url === "/api/projects/87") {
      response.end(JSON.stringify({ id: 87, unit_id: 55, tasks: [] }));
      return;
    }
    if (request.url === "/api/units/55") {
      response.end(JSON.stringify({
        id: 55,
        task_definitions: [{ id: 501, abbreviation: "D4", name: "Design task" }],
      }));
      return;
    }
    if (request.url === "/api/units/55/task_definitions/501/prerequisites") {
      prerequisiteRequestCount += 1;
      if (prerequisiteRequestCount === 1) {
        response.end('{"broken":');
        return;
      }
      if (prerequisiteRequestCount === 2) {
        response.end(JSON.stringify({ value: "x".repeat(512 * 1024) }));
        return;
      }
      response.end(JSON.stringify(Array.from({ length: 201 }, (_, index) => ({
        id: index + 1,
        task_definition_id: 501,
        prerequisite_id: index + 1000,
        task_status: "complete",
      }))));
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
      }),
      "utf8",
    );

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await runCli(
        [
          "agent",
          "call",
          "task.prerequisites",
          "--input-json",
          JSON.stringify({ project_id: 87, abbreviation: "D4" }),
        ],
        configRoot,
      );
      assert.equal(result.exitCode, 7);
      assert.equal(result.stderr, "");
      const envelope = JSON.parse(result.stdout) as Record<string, unknown>;
      assert.equal((envelope.error as Record<string, unknown>).code, "REMOTE_UNAVAILABLE");
    }
  } finally {
    server.close();
    await rm(configRoot, { recursive: true, force: true });
  }
});

test("agent call submission.status replays the observed definition-first submission contract", async () => {
  const configRoot = await mkdtemp(join(tmpdir(), "ontrack-agent-submission-status-"));
  let unitCode = "FIT0001";
  const fixture = JSON.parse(
    await readFile(
      resolve(process.cwd(), "test/fixtures/contracts/submission-details-shape.json"),
      "utf8",
    ),
  ) as { payload: Record<string, unknown> };
  const server = createServer((request, response) => {
    assert.equal(request.headers["auth-token"], "fixture-token");
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/projects") {
      response.end(JSON.stringify([{ id: 87, unit_id: 55 }]));
      return;
    }
    if (request.url === "/api/projects/87") {
      response.end(JSON.stringify({ id: 87, unit_id: 55, tasks: [] }));
      return;
    }
    if (request.url === "/api/units/55") {
      response.end(JSON.stringify({
        id: 55,
        code: unitCode,
        task_definitions: [{ id: 501, abbreviation: "D4", name: "Design task" }],
      }));
      return;
    }
    if (request.url === "/api/projects/87/task_def_id/501/submission_details") {
      response.end(JSON.stringify({
        ...fixture.payload,
        auth_token: "must-not-be-projected",
      }));
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
      }),
      "utf8",
    );

    const result = await runCli(
      [
        "agent",
        "call",
        "submission.status",
        "--input-json",
        JSON.stringify({ project_id: 87, abbreviation: "D4" }),
      ],
      configRoot,
    );
    assert.equal(result.exitCode, 0, `${result.stderr}\n${result.stdout}`);
    assert.equal(result.stderr, "");
    const envelope = JSON.parse(result.stdout) as Record<string, unknown>;
    assert.equal(envelope.command, "submission.status");
    assert.equal(envelope.status, "success");
    assert.deepEqual(envelope.data, {
      project_id: 87,
      unit_id: 55,
      unit_code: "FIT0001",
      task_definition_id: 501,
      task_instance_id: null,
      abbreviation: "D4",
      instantiated: false,
      has_pdf: true,
      processing_pdf: false,
      pdf_state: "ready",
      submission_date: "2030-01-01T00:00:00.000Z",
      task_status: "working",
      submission_observed: true,
    });

    const compatibility = await runCli(
      [
        "submission",
        "status",
        "--input-json",
        JSON.stringify({ project_id: 87, task_definition_id: 501 }),
        "--output",
        "agent-json",
      ],
      configRoot,
    );
    assert.equal(compatibility.exitCode, 0, compatibility.stderr);
    assert.equal(compatibility.stderr, "");
    const compatibilityEnvelope = JSON.parse(compatibility.stdout) as Record<string, unknown>;
    assert.equal(compatibilityEnvelope.command, "submission.status");
    assert.deepEqual(compatibilityEnvelope.data, envelope.data);

    unitCode = "x".repeat(81);
    const oversizedCompatibility = await runCli(
      [
        "submission",
        "status",
        "--input-json",
        JSON.stringify({ project_id: 87, task_definition_id: 501 }),
        "--output",
        "agent-json",
      ],
      configRoot,
    );
    assert.equal(oversizedCompatibility.exitCode, 10);
    assert.equal(oversizedCompatibility.stderr, "");
    const oversizedEnvelope = JSON.parse(oversizedCompatibility.stdout) as Record<
      string,
      unknown
    >;
    assert.equal(
      (oversizedEnvelope.error as Record<string, unknown>).code,
      "INTERNAL_ERROR",
    );
    assert.equal(oversizedCompatibility.stdout.includes("x".repeat(81)), false);
  } finally {
    server.close();
    await rm(configRoot, { recursive: true, force: true });
  }
});

test("native submission.status fails closed on malformed remote contract rows", async () => {
  const configRoot = await mkdtemp(join(tmpdir(), "ontrack-agent-submission-status-malformed-"));
  const malformedPayloads: unknown[] = [
    [],
    {},
    { has_pdf: "true", processing_pdf: false },
    { has_pdf: true, hasPdf: false, processing_pdf: false },
    { has_pdf: false, processing_pdf: false, task_status: "bad\nstatus" },
  ];
  let statusRequestCount = 0;
  let includeTaskDefinition = true;
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/projects") {
      response.end(JSON.stringify([{ id: 87, unit_id: 55 }]));
      return;
    }
    if (request.url === "/api/projects/87") {
      response.end(JSON.stringify({ id: 87, unit_id: 55, tasks: [] }));
      return;
    }
    if (request.url === "/api/units/55") {
      response.end(JSON.stringify({
        id: 55,
        task_definitions: includeTaskDefinition
          ? [{ id: 501, abbreviation: "D4", name: "Design task" }]
          : [],
      }));
      return;
    }
    if (request.url === "/api/projects/87/task_def_id/501/submission_details") {
      response.end(JSON.stringify(malformedPayloads[statusRequestCount]));
      statusRequestCount += 1;
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
      }),
      "utf8",
    );

    for (const _payload of malformedPayloads) {
      const result = await runCli(
        [
          "agent",
          "call",
          "submission.status",
          "--input-json",
          JSON.stringify({ project_id: 87, abbreviation: "D4" }),
        ],
        configRoot,
      );
      assert.equal(result.exitCode, 7);
      assert.equal(result.stderr, "");
      const envelope = JSON.parse(result.stdout) as Record<string, unknown>;
      assert.equal((envelope.error as Record<string, unknown>).code, "REMOTE_UNAVAILABLE");
      assert.equal(JSON.stringify(envelope.error).includes("bad"), false);
      assert.equal(JSON.stringify(envelope.data ?? null).includes("bad"), false);
    }

    includeTaskDefinition = false;
    const emptyProject = await runCli(
      [
        "agent",
        "call",
        "submission.status",
        "--input-json",
        JSON.stringify({ project_id: 87, abbreviation: "D4" }),
      ],
      configRoot,
    );
    assert.equal(emptyProject.exitCode, 5);
    assert.equal(emptyProject.stderr, "");
    const emptyEnvelope = JSON.parse(emptyProject.stdout) as Record<string, unknown>;
    assert.equal(
      (emptyEnvelope.error as Record<string, unknown>).code,
      "NOT_FOUND",
    );
  } finally {
    server.close();
    await rm(configRoot, { recursive: true, force: true });
  }
});

test("agent call task.resources downloads definition resources for an uninstantiated task", async () => {
  const configRoot = await mkdtemp(join(tmpdir(), "ontrack-agent-call-task-resources-"));
  const outputRoot = await mkdtemp(join(tmpdir(), "ontrack-agent-task-resources-output-"));
  const server = createServer((request, response) => {
    assert.equal(request.headers["auth-token"], "fixture-token");
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/projects") {
      response.end(JSON.stringify([{ id: 87, unit_id: 55 }]));
      return;
    }
    if (request.url === "/api/projects/87") {
      response.end(JSON.stringify({ id: 87, unit_id: 55, tasks: [] }));
      return;
    }
    if (request.url === "/api/units/55") {
      response.end(JSON.stringify({
        id: 55,
        code: "FIT0001",
        task_definitions: [{ id: 501, abbreviation: "D4", name: "Design task" }],
      }));
      return;
    }
    if (request.url === "/api/units/55/task_definitions/501/task_resources.json?as_attachment=true") {
      response.setHeader("content-type", "application/zip");
      response.setHeader(
        "content-disposition",
        "attachment; filename=FIT0001-D4-TaskResources.zip",
      );
      response.end(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
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
        "task.resources",
        "--input-json",
        JSON.stringify({
          project_id: 87,
          abbreviation: ["D4"],
          out_dir: outputRoot,
          allow_external_dir: true,
        }),
      ],
      configRoot,
    );
    assert.equal(result.exitCode, 0, `${result.stderr}\n${result.stdout}`);
    assert.equal(result.stderr, "");
    const envelope = JSON.parse(result.stdout) as Record<string, unknown>;
    assert.equal(envelope.command, "task.resources");
    assert.equal(envelope.status, "success");
    const data = envelope.data as Record<string, unknown>;
    assert.equal(data.project_id, 87);
    assert.equal(data.selected_count, 1);
    assert.deepEqual(data.unavailable, []);
    const downloads = data.downloads as Array<Record<string, unknown>>;
    assert.equal(downloads.length, 1);
    assert.equal(downloads[0].task_definition_id, 501);
    assert.equal(downloads[0].instantiated, false);
    const artifact = downloads[0].artifact as Record<string, unknown>;
    assert.equal(artifact.filename, "FIT0001-D4-TaskResources.zip");
    assert.equal(artifact.bytes, 4);
    assert.match(String(artifact.sha256), /^[a-f0-9]{64}$/u);
    const outputPath = join(outputRoot, "FIT0001-D4-TaskResources.zip");
    assert.equal(await stat(outputPath).then(() => true), true);
    assert.deepEqual([...await readFile(outputPath)], [0x50, 0x4b, 0x03, 0x04]);
    assert.equal(result.stdout.includes("fixture-token"), false);
    assert.equal(result.stdout.includes(configRoot), false);
  } finally {
    server.close();
    await rm(configRoot, { recursive: true, force: true });
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("agent call pdf.task downloads one definition-first task sheet with artifact metadata", async () => {
  const configRoot = await mkdtemp(join(tmpdir(), "ontrack-agent-call-task-pdf-"));
  const outputRoot = await mkdtemp(join(tmpdir(), "ontrack-agent-task-pdf-output-"));
  const legacyOutputRoot = await mkdtemp(join(tmpdir(), "ontrack-legacy-task-pdf-output-"));
  const pdfBytes = Buffer.from("%PDF-1.7\nfixture task sheet\n", "ascii");
  let pdfResponse = pdfBytes;
  let pdfContentType = "application/octet-stream";
  let pdfContentDisposition = "attachment; filename=FIT0001_D4_task.pdf";
  const server = createServer((request, response) => {
    assert.equal(request.headers["auth-token"], "fixture-token");
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/projects") {
      response.end(JSON.stringify([{ id: 87, unit_id: 55 }]));
      return;
    }
    if (request.url === "/api/projects/87") {
      response.end(JSON.stringify({ id: 87, unit_id: 55, tasks: [] }));
      return;
    }
    if (request.url === "/api/units/55") {
      response.end(JSON.stringify({
        id: 55,
        code: "FIT0001",
        task_definitions: [{ id: 501, abbreviation: "D4", name: "Design task" }],
      }));
      return;
    }
    if (request.url === "/api/units/55/task_definitions/501/task_pdf.json?as_attachment=true") {
      response.setHeader("content-type", pdfContentType);
      response.setHeader("content-disposition", pdfContentDisposition);
      response.end(pdfResponse);
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
        "pdf.task",
        "--input-json",
        JSON.stringify({
          project_id: 87,
          abbreviation: "D4",
          out_dir: outputRoot,
          allow_external_dir: true,
        }),
      ],
      configRoot,
    );
    assert.equal(result.exitCode, 0, `${result.stderr}\n${result.stdout}`);
    assert.equal(result.stderr, "");
    const envelope = JSON.parse(result.stdout) as Record<string, unknown>;
    assert.equal(envelope.command, "pdf.task");
    assert.equal(envelope.status, "success");
    const data = envelope.data as Record<string, unknown>;
    assert.deepEqual(
      {
        project_id: data.project_id,
        unit_id: data.unit_id,
        unit_code: data.unit_code,
        task_definition_id: data.task_definition_id,
        task_instance_id: data.task_instance_id,
        abbreviation: data.abbreviation,
        instantiated: data.instantiated,
      },
      {
        project_id: 87,
        unit_id: 55,
        unit_code: "FIT0001",
        task_definition_id: 501,
        task_instance_id: null,
        abbreviation: "D4",
        instantiated: false,
      },
    );
    const artifact = data.artifact as Record<string, unknown>;
    assert.equal(artifact.filename, "FIT0001_D4_task.pdf");
    assert.equal(artifact.bytes, pdfBytes.byteLength);
    assert.equal(artifact.content_type, "application/octet-stream");
    assert.match(String(artifact.sha256), /^[a-f0-9]{64}$/u);
    const outputPath = join(outputRoot, "FIT0001_D4_task.pdf");
    assert.equal(await stat(outputPath).then(() => true), true);
    assert.deepEqual(await readFile(outputPath), pdfBytes);
    assert.equal(result.stdout.includes("fixture-token"), false);
    assert.equal(result.stdout.includes(configRoot), false);

    pdfResponse = Buffer.from("<html>not a PDF</html>", "ascii");
    const invalidPdf = await runCli(
      [
        "agent",
        "call",
        "pdf.task",
        "--input-json",
        JSON.stringify({
          project_id: 87,
          task_definition_id: 501,
          out_dir: outputRoot,
          allow_external_dir: true,
        }),
      ],
      configRoot,
    );
    assert.equal(invalidPdf.exitCode, 7, invalidPdf.stderr);
    assert.equal(
      (JSON.parse(invalidPdf.stdout).error as Record<string, unknown>).code,
      "REMOTE_UNAVAILABLE",
    );
    assert.deepEqual(await readFile(outputPath), pdfBytes);

    pdfResponse = Buffer.alloc(MAX_DOWNLOAD_BYTES + 1, 0x20);
    const oversizedPdf = await runCli(
      [
        "agent",
        "call",
        "pdf.task",
        "--input-json",
        JSON.stringify({ project_id: 87, task_definition_id: 501 }),
      ],
      configRoot,
    );
    assert.equal(oversizedPdf.exitCode, 7, oversizedPdf.stderr);
    assert.equal(
      (JSON.parse(oversizedPdf.stdout).error as Record<string, unknown>).code,
      "REMOTE_UNAVAILABLE",
    );
    assert.deepEqual(await readFile(outputPath), pdfBytes);

    pdfResponse = pdfBytes;
    pdfContentType = "application/pdf";
    pdfContentDisposition = "attachment; filename=FileNotFound.pdf";
    const unavailablePdf = await runCli(
      [
        "agent",
        "call",
        "pdf.task",
        "--input-json",
        JSON.stringify({ project_id: 87, task_definition_id: 501 }),
      ],
      configRoot,
    );
    assert.equal(unavailablePdf.exitCode, 5, unavailablePdf.stderr);
    assert.equal(
      (JSON.parse(unavailablePdf.stdout).error as Record<string, unknown>).code,
      "NOT_FOUND",
    );
    assert.deepEqual(await readFile(outputPath), pdfBytes);

    const legacyPdf = await runCli(
      [
        "pdf",
        "task",
        "--project-id",
        "87",
        "--task-definition-id",
        "501",
        "--out-dir",
        legacyOutputRoot,
        "--allow-external-dir",
        "--json",
      ],
      configRoot,
    );
    assert.equal(legacyPdf.exitCode, 0, legacyPdf.stderr);
    const legacyOutput = JSON.parse(legacyPdf.stdout) as Record<string, unknown>;
    assert.equal(legacyOutput.taskDefinitionId, 501);
    assert.deepEqual(
      await readFile(join(legacyOutputRoot, "FIT0001_D4_task.pdf")),
      pdfBytes,
    );

  } finally {
    server.close();
    await rm(configRoot, { recursive: true, force: true });
    await rm(outputRoot, { recursive: true, force: true });
    await rm(legacyOutputRoot, { recursive: true, force: true });
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
      [
        "auth.status",
        "projects.list",
        "unit.show",
        "tutorials.status",
        "tasks.list",
        "task.show",
        "task.prerequisites",
        "feedback.list",
        "task.resources",
        "pdf.task",
        "plan.show",
        "submission.status",
      ],
    );

    const projects = await runCli(
      ["agent", "describe", "projects.list"],
      configRoot,
    );
    assert.equal(projects.exitCode, 0, projects.stderr);
    const projectData = JSON.parse(projects.stdout).data as Record<string, unknown>;
    assert.deepEqual(projectData.input_schema, {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {},
      additionalProperties: false,
    });
    assert.match(JSON.stringify(projectData.output_schema), /portfolio_available/);
    assert.equal(JSON.stringify(projectData.output_schema).includes("user_id"), false);

    const unit = await runCli(
      ["agent", "describe", "unit.show"],
      configRoot,
    );
    assert.equal(unit.exitCode, 0, unit.stderr);
    const unitData = JSON.parse(unit.stdout).data as Record<string, unknown>;
    assert.deepEqual(
      (unitData.input_schema as Record<string, unknown>).required,
      ["project_id"],
    );
    assert.match(JSON.stringify(unitData.output_schema), /task_definition_count/);
    assert.equal(JSON.stringify(unitData.output_schema).includes("staff"), false);

    const tutorials = await runCli(
      ["agent", "describe", "tutorials.status"],
      configRoot,
    );
    assert.equal(tutorials.exitCode, 0, tutorials.stderr);
    const tutorialsData = JSON.parse(tutorials.stdout).data as Record<string, unknown>;
    assert.deepEqual(
      (tutorialsData.input_schema as Record<string, unknown>).required,
      ["project_id"],
    );
    assert.match(JSON.stringify(tutorialsData.output_schema), /available_streams/);
    const tutorialProperties = (
      tutorialsData.output_schema as Record<string, unknown>
    ).properties as Record<string, unknown>;
    assert.equal(Object.hasOwn(tutorialProperties, "tutor"), false);
    assert.equal(Object.hasOwn(tutorialProperties, "room"), false);
    assert.equal(Object.hasOwn(tutorialProperties, "students"), false);

    const taskDirectory = await runCli(
      ["agent", "describe", "tasks.list"],
      configRoot,
    );
    assert.equal(taskDirectory.exitCode, 0, taskDirectory.stderr);
    const taskDirectoryData = JSON.parse(taskDirectory.stdout).data as Record<
      string,
      unknown
    >;
    assert.deepEqual(
      (taskDirectoryData.input_schema as Record<string, unknown>).required,
      ["project_id"],
    );
    assert.match(
      JSON.stringify(taskDirectoryData.output_schema),
      /task_definition_id/,
    );
    assert.equal(
      JSON.stringify(taskDirectoryData.output_schema).includes("task_id"),
      false,
    );

    const feedback = await runCli(
      ["agent", "describe", "feedback.list"],
      configRoot,
    );
    assert.equal(feedback.exitCode, 0, feedback.stderr);
    const feedbackData = JSON.parse(feedback.stdout).data as Record<string, unknown>;
    assert.equal(feedbackData.path, "feedback.list");
    assert.match(JSON.stringify(feedbackData.input_schema), /task_definition_id/);
    assert.match(JSON.stringify(feedbackData.output_schema), /feedback_id/);
    assert.equal(JSON.stringify(feedbackData.output_schema).includes("author"), false);
    assert.equal(JSON.stringify(feedbackData.output_schema).includes("recipient"), false);

    const taskPdf = await runCli(
      ["agent", "describe", "pdf.task"],
      configRoot,
    );
    assert.equal(taskPdf.exitCode, 0, taskPdf.stderr);
    const taskPdfData = JSON.parse(taskPdf.stdout).data as Record<string, unknown>;
    assert.equal(taskPdfData.path, "pdf.task");
    assert.match(JSON.stringify(taskPdfData.input_schema), /task_definition_id/);
    assert.equal(JSON.stringify(taskPdfData.input_schema).includes("all_tasks"), false);
    assert.match(JSON.stringify(taskPdfData.output_schema), /sha256/);
    assert.equal(JSON.stringify(taskPdfData.output_schema).includes("task_id"), false);

    const invalidPdfInput = await runCli(
      [
        "agent",
        "call",
        "pdf.task",
        "--input-json",
        JSON.stringify({ project_id: 87, all_tasks: true }),
      ],
      configRoot,
    );
    assert.equal(invalidPdfInput.exitCode, 2);
    assert.equal(
      (JSON.parse(invalidPdfInput.stdout).error as Record<string, unknown>).code,
      "INVALID_ARGUMENT",
    );

    const conflictingPdfInput = await runCli(
      [
        "agent",
        "call",
        "pdf.task",
        "--input-json",
        JSON.stringify({ project_id: 87, task_definition_id: 501, abbreviation: "D4" }),
      ],
      configRoot,
    );
    assert.equal(conflictingPdfInput.exitCode, 2);
    assert.equal(
      (JSON.parse(conflictingPdfInput.stdout).error as Record<string, unknown>).code,
      "INVALID_ARGUMENT",
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

    const resources = await runCli(
      ["agent", "describe", "task.resources"],
      configRoot,
    );
    assert.equal(resources.exitCode, 0, resources.stderr);
    const resourceData = (JSON.parse(resources.stdout).data ?? {}) as Record<
      string,
      unknown
    >;
    const resourceInput = resourceData.input_schema as Record<string, unknown>;
    const resourceSelectors = resourceInput.anyOf as Array<Record<string, unknown>>;
    assert.equal(resourceSelectors.length, 3);
    assert.equal(
      resourceSelectors.some((schema) =>
        (schema.required as string[] | undefined)?.includes("task_definition_id"),
      ),
      true,
    );
    assert.equal(
      resourceSelectors.some((schema) =>
        (schema.required as string[] | undefined)?.includes("abbreviation"),
      ),
      true,
    );
    assert.equal(JSON.stringify(resourceInput).includes("all_tasks"), true);

    const prerequisites = await runCli(
      ["agent", "describe", "task.prerequisites"],
      configRoot,
    );
    assert.equal(prerequisites.exitCode, 0, prerequisites.stderr);
    const prerequisiteInput = (JSON.parse(prerequisites.stdout).data as Record<string, unknown>)
      .input_schema as Record<string, unknown>;
    assert.equal((prerequisiteInput.anyOf as Array<unknown>).length, 2);
    assert.match(JSON.stringify(prerequisiteInput), /task_definition_id/);

    const submission = await runCli(
      ["agent", "describe", "submission.status"],
      configRoot,
    );
    assert.equal(submission.exitCode, 0, submission.stderr);
    const submissionData = JSON.parse(submission.stdout).data as Record<string, unknown>;
    const submissionInput = submissionData.input_schema as Record<string, unknown>;
    const submissionOutput = submissionData.output_schema as Record<string, unknown>;
    assert.equal((submissionInput.anyOf as Array<unknown>).length, 2);
    assert.match(JSON.stringify(submissionInput), /\\S/);
    assert.match(JSON.stringify(submissionOutput), /submission_observed/);

    const plan = await runCli(
      ["agent", "describe", "plan.show"],
      configRoot,
    );
    assert.equal(plan.exitCode, 0, plan.stderr);
    const planData = JSON.parse(plan.stdout).data as Record<string, unknown>;
    assert.equal(planData.path, "plan.show");
    assert.deepEqual(planData.policy, {
      risk: "read",
      auth: "ensure",
      interaction: "never",
      confirmation: "none",
      idempotency: "not_applicable",
      streaming: false,
    });
    assert.match(JSON.stringify(planData.input_schema), /include_beyond_target/);
    assert.match(JSON.stringify(planData.output_schema), /feedback_deadline/);

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

test('native and compatibility feedback.list share a bounded, person-free feedback projection', async () => {
  const configRoot = await mkdtemp(join(tmpdir(), 'ontrack-agent-feedback-list-'));
  const sensitiveMarker = 'marker-private@example.invalid';
  const server = createServer((request, response) => {
    assert.equal(request.headers['auth-token'], 'fixture-token');
    const payload =
      request.url === '/api/projects'
        ? [{ id: 1001, unit_id: 2001 }]
        : request.url === '/api/projects/1001'
        ? {
            id: 1001,
            unit_id: 2001,
            target_grade: 1,
            tasks: [{ id: 9001, task_definition_id: 3001, status: 'ready_for_feedback' }],
          }
        : request.url === '/api/units/2001'
          ? {
              id: 2001,
              code: 'FIT0001',
              task_definitions: [
                { id: 3001, abbreviation: 'D4', name: 'Design reflection', target_grade: 1 },
              ],
            }
          : request.url === '/api/projects/1001/task_def_id/3001/comments'
            ? [
                {
                  id: 7001,
                  type: 'comment',
                  comment: 'Clear reasoning. Explain the trade-off in section 2.',
                  created_at: '2026-08-04T10:00:00.000Z',
                  is_new: true,
                  author: { email: sensitiveMarker },
                  recipient: { email: 'student-private@example.invalid' },
                  attachments: [{ url: 'https://private.example.invalid/feedback.pdf' }],
                },
              ]
            : undefined;
    if (payload === undefined) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(payload));
  });
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const sessionDir = join(configRoot, 'ontrack-cli');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, 'session.json'),
      JSON.stringify({
        baseUrl: `http://127.0.0.1:${address.port}/api`,
        username: 'fixture-user',
        authToken: 'fixture-token',
        user: { id: 1, username: 'fixture-user', role: 'student' },
        savedAt: '2026-07-31T00:00:00.000Z',
        expiresAt: '2099-01-01T00:00:00.000Z',
        source: 'access-token',
      }),
      'utf8',
    );

    const legacy = await runCli(
      [
        'feedback',
        'list',
        '--project-id',
        '1001',
        '--task-definition-id',
        '3001',
        '--json',
      ],
      configRoot,
    );
    assert.equal(legacy.exitCode, 0, legacy.stderr);
    assert.equal(JSON.parse(legacy.stdout)[0]?.author?.email, sensitiveMarker);

    const compatibility = await runCli(
      [
        'feedback',
        'list',
        '--project-id',
        '1001',
        '--task-definition-id',
        '3001',
        '--output',
        'agent-json',
      ],
      configRoot,
    );
    assert.equal(compatibility.exitCode, 0, compatibility.stderr);
    const compatibilityEnvelope = JSON.parse(compatibility.stdout) as Record<string, unknown>;
    assert.equal(compatibilityEnvelope.command, 'feedback.list');
    assert.deepEqual(compatibilityEnvelope.data, {
      project_id: 1001,
      unit_id: 2001,
      unit_code: 'FIT0001',
      task_definition_id: 3001,
      task_instance_id: 9001,
      abbreviation: 'D4',
      instantiated: true,
      count: 1,
      feedback: [
        {
          feedback_id: 7001,
          kind: 'comment',
          text: 'Clear reasoning. Explain the trade-off in section 2.',
          created_at: '2026-08-04T10:00:00.000Z',
          updated_at: null,
          is_new: true,
        },
      ],
    });
    assert.equal(compatibility.stdout.includes(sensitiveMarker), false);
    assert.equal(compatibility.stdout.includes('private.example.invalid'), false);

    const legacySelector = await runCli(
      [
        'feedback',
        'list',
        '--project-id',
        '1001',
        '--task-id',
        '9001',
        '--json',
      ],
      configRoot,
    );
    assert.equal(legacySelector.exitCode, 0, legacySelector.stderr);
    assert.equal(JSON.parse(legacySelector.stdout)[0]?.author?.email, sensitiveMarker);

    const conflictingSelector = await runCli(
      [
        'feedback',
        'list',
        '--project-id',
        '1001',
        '--task-definition-id',
        '3001',
        '--abbr',
        'other-task',
        '--output',
        'agent-json',
      ],
      configRoot,
    );
    assert.equal(conflictingSelector.exitCode, 2, conflictingSelector.stderr);
    assert.equal(
      ((JSON.parse(conflictingSelector.stdout) as Record<string, unknown>).error as Record<
        string,
        unknown
      >).code,
      'INVALID_ARGUMENT',
    );

    const native = await runCli(
      [
        'agent',
        'call',
        'feedback.list',
        '--input-json',
        '{"project_id":1001,"task_definition_id":3001}',
      ],
      configRoot,
    );
    assert.equal(native.exitCode, 0, `${native.stderr}\n${native.stdout}`);
    assert.equal(native.stderr, '');
    const nativeEnvelope = JSON.parse(native.stdout) as Record<string, unknown>;
    assert.equal(nativeEnvelope.command, 'feedback.list');
    assert.deepEqual(nativeEnvelope.data, compatibilityEnvelope.data);
  } finally {
    server.close();
    await rm(configRoot, { recursive: true, force: true });
  }
});

test('feedback.list rejects unscoped and batch Agent selectors before authentication', async () => {
  const configRoot = await mkdtemp(join(tmpdir(), 'ontrack-agent-feedback-input-'));
  try {
    const invocations = [
      ['agent', 'call', 'feedback.list', '--input-json', '{"project_id":1001}'],
      [
        'agent',
        'call',
        'feedback.list',
        '--input-json',
        '{"project_id":1001,"abbreviation":"D4,D5"}',
      ],
      [
        'feedback',
        'list',
        '--project-id',
        '1001',
        '--all-tasks',
        '--output',
        'agent-json',
      ],
      [
        'feedback',
        'list',
        '--project-id',
        '1001',
        '--abbr',
        ',',
        '--output',
        'agent-json',
      ],
      [
        'feedback',
        'list',
        '--project-id',
        '1001',
        '--task-id',
        '9001',
        '--output',
        'agent-json',
      ],
      [
        'feedback',
        'list',
        '--project-id',
        '1001',
        '--abbr',
        'D4,D5',
        '--output',
        'agent-json',
      ],
    ];
    for (const args of invocations) {
      const result = await runCli(args, configRoot);
      assert.equal(result.exitCode, 2, `${args.join(' ')}\n${result.stdout}`);
      assert.equal(result.stderr, '');
      const envelope = JSON.parse(result.stdout) as Record<string, unknown>;
      assert.equal(envelope.command, 'feedback.list');
      assert.equal((envelope.error as Record<string, unknown>).code, 'INVALID_ARGUMENT');
    }
  } finally {
    await rm(configRoot, { recursive: true, force: true });
  }
});

test("Agent streaming watch frames preserve Plan Date kinds and remove feedback people", async () => {
  const configRoot = await mkdtemp(
    join(tmpdir(), "ontrack-agent-stream-watch-"),
  );
  const privateMarker = "marker-private@example.invalid";
  const server = createServer((request, response) => {
    assert.equal(request.headers["auth-token"], "fixture-token");
    const payload =
      request.url === "/api/projects"
        ? [{ id: 1001, unit_id: 2001 }]
        : request.url === "/api/projects/1001"
          ? {
              id: 1001,
              unit_id: 2001,
              target_grade: 1,
              tasks: [
                {
                  id: 9001,
                  task_definition_id: 3001,
                  status: "working_on_it",
                  target_start_date: "2026-08-10",
                  target_due_date: "2026-08-20",
                },
              ],
            }
          : request.url === "/api/units/2001"
            ? {
                id: 2001,
                code: "FIT0001",
                allow_flexible_dates: true,
                task_definitions: [
                  {
                    id: 3001,
                    abbreviation: "D4",
                    name: "Design reflection",
                    target_grade: 1,
                    start_date: "2026-08-01",
                    target_date: "2026-08-15",
                    due_date: "2026-08-25",
                  },
                ],
              }
            : request.url === "/api/projects/1001/task_def_id/3001/comments"
              ? [
                  {
                    id: 7001,
                    type: "comment",
                    comment: "Review the evidence in section two.",
                    created_at: "2026-08-01T10:00:00.000Z",
                    author: { email: privateMarker },
                    recipient: { email: "student-private@example.invalid" },
                  },
                ]
              : undefined;
    if (payload === undefined) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(payload));
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
        savedAt: "2026-08-01T00:00:00.000Z",
        expiresAt: "2099-01-01T00:00:00.000Z",
        source: "access-token",
      }),
      "utf8",
    );

    const watch = await runStreamingCliUntilFirstFrame(
      [
        "watch",
        "--project-id",
        "1001",
        "--interval",
        "1",
        "--output",
        "agent-json",
      ],
      configRoot,
    );
    assert.equal(watch.stderr, "");
    assert.equal(watch.stdout.trim().split("\n").length, 1);
    const watchEnvelope = JSON.parse(
      watch.stdout.split("\n")[0] ?? "",
    ) as Record<string, unknown>;
    assert.equal(watchEnvelope.command, "watch");
    const watchData = watchEnvelope.data as Record<string, unknown>;
    const task = (watchData.tasks as Array<Record<string, unknown>>)[0] ?? {};
    assert.deepEqual(task.start, {
      kind: "start",
      value: "2026-08-10",
      source: "personal",
      editable: true,
      interpretation: "unit_local_calendar_date",
    });
    assert.deepEqual(task.target, {
      kind: "target",
      value: "2026-08-20",
      source: "personal",
      editable: true,
      interpretation: "unit_local_calendar_date",
    });
    assert.deepEqual(task.feedback_deadline, {
      kind: "feedback_deadline",
      value: "2026-08-25",
      source: "unit_default",
      editable: false,
      interpretation: "unit_local_calendar_date",
    });

    const legacyWatch = await runStreamingCliUntilFirstFrame(
      ["watch", "--project-id", "1001", "--interval", "1", "--json"],
      configRoot,
    );
    assert.equal(legacyWatch.stderr, "");
    const legacyWatchFrame = JSON.parse(
      legacyWatch.stdout.split("\n")[0] ?? "",
    ) as Record<string, unknown>;
    assert.equal(legacyWatchFrame.type, "baseline");
    assert.equal("schema_version" in legacyWatchFrame, false);
    assert.equal(legacyWatchFrame.intervalSec, 1);
    assert.equal(Array.isArray(legacyWatchFrame.tasks), true);

    const feedback = await runStreamingCliUntilFirstFrame(
      [
        "feedback",
        "watch",
        "--project-id",
        "1001",
        "--task-definition-id",
        "3001",
        "--history",
        "1",
        "--interval",
        "1",
        "--output",
        "agent-json",
      ],
      configRoot,
    );
    assert.equal(feedback.stderr, "");
    assert.equal(feedback.stdout.trim().split("\n").length, 1);
    assert.equal(feedback.stdout.includes(privateMarker), false);
    const feedbackEnvelope = JSON.parse(
      feedback.stdout.split("\n")[0] ?? "",
    ) as Record<string, unknown>;
    assert.equal(feedbackEnvelope.command, "feedback.watch");
    assert.deepEqual(
      (feedbackEnvelope.data as Record<string, unknown>).feedback,
      [
        {
          feedback_id: 7001,
          kind: "comment",
          text: "Review the evidence in section two.",
          created_at: "2026-08-01T10:00:00.000Z",
          updated_at: null,
          is_new: null,
        },
      ],
    );

    const legacyFeedback = await runStreamingCliUntilFirstFrame(
      [
        "feedback",
        "watch",
        "--project-id",
        "1001",
        "--task-definition-id",
        "3001",
        "--history",
        "1",
        "--interval",
        "1",
        "--json",
      ],
      configRoot,
    );
    assert.equal(legacyFeedback.stderr, "");
    const legacyFeedbackFrame = JSON.parse(
      legacyFeedback.stdout.split("\n")[0] ?? "",
    ) as Record<string, unknown>;
    assert.equal(legacyFeedbackFrame.type, "baseline");
    assert.equal("schema_version" in legacyFeedbackFrame, false);
    assert.equal(legacyFeedbackFrame.intervalSec, 1);
    assert.equal(Array.isArray(legacyFeedbackFrame.comments), true);
  } finally {
    server.close();
    await rm(configRoot, { recursive: true, force: true });
  }
});

test("streaming Agent commands reject malformed input before authentication", async () => {
  const configRoot = await mkdtemp(
    join(tmpdir(), "ontrack-agent-stream-input-"),
  );
  try {
    const invocations = [
      {
        args: [
          "feedback",
          "watch",
          "--project-id",
          "1001",
          "--output",
          "agent-json",
        ],
        command: "feedback.watch",
      },
      {
        args: [
          "feedback",
          "watch",
          "--project-id",
          "1001",
          "--abbr",
          ",",
          "--output",
          "agent-json",
        ],
        command: "feedback.watch",
      },
      {
        args: ["watch", "--project-id", "0", "--output", "agent-json"],
        command: "watch",
      },
      {
        args: ["watch", "--interval", "0", "--output", "agent-json"],
        command: "watch",
      },
    ];
    for (const invocation of invocations) {
      const result = await runCli(invocation.args, configRoot);
      assert.equal(
        result.exitCode,
        2,
        `${invocation.args.join(" ")}\n${result.stdout}`,
      );
      assert.equal(result.stderr, "");
      const envelope = JSON.parse(result.stdout) as Record<string, unknown>;
      assert.equal(envelope.command, invocation.command);
      assert.equal(
        (envelope.error as Record<string, unknown>).code,
        "INVALID_ARGUMENT",
      );
    }
  } finally {
    await rm(configRoot, { recursive: true, force: true });
  }
});
