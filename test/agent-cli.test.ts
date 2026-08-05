import { test } from "bun:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
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
        "task.show",
        "task.prerequisites",
        "task.resources",
        "plan.show",
        "submission.status",
      ],
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
