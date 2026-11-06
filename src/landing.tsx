import { html, raw } from "hono/html";
import type { Child } from "hono/jsx";
import { MESSAGE_LIMITS } from "./billing.js";

// The public page at "/": what the assistant is and how to start texting it. Styles, the core script
// and icons are inline. The blob characters are served from public/blobs, and the Motion animations
// are bundled from scripts/browser into public/landing.js.

export type LandingLinks = {
  // E.164 number people text on iMessage, e.g. "+14155550123"
  imessageNumber?: string;
  // Telegram bot username without the "@"
  telegramUsername?: string;
  // Clerk Account Portal page for the account and its plan
  accountUrl?: string;
  // The plans page, left off when Clerk isn't configured because it can't load plans without it
  pricingUrl?: string;
  // Whether the Google Calendar connection is configured. Everything about it stays off the page
  // unless this is true.
  calendarEnabled?: boolean;
};

// The product's name wherever the page shows it
const NAME = "Assistant";
const TITLE = `${NAME}, a personal assistant you text`;

type Chip = { name: string; meta: string; kind: "document" | "photos" | "event" };

type Example = {
  id: string;
  tab: string;
  attachment?: Chip;
  ask: string;
  reply: string;
  file?: Chip;
};

// Illustrative conversations: each one shows a workflow the agent's tools support. They are not
// customer results, so they carry no real-looking figures, prices or outcomes.
const examples: Example[] = [
  {
    id: "checklist",
    tab: "Make a checklist",
    attachment: { name: "meeting-notes.pdf", meta: "Example attachment", kind: "document" },
    ask: "Turn these notes into a checklist.",
    reply: "Here’s the checklist, grouped by topic.",
    file: { name: "checklist.pdf", meta: "Example file", kind: "document" },
  },
  {
    id: "research",
    tab: "Research and compare",
    ask: "Compare three project tools and link your sources.",
    reply: "Here’s a one-page comparison, with the links I used.",
    file: { name: "tool-comparison.pdf", meta: "Example file", kind: "document" },
  },
  {
    id: "receipts",
    tab: "Total my receipts",
    attachment: { name: "Receipt photos", meta: "Example attachment", kind: "photos" },
    ask: "Turn these receipts into a spreadsheet.",
    reply: "Done. One row per receipt, totaled by category.",
    file: { name: "receipts.xlsx", meta: "Example spreadsheet", kind: "document" },
  },
];

const calendarExample: Example = {
  id: "event",
  tab: "Draft a calendar event",
  ask: "Put Thursday’s client call on my calendar, 3 PM Chicago time.",
  reply: "Here’s the draft. Nothing is created until you confirm.",
  file: {
    name: "confirm calendar <code>",
    meta: "Reply with the exact command from the draft",
    kind: "event",
  },
};

type BlobName =
  | "hero"
  | "computer"
  | "web"
  | "memory"
  | "crew"
  | "step-hi"
  | "step-key"
  | "step-pro"
  | "mini-sleepy"
  | "mini-wink"
  | "mini-wow";

type Ability = { title: string; body: string; blob: BlobName; tone: string; size?: number };

const abilities: Ability[] = [
  {
    title: "It has its own computer.",
    body: "Convert or merge documents, fill in forms, and build spreadsheets, charts, images and PDFs from what you send. It can click through a website when a task needs it. The finished file arrives in the chat.",
    blob: "computer",
    tone: "butter",
  },
  {
    title: "It reads the live web.",
    body: "Ask it to look something up, compare options or read a page you send. It checks the web when a question needs current facts and shares the links it used. Websites can be wrong or out of date, so check anything important.",
    blob: "web",
    tone: "lilac",
  },
  {
    title: "It keeps your place in a chat.",
    body: "Each chat keeps its own history, so a conversation in one app doesn’t carry over to another. Files on its computer are temporary and are wiped after about a week without use, so save what you want to keep.",
    blob: "memory",
    tone: "gum",
  },
];

const calendarAbility: Ability = {
  title: "It drafts calendar events for you to review.",
  body: "Ask in the chat to connect Google Calendar, then approve access from your own link. It can list upcoming events and draft a new one with an explicit timezone. The event is created on your primary calendar only after you reply with the exact command, confirm calendar <code>. It doesn’t invite anyone.",
  blob: "step-key",
  tone: "sky",
  size: 800,
};

// `channels` names the apps this deployment can be reached on, such as "iMessage and Telegram"
const steps = (channels: string): { title: string; body: string; blob: BlobName }[] => [
  {
    title: "Say hi",
    body: channels
      ? `Send any message on ${channels.replace(" and ", " or ")}. There’s no separate app to install.`
      : "Send any message from a chat link, once one is listed on this page.",
    blob: "step-hi",
  },
  {
    title: "Connect your account",
    body: "It replies with a sign-in link. Open it, sign in, and the chat is linked to you. If the link expires, send any message to get a new one.",
    blob: "step-key",
  },
  {
    title: "Ask again",
    body: `Send your request again: messages sent before you’re set up aren’t queued. Your account includes ${MESSAGE_LIMITS.free} free messages a month, and it sends an upgrade link when they run out.`,
    blob: "step-pro",
  },
];

