import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clerkFrontendApi,
  limitMessage,
  MESSAGE_LIMITS,
  messagePeriodStart,
  planFromSubscription,
  upgradeUrl,
} from "../src/billing.js";

const item = (slug: string, status = "active") => ({ status, plan: { slug } });
const LINK = "https://example.com/pricing";

test("the free plan allows 5 messages a month", () => {
  assert.equal(MESSAGE_LIMITS.free, 5);
});

test("the plan comes from active subscription items only", () => {
  assert.equal(planFromSubscription({ subscription_items: [] }), "free");
  assert.equal(planFromSubscription({ subscription_items: [item("free_user")] }), "free");
  assert.equal(planFromSubscription({ subscription_items: [item("plus")] }), "plus");
  assert.equal(planFromSubscription({ subscription_items: [item("pro")] }), "pro");

  // Scheduled, lapsed and unrecognized plans give no paid allowance
  assert.equal(
    planFromSubscription({ subscription_items: [item("free_user"), item("pro", "upcoming")] }),
    "free",
  );
  assert.equal(planFromSubscription({ subscription_items: [item("pro", "past_due")] }), "free");
  assert.equal(planFromSubscription({ subscription_items: [item("enterprise")] }), "free");
});

test("the larger plan wins while two are active", () => {
  assert.equal(planFromSubscription({ subscription_items: [item("plus"), item("pro")] }), "pro");
  assert.equal(planFromSubscription({ subscription_items: [item("pro"), item("plus")] }), "pro");
});

test("periods are UTC calendar months, including at the edges of the month", () => {
  assert.equal(
    messagePeriodStart(new Date("2026-11-30T23:59:59Z")).toISOString(),
    "2026-11-01T00:00:00.000Z",
  );
  assert.equal(
    messagePeriodStart(new Date("2026-12-01T00:00:00Z")).toISOString(),
    "2026-12-01T00:00:00.000Z",
  );
});

test("the limit reply says when messages reset and only offers a plan that gives more", () => {
  const november = new Date("2026-11-30T23:59:59Z");

  const free = limitMessage("free", november, LINK);
  assert.match(free, /all 5 messages on your free plan/);
  assert.match(free, /reset on December 1\./);
  assert.ok(free.includes(LINK));

  const plus = limitMessage("plus", november, LINK);
  assert.match(plus, /all 100 messages on your Plus plan/);
  assert.ok(plus.includes(LINK));

  const pro = limitMessage("pro", november, LINK);
  assert.match(pro, /all 300 messages on your Pro plan/);
  assert.ok(!pro.includes(LINK));

  // December's reset rolls over into the next year
  assert.match(limitMessage("free", new Date("2026-12-15T00:00:00Z"), LINK), /reset on January 1\./);
});

test("the Frontend API host is read from the publishable key", () => {
  const encode = (host: string) => Buffer.from(`${host}$`).toString("base64");
  assert.equal(clerkFrontendApi(`pk_test_${encode("slug-1.clerk.accounts.dev")}`), "slug-1.clerk.accounts.dev");
  assert.equal(clerkFrontendApi(`pk_live_${encode("clerk.example.com")}`), "clerk.example.com");
});

test("chat replies link to the pricing page when the public domain is known", () => {
  const saved = { domain: process.env.RAILWAY_PUBLIC_DOMAIN, key: process.env.CLERK_PUBLISHABLE_KEY };
  try {
    process.env.CLERK_PUBLISHABLE_KEY = `pk_test_${Buffer.from("slug-1.clerk.accounts.dev$").toString("base64")}`;
    process.env.RAILWAY_PUBLIC_DOMAIN = "assistant.example.com";
    assert.equal(upgradeUrl(), "https://assistant.example.com/pricing");

    delete process.env.RAILWAY_PUBLIC_DOMAIN;
    assert.equal(upgradeUrl(), "https://slug-1.accounts.dev/user/billing");
  } finally {
    if (saved.domain === undefined) delete process.env.RAILWAY_PUBLIC_DOMAIN;
    else process.env.RAILWAY_PUBLIC_DOMAIN = saved.domain;
    if (saved.key === undefined) delete process.env.CLERK_PUBLISHABLE_KEY;
    else process.env.CLERK_PUBLISHABLE_KEY = saved.key;
  }
});
