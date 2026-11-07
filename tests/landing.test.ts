import assert from "node:assert/strict";
import { test } from "node:test";
import { type LandingLinks, landingPage } from "../src/landing.js";

const NUMBER = "+14155550123";
const USERNAME = "assistant_bot";
const ACCOUNT = "https://accounts.example.com/user/billing";

const render = async (links: LandingLinks = {}) => String(await landingPage(links));

// What a reader sees: no inline styles or script, tags removed, entities and spacing normalized
const visibleText = (page: string) =>
  page
    .replace(/<(style|script)\b[\s\S]*?<\/\1>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replace(/\s+/g, " ")
    .replace(/ ([.,])/g, "$1");

// The opening tags of the elements that carry a given class, in document order
const elements = (page: string, className: string) =>
  [...page.matchAll(/<[a-z][^>]*>/g)]
    .map(([tag]) => tag)
    .filter((tag) => /\bclass="([^"]*)"/.exec(tag)?.[1].split(" ").includes(className));

const attribute = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];

const hrefs = (page: string, className: string) =>
  elements(page, className).map((tag) => attribute(tag, "href"));

const heroButtons = (page: string) =>
  elements(page, "btn").map((tag) => ({
    href: attribute(tag, "href"),
    primary: tag.includes("btn-primary"),
  }));

const metaDescription = (page: string) =>
  /<meta name="description" content="([^"]*)"/.exec(page)?.[1] ?? "";

const closingSend = (page: string) => elements(page, "send")[0];