// "+14155550123" → "+1 (415) 555-0123"; other countries are shown as entered
const displayNumber = (e164: string) => {
  const us = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return us ? `+1 (${us[1]}) ${us[2]}-${us[3]}` : e164;
};

const css = `
:root {
  color-scheme: light dark;
  --ground: #FAFAFF;
  --paper: #FFFFFF;
  --ink: #16123F;
  --muted: #5A5785;
  --line: #E1E0F2;
  --link: #0F55E6;
  --blue: #1463FF;
  --blue-deep: #0E51DB;
  --sky: #DCE8FF;
  --butter: #FFDD5C;
  --lilac: #D5CBFF;
  --gum: #FFC2DC;
  --surface: var(--ground);
  --display: "Gabarito", ui-sans-serif, system-ui, sans-serif;
  --text: "Wix Madefor Text", ui-sans-serif, system-ui, sans-serif;
  --gutter: clamp(1.25rem, 5vw, 3.5rem);
  --bubble: clamp(1.625rem, 3.5vw, 3.125rem);
  --spring: cubic-bezier(.2, .9, .25, 1.18);
}
@media (prefers-color-scheme: dark) {
  :root {
    --ground: #110E33;
    --paper: #231F5C;
    --ink: #F3F2FF;
    --muted: #ADAAD8;
    --line: #2E2A6B;
    --link: #A8C2FF;
  }
}
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
@media (prefers-reduced-motion: no-preference) {
  html { scroll-behavior: smooth; }
}
body {
  margin: 0;
  overflow-x: clip;
  background: var(--ground);
  color: var(--ink);
  font: 400 1.0625rem/1.6 var(--text);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
h1, h2, h3, p, ol { margin: 0; }
ol { padding: 0; list-style: none; }
a { color: inherit; }
img { display: block; }
:focus-visible { outline: 2px solid var(--link); outline-offset: 3px; border-radius: 6px; }
.skip {
  position: absolute; left: var(--gutter); top: -4rem;
  padding: .6rem 1rem; border-radius: 999px;
  background: var(--ink); color: var(--ground); text-decoration: none; font-weight: 600;
}
.skip:focus { top: .75rem; z-index: 3; }
main:focus { outline: none; }
.wrap { width: min(100%, 84rem); margin-inline: auto; padding-inline: var(--gutter); }

/* Header */
.top { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .5rem 1rem; padding-block: 1.25rem; }
.top-links { display: flex; flex-wrap: wrap; align-items: center; gap: .25rem 1.25rem; }
.mark {
  display: inline-flex; align-items: center; gap: .5rem;
  font: 800 1.375rem/1 var(--display); letter-spacing: -.02em; text-decoration: none;
}
.mark-blob { width: 2.25rem; height: 2.25rem; }
.quiet { font-weight: 600; font-size: .9375rem; text-decoration: none; }
.quiet:hover { text-decoration: underline; text-underline-offset: .25em; }

/* Buttons are squishy, like the characters */
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: .5rem;
  padding: 1rem 1.75rem; border-radius: 999px;
  font: 700 1.125rem/1.2 var(--display); text-decoration: none; white-space: nowrap;
  transition: transform .25s var(--spring), background-color .15s ease;
}
.btn:hover { transform: translateY(-2px) scale(1.02); }
.btn:active { transform: scale(.96, .92); }
.btn-primary {
  background: var(--blue); color: #fff;
  box-shadow: inset 0 2px 1px rgb(255 255 255 / .35), inset 0 -4px 6px rgb(6 30 120 / .35), 0 14px 28px -12px rgb(20 99 255 / .75);
}
.btn-primary:hover { background: var(--blue-deep); }
.btn-plain {
  background: var(--paper); color: var(--ink);
  box-shadow: inset 0 0 0 1.5px var(--line), inset 0 -4px 6px rgb(22 18 63 / .05);
}

/* Hero */
.hero { padding-top: clamp(1.5rem, 5vw, 4.5rem); }
.hero-copy { text-align: center; }
/* The characters stand centered on the panel below, with the image's transparent base behind it.
   The small one is placed from the center too, so it stays beside the large one at every width. */
.hero-art { --s: clamp(14rem, 24vw, 21rem); position: relative; display: flex; justify-content: center; margin-top: clamp(1rem, 2vw, 1.5rem); }
.blob-hero { width: var(--s); height: auto; margin-bottom: calc(var(--s) * -.06); }
.hero-art .blob-wow { position: absolute; right: calc(50% + var(--s) * .34); bottom: calc(var(--w) * -.28); height: auto; }
.hero h1 {
  font: 800 clamp(2.875rem, 6.6vw, 5.75rem)/.98 var(--display);
  letter-spacing: -.035em; text-wrap: balance;
}
/* Each sentence starts its own line, and wraps within itself when it doesn't fit on one */
.hero h1 span { display: inline-block; }
.hero-sub {
  margin: clamp(1.25rem, 2vw, 1.75rem) auto 0; max-width: 31rem;
  font-size: clamp(1.125rem, 1.6vw, 1.3125rem); line-height: 1.45; color: var(--muted); text-wrap: pretty;
}
.buttons { display: flex; flex-wrap: wrap; justify-content: center; gap: .75rem; margin-top: clamp(1.5rem, 3vw, 2.25rem); }
.number { display: block; margin-top: .85rem; font-size: .9375rem; font-weight: 500; color: var(--muted); font-variant-numeric: tabular-nums; }
.hero-setup { margin: .85rem auto 0; max-width: 36rem; font-size: .9375rem; font-weight: 500; color: var(--muted); text-wrap: pretty; }
.notice {
  margin: clamp(1.5rem, 3vw, 2.25rem) auto 0; max-width: 34rem;
  padding: 1rem 1.25rem; border-radius: 1.4rem;
  background: var(--paper); box-shadow: inset 0 0 0 1.5px var(--line);
  text-wrap: pretty;
}
.notice strong { display: block; font: 700 1.125rem/1.25 var(--display); }
.notice a { color: var(--link); font-weight: 600; text-underline-offset: .25em; }
.notice + .buttons { margin-top: 1rem; }

/* A stage is a colored panel with characters standing behind its top edge. The ledge has no
   height, so a character is placed against the panel's top edge and the panel hides its base. */
.stage { position: relative; isolation: isolate; }
.ledge { position: relative; height: 0; z-index: 0; }
.ledge img { position: absolute; bottom: -1.75rem; height: auto; }
.panel {
  --ink: #16123F;
  --muted: #47446F;
  --paper: #FFFFFF;
  --line: rgb(22 18 63 / .16);
  --link: #0F55E6;
  position: relative; z-index: 1;
  padding: clamp(1.5rem, 4vw, 3.75rem);
  background: var(--surface); color: var(--ink);
}
.panel.sky { --surface: var(--sky); border-radius: 3.5rem 4.5rem 3rem 5rem / 4.5rem 3.5rem 5rem 3rem; }
.panel.butter { --surface: var(--butter); border-radius: 5rem 3rem 4.5rem 3.5rem / 3.5rem 5rem 3rem 4.5rem; }
.panel.lilac { --surface: var(--lilac); border-radius: 3rem 5rem 3.5rem 4.5rem / 5rem 3rem 4.5rem 3.5rem; }
.panel.gum { --surface: var(--gum); border-radius: 4.5rem 3.5rem 5rem 3rem / 3rem 4.5rem 3.5rem 5rem; }

.mini { --w: clamp(5.5rem, 8.5vw, 8rem); width: var(--w); }

/* The conversation */
.threads { display: grid; margin-top: clamp(1.5rem, 3vw, 2.5rem); }
.thread { grid-area: 1 / 1; align-self: end; display: flex; flex-direction: column; gap: .5rem; }
html:not(.js) .thread:not(:first-child) { display: none; }
.js .thread:not(.is-active) { visibility: hidden; pointer-events: none; }
.me { align-self: flex-end; }
.them { align-self: flex-start; }
.reply-slot { position: relative; align-self: stretch; display: flex; flex-direction: column; gap: .5rem; margin-top: .75rem; }

.bubble {
  --k: .04em;
  --fill: var(--paper);
  position: relative; max-width: min(100%, 13.5em);
  padding: .34em .62em .4em; border-radius: .74em;
  background: var(--fill);
  font: 700 var(--bubble)/1.07 var(--display); letter-spacing: -.028em; text-wrap: balance;
}
.bubble::before, .bubble::after { content: ""; position: absolute; bottom: 0; height: calc(25 * var(--k)); }
.bubble::before { background: var(--fill); }
.bubble::after { background: var(--surface); }
.bubble.me { --fill: var(--blue); color: #fff; transform-origin: 100% 100%; }
.bubble.me::before { right: calc(-7 * var(--k)); width: calc(20 * var(--k)); border-bottom-left-radius: calc(16 * var(--k)) calc(14 * var(--k)); }
.bubble.me::after { right: calc(-12 * var(--k)); width: calc(12 * var(--k)); border-bottom-left-radius: calc(10 * var(--k)); }
.bubble.them { color: var(--ink); transform-origin: 0 100%; }
.bubble.them::before { left: calc(-7 * var(--k)); width: calc(20 * var(--k)); border-bottom-right-radius: calc(16 * var(--k)) calc(14 * var(--k)); }
.bubble.them::after { left: calc(-12 * var(--k)); width: calc(12 * var(--k)); border-bottom-right-radius: calc(10 * var(--k)); }
.receipt { align-self: flex-end; font-size: .8125rem; font-weight: 500; color: var(--muted); padding-right: .25rem; }

.chip {
  display: inline-flex; align-items: center; gap: .7rem;
  padding: .6rem 1.05rem .6rem .7rem; border-radius: 1.15rem;
  background: var(--paper); line-height: 1.25;
}
.chip.me { background: color-mix(in srgb, var(--blue) 16%, var(--surface)); transform-origin: 100% 100%; }
.chip.them { transform-origin: 0 100%; }
.chip svg { flex: none; width: 1.75rem; height: 1.75rem; color: var(--blue); }
.chip-name { display: block; font-weight: 600; font-size: .9375rem; }
.chip-meta { display: block; font-size: .8125rem; color: var(--muted); }

.dots {
  position: absolute; left: 0; top: 0; display: flex; align-items: center; gap: .32rem;
  padding: 1rem 1.1rem; border-radius: 1.4rem; background: var(--paper);
  opacity: 0; transform: scale(.8); transform-origin: 0 100%;
  transition: opacity .16s ease, transform .16s ease;
}
.dots i { width: .5rem; height: .5rem; border-radius: 50%; background: var(--muted); animation: dot 1.1s infinite ease-in-out both; animation-play-state: paused; }
.dots i:nth-child(2) { animation-delay: .16s; }
.dots i:nth-child(3) { animation-delay: .32s; }
.thread.typing .dots { opacity: 1; transform: none; }
.thread.typing .dots i { animation-play-state: running; }
@keyframes dot { 0%, 70%, 100% { opacity: .35; } 35% { opacity: 1; } }

.motion .thread [data-step] { opacity: 0; transform: translateY(.6rem) scale(.92); }
.motion .thread [data-step].in { opacity: 1; transform: none; transition: opacity .2s ease, transform .42s var(--spring); }
.motion .thread .receipt[data-step] { transform: none; }

.tabs { position: relative; isolation: isolate; display: none; flex-wrap: wrap; gap: .4rem; }
.js .tabs { display: flex; }
/* The pill paints above the tabs' own backgrounds, so it stays solid crossing them, and below their
   labels. landing.js adds it; until then the selected tab colors itself. */
.tab-pill { position: absolute; left: 0; top: 0; border-radius: 999px; background: var(--ink); pointer-events: none; }
.tab-label { position: relative; z-index: 1; }
.tab {
  appearance: none; border: 0; cursor: pointer;
  padding: .55rem 1rem; border-radius: 999px; background: rgb(255 255 255 / .6); color: var(--ink);
  font: 600 1rem/1.2 var(--display);
  transition: background-color .15s ease, color .15s ease, transform .25s var(--spring);
}
.tab:hover { background: #fff; }
.tab:active { transform: scale(.95); }
.tab[aria-selected="true"] { background: var(--ink); color: #fff; }
.has-pill .tab[aria-selected="true"] { background: transparent; }
.demo-note { margin-top: clamp(1.25rem, 2.5vw, 2rem); font-size: .875rem; font-weight: 500; color: var(--muted); }

/* Blobs pop up once as they arrive, and squish when you hover them */
.motion .pop { transform-origin: 50% 100%; transition: transform .7s var(--spring), opacity .2s ease; }
.motion .pop:not(.up) { opacity: 0; transform: translateY(26%) scale(.9); }
@keyframes squish {
  0% { transform: none; }
  30% { transform: scale(1.07, .92); }
  60% { transform: scale(.96, 1.05); }
  100% { transform: none; }
}
@media (hover: hover) {
  .motion .pop.up:hover { animation: squish .55s ease-out; }
}

/* What it does */
.part { padding-top: clamp(5rem, 11vw, 9rem); }
.part > h2 {
  max-width: 15ch;
  font: 800 clamp(2.5rem, 6vw, 5rem)/.98 var(--display); letter-spacing: -.035em; text-wrap: balance;
}
.abilities { display: grid; gap: clamp(5rem, 9vw, 7.5rem); margin-top: clamp(5.5rem, 9vw, 8.5rem); }
.ability { display: grid; grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); align-items: center; gap: 1rem clamp(1.5rem, 4vw, 4rem); }
.ability h3 { font: 800 clamp(2rem, 4.2vw, 3.625rem)/1 var(--display); letter-spacing: -.03em; text-wrap: balance; }
.ability p { margin-top: 1.1rem; max-width: 34rem; font-size: clamp(1.0625rem, 1.4vw, 1.1875rem); line-height: 1.5; text-wrap: pretty; }
.ability .blob {
  width: 100%; max-width: 27rem; height: auto; justify-self: center;
  margin-block: clamp(-9rem, -8vw, -4rem) clamp(-3rem, -2vw, -1rem);
  filter: drop-shadow(0 1.25rem 1.25rem rgb(22 18 63 / .16));
}
.ability.flip { grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); }
.ability.flip .blob { order: -1; }
.ledge .blob-wink { right: clamp(2rem, 9vw, 8rem); bottom: calc(var(--w) * -.22); }
.ledge .blob-sleepy { left: clamp(2.5rem, 10vw, 9rem); bottom: calc(var(--w) * -.255); }

/* Getting started: the steps walk down the page */
.steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 3rem clamp(1.5rem, 4vw, 3.5rem); margin-top: clamp(2.5rem, 5vw, 4rem); counter-reset: step; }
.step { counter-increment: step; }
.step:nth-child(2) { margin-top: 4rem; }
.step:nth-child(3) { margin-top: 8rem; }
.step .blob { width: min(100%, 15rem); height: auto; margin-left: -.5rem; filter: drop-shadow(0 1rem 1rem rgb(22 18 63 / .14)); }
.step h3 { margin-top: 1.25rem; font: 800 clamp(1.5rem, 2.4vw, 2rem)/1.08 var(--display); letter-spacing: -.024em; }
.step h3::before { content: counter(step) ". "; color: var(--link); font-variant-numeric: tabular-nums; }
.step p { margin-top: .6rem; max-width: 22rem; color: var(--muted); text-wrap: pretty; }

/* Questions. Native disclosures, so they work with a keyboard and without the script */
.stage-faq { margin-top: clamp(5rem, 9vw, 7.5rem); }
.faq { display: grid; gap: .75rem; }
.faq details { border-radius: 1.4rem; background: var(--paper); }
.faq summary {
  display: flex; align-items: center; justify-content: space-between; gap: 1rem;
  min-height: 3rem; padding: .9rem 1.25rem; border-radius: 1.4rem;
  cursor: pointer; list-style: none;
}
.faq summary::-webkit-details-marker { display: none; }
.faq summary::after {
  content: "+"; flex: none;
  font: 700 1.625rem/1 var(--display); color: var(--link);
  transition: transform .25s var(--spring);
}
.faq details[open] summary::after { transform: rotate(45deg); }
.faq h3 { font: 700 clamp(1.125rem, 1.8vw, 1.375rem)/1.2 var(--display); letter-spacing: -.015em; }
.faq-answer { display: grid; gap: .6rem; max-width: 46rem; padding: 0 1.25rem 1.1rem; color: var(--muted); text-wrap: pretty; }
.faq-answer a { color: var(--link); font-weight: 600; text-underline-offset: .25em; }
.faq-answer code {
  padding: .1em .4em; border-radius: .4em;
  background: rgb(22 18 63 / .08); color: var(--ink);
  font: 600 .9em ui-monospace, SFMono-Regular, Menlo, monospace; white-space: nowrap;
}

/* Closing */
.stage-close { margin-top: clamp(12rem, 29vw, 25rem); }
.ledge .blob-crew { left: 50%; width: min(92vw, 52rem); margin-left: calc(min(92vw, 52rem) / -2); bottom: -1.5rem; }
.panel.blue {
  --surface: var(--blue);
  --ink: #FFFFFF;
  --muted: #E6EEFF;
  border-radius: 4.5rem 5rem 3.5rem 4rem / 5rem 3.5rem 4.5rem 4rem;
  display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 2rem 3rem;
  padding-block: clamp(3rem, 7vw, 6rem);
}
.close-copy { flex: 1 1 22rem; }
.close-copy h2 { max-width: 11ch; font: 800 clamp(2.75rem, 7vw, 6rem)/.96 var(--display); letter-spacing: -.035em; text-wrap: balance; }
.close-copy p { margin-top: 1.25rem; font-size: 1.0625rem; color: var(--muted); }
.close-copy a { color: #fff; font-weight: 600; text-underline-offset: .25em; }
.close-copy a:focus-visible { outline-color: #fff; }
.close-copy .close-setup { margin-top: .5rem; font-size: .9375rem; }
.send {
  --fill: #fff;
  align-self: flex-end; margin-right: .5em;
  color: var(--blue); font-size: clamp(4.5rem, 14vw, 11rem); text-decoration: none;
  transition: transform .3s var(--spring);
}
.send.bubble.me { --fill: #fff; color: var(--blue); }
.send:hover { transform: scale(1.05) rotate(-2deg); }
.send:active { transform: scale(.94); }
.send:focus-visible { outline-color: #fff; outline-offset: 6px; border-radius: .74em; }

/* Footer */
.foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .75rem 2rem; padding-block: 2.5rem; font-size: .9375rem; color: var(--muted); }
.foot a { text-underline-offset: .25em; }

@media (max-width: 58rem) {
  .ledge .blob-wink, .ledge .blob-sleepy { display: none; }
  .stage-faq { margin-top: clamp(2.5rem, 6vw, 3.5rem); }
  .ability, .ability.flip { grid-template-columns: 1fr; }
  .ability .blob { order: -1; max-width: 17rem; margin-block: -6rem 0; }
  .steps { grid-template-columns: 1fr; }
  .step:nth-child(2), .step:nth-child(3) { margin-top: 0; }
  .step .blob { width: 11rem; }
}
@media (max-width: 34rem) {
  .bubble { max-width: 94%; }
  .send { max-width: none; }
  .buttons .btn { flex: 1 1 100%; }
  .panel.sky, .panel.butter, .panel.lilac, .panel.gum, .panel.blue { border-radius: 2.5rem 3rem 2rem 3rem / 3rem 2.5rem 3rem 2rem; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; animation: none !important; }
}
`;

