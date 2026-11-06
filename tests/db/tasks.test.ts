import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { setTimeout } from "node:timers/promises";
import { eq } from "drizzle-orm";
import { assistantTasks, taskAttempts } from "../../src/db/schema.js";
import type { StartTask, TaskExecution } from "../../src/db/tasks.js";
import { taskOutcome } from "../../src/tasks/outcome.js";
import { testDatabase } from "./fixture.js";

const { pool, db, store } = testDatabase();
after(() => pool.end());
const request = (): StartTask => ({
  clerkUserId: `user-${randomUUID()}`,
  platform: "telegram",
  chatId: randomUUID(),
  messageId: randomUUID(),
  runId: randomUUID(),
  runAttempt: 1,
});
const start = async (input: StartTask): Promise<TaskExecution> => {
  const execution = await store.start(input);
  assert.ok(execution);
  return execution;
};
const snapshot = {
  stepCount: 1,
  toolCallCount: 2,
  inputTokens: 100,
  cachedInputTokens: 0,
  outputTokens: 20,
};

test("concurrent starts produce one logical task and one execution", async () => {
  const input = request();
  const attempts = await Promise.all(Array.from({ length: 8 }, () => store.start(input)));
  assert.equal(attempts.filter(Boolean).length, 1);
  assert.equal((await store.list(input.clerkUserId)).length, 1);
  const execution = attempts.find((attempt) => attempt !== null);
  assert.ok(execution);
  assert.equal(
    (await db.select().from(taskAttempts).where(eq(taskAttempts.taskId, execution.taskId))).length,
    1,
  );
});

test("a completion winning the row lock cannot be overwritten by a retry", async () => {
  const input = request();
  const execution = await start(input);
  const blocker = await pool.connect();
  let retry: Promise<TaskExecution | null> | undefined;
  try {
    await blocker.query("begin");
    const {
      rows: [{ pid }],
    } = await blocker.query<{ pid: number }>("select pg_backend_pid() as pid");
    await blocker.query("select id from task_attempts where id = $1 for update", [
      execution.attemptId,
    ]);
    retry = store.start({ ...input, runAttempt: 2 });
    let blocked = false;
    for (let attempt = 0; attempt < 100 && !blocked; attempt++) {
      const { rows } = await pool.query<{ blocked: boolean }>(
        "select exists(select 1 from pg_stat_activity where $1 = any(pg_blocking_pids(pid))) as blocked",
        [pid],
      );
      blocked = rows[0]?.blocked ?? false;
      if (!blocked) await setTimeout(10);
    }
    assert.ok(blocked, "retry must reach the locked attempt before completion commits");
    await blocker.query(
      "update task_attempts set status = 'completed', finish_reason = 'stop', finished_at = now() where id = $1",
      [execution.attemptId],
    );
    await blocker.query("commit");
    assert.equal(await retry, null);
    assert.equal(
      (await store.get(input.clerkUserId, execution.taskId))?.attempt.status,
      "completed",
    );
  } finally {
    await blocker.query("rollback");
    blocker.release();
    await retry;
  }
});

test("customer reads and lifecycle writes are scoped to the owner", async () => {
  const input = request();
  const execution = await start(input);
  const otherUserId = `user-${randomUUID()}`;
  const wrongOwner = { ...execution, clerkUserId: otherUserId };
  assert.equal(await store.get(otherUserId, execution.taskId), null);
  assert.deepEqual(await store.list(otherUserId), []);
  await store.recordUsage(wrongOwner, snapshot);
  await store.recordDelivery(wrongOwner, "accepted");
  await store.finish(wrongOwner, taskOutcome({ stopped: false, finishReason: "stop" }));
  const record = await store.get(input.clerkUserId, execution.taskId);
  assert.equal(record?.attempt.status, "running");
  assert.equal(record?.attempt.stepCount, 0);
  assert.equal(record?.attempt.deliveryStatus, "pending");
  const other = await start({ ...input, clerkUserId: otherUserId });
  assert.notEqual(other.taskId, execution.taskId);
});

