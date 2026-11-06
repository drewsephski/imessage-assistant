import assert from "node:assert/strict";
import { test } from "node:test";
import { calendarEventSchema, calendarWindowSchema, confirmationCode, googleEventId } from "../src/integrations/calendar.js";
import { createComposioCalendar } from "../src/integrations/composio-calendar.js";
import { calendarConfirmationText } from "../src/trigger/calendar-tools.js";
import { operationCeiling, SpendingDenied } from "../src/spending/policy.js";
import { testPolicy as policy } from "./helpers/spending-policy.js";

const event = {
  title: "Project check-in", start: "2026-11-20T10:00:00-06:00", end: "2026-11-20T10:30:00-06:00", timeZone: "America/Chicago",
};
const config = { apiKey: "not-a-real-key", authConfigId: "ac_test" };
const draftId = "8d415c51-cda2-4d54-a2e4-313240c1497a";
const charge = async <T>(_operation: string, work: () => Promise<T>) => work();
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

test("calendar validates timezone offsets, DST gaps, bounds, and unsupported inputs", () => {
  assert.equal(calendarEventSchema.parse(event).title, event.title);
  for (const invalid of [
    { ...event, timeZone: "Mars/Base" }, { ...event, timeZone: "+01:00" }, { ...event, start: "2026-11-20T10:00:00" },
    { ...event, start: "2026-11-20T10:00:00Z" }, { ...event, end: event.start },
    { ...event, attendees: ["someone@example.com"] },
    { ...event, start: "2026-03-08T02:15:00-06:00", end: "2026-03-08T03:30:00-05:00" },
    { ...event, end: "2026-12-20T10:30:00-06:00" },
  ]) assert.equal(calendarEventSchema.safeParse(invalid).success, false);
  assert.equal(calendarWindowSchema.safeParse({ start: event.start, end: "2026-12-22T10:00:00-06:00" }).success, false);
});

test("confirmation accepts only exact standalone user text, never a filename or previous turn", () => {
  const phrase = "confirm calendar abcd12345678";
  assert.equal(confirmationCode(phrase), "abcd12345678");
  for (const invalid of ["yes", `Please ${phrase}`, `${phrase}\nand invite Joe`, `Quoted: ${phrase}`])
    assert.equal(confirmationCode(invalid), undefined);
  assert.equal(calendarConfirmationText([{ id: "1", role: "user", parts: [{ type: "text", text: phrase }] }]), phrase);
  assert.equal(calendarConfirmationText([
    { id: "1", role: "user", parts: [{ type: "text", text: phrase }] },
    { id: "2", role: "user", parts: [{ type: "file", mediaType: "text/plain", url: "https://telegram.invalid/files/1", filename: phrase }] },
  ]), "");
  assert.equal(calendarConfirmationText([{ id: "1", role: "user", parts: [{ type: "text", text: phrase }, { type: "text", text: "[attachment]" }] }]), "");
});

test("Composio ownership, toolkit, auth config and sharing are checked before use", async () => {
  const account = { id: "ca_test", user_id: "user_a", status: "ACTIVE", toolkit: { slug: "googlecalendar" }, auth_config: { id: "ac_test" } };
  for (const wrong of [
    { ...account, user_id: "user_b" }, { ...account, id: "ca_other" },
    { ...account, toolkit: { slug: "gmail" } }, { ...account, auth_config: { id: "ac_other" } },
    { ...account, experimental: { account_type: "SHARED" } },
  ]) {
    const provider = createComposioCalendar(config, charge, async () => json(wrong));
    await assert.rejects(provider.status("user_a", "ca_test"), /ownership/);
  }
  const disabled = createComposioCalendar(config, charge, async () => json({ ...account, is_disabled: true }));
  assert.equal(await disabled.status("user_a", "ca_test"), "DISABLED");
});

