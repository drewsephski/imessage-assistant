import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { InactiveExecutionError } from "../../src/db/execution.js";
import { createProfileStore } from "../../src/db/profiles.js";
import { PROFILE_NOTE_LIMIT } from "../../src/db/schema.js";
import type { TaskExecution } from "../../src/db/tasks.js";
import { MemoryError } from "../../src/memory/domain.js";
import { testDatabase } from "./fixture.js";

const { pool, db, store: tasks } = testDatabase();
const profiles = createProfileStore(db);
after(() => pool.end());

const start = async (clerkUserId = `profile-user-${randomUUID()}`): Promise<TaskExecution> => {
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

test("a profile starts empty and keeps what the user asked for, across channels", async () => {
  const telegram = await start();
  assert.deepEqual(await profiles.get(telegram.clerkUserId), { timeZone: null, displayName: null, notes: [] });

  assert.deepEqual(await profiles.remember(telegram, { kind: "timezone", value: "America/Chicago" }), {
    saved: "timezone",
    value: "America/Chicago",
  });
  await profiles.remember(telegram, { kind: "name", value: "Drew" });
  await profiles.remember(telegram, { kind: "note", value: "Prefers short replies" });
  // The same note again, differently cased, is not a second note
  assert.deepEqual(await profiles.remember(telegram, { kind: "note", value: "prefers short replies" }), {
    saved: "note",
    value: "prefers short replies",
    duplicate: true,
  });

  const imessage = await tasks.start({
    clerkUserId: telegram.clerkUserId,
    platform: "linq",
    chatId: randomUUID(),
    messageId: randomUUID(),
    runId: randomUUID(),
    runAttempt: 1,
  });
  assert.ok(imessage);
  assert.deepEqual(await profiles.get(imessage.clerkUserId), {
    timeZone: "America/Chicago",
    displayName: "Drew",
    notes: ["Prefers short replies"],
  });

  assert.deepEqual(await profiles.forget(imessage, { kind: "note", value: "PREFERS SHORT REPLIES" }), {
    forgot: "note",
    found: true,
  });
  assert.deepEqual(await profiles.forget(imessage, { kind: "note", value: "never saved" }), {
    forgot: "note",
    found: false,
  });
  assert.deepEqual(await profiles.forget(imessage, { kind: "everything" }), { forgot: "everything", found: true });
  assert.deepEqual(await profiles.get(telegram.clerkUserId), { timeZone: null, displayName: null, notes: [] });
  assert.deepEqual(await profiles.forget(imessage, { kind: "everything" }), { forgot: "everything", found: false });
});

test("notes are capped and concurrent saves from two chats are both kept", async () => {
  const a = await start();
  const b = await start(a.clerkUserId);
  await Promise.all([
    profiles.remember(a, { kind: "note", value: "From Telegram" }),
    profiles.remember(b, { kind: "note", value: "From iMessage" }),
  ]);
  assert.deepEqual((await profiles.get(a.clerkUserId)).notes.sort(), ["From Telegram", "From iMessage"].sort());

  for (let index = 2; index < PROFILE_NOTE_LIMIT; index++) {
    await profiles.remember(a, { kind: "note", value: `Note ${index}` });
  }
  assert.equal((await profiles.get(a.clerkUserId)).notes.length, PROFILE_NOTE_LIMIT);
  await assert.rejects(profiles.remember(a, { kind: "note", value: "One too many" }), MemoryError);
});

test("another user, a forged attempt or a finished task cannot write a profile", async () => {
  const owner = await start();
  await profiles.remember(owner, { kind: "name", value: "Owner" });
  const stranger = await start();
  // A stranger's execution can only reach the stranger's own profile
  await profiles.remember(stranger, { kind: "name", value: "Stranger" });
  assert.equal((await profiles.get(owner.clerkUserId)).displayName, "Owner");
  await assert.rejects(
    profiles.remember({ ...stranger, clerkUserId: owner.clerkUserId }, { kind: "name", value: "Hijacked" }),
    InactiveExecutionError,
  );
  await assert.rejects(
    profiles.remember({ ...owner, attemptId: randomUUID() }, { kind: "name", value: "Stale" }),
    InactiveExecutionError,
  );
  await tasks.finish(owner, { status: "completed", finishReason: "stop", interruptionReason: null });
  await assert.rejects(profiles.forget(owner, { kind: "everything" }), InactiveExecutionError);
  assert.equal((await profiles.get(owner.clerkUserId)).displayName, "Owner");
});
