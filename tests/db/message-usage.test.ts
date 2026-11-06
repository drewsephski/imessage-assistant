import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { createMessageUsageStore } from "../../src/db/message-usage.js";
import { testDatabase } from "./fixture.js";

const { pool, db } = testDatabase();
after(() => pool.end());

const usage = createMessageUsageStore(db);
const NOVEMBER = new Date("2026-11-15T12:00:00Z");

const claim = (clerkUserId: string, eventId: string, limit = 5, now = NOVEMBER) =>
  usage.claim({ clerkUserId, platform: "telegram", eventId: `${clerkUserId}-${eventId}`, limit, now });

test("messages are allowed up to the limit and refused after it", async () => {
  const user = randomUUID();
  for (let i = 0; i < 5; i++) assert.equal(await claim(user, `m${i}`), true);
  assert.equal(await claim(user, "m5"), false);
});

test("a redelivery doesn't use up another message, and still passes once the limit is reached", async () => {
  const user = randomUUID();
  assert.equal(await claim(user, "a", 2), true);
  assert.equal(await claim(user, "a", 2), true);
  assert.equal(await claim(user, "b", 2), true);
  assert.equal(await claim(user, "a", 2), true);
  assert.equal(await claim(user, "c", 2), false);
});

test("a new month starts a new allowance", async () => {
  const user = randomUUID();
  assert.equal(await claim(user, "a", 1), true);
  assert.equal(await claim(user, "b", 1), false);
  assert.equal(await claim(user, "b", 1, new Date("2026-12-01T00:00:00Z")), true);
});

test("upgrading applies the larger limit to what's already been used this month", async () => {
  const user = randomUUID();
  assert.equal(await claim(user, "a", 1), true);
  assert.equal(await claim(user, "b", 1), false);
  assert.equal(await claim(user, "b", 100), true);
});

test("each user has their own allowance", async () => {
  const [first, second] = [randomUUID(), randomUUID()];
  assert.equal(await claim(first, "a", 1), true);
  assert.equal(await claim(first, "b", 1), false);
  assert.equal(await claim(second, "a", 1), true);
});

test("simultaneous messages can't overshoot the limit", async () => {
  const user = randomUUID();
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) => claim(user, `m${i}`, 5)),
  );
  assert.equal(results.filter(Boolean).length, 5);
});
