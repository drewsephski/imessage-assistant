import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { and, eq } from "drizzle-orm";
import { createLoopStore } from "../../src/db/loops.js";
import { assistantTasks, openLoopReceipts, openLoops, taskAttempts } from "../../src/db/schema.js";
import type { TaskExecution } from "../../src/db/tasks.js";
import { type LoopAction, LoopError, type LoopProposal, renderLoopBrief } from "../../src/loops/domain.js";
import { testDatabase } from "./fixture.js";

const { pool, db, store: tasks } = testDatabase();
const store = createLoopStore(db);
after(() => pool.end());

const DAY = 86400_000;
const capture = "I promised to send Acme the signed proposal by Friday";
const proposal: LoopProposal = {
  title: "Send Acme the proposal",
  direction: "mine",
  nextAction: "Email the signed copy",
  reviewOn: "2026-12-01",
  evidenceQuote: "send Acme the signed proposal",
};
const owner = () => `loop-user-${randomUUID()}`;
const handleFor = () => `L${randomBytes(6).toString("hex").toUpperCase()}`;

const begin = async (clerkUserId: string, platform: "telegram" | "linq" = "telegram") => {
  const request = { clerkUserId, platform, chatId: randomUUID(), messageId: randomUUID(), runId: randomUUID(), runAttempt: 1 };
  const execution = await tasks.start(request);
  assert.ok(execution);
  return { request, execution };
};
const start = async (clerkUserId: string, platform: "telegram" | "linq" = "telegram") =>
  (await begin(clerkUserId, platform)).execution;
const retry = async (request: Awaited<ReturnType<typeof begin>>["request"], runAttempt = 2) => {
  const execution = await tasks.start({ ...request, runAttempt });
  assert.ok(execution);
  return execution;
};
const propose = async (clerkUserId: string, platform: "telegram" | "linq" = "telegram") =>
  store.propose(await start(clerkUserId, platform), proposal, capture);
const command = async (clerkUserId: string, action: LoopAction, handle: string, platform: "telegram" | "linq" = "telegram") =>
  store.mutate(await start(clerkUserId, platform), action, handle);