// Plays the active conversation in order (attachment, message, receipt, typing, reply, file),
// swaps conversations from the tabs, and pops the blobs up. Without it, the first conversation and
// every blob are simply shown.
const script = `
(function () {
  var root = document.documentElement;
  var motion = root.classList.contains("motion");
  var tabs = Array.prototype.slice.call(document.querySelectorAll(".tab"));
  var threads = Array.prototype.slice.call(document.querySelectorAll(".thread"));
  var bubbles = Array.prototype.slice.call(document.querySelectorAll(".thread .bubble"));
  var timers = [];
  // A wrapped paragraph keeps its maximum width; a message bubble hugs its longest line
  function fit() {
    bubbles.forEach(function (bubble) {
      bubble.style.width = "";
      var box = bubble.getBoundingClientRect();
      if (!box.width || !bubble.offsetWidth) return;
      var scale = box.width / bubble.offsetWidth;
      var range = document.createRange();
      range.selectNodeContents(bubble);
      var style = getComputedStyle(bubble);
      var pad = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      bubble.style.width = Math.ceil(range.getBoundingClientRect().width / scale + pad) + 2 + "px";
    });
  }
  var queued = 0;
  window.addEventListener("resize", function () {
    cancelAnimationFrame(queued);
    queued = requestAnimationFrame(fit);
  });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
  fit();
  function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
  function play(thread, quick) {
    timers.forEach(clearTimeout); timers = [];
    threads.forEach(function (t) { t.classList.remove("typing"); });
    if (!motion) return;
    var parts = Array.prototype.slice.call(thread.querySelectorAll("[data-step]"));
    parts.forEach(function (p) { p.classList.remove("in"); });
    var at = quick ? 60 : 450;
    parts.forEach(function (p) {
      var step = p.getAttribute("data-step");
      if (step === "reply") {
        later(function () { thread.classList.add("typing"); }, at + 260);
        at += quick ? 1050 : 1500;
        later(function () { thread.classList.remove("typing"); }, at - 120);
      }
      later(function () { p.classList.add("in"); }, at);
      at += step === "ask" ? 520 : 240;
    });
  }
  function select(index, focus) {
    tabs.forEach(function (tab, i) {
      var on = i === index;
      tab.setAttribute("aria-selected", on ? "true" : "false");
      tab.tabIndex = on ? 0 : -1;
      threads[i].classList.toggle("is-active", on);
    });
    if (focus) tabs[index].focus();
    play(threads[index], true);
  }
  tabs.forEach(function (tab, i) {
    tab.addEventListener("click", function () { select(i, false); });
    tab.addEventListener("keydown", function (event) {
      var last = tabs.length - 1;
      var next =
        event.key === "ArrowRight" ? (i === last ? 0 : i + 1) :
        event.key === "ArrowLeft" ? (i === 0 ? last : i - 1) :
        event.key === "Home" ? 0 :
        event.key === "End" ? last : -1;
      if (next < 0) return;
      event.preventDefault();
      select(next, true);
    });
  });
  if (threads.length) play(threads[0], false);
  // Each blob pops up once, when it first scrolls into view
  var pops = Array.prototype.slice.call(document.querySelectorAll(".pop"));
  if (!motion) return;
  if (!("IntersectionObserver" in window)) {
    pops.forEach(function (pop) { pop.classList.add("up"); });
    return;
  }
  var watcher = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("up");
      watcher.unobserve(entry.target);
    });
  }, { threshold: 0.15 });
  pops.forEach(function (pop) { watcher.observe(pop); });
})();
`;

