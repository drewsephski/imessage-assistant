import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "hono/jsx/jsx-runtime";
import { html, raw } from "hono/html";
// The product's name wherever the page shows it
const NAME = "Assistant";
const TITLE = `${NAME}, a personal assistant you text`;
// Illustrative conversations: each one shows a workflow the agent's tools support. They are not
// customer results, so they carry no real-looking figures, prices or outcomes.
const examples = [
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
const calendarExample = {
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
const abilities = [
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
const calendarAbility = {
    title: "It drafts calendar events for you to review.",
    body: "Ask in the chat to connect Google Calendar, then approve access from your own link. It can list upcoming events and draft a new one with an explicit timezone. The event is created on your primary calendar only after you reply with the exact command, confirm calendar <code>. It doesn’t invite anyone.",
    blob: "step-key",
    tone: "sky",
    size: 800,
};
// `channels` names the apps this deployment can be reached on, such as "iMessage and Telegram"
const steps = (channels) => [
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
        title: "Go Pro, then ask again",
        body: "It needs an active Pro plan, and it sends the upgrade link if you don’t have one. Then send your request again: messages sent before you’re set up aren’t queued.",
        blob: "step-pro",
    },
];
// "+14155550123" → "+1 (415) 555-0123"; other countries are shown as entered
const displayNumber = (e164) => {
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
/* The copy and its characters are columns that both end at the panel below. The left column never
   gets narrower than the two buttons side by side. */
.hero-main {
  display: grid; grid-template-columns: minmax(26.5rem, 1fr) minmax(0, 1.1fr);
  column-gap: clamp(1rem, 3vw, 3rem); align-items: end;
}
.hero-copy { padding-bottom: clamp(2rem, 3vw, 2.75rem); }
/* The image has 6% transparent padding per side. Sizing and offsetting it by that much puts the
   artwork's right edge on the page's right edge, under the nav, and its base behind the panel. */
.hero-art { position: relative; display: flex; justify-content: flex-end; }
.blob-hero { flex: none; width: 118%; height: auto; margin: 0 -7.08% -7.08% 0; }
.hero-art .blob-wow { position: absolute; left: -8%; bottom: calc(var(--w) * -.28); height: auto; }
.hero h1 {
  font: 800 clamp(2.875rem, 6.6vw, 5.75rem)/.98 var(--display);
  letter-spacing: -.035em; text-wrap: balance;
}
.hero-sub {
  margin-top: clamp(1.25rem, 2vw, 1.75rem); max-width: 31rem;
  font-size: clamp(1.125rem, 1.6vw, 1.3125rem); line-height: 1.45; color: var(--muted); text-wrap: pretty;
}
.buttons { display: flex; flex-wrap: wrap; gap: .75rem; margin-top: clamp(1.5rem, 3vw, 2.25rem); }
.number { display: block; margin-top: .85rem; font-size: .9375rem; font-weight: 500; color: var(--muted); font-variant-numeric: tabular-nums; }
.hero-setup { margin-top: .85rem; max-width: 31rem; font-size: .9375rem; font-weight: 500; color: var(--muted); text-wrap: pretty; }
.notice {
  margin-top: clamp(1.5rem, 3vw, 2.25rem); max-width: 34rem;
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
  .hero-main { grid-template-columns: minmax(0, 1fr); }
  .hero-copy { padding-bottom: 0; }
  .blob-hero { --s: clamp(15rem, 50vw, 26rem); width: var(--s); margin: 0 0 calc(var(--s) * -.06); }
  .hero-art .blob-wow { left: 1.5rem; }
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
const Blob = ({ name, class: className, size = 1000, height, eager, }) => (_jsx("img", { class: className, src: `/blobs/${name}.webp`, width: size, height: height ?? size, alt: "", decoding: "async", loading: eager ? "eager" : "lazy" }));
const ChipIcon = ({ kind }) => kind === "event" ? (_jsxs("svg", { viewBox: "0 0 28 28", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", children: [_jsx("rect", { x: "4", y: "6", width: "20", height: "18", rx: "4" }), _jsx("path", { d: "M4 12h20M10 3.5V8M18 3.5V8" })] })) : kind === "photos" ? (_jsxs("svg", { viewBox: "0 0 28 28", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", children: [_jsx("rect", { x: "4", y: "5", width: "20", height: "18", rx: "4" }), _jsx("circle", { cx: "10.5", cy: "11.5", r: "1.8" }), _jsx("path", { d: "m5 20 5.5-5 4 3.5 3.5-3 5.5 5" })] })) : (_jsxs("svg", { viewBox: "0 0 28 28", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", children: [_jsx("path", { d: "M8.5 3.5h8l6 6V21a3.5 3.5 0 0 1-3.5 3.5h-10.5A3.5 3.5 0 0 1 5 21V7a3.5 3.5 0 0 1 3.5-3.5Z" }), _jsx("path", { d: "M16 4v6h6" })] }));
const ChipBubble = ({ chip, side, step }) => (_jsxs("div", { class: `chip ${side}`, "data-step": step, children: [_jsx(ChipIcon, { kind: chip.kind }), _jsxs("span", { children: [_jsx("span", { class: "chip-name", children: chip.name }), _jsx("span", { class: "chip-meta", children: chip.meta })] })] }));
const Thread = ({ example, first }) => (_jsxs("div", { class: first ? "thread is-active" : "thread", id: `thread-${example.id}`, role: "tabpanel", "aria-labelledby": `tab-${example.id}`, tabindex: 0, children: [example.attachment && _jsx(ChipBubble, { chip: example.attachment, side: "me", step: "attachment" }), _jsx("p", { class: "bubble me", "data-step": "ask", children: example.ask }), _jsx("span", { class: "receipt", "data-step": "receipt", children: "Delivered" }), _jsxs("div", { class: "reply-slot", children: [_jsxs("span", { class: "dots", "aria-hidden": "true", children: [_jsx("i", {}), _jsx("i", {}), _jsx("i", {})] }), _jsx("p", { class: "bubble them", "data-step": "reply", children: example.reply }), example.file && _jsx(ChipBubble, { chip: example.file, side: "them", step: "file" })] })] }));
const Question = ({ title, children }) => (_jsxs("details", { children: [_jsx("summary", { children: _jsx("h3", { children: title }) }), _jsx("div", { class: "faq-answer", children: children })] }));
const Page = ({ imessageNumber, telegramUsername, accountUrl, calendarEnabled = false, }) => {
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
    const description = `Text it what you need. It has its own computer and live access to the web, so it sends back the finished file or the answer.${channels ? ` Works in ${channels}.` : ""} Requires an account with an active Pro plan.`;
    return (_jsxs("html", { lang: "en", children: [_jsxs("head", { children: [_jsx("meta", { charset: "utf-8" }), _jsx("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }), _jsx("title", { children: TITLE }), _jsx("meta", { name: "description", content: description }), _jsx("meta", { property: "og:title", content: TITLE }), _jsx("meta", { property: "og:description", content: description }), _jsx("meta", { property: "og:type", content: "website" }), _jsx("meta", { name: "theme-color", content: "#FAFAFF", media: "(prefers-color-scheme: light)" }), _jsx("meta", { name: "theme-color", content: "#110E33", media: "(prefers-color-scheme: dark)" }), _jsx("link", { rel: "icon", href: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%231463FF' d='M12 2.5c5.6 0 10 3.9 10 8.9s-4.4 8.9-10 8.9c-1.1 0-2.2-.2-3.2-.4-1.3 1.3-3 2-5 2.1 1.1-1.1 1.7-2.5 1.7-4C3.4 16.3 2 14 2 11.4c0-5 4.4-8.9 10-8.9Z'/%3E%3C/svg%3E" }), _jsx("link", { rel: "preload", as: "image", href: "/blobs/hero.webp" }), _jsx("link", { rel: "preconnect", href: "https://fonts.googleapis.com" }), _jsx("link", { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" }), _jsx("link", { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Gabarito:wght@500..900&family=Wix+Madefor+Text:wght@400..700&display=swap" }), _jsx("style", { children: raw(css) }), _jsx("script", { children: raw(`document.documentElement.classList.add("js");if(!matchMedia("(prefers-reduced-motion: reduce)").matches)document.documentElement.classList.add("motion");`) })] }), _jsxs("body", { children: [_jsx("a", { class: "skip", href: "#main", children: "Skip to content" }), _jsxs("header", { class: "wrap top", children: [_jsxs("a", { class: "mark", href: "/", "aria-label": `${NAME} home`, children: [_jsx(Blob, { name: "hero", class: "mark-blob", size: 1200, eager: true }), NAME] }), _jsxs("nav", { class: "top-links", "aria-label": "On this page", children: [_jsx("a", { class: "quiet", href: "#how-it-works", children: "How it works" }), _jsx("a", { class: "quiet", href: "#questions", children: "Questions" }), accountUrl && (_jsx("a", { class: "quiet", href: accountUrl, children: "Account" }))] })] }), _jsxs("main", { id: "main", tabindex: -1, children: [_jsxs("section", { class: "wrap hero", "aria-labelledby": "hero-title", children: [_jsxs("div", { class: "hero-main", children: [_jsxs("div", { class: "hero-copy", children: [_jsx("h1", { id: "hero-title", children: "Text it what you need. Get the finished thing back." }), _jsxs("p", { class: "hero-sub", children: ["A personal assistant", channels ? ` in ${channels}` : " you text", ", with its own computer and the live web."] }), !start && (_jsxs("p", { class: "notice", id: "chat-unavailable", children: [_jsx("strong", { children: "Chat links aren\u2019t available right now." }), "There\u2019s nowhere to start a chat from this page yet, so please check back later."] })), (start || accountUrl) && (_jsxs("div", { class: "buttons", children: [imessageUrl && (_jsx("a", { class: "btn btn-primary", href: imessageUrl, children: "Text it on iMessage" })), telegramUrl && (_jsx("a", { class: imessageUrl ? "btn btn-plain" : "btn btn-primary", href: telegramUrl, children: "Open in Telegram" })), !start && accountUrl && (_jsx("a", { class: "btn btn-primary", href: accountUrl, children: "Account and billing" }))] })), imessageNumber && _jsxs("span", { class: "number", children: ["or text ", displayNumber(imessageNumber)] }), _jsxs("p", { class: "hero-setup", children: ["Requires an account with an active Pro plan.", start && " The chat walks you through both."] })] }), _jsxs("div", { class: "hero-art", children: [_jsx(Blob, { name: "hero", class: "blob-hero pop", size: 1200, eager: true }), _jsx(Blob, { name: "mini-wow", class: "mini blob-wow pop", size: 480, eager: true })] })] }), _jsx("div", { class: "stage stage-demo", children: _jsxs("div", { class: "panel sky", children: [_jsx("div", { class: "tabs", role: "tablist", "aria-label": "Illustrative example conversations", children: shownExamples.map((example, index) => (_jsx("button", { type: "button", class: "tab", role: "tab", id: `tab-${example.id}`, "aria-controls": `thread-${example.id}`, "aria-selected": index === 0 ? "true" : "false", tabindex: index === 0 ? 0 : -1, children: _jsx("span", { class: "tab-label", children: example.tab }) }))) }), _jsx("div", { class: "threads", children: shownExamples.map((example, index) => (_jsx(Thread, { example: example, first: index === 0 }))) }), _jsx("p", { class: "demo-note", children: "Illustrative examples of supported tasks, not real conversations or customer results." })] }) })] }), _jsxs("section", { class: "wrap part", "aria-labelledby": "abilities-title", children: [_jsx("h2", { id: "abilities-title", children: "Ask for the result, not the how-to." }), _jsx("div", { class: "abilities", children: shownAbilities.map((ability, index) => (_jsxs("div", { class: "stage", children: [ability.blob === "web" && (_jsx("div", { class: "ledge", children: _jsx(Blob, { name: "mini-wink", class: "mini blob-wink pop", size: 480 }) })), ability.blob === "memory" && (_jsx("div", { class: "ledge", children: _jsx(Blob, { name: "mini-sleepy", class: "mini blob-sleepy pop", size: 480 }) })), _jsxs("div", { class: `panel ${ability.tone} ability${index % 2 ? " flip" : ""}`, children: [_jsxs("div", { children: [_jsx("h3", { children: ability.title }), _jsx("p", { children: ability.body })] }), _jsx(Blob, { name: ability.blob, class: "blob pop", size: ability.size })] })] }))) })] }), _jsxs("section", { class: "wrap part", id: "how-it-works", "aria-labelledby": "how-it-works-title", children: [_jsx("h2", { id: "how-it-works-title", children: "Start with a text." }), _jsx("ol", { class: "steps", children: steps(channels).map((step) => (_jsxs("li", { class: "step", children: [_jsx(Blob, { name: step.blob, class: "blob pop", size: 800 }), _jsx("h3", { children: step.title }), _jsx("p", { children: step.body })] }))) })] }), _jsxs("section", { class: "wrap part", id: "questions", "aria-labelledby": "questions-title", children: [_jsx("h2", { id: "questions-title", children: "Before you start." }), _jsxs("div", { class: "stage stage-faq", children: [_jsx("div", { class: "ledge", children: _jsx(Blob, { name: "mini-wink", class: "mini blob-wink pop", size: 480 }) }), _jsxs("div", { class: "panel lilac faq", children: [_jsx(Question, { title: "What do I need to start?", children: _jsx("p", { children: "An account with an active Pro plan. Send a message and it replies with a sign-in link. If your account doesn\u2019t have Pro when you message it again, it sends an upgrade link." }) }), _jsx(Question, { title: "Why do I have to send my first request again?", children: _jsx("p", { children: "Messages sent before you\u2019re signed in and on Pro aren\u2019t queued or replayed. Once your plan is active, send your request again and it will start working on it." }) }), _jsx(Question, { title: "What does it cost?", children: _jsxs("p", { children: ["The assistant is part of the Pro plan. This page doesn\u2019t list a price", accountUrl ? (_jsxs(_Fragment, { children: ["; plan details are on your ", _jsx("a", { href: accountUrl, children: "account and billing page" }), "."] })) : ("."), " ", "Usage limits apply, so a large or costly request may be stopped."] }) }), _jsxs(Question, { title: "What does it keep, and for how long?", children: [_jsx("p", { children: "Each chat keeps its own history, and a conversation in one app doesn\u2019t carry over to another." }), _jsx("p", { children: "Files on its computer are temporary. They\u2019re wiped after about a week without use, so save anything you want to keep from the chat." })] }), _jsx(Question, { title: "Should I check its work?", children: _jsx("p", { children: "Yes. Review files and answers before you rely on them. Answers about the web come from the pages it finds, which can be wrong or out of date." }) }), calendarEnabled && (_jsxs(Question, { title: "How does Google Calendar work?", children: [_jsx("p", { children: "Ask in the chat to connect your calendar, then approve access from the personal link it sends. It can list upcoming events and draft a new one with an explicit timezone." }), _jsxs("p", { children: ["Review the draft. The event is created only after you reply with the exact command it gives you: ", _jsxs("code", { children: ["confirm calendar ", "<code>"] }), "."] }), _jsx("p", { children: "It only uses your primary Google calendar. It doesn\u2019t add attendees, invite anyone or send anything on its own." })] }))] })] })] }), start && (_jsx("section", { class: "wrap", children: _jsxs("div", { class: "stage stage-close", children: [_jsx("div", { class: "ledge", children: _jsx(Blob, { name: "crew", class: "blob-crew pop", size: 1600, height: 1000 }) }), _jsxs("div", { class: "panel blue", children: [_jsxs("div", { class: "close-copy", children: [_jsx("h2", { children: "It\u2019s one message away." }), _jsxs("p", { children: [imessageNumber ? (`Text it on iMessage at ${displayNumber(imessageNumber)}`) : (_jsx("a", { href: start.href, children: start.label })), imessageUrl && telegramUrl && (_jsxs(_Fragment, { children: [", or ", _jsx("a", { href: telegramUrl, children: "open in Telegram" })] }))] }), _jsx("p", { class: "close-setup", children: "You\u2019ll sign in first, and your account needs an active Pro plan." })] }), _jsx("a", { class: "bubble me send", href: start.href, "aria-label": `Say Hi: ${start.label}`, children: "Hi" })] })] }) }))] }), _jsx("footer", { class: "wrap", children: _jsxs("div", { class: "foot", children: [_jsxs("span", { children: [NAME, ", ", new Date().getUTCFullYear()] }), accountUrl && _jsx("a", { href: accountUrl, children: "Account and billing" })] }) }), _jsx("script", { children: raw(script) }), _jsx("script", { src: "/landing.js", defer: true })] })] }));
};
export const landingPage = (links) => html `<!doctype html>${(_jsx(Page, { ...links }))}`;
