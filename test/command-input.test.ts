import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  StructuredInputError,
  mergeStructuredCommandInput,
  validateAgentCommandArguments,
} from "../src/lib/command-input.js";
import { getCommandSpec } from "../src/lib/command-spec.js";

const taskShow = getCommandSpec("task.show");

test("structured input maps schema fields to stable CLI flags", async () => {
  const args = await mergeStructuredCommandInput(
    [
      "task",
      "show",
      "--input-json",
      '{"project_id":87,"task_definition_id":501,"all_tasks":false}',
    ],
    taskShow,
  );

  assert.deepEqual(args, [
    "task",
    "show",
    "--project-id",
    "87",
    "--task-definition-id",
    "501",
  ]);
});

test("stdin input is bounded, requires dash, and rejects TTY reads", async () => {
  await assert.rejects(
    mergeStructuredCommandInput(["task", "show", "--input", "-"], taskShow, {
      stdinIsTTY: true,
      readStdin: async () => '{"project_id":87}',
    }),
    /non-interactive stdin/,
  );

  await assert.rejects(
    mergeStructuredCommandInput(
      ["task", "show", "--input", "payload.json"],
      taskShow,
    ),
    /only supports "-"/,
  );
});

test("structured input rejects duplicate explicit flags and unknown fields", async () => {
  await assert.rejects(
    mergeStructuredCommandInput(
      [
        "task",
        "show",
        "--project-id",
        "87",
        "--input-json",
        '{"project_id":88}',
      ],
      taskShow,
    ),
    /provided by both/,
  );

  await assert.rejects(
    mergeStructuredCommandInput(
      ["task", "show", "--input-json", '{"project_id":87,"token":"secret"}'],
      taskShow,
    ),
    (error: unknown) =>
      error instanceof StructuredInputError &&
      error.code === "INVALID_ARGUMENT" &&
      /Unknown structured input field/.test(error.message),
  );
});

test("structured input refuses arrays, prototype keys, and oversized payloads", async () => {
  await assert.rejects(
    mergeStructuredCommandInput(
      ["task", "show", "--input-json", "[]"],
      taskShow,
    ),
    /JSON object/,
  );

  await assert.rejects(
    mergeStructuredCommandInput(
      ["task", "show", "--input-json", '{"constructor":"bad"}'],
      taskShow,
    ),
    /Unsafe structured input field/,
  );

  await assert.rejects(
    mergeStructuredCommandInput(
      [
        "task",
        "show",
        "--input-json",
        `{"project_id":"${"1".repeat(70_000)}"}`,
      ],
      taskShow,
    ),
    /exceeds/,
  );
});

test("direct Agent argv is schema-strict before authentication or business I/O", () => {
  const projectShow = getCommandSpec("project.show");
  assert.doesNotThrow(() =>
    validateAgentCommandArguments(
      [
        "project",
        "show",
        "--project-id",
        "101",
        "--output",
        "agent-json",
        "--json",
      ],
      projectShow,
    ),
  );
  assert.throws(
    () =>
      validateAgentCommandArguments(
        ["project", "show", "--output", "agent-json"],
        projectShow,
      ),
    /Missing required Agent field: project_id/,
  );
  assert.throws(
    () =>
      validateAgentCommandArguments(
        [
          "project",
          "show",
          "--project-id",
          "101",
          "--unknown",
          "--output",
          "agent-json",
        ],
        projectShow,
      ),
    /Unknown Agent flag/,
  );
  assert.throws(
    () =>
      validateAgentCommandArguments(
        ["task", "show", "unexpected", "--output", "agent-json"],
        taskShow,
      ),
    /Unexpected Agent positional argument/,
  );

  const planReset = getCommandSpec("plan.reset");
  assert.throws(
    () =>
      validateAgentCommandArguments(
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
        planReset,
      ),
    /--confirm does not accept a value/,
  );
});