// Decorative: every character repeats something the text beside it already says
const Blob = ({
  name,
  class: className,
  size = 1000,
  height,
  eager,
}: {
  name: BlobName;
  class: string;
  size?: number;
  height?: number;
  eager?: boolean;
}) => (
  <img
    class={className}
    src={`/blobs/${name}.webp`}
    width={size}
    height={height ?? size}
    alt=""
    decoding="async"
    loading={eager ? "eager" : "lazy"}
  />
);

const ChipIcon = ({ kind }: { kind: Chip["kind"] }) =>
  kind === "event" ? (
    <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="4" y="6" width="20" height="18" rx="4" />
      <path d="M4 12h20M10 3.5V8M18 3.5V8" />
    </svg>
  ) : kind === "photos" ? (
    <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="4" y="5" width="20" height="18" rx="4" />
      <circle cx="10.5" cy="11.5" r="1.8" />
      <path d="m5 20 5.5-5 4 3.5 3.5-3 5.5 5" />
    </svg>
  ) : (
    <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M8.5 3.5h8l6 6V21a3.5 3.5 0 0 1-3.5 3.5h-10.5A3.5 3.5 0 0 1 5 21V7a3.5 3.5 0 0 1 3.5-3.5Z" />
      <path d="M16 4v6h6" />
    </svg>
  );

