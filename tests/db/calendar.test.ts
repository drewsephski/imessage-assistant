import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";
import { createCalendarStore } from "../../src/db/calendar.js";
import { calendarDrafts } from "../../src/db/schema.js";
import type { TaskExecution } from "../../src/db/tasks.js";
import { createCalendarService } from "../../src/integrations/calendar-service.js";
import { createComposioCalendar } from "../../src/integrations/composio-calendar.js";
import { googleEventId } from "../../src/integrations/calendar.js";
import { testDatabase } from "./fixture.js";

const { pool, db, store: tasks } = testDatabase();
const store = createCalendarStore(db);
after(() => pool.end());
const event = { title: "Review", start: "2026-11-20T10:00:00-06:00", end: "2026-11-20T10:30:00-06:00", timeZone: "America/Chicago" };
const start = async (clerkUserId = `calendar-user-${randomUUID()}`): Promise<TaskExecution> => {
  const execution = await tasks.start({ clerkUserId, platform: "telegram", chatId: randomUUID(), messageId: randomUUID(), runId: randomUUID(), runAttempt: 1 });
  assert.ok(execution); return execution;
};
const setup = async () => {
  const source = await start(); const accountId = `ca_${randomUUID()}`;
  await store.saveConnection(source, accountId, "ac_test");
  const draft = await store.draft(source, accountId, event);
  const confirmation = await start(source.clerkUserId);
  return { source, accountId, draft, confirmation };
};

test("calendar drafts are immutable, scoped to owner, and require a later task", async () => {
  const { source, accountId, draft, confirmation } = await setup();
  const repeated = await store.draft(source, accountId, { ...event, title: "Silently changed" });
  assert.equal(repeated.id, draft.id); assert.equal(repeated.event.title, "Review");
  const stranger = await start();
  assert.equal(await store.findDraft(stranger, draft.confirmationCode), null);
  assert.equal(await store.connection(stranger), null);
  await assert.rejects(store.claim(stranger, draft.id, accountId), /connection changed/);
  await assert.rejects(store.claim(source, draft.id, accountId), /new message/);
  assert.equal(await store.claim(confirmation, draft.id, accountId), true);
});

test("concurrent confirmation claims permit exactly one provider submission", async () => {
  const { source, accountId, draft } = await setup();
  const confirmations = await Promise.all(Array.from({ length: 6 }, () => start(source.clerkUserId)));
  const claims = await Promise.all(confirmations.map((execution) => store.claim(execution, draft.id, accountId)));
  assert.equal(claims.filter(Boolean).length, 1);
});

test("expired drafts and changed connections cannot be submitted", async () => {
  const { accountId, draft, confirmation } = await setup();
  await db.update(calendarDrafts).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(calendarDrafts.id, draft.id));
  await assert.rejects(store.claim(confirmation, draft.id, accountId), /expired/);
  const other = await setup();
  await store.saveConnection(other.confirmation, `ca_${randomUUID()}`, "ac_test", other.accountId);
  await assert.rejects(store.claim(other.confirmation, other.draft.id, other.accountId), /connection changed/);
});

test("completed or forged task executions cannot access calendar state", async () => {
  const { source, draft } = await setup();
  await assert.rejects(store.findDraft({ ...source, clerkUserId: "stranger" }, draft.confirmationCode), /no longer active/);
  await assert.rejects(store.connection({ ...source, attemptId: randomUUID() }), /no longer active/);
  await tasks.finish(source, { status: "completed", finishReason: "stop", interruptionReason: null });
  await assert.rejects(store.connection(source), /no longer active/);
});

