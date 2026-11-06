import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { createAttachmentStore, loadOwnedAttachment } from "../../src/db/attachments.js";
import { testDatabase } from "./fixture.js";

const { pool, db } = testDatabase();
const store = createAttachmentStore(db);
after(() => pool.end());

test("attachment registrations survive retries and are scoped to owner and platform", async () => {
  const owner = `user-${randomUUID()}`;
  const other = `user-${randomUUID()}`;
  const input = {
    clerkUserId: owner,
    platform: "telegram" as const,
    fileIds: ["file-a", "file-a"],
  };
  await Promise.all([store.register(input), store.register(input)]);
  assert.equal(await store.owns(owner, "telegram", "file-a"), true);
  assert.equal(await store.owns(other, "telegram", "file-a"), false);
  assert.equal(await store.owns(owner, "linq", "file-a"), false);
  assert.equal(await store.owns(owner, "telegram", "unknown"), false);
  // Provider file IDs can legitimately be delivered to multiple owners.
  await store.register({ ...input, clerkUserId: other });
  assert.equal(await store.owns(other, "telegram", "file-a"), true);
});

test("attachment authorization rejects absent, foreign, and historical unregistered references before download", async () => {
  const owner = `user-${randomUUID()}`;
  await store.register({ clerkUserId: owner, platform: "linq", fileIds: ["private-file"] });
  let calls = 0;
  const load = async () => {
    calls++;
    return new Uint8Array([1]);
  };
  for (const requestedOwner of [undefined, "different-owner"]) {
    await assert.rejects(
      loadOwnedAttachment(store, requestedOwner, "linq", "private-file", load),
      /attach it again/,
    );
  }
  await assert.rejects(
    loadOwnedAttachment(store, owner, "telegram", "private-file", load),
    /attach it again/,
  );
  await assert.rejects(
    loadOwnedAttachment(store, owner, "linq", "old-unregistered-file", load),
    /attach it again/,
  );
  assert.equal(calls, 0);
  assert.deepEqual(
    await loadOwnedAttachment(store, owner, "linq", "private-file", load),
    new Uint8Array([1]),
  );
  assert.equal(calls, 1);
});

test("empty and invalid registrations never grant access", async () => {
  const owner = `user-${randomUUID()}`;
  await store.register({ clerkUserId: owner, platform: "telegram", fileIds: [] });
  await assert.rejects(store.register({ clerkUserId: "", platform: "telegram", fileIds: ["x"] }));
  await assert.rejects(store.register({ clerkUserId: owner, platform: "telegram", fileIds: [""] }));
  assert.equal(await store.owns(owner, "telegram", "x"), false);
});