const ChipBubble = ({ chip, side, step }: { chip: Chip; side: "me" | "them"; step: string }) => (
  <div class={`chip ${side}`} data-step={step}>
    <ChipIcon kind={chip.kind} />
    <span>
      <span class="chip-name">{chip.name}</span>
      <span class="chip-meta">{chip.meta}</span>
    </span>
  </div>
);

const Thread = ({ example, first }: { example: Example; first: boolean }) => (
  <div
    class={first ? "thread is-active" : "thread"}
    id={`thread-${example.id}`}
    role="tabpanel"
    aria-labelledby={`tab-${example.id}`}
    tabindex={0}
  >
    {example.attachment && <ChipBubble chip={example.attachment} side="me" step="attachment" />}
    <p class="bubble me" data-step="ask">
      {example.ask}
    </p>
    <span class="receipt" data-step="receipt">
      Delivered
    </span>
    <div class="reply-slot">
      <span class="dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <p class="bubble them" data-step="reply">
        {example.reply}
      </p>
      {example.file && <ChipBubble chip={example.file} side="them" step="file" />}
    </div>
  </div>
);

const Question = ({ title, children }: { title: string; children: Child }) => (
  <details>
    <summary>
      <h3>{title}</h3>
    </summary>
    <div class="faq-answer">{children}</div>
  </details>
);

