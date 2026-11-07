import assert from "node:assert/strict";
import { test } from "node:test";
import type { DeliverableReminder } from "../src/db/reminders.js";
import {
  formatWhen,
  isTimeZone,
  MAX_LEAD_MS,
  ReminderError,
  reminderInputSchema,
  renderReminderDelivery,
  renderReminderList,
  resolveDueAt,
  zoneOffsetMinutes,
} from "../src/reminders/domain.js";
import { deliverReminder, sweepReminders } from "../src/trigger/send-reminder.js";

const NOW = new Date("2026-11-06T18:00:00Z");

test("only real IANA zones are accepted", () => {
  for (const zone of ["America/Chicago", "Europe/Berlin", "UTC", "Asia/Kolkata", "Etc/GMT+5"]) {
    assert.equal(isTimeZone(zone), true, zone);
  }
  for (const zone of ["CST", "Chicago", "America/Nowhere", "", " America/Chicago", "America/Chicago; drop"]) {
    assert.equal(isTimeZone(zone), false, zone);
  }
});

test("zone offsets follow daylight saving", () => {
  assert.equal(zoneOffsetMinutes(new Date("2026-11-20T15:00:00Z"), "America/Chicago"), -360);
  assert.equal(zoneOffsetMinutes(new Date("2026-07-01T15:00:00Z"), "America/Chicago"), -300);
  assert.equal(zoneOffsetMinutes(new Date("2026-07-01T15:00:00Z"), "Asia/Kolkata"), 330);
  assert.equal(zoneOffsetMinutes(new Date("2026-07-01T15:00:00Z"), "UTC"), 0);
});

test("a due time needs the zone's own offset and a sensible lead", () => {
  const input = (dueAt: string, timeZone = "America/Chicago") =>
    reminderInputSchema.parse({ message: "Send Dana the invoice", dueAt, timeZone });
  assert.equal(
    resolveDueAt(input("2026-11-20T09:00:00-06:00"), NOW).toISOString(),
    "2026-11-20T15:00:00.000Z",
  );
  // Summer time in the same zone
  assert.equal(
    resolveDueAt(input("2027-07-01T09:00-05:00"), NOW).toISOString(),
    "2027-07-01T14:00:00.000Z",
  );
  assert.equal(resolveDueAt(input("2026-11-07T09:00:00Z", "UTC"), NOW).toISOString(), "2026-11-07T09:00:00.000Z");
  // The model guessed an offset that isn't Chicago's in November
  assert.throws(() => resolveDueAt(input("2026-11-20T09:00:00-05:00"), NOW), /offset/);
  assert.throws(() => resolveDueAt(input("2026-11-06T17:00:00Z", "UTC"), NOW), /at least a minute/);
  assert.throws(() => resolveDueAt(input("2026-11-06T18:00:30Z", "UTC"), NOW), /at least a minute/);
  assert.ok(resolveDueAt(input("2026-11-06T18:01:00Z", "UTC"), NOW) instanceof Date);
  const tooFar = new Date(NOW.getTime() + MAX_LEAD_MS + 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  assert.throws(() => resolveDueAt(input(tooFar, "UTC"), NOW), ReminderError);
});

test("the input schema rejects what the model must not get away with", () => {
  const base = { message: "Call the dentist", dueAt: "2026-11-20T09:00:00-06:00", timeZone: "America/Chicago" };
  assert.ok(reminderInputSchema.safeParse(base).success);
  for (const bad of [
    { ...base, dueAt: "2026-11-20T09:00:00" },
    { ...base, dueAt: "tomorrow at 9" },
    { ...base, dueAt: "2026-11-20" },
    { ...base, timeZone: "CST" },
    { ...base, message: "" },
    { ...base, message: "x".repeat(501) },
    { ...base, extra: true },
  ]) {
    assert.equal(reminderInputSchema.safeParse(bad).success, false, JSON.stringify(bad));
  }
});

test("times and lists read naturally in the user's zone", () => {
  const dueAt = new Date("2026-11-20T15:00:00Z");
  assert.equal(formatWhen(dueAt, "America/Chicago"), "Fri, Nov 20, 2026, 9:00 AM (America/Chicago)");
  assert.equal(renderReminderList([]), "No reminders are scheduled.");
  assert.equal(
    renderReminderList([{ id: "abc", message: "Call the dentist", dueAt, timeZone: "America/Chicago", status: "scheduled" }]),
    "Fri, Nov 20, 2026, 9:00 AM (America/Chicago): Call the dentist [id abc]",
  );
  assert.equal(renderReminderDelivery("Call the dentist"), "Reminder: Call the dentist");
});

const row = (overrides: Partial<DeliverableReminder> = {}): DeliverableReminder => ({
  id: "r1",
  clerkUserId: "user_1",
  platform: "telegram",
  chatId: "555",
  message: "Call the dentist",
  dueAt: NOW,
  timeZone: "UTC",
  attempts: 1,
  ...overrides,
});

const fakeStore = (claims: (DeliverableReminder | null)[], due: string[] = []) => {
  const sent: string[] = [];
  const claimed: string[] = [];
  return {
    sent,
    claimed,
    store: {
      claim: async (id: string) => {
        claimed.push(id);
        return claims.shift() ?? null;
      },
      markSent: async (id: string) => {
        sent.push(id);
      },
      due: async () => ({ due, failed: 0 }),
    },
  };
};

const fakeSender = (fail = false) => {
  const sends: { platform: string; chatId: string; text: string }[] = [];
  const send = (platform: string) => async (chatId: string, text: string) => {
    if (fail) throw new Error("Messaging service unavailable");
    sends.push({ platform, chatId, text });
  };
  return { sends, sender: { telegram: send("telegram"), linq: send("linq") } };
};

test("delivery sends only what it can claim, then marks it sent", async () => {
  const { sends, sender } = fakeSender();
  const skipped = fakeStore([null]);
  assert.deepEqual(await deliverReminder(skipped.store, "r1", sender), { status: "skipped" });
  assert.deepEqual(sends, []);
  assert.deepEqual(skipped.sent, []);

  const won = fakeStore([row({ platform: "linq", chatId: "chat_9" })]);
  assert.deepEqual(await deliverReminder(won.store, "r1", sender), { status: "sent" });
  assert.deepEqual(sends, [{ platform: "linq", chatId: "chat_9", text: "Reminder: Call the dentist" }]);
  assert.deepEqual(won.sent, ["r1"]);
});

test("a failed send leaves the reminder for the sweep instead of marking it sent", async () => {
  const { sender } = fakeSender(true);
  const failing = fakeStore([row({ attempts: 2 })]);
  assert.deepEqual(await deliverReminder(failing.store, "r1", sender), { status: "failed", attempts: 2 });
  assert.deepEqual(failing.sent, []);
});

test("the sweep claims each due reminder once and reports what it sent", async () => {
  const { sends, sender } = fakeSender();
  const sweep = fakeStore([row({ id: "a" }), null, row({ id: "c", chatId: "7" })], ["a", "b", "c"]);
  assert.deepEqual(await sweepReminders(sweep.store, sender), { due: 3, sent: 2, failed: 0 });
  assert.deepEqual(sweep.claimed, ["a", "b", "c"]);
  assert.deepEqual(sends.map((send) => send.chatId), ["555", "7"]);
});