test("retries preserve earlier usage and fence out late callbacks", async () => {
  const input = request();
  const first = await start(input);
  await store.recordUsage(first, snapshot);
  const second = await start({ ...input, runAttempt: 2 });
  assert.equal(second.taskId, first.taskId);
  assert.notEqual(second.attemptId, first.attemptId);
  await store.finish(first, taskOutcome({ stopped: false, finishReason: "stop" }));
  await store.recordUsage(first, { ...snapshot, inputTokens: 900, stepCount: 2 });
  await store.recordDelivery(first, "accepted");
  const [previous] = await db
    .select()
    .from(taskAttempts)
    .where(eq(taskAttempts.id, first.attemptId));
  assert.equal(previous?.status, "interrupted");
  assert.equal(previous?.interruptionReason, "worker_restarted");
  assert.equal(previous?.inputTokens, 100);
  assert.equal((await store.get(input.clerkUserId, first.taskId))?.attempt.id, second.attemptId);
  assert.equal(await store.start(input), null);
});

test("only the explicit successor run can recover an interrupted task", async () => {
  const input = request();
  const first = await start(input);
  await store.finish(first, taskOutcome({ stopped: true }));
  assert.equal(await store.start({ ...input, runId: "unrelated-run" }), null);
  const next = await start({ ...input, runId: "successor-run", previousRunId: input.runId });
  assert.equal(next.taskId, first.taskId);
  assert.equal(await store.start({ ...input, runAttempt: 2 }), null);
});

test("terminal records and monotonic usage cannot be overwritten by replays", async () => {
  const input = request();
  const execution = await start(input);
  await store.recordUsage(execution, { ...snapshot, stepCount: 2, inputTokens: 200 });
  await store.recordUsage(execution, snapshot);
  await store.recordDelivery(execution, "accepted");
  await store.recordDelivery(execution, "not_applicable");
  await store.finish(execution, taskOutcome({ stopped: false, finishReason: "stop" }));
  await store.finish(execution, taskOutcome({ stopped: false, finishReason: "error" }));
  assert.equal(await store.start({ ...input, runAttempt: 2 }), null);
  const record = await store.get(input.clerkUserId, execution.taskId);
  assert.equal(record?.attempt.inputTokens, 200);
  assert.equal(record?.attempt.status, "completed");
  assert.equal(record?.attempt.deliveryStatus, "accepted");
});

test("failed delivery stays separate from model success", async () => {
  const input = request();
  const execution = await start(input);
  await store.recordDelivery(execution, "failed");
  await store.finish(execution, taskOutcome({ stopped: false, finishReason: "stop" }));
  const record = await store.get(input.clerkUserId, execution.taskId);
  assert.equal(record?.attempt.status, "completed");
  assert.equal(record?.attempt.deliveryStatus, "failed");
});

test("deadline reconciliation interrupts killed workers without touching live/completed tasks", async () => {
  const expiredInput = request();
  const expired = await start(expiredInput);
  await store.recordUsage(expired, snapshot);
  const live = await start(request());
  await db
    .update(taskAttempts)
    .set({
      startedAt: new Date(Date.now() - 40 * 60_000),
      deadlineAt: new Date(Date.now() - 5 * 60_000),
    })
    .where(eq(taskAttempts.id, expired.attemptId));
  assert.ok((await store.interruptExpired()) >= 1);
  assert.equal(await store.interruptExpired(), 0);
  const record = await store.get(expiredInput.clerkUserId, expired.taskId);
  assert.equal(record?.attempt.status, "interrupted");
  assert.equal(record?.attempt.interruptionReason, "deadline_exceeded");
  assert.equal(record?.attempt.inputTokens, 100);
  assert.equal((await store.get(live.clerkUserId, live.taskId))?.attempt.status, "running");
});

test("database constraints reject invalid states and negative usage", async () => {
  const execution = await start(request());
  await assert.rejects(
    pool.query("update task_attempts set input_tokens = -1 where id = $1", [execution.attemptId]),
  );
  await assert.rejects(
    pool.query("update task_attempts set status = 'completed' where id = $1", [
      execution.attemptId,
    ]),
  );
  await assert.rejects(
    pool.query("update assistant_tasks set platform = 'other' where id = $1", [execution.taskId]),
  );
  await db.delete(assistantTasks).where(eq(assistantTasks.id, execution.taskId));
  assert.deepEqual(
    await db.select().from(taskAttempts).where(eq(taskAttempts.taskId, execution.taskId)),
    [],
  );
});