const Page = ({
  imessageNumber,
  telegramUsername,
  accountUrl,
  pricingUrl,
  calendarEnabled = false,
}: LandingLinks) => {
  const imessageUrl = imessageNumber && `sms:${imessageNumber}`;
  const telegramUrl = telegramUsername && `https://t.me/${telegramUsername}`;
  // Only the apps this deployment can be reached on are ever named
  const channels = [imessageUrl && "iMessage", telegramUrl && "Telegram"]
    .filter(Boolean)
    .join(" and ");
  // The first way to reach the assistant that is configured. The account page isn't one: it can't
  // take a message, so it never gets the "one message away" closing.
  const start = imessageUrl
    ? { href: imessageUrl, label: "Text it on iMessage" }
    : telegramUrl
      ? { href: telegramUrl, label: "Open in Telegram" }
      : undefined;
  const shownExamples = calendarEnabled ? [...examples, calendarExample] : examples;
  const shownAbilities = calendarEnabled ? [...abilities, calendarAbility] : abilities;
  const description = `Text it what you need. It has its own computer and live access to the web, so it sends back the finished file or the answer.${
    channels ? ` Works in ${channels}.` : ""
  } Free accounts include ${MESSAGE_LIMITS.free} messages a month.`;

  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{TITLE}</title>
        <meta name="description" content={description} />
        <meta property="og:title" content={TITLE} />
        <meta property="og:description" content={description} />
        <meta property="og:type" content="website" />
        <meta name="theme-color" content="#FAFAFF" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#110E33" media="(prefers-color-scheme: dark)" />
        <link
          rel="icon"
          href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%231463FF' d='M12 2.5c5.6 0 10 3.9 10 8.9s-4.4 8.9-10 8.9c-1.1 0-2.2-.2-3.2-.4-1.3 1.3-3 2-5 2.1 1.1-1.1 1.7-2.5 1.7-4C3.4 16.3 2 14 2 11.4c0-5 4.4-8.9 10-8.9Z'/%3E%3C/svg%3E"
        />
        <link rel="preload" as="image" href="/blobs/hero.webp" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Gabarito:wght@500..900&family=Wix+Madefor+Text:wght@400..700&display=swap"
        />
        <style>{raw(css)}</style>
        <script>
          {raw(
            `document.documentElement.classList.add("js");if(!matchMedia("(prefers-reduced-motion: reduce)").matches)document.documentElement.classList.add("motion");`,
          )}
        </script>
      </head>
      <body>
        <a class="skip" href="#main">
          Skip to content
        </a>
        <header class="wrap top">
          <a class="mark" href="/" aria-label={`${NAME} home`}>
            <Blob name="hero" class="mark-blob" size={1200} eager />
            {NAME}
          </a>
          <nav class="top-links" aria-label="On this page">
            <a class="quiet" href="#how-it-works">
              How it works
            </a>
            <a class="quiet" href="#questions">
              Questions
            </a>
            {pricingUrl && (
              <a class="quiet" href={pricingUrl}>
                Pricing
              </a>
            )}
            {accountUrl && (
              <a class="quiet" href={accountUrl}>
                Account
              </a>
            )}
          </nav>
        </header>

        <main id="main" tabindex={-1}>
          <section class="wrap hero" aria-labelledby="hero-title">
            <div class="hero-copy">
              <h1 id="hero-title">
                <span>Text it what you need.</span> <span>Get the finished thing back.</span>
              </h1>
              <p class="hero-sub">
                A personal assistant{channels ? ` in ${channels}` : " you text"}, with its own computer and
                the live web.
              </p>
              {!start && (
                <p class="notice" id="chat-unavailable">
                  <strong>Chat links aren’t available right now.</strong>
                  There’s nowhere to start a chat from this page yet, so please check back later.
                </p>
              )}
              {(start || accountUrl) && (
                <div class="buttons">
                  {imessageUrl && (
                    <a class="btn btn-primary" href={imessageUrl}>
                      Text it on iMessage
                    </a>
                  )}
                  {telegramUrl && (
                    <a class={imessageUrl ? "btn btn-plain" : "btn btn-primary"} href={telegramUrl}>
                      Open in Telegram
                    </a>
                  )}
                  {!start && accountUrl && (
                    <a class="btn btn-primary" href={accountUrl}>
                      Account and billing
                    </a>
                  )}
                </div>
              )}
              {imessageNumber && <span class="number">or text {displayNumber(imessageNumber)}</span>}
              <p class="hero-setup">
                Free accounts include {MESSAGE_LIMITS.free} messages a month.
                {start && " The chat walks you through setup."}
              </p>
            </div>
            <div class="hero-art">
              <Blob name="hero" class="blob-hero pop" size={1200} eager />
              <Blob name="mini-wow" class="mini blob-wow pop" size={480} eager />
            </div>

            <div class="stage stage-demo">
              <div class="panel sky">
                <div class="tabs" role="tablist" aria-label="Illustrative example conversations">
                  {shownExamples.map((example, index) => (
                    <button
                      type="button"
                      class="tab"
                      role="tab"
                      id={`tab-${example.id}`}
                      aria-controls={`thread-${example.id}`}
                      aria-selected={index === 0 ? "true" : "false"}
                      tabindex={index === 0 ? 0 : -1}
                    >
                      <span class="tab-label">{example.tab}</span>
                    </button>
                  ))}
                </div>
                <div class="threads">
                  {shownExamples.map((example, index) => (
                    <Thread example={example} first={index === 0} />
                  ))}
                </div>
                <p class="demo-note">
                  Illustrative examples of supported tasks, not real conversations or customer results.
                </p>
              </div>
            </div>
          </section>

          <section class="wrap part" aria-labelledby="abilities-title">
            <h2 id="abilities-title">Ask for the result, not the how-to.</h2>
            <div class="abilities">
              {shownAbilities.map((ability, index) => (
                <div class="stage">
                  {ability.blob === "web" && (
                    <div class="ledge">
                      <Blob name="mini-wink" class="mini blob-wink pop" size={480} />
                    </div>
                  )}
                  {ability.blob === "memory" && (
                    <div class="ledge">
                      <Blob name="mini-sleepy" class="mini blob-sleepy pop" size={480} />
                    </div>
                  )}
                  <div class={`panel ${ability.tone} ability${index % 2 ? " flip" : ""}`}>
                    <div>
                      <h3>{ability.title}</h3>
                      <p>{ability.body}</p>
                    </div>
                    <Blob name={ability.blob} class="blob pop" size={ability.size} />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section class="wrap part" id="how-it-works" aria-labelledby="how-it-works-title">
            <h2 id="how-it-works-title">Start with a text.</h2>
            <ol class="steps">
              {steps(channels).map((step) => (
                <li class="step">
                  <Blob name={step.blob} class="blob pop" size={800} />
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </li>
              ))}
            </ol>
          </section>

          <section class="wrap part" id="questions" aria-labelledby="questions-title">
            <h2 id="questions-title">Before you start.</h2>
            <div class="stage stage-faq">
              <div class="ledge">
                <Blob name="mini-wink" class="mini blob-wink pop" size={480} />
              </div>
              <div class="panel lilac faq">
                <Question title="What do I need to start?">
                  <p>
                    Just an account. Send a message and it replies with a sign-in link. Every account
                    includes {MESSAGE_LIMITS.free} free messages a month, and it sends an upgrade link
                    when they run out.
                  </p>
                </Question>
                <Question title="Why do I have to send my first request again?">
                  <p>
                    Messages sent before you’re signed in, or after your messages run out, aren’t
                    queued or replayed. Once you’re set up, send your request again and it will start
                    working on it.
                  </p>
                </Question>
                <Question title="What does it cost?">
                  <p>
                    It’s free for {MESSAGE_LIMITS.free} messages a month, and paid plans include more
                    {pricingUrl ? (
                      <>
                        : <a href={pricingUrl}>see plans and prices</a>.
                      </>
                    ) : (
                      "."
                    )}{" "}
                    Usage limits apply, so a large or costly request may be stopped.
                  </p>
                </Question>
                <Question title="What does it keep, and for how long?">
                  <p>
                    Each chat keeps its own history, and a conversation in one app doesn’t carry over
                    to another.
                  </p>
                  <p>
                    Files on its computer are temporary. They’re wiped after about a week without use,
                    so save anything you want to keep from the chat.
                  </p>
                </Question>
                <Question title="Should I check its work?">
                  <p>
                    Yes. Review files and answers before you rely on them. Answers about the web come
                    from the pages it finds, which can be wrong or out of date.
                  </p>
                </Question>
                {calendarEnabled && (
                  <Question title="How does Google Calendar work?">
                    <p>
                      Ask in the chat to connect your calendar, then approve access from the personal
                      link it sends. It can list upcoming events and draft a new one with an explicit
                      timezone.
                    </p>
                    <p>
                      Review the draft. The event is created only after you reply with the exact
                      command it gives you: <code>confirm calendar {"<code>"}</code>.
                    </p>
                    <p>
                      It only uses your primary Google calendar. It doesn’t add attendees, invite
                      anyone or send anything on its own.
                    </p>
                  </Question>
                )}
              </div>
            </div>
          </section>

          {start && (
            <section class="wrap">
              <div class="stage stage-close">
                <div class="ledge">
                  <Blob name="crew" class="blob-crew pop" size={1600} height={1000} />
                </div>
                <div class="panel blue">
                  <div class="close-copy">
                    <h2>It’s one message away.</h2>
                    <p>
                      {imessageNumber ? (
                        `Text it on iMessage at ${displayNumber(imessageNumber)}`
                      ) : (
                        <a href={start.href}>{start.label}</a>
                      )}
                      {imessageUrl && telegramUrl && (
                        <>
                          , or <a href={telegramUrl}>open in Telegram</a>
                        </>
                      )}
                    </p>
                    <p class="close-setup">
                      You’ll sign in first. Your account includes {MESSAGE_LIMITS.free} free messages a
                      month.
                    </p>
                  </div>
                  <a class="bubble me send" href={start.href} aria-label={`Say Hi: ${start.label}`}>
                    Hi
                  </a>
                </div>
              </div>
            </section>
          )}
        </main>

        <footer class="wrap">
          <div class="foot">
            <span>
              {NAME}, {new Date().getUTCFullYear()}
            </span>
            {accountUrl && <a href={accountUrl}>Account and billing</a>}
          </div>
        </footer>
        <script>{raw(script)}</script>
        <script src="/landing.js" defer />
      </body>
    </html>
  );
};

export const landingPage = (links: LandingLinks) => html`<!doctype html>${(<Page {...links} />)}`;
