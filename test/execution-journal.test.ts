import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "bun:test";
import { AgentProtocolError } from "../src/lib/agent-protocol.js";
import {
  claimExecution,
  updateExecution,
  withExecutionJournalLock,
} from "../src/lib/execution-journal.js";

test("execution journal replays a completed result without exposing credential-shaped data", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "ontrack-execution-"));
  const input = { project_id: 101, target: "2026-08-10" };
  try {
    const claim = await claimExecution(
      "planner:101:P1:2026-08-10",
      "plan.set_dates",
      input,
      { rootPath },
    );
    assert.equal(claim.replayed, false);
    await updateExecution(
      claim,
      "plan.set_dates",
      input,
      "succeeded",
      { verified: true, authToken: "must-not-be-persisted" },
      { rootPath },
    );

    const replay = await claimExecution(
      "planner:101:P1:2026-08-10",
      "plan.set_dates",
      input,
      { rootPath },
    );
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.result, { verified: true });
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("execution journal rejects key reuse with different input and guards unknown outcomes", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "ontrack-execution-"));
  try {
    const claim = await claimExecution(
      "submission-101-P1",
      "submission.upload",
      { digest: "aaa" },
      { rootPath },
    );
    await assert.rejects(
      () =>
        claimExecution(
          "submission-101-P1",
          "submission.upload",
          { digest: "bbb" },
          { rootPath },
        ),
      (error: unknown) =>
        error instanceof AgentProtocolError && error.code === "CONFLICT",
    );
    await updateExecution(
      claim,
      "submission.upload",
      { digest: "aaa" },
      "outcome_unknown",
      undefined,
      { rootPath },
    );
    await assert.rejects(
      () =>
        claimExecution(
          "submission-101-P1",
          "submission.upload",
          { digest: "aaa" },
          { rootPath },
        ),
      (error: unknown) =>
        error instanceof AgentProtocolError &&
        error.code === "IDEMPOTENCY_OUTCOME_UNKNOWN",
    );
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("execution journal fails closed for corrupt records and unverifiable locks", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "ontrack-execution-"));
  try {
    const key = "corrupt-record";
    const digest = new Bun.CryptoHasher("sha256").update(key).digest("hex");
    await writeFile(join(rootPath, `${digest}.json`), "{invalid", "utf8");
    await assert.rejects(
      () =>
        claimExecution(key, "plan.reset", { project_id: 101 }, { rootPath }),
      (error: unknown) =>
        error instanceof AgentProtocolError &&
        error.code === "IDEMPOTENCY_OUTCOME_UNKNOWN",
    );

    const staleKey = "stale-lock";
    const staleDigest = new Bun.CryptoHasher("sha256")
      .update(staleKey)
      .digest("hex");
    const staleLock = join(rootPath, `${staleDigest}.lock`);
    await mkdir(staleLock);
    await chmod(staleLock, 0o700);
    await Bun.write(join(staleLock, "age"), "");
    await assert.rejects(
      () =>
        claimExecution(
          staleKey,
          "plan.reset",
          { project_id: 101 },
          { rootPath },
        ),
      (error: unknown) =>
        error instanceof AgentProtocolError && error.code === "CONFLICT",
    );
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("execution journal never automatically reclaims a recorded dead owner", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "ontrack-execution-"));
  try {
    const key = "dead-owner";
    const digest = new Bun.CryptoHasher("sha256").update(key).digest("hex");
    const path = join(rootPath, `${digest}.lock`);
    await mkdir(path);
    await writeFile(
      join(path, "owner.json"),
      JSON.stringify({ id: "dead-owner", pid: 2_147_483_647 }),
      { encoding: "utf8", mode: 0o600 },
    );

    await assert.rejects(
      () =>
        claimExecution(key, "plan.reset", { project_id: 101 }, { rootPath }),
      (error: unknown) =>
        error instanceof AgentProtocolError && error.code === "CONFLICT",
    );
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("execution journal lock never reclaims a live owner", async () => {
  const rootPath = await mkdtemp(join(tmpdir(), "ontrack-execution-"));
  let active = 0;
  let peak = 0;
  try {
    const first = withExecutionJournalLock(
      "heartbeat-key",
      { rootPath },
      async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 45));
        active -= 1;
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    await assert.rejects(
      () =>
        withExecutionJournalLock("heartbeat-key", { rootPath }, async () => {
          active += 1;
          peak = Math.max(peak, active);
          active -= 1;
        }),
      (error: unknown) =>
        error instanceof AgentProtocolError && error.code === "CONFLICT",
    );
    await first;
    assert.equal(peak, 1);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});
