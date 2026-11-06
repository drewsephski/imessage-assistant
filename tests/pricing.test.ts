import assert from "node:assert/strict";
import { test } from "node:test";
import { pricingPage } from "../src/pricing.js";

const page = async () =>
  String(
    await pricingPage({
      publishableKey: "pk_test_abc",
      frontendApi: "slug-1.clerk.accounts.dev",
    }),
  );

test("the page loads Clerk's UI before clerk-js, from the instance's own host", async () => {
  const html = await page();
  const ui = html.indexOf("https://slug-1.clerk.accounts.dev/npm/@clerk/ui@1/dist/ui.browser.js");
  const js = html.indexOf("https://slug-1.clerk.accounts.dev/npm/@clerk/clerk-js@6/dist/clerk.browser.js");
  assert.ok(ui > 0 && js > ui);
  assert.match(html, /data-clerk-publishable-key="pk_test_abc"/);
});

test("the cards are mounted by Clerk, with a fallback if they can't load", async () => {
  const html = await page();
  assert.match(html, /<div id="pricing-table">/);
  assert.match(html, /Clerk\.mountPricingTable\(table/);
  assert.match(html, /ClerkUI: window\.__internal_ClerkUICtor/);
  assert.match(html, /Plans couldn’t load/);
});

test("prices stay in Clerk, and the allowance rules are stated", async () => {
  const html = await page();
  const text = html.replace(/<(style|script)\b[\s\S]*?<\/\1>/g, " ");
  assert.doesNotMatch(text, /\$\s?\d/);
  assert.match(text, /Start free with 5 messages a month\./);
  assert.match(text, /reset on the first of each month/);
  assert.match(text, /Usage limits apply/);
});