test("with no configuration the page says chat is unavailable and links nowhere", async () => {
  const page = await render();
  const text = visibleText(page);

  assert.match(text, /Chat links aren’t available right now\./);
  assert.deepEqual(heroButtons(page), []);
  assert.equal(closingSend(page), undefined);
  assert.doesNotMatch(text, /one message away/);
  assert.doesNotMatch(page, /href="(sms:|https:\/\/t\.me)/);
  assert.doesNotMatch(page, /undefined/);

  // Neither app is reachable here, so neither is named or advertised
  assert.doesNotMatch(page, /iMessage|Telegram/);
  assert.doesNotMatch(text, /Account and billing|account and billing page/);

  // The explanation of how the product works stays useful in this state
  assert.match(text, /How it works/);
  assert.match(text, /Free accounts include 5 messages a month\./);
  assert.doesNotMatch(text, /The chat walks you through/);
  assert.doesNotMatch(text, /see plans and prices/);
});

test("iMessage and Telegram together: iMessage leads and Telegram stays reachable", async () => {
  const page = await render({ imessageNumber: NUMBER, telegramUsername: USERNAME });
  const text = visibleText(page);

  assert.deepEqual(heroButtons(page), [
    { href: `sms:${NUMBER}`, primary: true },
    { href: `https://t.me/${USERNAME}`, primary: false },
  ]);
  assert.match(text, /or text \+1 \(415\) 555-0123/);
  assert.match(text, /in iMessage and Telegram, with its own computer/);
  assert.match(text, /Send any message on iMessage or Telegram\./);
  assert.match(metaDescription(page), /Works in iMessage and Telegram\./);
  assert.doesNotMatch(text, /Chat links aren’t available/);

  // The closing bubble's name includes the word it shows, so voice control can find it
  const send = closingSend(page);
  assert.equal(attribute(send, "href"), `sms:${NUMBER}`);
  assert.equal(attribute(send, "aria-label"), "Say Hi: Text it on iMessage");
  assert.match(text, /Text it on iMessage at \+1 \(415\) 555-0123, or open in Telegram/);
});

test("a single configured app is the only one the page mentions", async () => {
  const telegramOnly = await render({ telegramUsername: USERNAME });
  assert.deepEqual(heroButtons(telegramOnly), [
    { href: `https://t.me/${USERNAME}`, primary: true },
  ]);
  assert.equal(attribute(closingSend(telegramOnly), "href"), `https://t.me/${USERNAME}`);
  assert.match(visibleText(telegramOnly), /Send any message on Telegram\./);
  assert.doesNotMatch(telegramOnly, /iMessage|href="sms:/);

  const imessageOnly = await render({ imessageNumber: NUMBER });
  assert.deepEqual(heroButtons(imessageOnly), [{ href: `sms:${NUMBER}`, primary: true }]);
  assert.equal(attribute(closingSend(imessageOnly), "href"), `sms:${NUMBER}`);
  assert.match(visibleText(imessageOnly), /Send any message on iMessage\./);
  assert.doesNotMatch(imessageOnly, /Telegram|t\.me/);
});

test("non-US numbers are shown as entered", async () => {
  const page = await render({ imessageNumber: "+442071838750" });
  assert.match(visibleText(page), /or text \+442071838750/);
});

test("an account link alone does not pretend to be a way to message the assistant", async () => {
  const page = await render({ accountUrl: ACCOUNT });
  const text = visibleText(page);

  assert.deepEqual(heroButtons(page), [{ href: ACCOUNT, primary: true }]);
  assert.match(text, /Chat links aren’t available right now\./);
  assert.equal(closingSend(page), undefined);
  assert.doesNotMatch(text, /one message away/);
  assert.match(text, /Account and billing/);
  assert.ok(hrefs(page, "quiet").includes(ACCOUNT), "the header links to the account page");
});

test("the pricing page is linked from the header and the cost answer when it's available", async () => {
  const page = await render({ telegramUsername: USERNAME, pricingUrl: "/pricing" });
  assert.ok(hrefs(page, "quiet").includes("/pricing"));
  assert.match(visibleText(page), /It’s free for 5 messages a month, and paid plans include more: see plans and prices\./);
  assert.match(page, /<a href="\/pricing">see plans and prices<\/a>/);
});

test("the account link is left out everywhere when it isn't configured", async () => {
  const page = await render({ telegramUsername: USERNAME });
  const text = visibleText(page);
  assert.doesNotMatch(text, /account and billing/i);
  assert.match(text, /paid plans include more\. Usage limits apply/);
  assert.deepEqual(hrefs(page, "quiet"), ["#how-it-works", "#questions"]);
});

test("the setup path matches what the channel gate and linking flow do", async () => {
  const page = await render({ imessageNumber: NUMBER, accountUrl: ACCOUNT });
  const text = visibleText(page);

  assert.match(text, /Free accounts include 5 messages a month\. The chat walks you through setup\./);
  assert.match(text, /It replies with a sign-in link\./);
  assert.match(text, /If the link expires, send any message to get a new one\./);
  assert.match(text, /includes 5 free messages a month, and it sends an upgrade link when they run out\./);
  assert.doesNotMatch(text, /active Pro plan/);

  // The first request is not replayed after sign-in: src/trigger/link-account.ts asks for a resend
  assert.match(text, /Send your request again: messages sent before you’re set up aren’t queued\./);
  assert.match(text, /Messages sent before you’re signed in, or after your messages run out, aren’t queued or replayed\./);

  assert.match(metaDescription(page), /Free accounts include 5 messages a month\./);
});

test("retention copy matches the computer and per-channel chat behavior", async () => {
  const page = await render({ imessageNumber: NUMBER, telegramUsername: USERNAME });
  const text = visibleText(page);

  assert.match(text, /Files on its computer are temporary/);
  assert.match(text, /wiped after about a week without use/);
  assert.match(text, /Each chat keeps its own conversation history/);
  assert.match(text, /a conversation in one app doesn’t carry over to another/);
  // Memory and reminders are core, so they are explained whatever else is configured
  assert.match(text, /It remembers what you tell it\./);
  assert.match(text, /It texts you when it’s time\./);
  assert.match(text, /Can it remind me of things\?/);
  assert.match(text, /won’t keep passwords, codes or card numbers/);
  assert.ok(elements(page, "tab").some((tag) => attribute(tag, "id") === "tab-reminder"));
  assert.doesNotMatch(text, /whichever app you text from/);
});

test("the page makes no claim the product or its research can't support", async () => {
  const fullyConfigured: LandingLinks = {
    imessageNumber: NUMBER,
    telegramUsername: USERNAME,
    accountUrl: ACCOUNT,
    calendarEnabled: true,
  };
  for (const links of [{}, fullyConfigured]) {
    const page = await render(links);
    const text = visibleText(page);

    // Illustrative tasks that read as real results, or that the research says not to lead with
    assert.doesNotMatch(text, /\blease|\bsign(ed|s)? (my|your|a|the)\b|\bsigning\b/i);
    assert.doesNotMatch(text, /ticket|flight|hotel|Lisbon/i);
    assert.doesNotMatch(text, /\$\s?\d/, "no dollar figures: not a price and not an example result");

    // Commercial and legal promises nobody has made
    assert.doesNotMatch(text, /free trial|unlimited|money.?back|guarantee|encrypt|\b(HIPAA|GDPR|SOC ?2)\b/i);
    assert.doesNotMatch(page, /mailto:|[a-z0-9._-]+@[a-z0-9-]+\.[a-z]{2,}/i);
    assert.doesNotMatch(text, /terms of service|privacy policy/i);

    assert.match(text, /Usage limits apply/);
    assert.match(text, /Illustrative examples of supported tasks, not real conversations or customer results\./);
  }
});

test("calendar is absent from the whole page unless enabled", async () => {
  const configured: LandingLinks = {
    imessageNumber: NUMBER,
    telegramUsername: USERNAME,
    accountUrl: ACCOUNT,
  };
  for (const links of [configured, { ...configured, calendarEnabled: false }, {}]) {
    const page = await render(links);
    assert.doesNotMatch(page, /calendar|composio|attendee/i);
    // The stylesheet comes from Google Fonts, so this one only looks at what a reader sees
    assert.doesNotMatch(visibleText(page), /google/i);
    assert.doesNotMatch(metaDescription(page), /google/i);
    assert.equal(elements(page, "tab").length, 4);
    assert.equal(elements(page, "thread").length, 4);
  }
});

test("enabled calendar is described as reviewed and confirmed, not autonomous", async () => {
  const page = await render({ telegramUsername: USERNAME, calendarEnabled: true });
  const text = visibleText(page);

  // The escaped placeholder proves the angle brackets can't be parsed as a tag
  assert.match(page, /confirm calendar &lt;code&gt;/);
  assert.doesNotMatch(page, /confirm calendar <code>/);

  assert.ok(elements(page, "tab").some((tag) => attribute(tag, "id") === "tab-event"));
  assert.match(text, /Draft a calendar event/);
  assert.match(text, /Nothing is created until you confirm\./);
  assert.match(text, /Reply with the exact command from the draft/);

  assert.match(text, /How does Google Calendar work\?/);
  assert.match(text, /Ask in the chat to connect your calendar/);
  assert.match(text, /approve access from the personal link it sends/);
  assert.match(text, /list upcoming events and draft a new one with an explicit timezone/);
  assert.match(text, /created only after you reply with the exact command/);
  assert.match(text, /only uses your primary Google calendar/);
  assert.match(text, /doesn’t add attendees, invite anyone or send anything on its own/);

  // It is configured, not proven: no claim of verified or completed events
  assert.doesNotMatch(text, /verified|tested|added to your calendar|event created|invites? (your|guests)/i);
});

test("calendar enablement never adds a way in or changes the channel list", async () => {
  const page = await render({ calendarEnabled: true });
  assert.deepEqual(heroButtons(page), []);
  assert.match(visibleText(page), /Chat links aren’t available right now\./);
  assert.doesNotMatch(page, /iMessage|Telegram/);
});

test("the example tabs and panels are correctly associated", async () => {
  for (const calendarEnabled of [false, true]) {
    const page = await render({ telegramUsername: USERNAME, calendarEnabled });
    const tabs = elements(page, "tab");
    const panels = elements(page, "thread");

    assert.equal(tabs.length, panels.length);
    assert.equal(tabs.filter((tab) => attribute(tab, "aria-selected") === "true").length, 1);
    assert.equal(attribute(tabs[0], "aria-selected"), "true");
    assert.equal(attribute(tabs[0], "tabindex"), "0");
    for (const tab of tabs.slice(1)) assert.equal(attribute(tab, "tabindex"), "-1");

    tabs.forEach((tab, index) => {
      assert.equal(attribute(tab, "role"), "tab");
      assert.equal(attribute(tab, "aria-controls"), attribute(panels[index], "id"));
      assert.equal(attribute(panels[index], "aria-labelledby"), attribute(tab, "id"));
      assert.equal(attribute(panels[index], "role"), "tabpanel");
      assert.equal(attribute(panels[index], "tabindex"), "0");
    });
  }
});

test("the document structure is navigable", async () => {
  const page = await render({ imessageNumber: NUMBER, calendarEnabled: true });

  assert.match(page, /^<!doctype html>/i);
  assert.match(page, /<html lang="en">/);
  assert.equal(page.match(/<h1\b/g)?.length, 1);
  assert.match(page, /<a class="skip" href="#main">/);
  assert.match(page, /<main id="main" tabindex="-1">/);

  // Every id reference resolves, including the in-page links and section labels
  const ids = new Set([...page.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  const references = [
    ...[...page.matchAll(/\baria-(?:labelledby|controls)="([^"]+)"/g)].map((match) => match[1]),
    ...[...page.matchAll(/\bhref="#([^"]+)"/g)].map((match) => match[1]),
  ];
  assert.ok(references.length > 0);
  for (const reference of references) assert.ok(ids.has(reference), `${reference} has no target`);

  // Characters only repeat nearby text, so each one is decorative
  const images = [...page.matchAll(/<img\b[^>]*>/g)].map(([tag]) => tag);
  assert.ok(images.length > 0);
  for (const image of images) {
    assert.equal(attribute(image, "alt"), "");
    assert.match(attribute(image, "src") ?? "", /^\/blobs\/[a-z-]+\.webp$/);
  }

  // Questions use native disclosures, each with its own heading
  const questions = page.match(/<details>/g)?.length ?? 0;
  assert.equal(questions, 7);
  assert.equal(page.match(/<summary><h3>/g)?.length, questions);
});

test("the headline reads as one sentence pair and the animations come from the served bundle", async () => {
  const page = await render({ imessageNumber: NUMBER });
  assert.match(visibleText(page), /Text it what you need\. Get the finished thing back\./);
  assert.match(page, /<script src="\/landing\.js" defer/);
  assert.equal(elements(page, "tab-label").length, elements(page, "tab").length);
});

test("each question disclosure exists without the calendar answer", async () => {
  const page = await render({ imessageNumber: NUMBER });
  assert.equal(page.match(/<details>/g)?.length, 6);
});

test("the product name comes from configuration and defaults to Assistant", async () => {
  const plain = await render({ imessageNumber: NUMBER });
  assert.match(plain, /<title>Assistant, a personal assistant you text<\/title>/);
  assert.match(visibleText(plain), /Assistant, \d{4}/);

  const named = await render({ imessageNumber: NUMBER, productName: " Ossie " });
  assert.match(named, /<title>Ossie, a personal assistant you text<\/title>/);
  assert.match(named, /aria-label="Ossie home"/);
  assert.match(visibleText(named), /Ossie, \d{4}/);
  assert.doesNotMatch(named, /Assistant,/);

  // Blank configuration is the same as none
  assert.match(await render({ productName: "   " }), /<title>Assistant, a personal assistant you text<\/title>/);
});
