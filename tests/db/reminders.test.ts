import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";
import { InactiveExecutionError } from "../../src/db/execution.js";
import { createReminderStore, MAX_ATTEMPTS, RECLAIM_AFTER_MS } from "../../src/db/reminders.js";
import { reminders } from "../../src/db/schema.js";
import type { TaskExecution } from "../../src/db/tasks.js";
import { MAX_SCHEDULED_PER_USER, ReminderError } from "../../src/reminders/domain.js";
import { testDatabase } from "./fixture.js";

const { pool, db, store: tasks } = testDatabase();
const store = createReminderStore(db);
after(() => pool.end());

const NOW = new Date("2026-11-06T18:00:00Z");
const later = (ms: number, from = NOW) => new Date(from.getTime() + ms);

const start = async (clerkUserId = `reminder-user-${randomUUID()}`): Promise<TaskExecution> => {
  const execution = await tasks.start({
    clerkUserId,
    platform: "telegram",
    chatId: randomUUID(),
    messageId: randomUUID(),
    runId: randomUUID(),
    runAttempt: 1,
  });
  assert.ok(execution);
  return execution;
};

const input = (dueAt: Date, message = "Call the dentist") => ({
  platform: "telegram" as const,
  chatId: "555",
  message,
  dueAt,
  timeZone: "America/Chicago",
});

test("scheduling is idempotent per turn, listed by owner only, and cancelable once", async () => {
  const execution = await start();
  const first = await store.schedule(execution, input(later(60 * 60_000)));
  assert.equal(first.created, true);
  const again = await store.schedule(execution, input(later(60 * 60_000)));
  assert.equal(again.created, false);
  assert.equal(again.reminder.id, first.reminder.id);
  // A different message from the same turn is a second reminder
  const second = await store.schedule(execution, input(later(2 * 60 * 60_000), "Buy milk"));
  assert.equal(second.created, true);

  await store.attachRun(execution.clerkUserId, first.reminder.id, "run_abc");
  const listed = await store.list(execution);
  assert.deepEqual(
    listed.map((record) => record.message),
    ["Call the dentist", "Buy milk"],
  );
  const [record] = listed;
  assert.ok(record && !("chatId" in record) && !("clerkUserId" in record));

  const stranger = await start();
  assert.deepEqual(await store.list(stranger), []);
  assert.deepEqual(await store.cancel(stranger, first.reminder.id), { outcome: "not_found" });

  assert.deepEqual(await store.cancel(execution, first.reminder.id), { outcome: "canceled", runId: "run_abc" });
  assert.deepEqual(await store.cancel(execution, first.reminder.id), { outcome: "already_canceled" });
  assert.deepEqual((await store.list(execution)).map((record) => record.message), ["Buy milk"]);
  // A delayed run that fires anyway finds nothing to send
  assert.equal(await store.claim(first.reminder.id, later(2 * 60 * 60_000)), null);
});

test("exactly one sender claims a due reminder, and a dead claim is retried after the window", async () => {
  const execution = await start();
  const { reminder } = await store.schedule(execution, input(later(60_000)));
  assert.equal(await store.claim(reminder.id, NOW), null, "not due yet");

  const due = later(2 * 60_000);
  const claims = await Promise.all(Array.from({ length: 5 }, () => store.claim(reminder.id, due)));
  const won = claims.filter((claim) => claim !== null);
  assert.equal(won.length, 1);
  assert.equal(won[0]?.attempts, 1);
  assert.equal(won[0]?.chatId, "555");
  assert.equal(won[0]?.platform, "telegram");

  // Still inside the reclaim window: the worker may be mid-send
  assert.equal(await store.claim(reminder.id, later(RECLAIM_AFTER_MS - 1000, due)), null);
  const retried = await store.claim(reminder.id, later(RECLAIM_AFTER_MS + 1000, due));
  assert.equal(retried?.attempts, 2);

  await store.markSent(reminder.id, later(RECLAIM_AFTER_MS + 2000, due));
  assert.equal(await store.claim(reminder.id, later(2 * RECLAIM_AFTER_MS, due)), null);
  assert.deepEqual(await store.cancel(execution, reminder.id), { outcome: "already_sent" });
  assert.deepEqual(await store.list(execution), []);
});

test("the sweep sees due unclaimed reminders and retires ones out of attempts", async () => {
  const execution = await start();
  const dueSoon = await store.schedule(execution, input(later(60_000), "Due soon"));
  const notYet = await store.schedule(execution, input(later(60 * 60_000), "Not yet"));
  const exhausted = await store.schedule(execution, input(later(60_000), "Exhausted"));
  await db
    .update(reminders)
    .set({ attempts: MAX_ATTEMPTS, claimedAt: later(-2 * RECLAIM_AFTER_MS) })
    .where(eq(reminders.id, exhausted.reminder.id));

  const sweep = await store.due(later(2 * 60_000));
  assert.ok(sweep.due.includes(dueSoon.reminder.id));
  assert.ok(!sweep.due.includes(notYet.reminder.id));
  assert.ok(!sweep.due.includes(exhausted.reminder.id));
  assert.ok(sweep.failed >= 1);
  const [row] = await db.select().from(reminders).where(eq(reminders.id, exhausted.reminder.id));
  assert.equal(row?.status, "failed");
  assert.deepEqual((await store.list(execution)).map((record) => record.message), ["Due soon", "Not yet"]);
});

test("scheduled reminders are capped per user", async () => {
  const execution = await start();
  for (let index = 0; index < MAX_SCHEDULED_PER_USER; index++) {
    await store.schedule(execution, input(later((index + 2) * 60_000), `Reminder ${index}`));
  }
  await assert.rejects(store.schedule(execution, input(later(60 * 60_000), "One too many")), ReminderError);
  assert.equal((await store.list(execution)).length, MAX_SCHEDULED_PER_USER);
});

test("a forged owner, stale attempt or finished task can schedule or cancel nothing", async () => {
  const owner = await start();
  const { reminder } = await store.schedule(owner, input(later(60 * 60_000)));
  const stranger = await start();
  await assert.rejects(
    store.schedule({ ...stranger, clerkUserId: owner.clerkUserId }, input(later(60 * 60_000), "Hijacked")),
    InactiveExecutionError,
  );
  await assert.rejects(store.cancel({ ...owner, attemptId: randomUUID() }, reminder.id), InactiveExecutionError);
  await tasks.finish(owner, { status: "completed", finishReason: "stop", interruptionReason: null });
  await assert.rejects(store.list(owner), InactiveExecutionError);
  await assert.rejects(store.cancel(owner, reminder.id), InactiveExecutionError);
});