const read = async (clerkUserId: string, handle: string) => {
  const [row] = await db.select().from(openLoops).where(and(eq(openLoops.clerkUserId, clerkUserId), eq(openLoops.handle, handle)));
  return row ?? null;
};
const rowsOf = (clerkUserId: string) => db.select().from(openLoops).where(eq(openLoops.clerkUserId, clerkUserId));
const receiptsOf = (clerkUserId: string) => db.select().from(openLoopReceipts).where(eq(openLoopReceipts.clerkUserId, clerkUserId));
const seed = (clerkUserId: string, values: Partial<typeof openLoops.$inferInsert> = {}) => {
  const handle = handleFor();
  return db.insert(openLoops).values({
    clerkUserId, handle, status: "open", direction: "mine", sourcePlatform: "telegram",
    title: "Seeded", nextAction: "Follow up", evidenceQuote: "seeded quote", ...values,
  }).then(() => handle);
};
const inactive = /no longer active/;
// Holds the task rows until every request is blocked on them, then releases them together, so
// the requests truly overlap instead of depending on how the scheduler happens to order them.
const together = async <T>(executions: TaskExecution[], work: (execution: TaskExecution, index: number) => Promise<T>) => {
  const gate = await pool.connect();
  try {
    await gate.query("begin");
    await gate.query("select id from assistant_tasks where id = any($1::uuid[]) for update", [executions.map((execution) => execution.taskId)]);
    const results = Promise.allSettled(executions.map(work));
    for (let waited = 0; ; waited += 5) {
      const { rows } = await gate.query<{ blocked: number }>(
        "select count(*)::int as blocked from pg_locks where not granted and pid in (select pid from pg_stat_activity where datname = current_database())",
      );
      if ((rows[0]?.blocked ?? 0) >= executions.length) break;
      assert.ok(waited < 5000, "requests never reached the gate");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await gate.query("commit");
    return await results;
  } finally {
    gate.release();
  }
};
const succeeded = <T>(results: PromiseSettledResult<T>[]) => results.map((result) => {
  if (result.status === "rejected") throw result.reason;
  return result.value;
});

test("a proposal stores validated fields, derives the channel from the task, and never keeps the source text", async () => {
  const clerkUserId = owner();
  const execution = await start(clerkUserId, "linq");
  const before = Date.now();
  const record = await store.propose(execution, proposal, capture);
  assert.match(record.handle, /^L[0-9A-F]{12}$/);
  assert.equal(record.status, "proposed");
  assert.equal(record.sourcePlatform, "linq");
  assert.equal(record.evidenceQuote, proposal.evidenceQuote);
  assert.equal(record.reviewOn, "2026-12-01");
  assert.ok(record.expiresAt);
  const lifetime = record.expiresAt.getTime() - before;
  assert.ok(lifetime > DAY - 60_000 && lifetime <= DAY + 60_000);
  assert.deepEqual(Object.keys(record).sort(), [
    "createdAt", "direction", "evidenceQuote", "expiresAt", "handle", "nextAction",
    "reviewOn", "sourcePlatform", "status", "title", "updatedAt",
  ]);
  const stored = JSON.stringify([await rowsOf(clerkUserId), await receiptsOf(clerkUserId)]);
  assert.ok(!stored.includes(capture));
  assert.ok(!stored.includes("by Friday"));
});

test("invalid model output and unsupported evidence are refused at the persistence boundary", async () => {
  const clerkUserId = owner();
  const invalid: unknown[] = [
    { ...proposal, title: "two\nlines" },
    { ...proposal, title: "x".repeat(121) },
    { ...proposal, nextAction: "x".repeat(161) },
    { ...proposal, reviewOn: "2026-02-30" },
    { ...proposal, clerkUserId: "someone-else" },
    { ...proposal, sourcePlatform: "linq" },
    { ...proposal, evidenceQuote: "a quote the user never wrote" },
    { ...proposal, evidenceQuote: "" },
  ];
  for (const candidate of invalid) {
    await assert.rejects(store.propose(await start(clerkUserId), candidate as LoopProposal, capture), LoopError);
  }
  assert.equal((await rowsOf(clerkUserId)).length, 0);
  assert.equal((await receiptsOf(clerkUserId)).length, 0);
});

test("every operation is scoped to the owner, and forged ownership is refused", async () => {
  const alice = owner(); const mallory = owner();
  const source = await start(alice);
  const { handle } = await store.propose(source, proposal, capture);
  const intruder = await start(mallory);
  assert.equal(await store.get(intruder, handle), null);
  assert.deepEqual(await store.list(intruder), []);
  for (const action of ["keep", "waiting", "mine", "done", "forget"] as const) {
    assert.equal((await command(mallory, action, handle)).outcome, "not_found");
  }
  assert.equal((await read(alice, handle))?.status, "proposed");
  // Replaying a stolen task or attempt under another identity does not authenticate it.
  const forged = { ...source, clerkUserId: mallory };
  await assert.rejects(store.get(forged, handle), inactive);
  await assert.rejects(store.mutate(forged, "forget", handle), inactive);
  await assert.rejects(store.propose(forged, proposal, capture), inactive);
  await assert.rejects(store.list(forged), inactive);
  await assert.rejects(store.get({ ...intruder, taskId: source.taskId }, handle), inactive);
  assert.ok(await read(alice, handle));
});

test("stale, forged and finished attempts cannot touch state", async () => {
  const clerkUserId = owner();
  const { handle } = await propose(clerkUserId);
  const { request, execution: stale } = await begin(clerkUserId);
  const current = await retry(request);
  const operations = (execution: TaskExecution) => [
    () => store.list(execution), () => store.get(execution, handle), () => store.mutate(execution, "keep", handle),
    () => store.propose(execution, proposal, capture),
  ];
  for (const attempt of operations(stale)) await assert.rejects(attempt, inactive);
  for (const attempt of operations({ ...current, attemptId: randomUUID() })) await assert.rejects(attempt, inactive);
  // A superseded worker is fenced by the task's current attempt alone, even if still marked running.
  await db.update(taskAttempts).set({ status: "running", finishedAt: null }).where(eq(taskAttempts.id, stale.attemptId));
  for (const attempt of operations(stale)) await assert.rejects(attempt, inactive);
  assert.equal((await read(clerkUserId, handle))?.status, "proposed");
  assert.equal((await receiptsOf(clerkUserId)).length, 1);
  assert.equal((await store.mutate(current, "keep", handle)).outcome, "applied");
  for (const status of ["completed", "failed"] as const) {
    const finished = await start(clerkUserId);
    await tasks.finish(finished, { status, finishReason: "stop", interruptionReason: null });
    for (const attempt of operations(finished)) await assert.rejects(attempt, inactive);
  }
});

test("saved rows are shared across an owner's channels while keeping their source channel", async () => {
  const clerkUserId = owner();
  const { handle } = await propose(clerkUserId, "linq");
  const telegram = await start(clerkUserId, "telegram");
  assert.deepEqual((await store.list(telegram)).map((record) => record.handle), [handle]);
  assert.equal((await store.get(telegram, handle))?.sourcePlatform, "linq");
  assert.equal((await store.mutate(telegram, "keep", handle)).outcome, "applied");
  assert.equal((await command(clerkUserId, "waiting", handle, "linq")).outcome, "applied");
  const saved = await read(clerkUserId, handle);
  assert.equal(saved?.status, "open");
  assert.equal(saved?.direction, "waiting");
  assert.equal(saved?.sourcePlatform, "linq");
});

test("simultaneous proposals across channels cannot exceed the 50 row cap", async () => {
  const clerkUserId = owner();
  await Promise.all(Array.from({ length: 48 }, () => seed(clerkUserId)));
  const executions = await Promise.all(Array.from({ length: 8 }, (_, index) => start(clerkUserId, index % 2 ? "linq" : "telegram")));
  const results = await together(executions, (execution) => store.propose(execution, proposal, capture));
  const saved = results.filter((result) => result.status === "fulfilled");
  const refused = results.filter((result) => result.status === "rejected");
  assert.equal(saved.length, 2);
  for (const result of refused) {
    assert.ok(result.reason instanceof LoopError);
    assert.match(result.reason.message, /50 saved items/);
  }
  assert.equal((await rowsOf(clerkUserId)).length, 50);
  // A refused task left nothing behind, so it succeeds once the user has made room.
  const [refusedIndex] = results.flatMap((result, index) => (result.status === "rejected" ? [index] : []));
  const execution = executions[refusedIndex];
  assert.ok(execution);
  const [first] = await rowsOf(clerkUserId);
  assert.ok(first);
  assert.equal((await command(clerkUserId, "forget", first.handle)).outcome, "applied");
  assert.equal((await store.propose(execution, proposal, capture)).status, "proposed");
  assert.equal((await rowsOf(clerkUserId)).length, 50);
});

test("expired and done rows count toward the cap until they are forgotten", async () => {
  const clerkUserId = owner();
  await Promise.all(Array.from({ length: 48 }, () => seed(clerkUserId)));
  await seed(clerkUserId, { status: "done" });
  const expired = await seed(clerkUserId, { status: "proposed", expiresAt: new Date(Date.now() - 1000) });
  await assert.rejects(propose(clerkUserId), /50 saved items/);
  assert.equal((await command(clerkUserId, "forget", expired)).outcome, "applied");
  assert.equal((await propose(clerkUserId)).status, "proposed");
  assert.equal((await rowsOf(clerkUserId)).length, 50);
});

test("one immutable proposal per logical task, however it is retried", async () => {
  const clerkUserId = owner();
  const { request, execution } = await begin(clerkUserId);
  const original = await store.propose(execution, proposal, capture);
  const reworded = { ...proposal, title: "Silently changed", nextAction: "Do something else", direction: "waiting" as const };
  const repeated = await store.propose(execution, reworded, capture);
  assert.deepEqual(repeated, original);
  const retried = await retry(request);
  assert.deepEqual(await store.propose(retried, reworded, capture), original);
  assert.equal((await rowsOf(clerkUserId)).length, 1);
  assert.equal((await receiptsOf(clerkUserId)).length, 1);
  // Nor does a proposal retry revert what the user did with the row since.
  assert.equal((await command(clerkUserId, "keep", original.handle)).outcome, "applied");
  const third = await retry(request, 3);
  const afterKeep = await store.propose(third, proposal, capture);
  assert.equal(afterKeep.status, "open");
  assert.equal(afterKeep.expiresAt, null);
});

test("simultaneous proposals from the same task create a single row", async () => {
  const clerkUserId = owner();
  const execution = await start(clerkUserId);
  const records = succeeded(await together(Array.from({ length: 6 }, () => execution), (same, index) =>
    store.propose(same, { ...proposal, title: `Variant ${index}` }, capture)));
  assert.equal(new Set(records.map((record) => record.handle)).size, 1);
  assert.equal(new Set(records.map((record) => record.title)).size, 1);
  assert.equal((await rowsOf(clerkUserId)).length, 1);
});

test("forgetting erases content and a retried proposal can never bring it back", async () => {
  const clerkUserId = owner();
  const { request, execution } = await begin(clerkUserId);
  const { handle } = await store.propose(execution, proposal, capture);
  assert.equal((await command(clerkUserId, "forget", handle)).outcome, "applied");
  assert.equal(await read(clerkUserId, handle), null);

  await assert.rejects(store.propose(execution, proposal, capture), /already removed/);
  const retried = await retry(request);
  await assert.rejects(store.propose(retried, proposal, capture), /already removed/);
  assert.equal((await rowsOf(clerkUserId)).length, 0);

  const receipts = await receiptsOf(clerkUserId);
  assert.equal(receipts.length, 2);
  const remaining = JSON.stringify(receipts);
  for (const content of [proposal.title, proposal.nextAction, proposal.evidenceQuote, capture])
    assert.ok(!remaining.includes(content));
  // A new task may save the same thing again, under a new handle.
  const again = await propose(clerkUserId);
  assert.notEqual(again.handle, handle);
  // Forgetting again is a no-op, and says so only to the owner it happened to.
  assert.equal((await command(clerkUserId, "forget", handle)).outcome, "already_applied");
  assert.equal((await command(owner(), "forget", handle)).outcome, "not_found");
  assert.equal((await command(clerkUserId, "keep", handle)).outcome, "not_found");
});

test("receipt columns refuse anything but a handle and known codes", async () => {
  const clerkUserId = owner();
  const { taskId } = await start(clerkUserId);
  const base = { clerkUserId, taskId, kind: "mutation", action: "keep", outcome: "applied" } as const;
  await assert.rejects(db.insert(openLoopReceipts).values({ ...base, handle: "Send Acme the proposal" }));
  await assert.rejects(db.insert(openLoopReceipts).values({ clerkUserId, taskId, kind: "mutation", handle: handleFor() }));
  await assert.rejects(db.insert(openLoopReceipts).values({ ...base, handle: handleFor(), kind: "proposal" }));
});

test("legal transitions, repeats and refusals", async () => {
  type Status = "proposed" | "open" | "done";
  const cases: [Status, LoopAction, string][] = [
    ["proposed", "keep", "applied"], ["proposed", "mine", "invalid_transition"], ["proposed", "waiting", "invalid_transition"],
    ["proposed", "done", "invalid_transition"], ["proposed", "forget", "applied"],
    ["open", "keep", "already_applied"], ["open", "mine", "already_applied"], ["open", "waiting", "applied"],
    ["open", "done", "applied"], ["open", "forget", "applied"],
    ["done", "keep", "invalid_transition"], ["done", "mine", "invalid_transition"], ["done", "waiting", "invalid_transition"],
    ["done", "done", "already_applied"], ["done", "forget", "applied"],
  ];
  for (const [status, action, outcome] of cases) {
    const clerkUserId = owner();
    const { handle } = await propose(clerkUserId);
    if (status !== "proposed") await command(clerkUserId, "keep", handle);
    if (status === "done") await command(clerkUserId, "done", handle);
    const before = await read(clerkUserId, handle);
    assert.ok(before);
    const result = await command(clerkUserId, action, handle);
    assert.deepEqual(result, { handle, action, outcome }, `${status} + ${action}`);
    const saved = await read(clerkUserId, handle);
    if (action === "forget") {
      assert.equal(saved, null);
    } else if (outcome === "applied") {
      assert.ok(saved && saved.updatedAt >= before.updatedAt);
      if (action === "keep") { assert.equal(saved.status, "open"); assert.equal(saved.expiresAt, null); }
      if (action === "done") assert.equal(saved.status, "done");
      if (action === "waiting") assert.equal(saved.direction, "waiting");
    } else {
      assert.deepEqual(saved, before, `${status} + ${action} must not change the row`);
    }
  }
});

test("a repeated command returns its first result and cannot undo a later command", async () => {
  const clerkUserId = owner();
  const { handle } = await propose(clerkUserId);
  await command(clerkUserId, "keep", handle);
  const { request, execution } = await begin(clerkUserId);
  assert.equal((await store.mutate(execution, "waiting", handle)).outcome, "applied");
  assert.equal((await command(clerkUserId, "mine", handle)).outcome, "applied");
  const settled = await read(clerkUserId, handle);

  assert.deepEqual(await store.mutate(execution, "waiting", handle), { handle, action: "waiting", outcome: "applied" });
  const retried = await retry(request);
  assert.deepEqual(await store.mutate(retried, "waiting", handle), { handle, action: "waiting", outcome: "applied" });
  assert.deepEqual(await read(clerkUserId, handle), settled);
});

test("a refused command stays refused on retry, even once it would become legal", async () => {
  const clerkUserId = owner();
  const { handle } = await propose(clerkUserId);
  const { request, execution } = await begin(clerkUserId);
  assert.equal((await store.mutate(execution, "waiting", handle)).outcome, "invalid_transition");
  await command(clerkUserId, "keep", handle);
  const retried = await retry(request);
  assert.equal((await store.mutate(retried, "waiting", handle)).outcome, "invalid_transition");
  assert.equal((await read(clerkUserId, handle))?.direction, "mine");
});

test("one logical task applies one action: other arguments and kinds fail safely", async () => {
  const clerkUserId = owner();
  const first = await propose(clerkUserId);
  const second = await propose(clerkUserId);
  await command(clerkUserId, "keep", first.handle);
  await command(clerkUserId, "keep", second.handle);
  const { request, execution } = await begin(clerkUserId);
  assert.equal((await store.mutate(execution, "waiting", first.handle)).outcome, "applied");
  const retried = await retry(request);
  await assert.rejects(store.mutate(retried, "done", first.handle), /different loop command/);
  await assert.rejects(store.mutate(retried, "waiting", second.handle), /different loop command/);
  await assert.rejects(store.mutate(retried, "forget", first.handle), /different loop command/);
  await assert.rejects(store.propose(retried, proposal, capture), /already ran a loop command/);
  assert.equal((await read(clerkUserId, first.handle))?.status, "open");
  assert.equal((await read(clerkUserId, second.handle))?.direction, "mine");

  // The message that created a proposal cannot also confirm it.
  const source = await start(clerkUserId);
  const third = await store.propose(source, proposal, capture);
  await assert.rejects(store.mutate(source, "keep", third.handle), /different loop command/);
  assert.equal((await read(clerkUserId, third.handle))?.status, "proposed");
});

test("simultaneous commands are serialized per owner", async () => {
  const clerkUserId = owner();
  const { handle } = await propose(clerkUserId);
  const keepers = await Promise.all(Array.from({ length: 6 }, (_, index) => start(clerkUserId, index % 2 ? "linq" : "telegram")));
  const kept = succeeded(await together(keepers, (execution) => store.mutate(execution, "keep", handle)));
  assert.equal(kept.filter((result) => result.outcome === "applied").length, 1);
  assert.equal(kept.filter((result) => result.outcome === "already_applied").length, 5);

  const racers = await Promise.all(Array.from({ length: 6 }, () => start(clerkUserId)));
  const raced = succeeded(await together(racers, (execution, index) =>
    store.mutate(execution, index % 2 ? "forget" : "done", handle)));
  // Forget always wins eventually, and nothing can act on the row after it.
  assert.equal(await read(clerkUserId, handle), null);
  assert.equal(raced.filter((result) => result.action === "forget" && result.outcome === "applied").length, 1);
  assert.equal(raced.filter((result) => result.action === "forget" && result.outcome === "already_applied").length, 2);
});

test("handles normalize at the boundary; a malformed one matches nothing and is not stored", async () => {
  const clerkUserId = owner();
  const { handle } = await propose(clerkUserId);
  const reader = await start(clerkUserId);
  assert.equal((await store.get(reader, `  ${handle.toLowerCase()} `))?.handle, handle);
  assert.equal(await store.get(reader, "not-a-handle"), null);
  assert.equal((await store.mutate(await start(clerkUserId), "keep", ` ${handle.toLowerCase()}`)).outcome, "applied");
  const before = (await receiptsOf(clerkUserId)).length;
  const secret = "my client's private note";
  assert.equal((await command(clerkUserId, "forget", secret)).outcome, "not_found");
  const receipts = await receiptsOf(clerkUserId);
  assert.equal(receipts.length, before);
  assert.ok(!JSON.stringify(receipts).toUpperCase().includes(secret.toUpperCase()));
  await assert.rejects(command(clerkUserId, "reopen" as LoopAction, handle), LoopError);
});

test("an expired proposal cannot be kept, but stays visible and forgettable until retention removes it", async () => {
  const clerkUserId = owner();
  const { handle } = await propose(clerkUserId);
  await db.update(openLoops).set({ expiresAt: new Date(Date.now() - 1000) })
    .where(and(eq(openLoops.clerkUserId, clerkUserId), eq(openLoops.handle, handle)));
  for (const action of ["keep", "mine", "waiting", "done"] as const) {
    assert.equal((await command(clerkUserId, action, handle)).outcome, "expired");
  }
  assert.equal((await read(clerkUserId, handle))?.status, "proposed");
  const reader = await start(clerkUserId);
  const listed = await store.list(reader);
  assert.deepEqual(listed.map((record) => record.handle), [handle]);
  assert.match(renderLoopBrief(listed, new Date()), /Expired, cannot be kept/);
  assert.equal((await store.get(reader, handle))?.handle, handle);
  assert.equal((await command(clerkUserId, "forget", handle)).outcome, "applied");
  assert.equal(await read(clerkUserId, handle), null);
});

test("owner access removes only that owner's rows past retention", async () => {
  const clerkUserId = owner(); const other = owner();
  const past = (days: number) => new Date(Date.now() - days * DAY);
  const purged = [
    await seed(clerkUserId, { status: "proposed", expiresAt: past(31) }),
    await seed(clerkUserId, { status: "done", updatedAt: past(31) }),
  ];
  const kept = [
    await seed(clerkUserId, { status: "proposed", expiresAt: past(29) }),
    await seed(clerkUserId, { status: "done", updatedAt: past(29) }),
    await seed(clerkUserId, { status: "open", createdAt: past(400), updatedAt: past(400) }),
  ];
  const untouched = await seed(other, { status: "done", updatedAt: past(31) });
  // Any owner operation applies retention, and what it reports already reflects that.
  const listed = await store.list(await start(clerkUserId));
  assert.ok(!listed.some((record) => purged.includes(record.handle)));
  for (const handle of purged) assert.equal(await read(clerkUserId, handle), null);
  for (const handle of kept) assert.ok(await read(clerkUserId, handle));
  assert.ok(await read(other, untouched));
  await db.delete(openLoops).where(eq(openLoops.clerkUserId, other));
});

test("purgeExpired applies retention across owners and reports what it removed", async () => {
  await store.purgeExpired();
  const alice = owner(); const bob = owner();
  const past = (days: number) => new Date(Date.now() - days * DAY);
  await seed(alice, { status: "proposed", expiresAt: past(31) });
  await seed(bob, { status: "done", updatedAt: past(31) });
  const recentDone = await seed(alice, { status: "done", updatedAt: past(29) });
  const recentExpired = await seed(bob, { status: "proposed", expiresAt: past(1) });
  const open = await seed(bob, { status: "open", updatedAt: past(400) });
  assert.equal(await store.purgeExpired(), 2);
  assert.deepEqual((await rowsOf(alice)).map((row) => row.handle), [recentDone]);
  assert.deepEqual((await rowsOf(bob)).map((row) => row.handle).sort(), [recentExpired, open].sort());
  assert.equal(await store.purgeExpired(), 0);
});

test("receipts outlast retention to block a replay, and leave with their task while open rows stay", async () => {
  const clerkUserId = owner();
  const { request, execution } = await begin(clerkUserId);
  const { handle } = await store.propose(execution, proposal, capture);
  await db.update(openLoops).set({ expiresAt: new Date(Date.now() - 31 * DAY) })
    .where(and(eq(openLoops.clerkUserId, clerkUserId), eq(openLoops.handle, handle)));
  await store.purgeExpired();
  assert.equal(await read(clerkUserId, handle), null);
  const retried = await retry(request);
  await assert.rejects(store.propose(retried, proposal, capture), /already removed/);
  assert.equal((await rowsOf(clerkUserId)).length, 0);

  const source = await start(clerkUserId);
  const kept = await store.propose(source, proposal, capture);
  await command(clerkUserId, "keep", kept.handle);
  await db.delete(assistantTasks).where(eq(assistantTasks.id, source.taskId));
  assert.equal((await db.select().from(openLoopReceipts).where(eq(openLoopReceipts.taskId, source.taskId))).length, 0);
  assert.equal((await read(clerkUserId, kept.handle))?.status, "open");
});

test("lists are stably ordered by review date with nulls last, then creation time and handle", async () => {
  const clerkUserId = owner();
  const at = new Date("2026-11-01T00:00:00Z");
  const noDate = await seed(clerkUserId, { reviewOn: null, createdAt: new Date(at.getTime() - DAY) });
  const late = await seed(clerkUserId, { reviewOn: "2026-12-20", createdAt: at });
  const soonNewer = await seed(clerkUserId, { reviewOn: "2026-12-01", createdAt: at });
  const soonOlder = await seed(clerkUserId, { reviewOn: "2026-12-01", createdAt: new Date(at.getTime() - 1000) });
  const twin = await seed(clerkUserId, { reviewOn: "2026-12-20", createdAt: at });
  const [firstTwin, secondTwin] = [late, twin].sort();
  const listed = await store.list(await start(clerkUserId));
  assert.deepEqual(listed.map((record) => record.handle), [soonOlder, soonNewer, firstTwin, secondTwin, noDate]);
});