test("uncertain POST is never retried; repeating real confirmation only reads its deterministic event", async () => {
  const { source, accountId, draft, confirmation } = await setup();
  let posts = 0; let reads = 0; let visible = false;
  const provider = createComposioCalendar({ apiKey: "fake", authConfigId: "ac_test" }, async (_op, work) => work(),
    async (url, init) => {
      if (String(url).includes("/connected_accounts/")) return Response.json({
        id: accountId, user_id: source.clerkUserId, status: "ACTIVE", toolkit: { slug: "googlecalendar" }, auth_config: { id: "ac_test" },
      });
      const body = JSON.parse(String(init?.body));
      if (body.method === "POST") { posts++; throw new Error("timeout after upstream accepted"); }
      reads++;
      return Response.json(visible ? { status: 200, data: {
        id: googleEventId(draft.id), summary: event.title, extendedProperties: { private: { assistantDraftId: draft.id } },
      } } : { status: 404, data: {} });
    });
  const service = createCalendarService(store, provider);
  await assert.rejects(service.confirm(confirmation, "yes"), /exact confirmation/);
  assert.equal(posts, 0);
  const phrase = `confirm calendar ${draft.confirmationCode}`;
  await assert.rejects(service.confirm(confirmation, phrase), /did not respond/);
  assert.equal(posts, 1);
  assert.equal((await service.confirm(confirmation, phrase)).status, "uncertain");
  visible = true;
  assert.equal((await service.confirm(confirmation, phrase)).status, "created");
  assert.equal(posts, 1); assert.equal(reads, 2);
});

test("revocation blocks calendar reads and writes without a Google request", async () => {
  const { source, accountId, draft, confirmation } = await setup(); let google = 0;
  const provider = createComposioCalendar({ apiKey: "fake", authConfigId: "ac_test" }, async (_op, work) => work(),
    async (url) => {
      if (String(url).includes("/tools/execute/proxy")) google++;
      return Response.json({ id: accountId, user_id: source.clerkUserId, status: "REVOKED", toolkit: { slug: "googlecalendar" }, auth_config: { id: "ac_test" } });
    });
  const service = createCalendarService(store, provider);
  await assert.rejects(service.confirm(confirmation, `confirm calendar ${draft.confirmationCode}`), /not connected/);
  await assert.rejects(service.list(source, { start: event.start, end: event.end }), /not connected/);
  assert.equal(google, 0);
});

test("retention removes expired unused drafts and old submitted drafts, retaining recovery window", async () => {
  const expired = await setup(); const old = await setup(); const recent = await setup();
  await db.update(calendarDrafts).set({ expiresAt: new Date(Date.now() - 2 * 86400_000) }).where(eq(calendarDrafts.id, expired.draft.id));
  await db.update(calendarDrafts).set({ submittedAt: new Date(Date.now() - 31 * 86400_000) }).where(eq(calendarDrafts.id, old.draft.id));
  await store.claim(recent.confirmation, recent.draft.id, recent.accountId);
  await store.purgeExpired();
  assert.equal(await store.findDraft(expired.confirmation, expired.draft.confirmationCode), null);
  assert.equal(await store.findDraft(old.confirmation, old.draft.confirmationCode), null);
  assert.ok(await store.findDraft(recent.confirmation, recent.draft.confirmationCode));
});

test("simultaneous connection requests publish only the persisted winning link", async () => {
  const first = await start();
  const second = await start(first.clerkUserId);
  const accountPrefix = `ca_race_${randomUUID()}`;
  let release: (() => void) | undefined;
  const bothStarted = new Promise<void>((resolve) => { release = resolve; });
  let links = 0;
  const provider = createComposioCalendar({ apiKey: "fake", authConfigId: "ac_test" }, async (_op, work) => work(),
    async (url) => {
      assert.ok(String(url).endsWith("/connected_accounts/link"));
      const index = ++links;
      if (links === 2) release?.();
      await bothStarted;
      return Response.json({ connected_account_id: `${accountPrefix}_${index}`, redirect_url: `https://connect.composio.dev/link/${index}` });
    });
  const service = createCalendarService(store, provider);
  const results = await Promise.all([service.connect(first), service.connect(second)]);
  const winner = results.find((result) => result.status === "authorization_required");
  assert.ok(winner && "url" in winner);
  assert.equal(results.filter((result) => result.status === "pending").length, 1);
  const saved = await store.connection(first);
  assert.equal(saved?.accountId, `${accountPrefix}_${winner.url.split("/").at(-1)}`);
  // Two reconnects based on the same old account cannot overwrite the first winner.
  assert.ok(saved);
  const replacements = await Promise.all([
    store.saveConnection(first, `${accountPrefix}_replaced_a`, "ac_test", saved.accountId),
    store.saveConnection(second, `${accountPrefix}_replaced_b`, "ac_test", saved.accountId),
  ]);
  assert.equal(replacements.filter(Boolean).length, 1);
});