test("calendar writes reserve before claiming, bind owner and account, and omit guests", async () => {
  const order: string[] = [];
  const provider = createComposioCalendar(config, async (operation, work) => {
    assert.equal(operation, "integration:calendar.create"); order.push("reserve"); return work();
  }, async (url, init) => {
    order.push("request");
    assert.equal(url, "https://backend.composio.dev/api/v3.1/tools/execute/proxy");
    assert.equal(init?.redirect, "error");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.user_id, "user_a"); assert.equal(body.connected_account_id, "ca_test");
    assert.equal(body.endpoint, "/calendars/primary/events?sendUpdates=none");
    assert.equal(body.body.id, googleEventId(draftId));
    assert.equal(body.body.attendees, undefined);
    assert.equal(body.body.start.timeZone, "America/Chicago");
    return json({ status: 200, data: { ...body.body, status: "confirmed", htmlLink: "https://www.google.com/calendar/event?eid=test" } });
  });
  const result = await provider.create("user_a", "ca_test", draftId, event, async () => { order.push("claim"); return true; });
  assert.equal(result?.title, event.title);
  assert.deepEqual(order, ["reserve", "claim", "request"]);
});

test("denied spending or a consumed draft cannot make a provider write", async () => {
  let requests = 0; let claims = 0;
  const transport: typeof fetch = async () => { requests++; return json({}); };
  const denied = createComposioCalendar(config, async () => { throw new SpendingDenied("limit"); }, transport);
  await assert.rejects(denied.create("user_a", "ca_test", draftId, event, async () => { claims++; return true; }), SpendingDenied);
  const consumed = createComposioCalendar(config, charge, transport);
  assert.equal(await consumed.create("user_a", "ca_test", draftId, event, async () => false), null);
  assert.equal(requests, 0); assert.equal(claims, 0);
});

test("provider errors are sanitized and mismatched or deleted events cannot be success", async () => {
  const secret = "super-secret-response-token";
  const failed = createComposioCalendar(config, charge, async () => json({ error: secret }, 401));
  await assert.rejects(failed.status("user_a", "ca_test"), (error: unknown) => error instanceof Error && !error.message.includes(secret) && error.message.includes("401"));
  for (const data of [
    { id: "wrong", extendedProperties: { private: { assistantDraftId: draftId } } },
    { id: googleEventId(draftId), extendedProperties: { private: { assistantDraftId: "wrong" } } },
    { id: googleEventId(draftId), status: "cancelled", extendedProperties: { private: { assistantDraftId: draftId } } },
  ]) {
    const provider = createComposioCalendar(config, charge, async () => json({ status: 200, data }));
    await assert.rejects(provider.get("user_a", "ca_test", draftId), /could not be verified/);
  }
});

test("bounded listings expose truncation and only safe calendar links", async () => {
  const provider = createComposioCalendar(config, charge, async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.ok(body.endpoint.includes("maxResults=25"));
    return json({ status: 200, data: { items: [{ id: "a", summary: "Review", htmlLink: "https://evil.example/" }], nextPageToken: "next" } });
  });
  const result = await provider.list("user_a", "ca_test", event.start, event.end);
  assert.equal(result.truncated, true); assert.equal(result.events[0]?.url, undefined);
});

test("auth links cannot redirect a user to an unexpected host", async () => {
  const provider = createComposioCalendar(config, charge, async () => json({ connected_account_id: "ca_test", redirect_url: "https://evil.example/signin" }));
  await assert.rejects(provider.link("user_a"), /invalid connection link/);
});

test("a removed connected account can be recognized for reconnection", async () => {
  const provider = createComposioCalendar(config, charge, async () => json({}, 404));
  assert.equal(await provider.status("user_a", "ca_test"), "MISSING");
});

test("unpriced or zero-priced calendar operations fail closed", () => {
  assert.throws(() => operationCeiling(policy(), "integration:calendar.create"), SpendingDenied);
  assert.throws(() => operationCeiling({ ...policy(), ceilings: { "integration:calendar.create": 0n } }, "integration:calendar.create"), SpendingDenied);
});
