import { html, raw } from "hono/html";

// The public page at "/": what the assistant is and how to start texting it. Everything is inline
// (styles, script, icons) so the page is one response and needs no static file serving.

export type LandingLinks = {
  // E.164 number people text on iMessage, e.g. "+14155550123"
  imessageNumber?: string;
  // Telegram bot username without the "@"
  telegramUsername?: string;
  // Clerk Account Portal page for the account and its plan
  accountUrl?: string;
};

// The product's name wherever the page shows it
const NAME = "Assistant";
const TITLE = `${NAME}, a personal assistant you text`;

type Chip = { name: string; meta: string; kind: "document" | "photos" };

type Example = {
  id: string;
  tab: string;
  attachment?: Chip;
  ask: string;
  reply: string;
  file?: Chip;
};

// Illustrative conversations: each one shows a different thing the agent's tools can do
const examples: Example[] = [
  {
    id: "lease",
    tab: "Sign a lease",
    attachment: { name: "lease.pdf", meta: "PDF, 6 pages", kind: "document" },
    ask: "Sign my lease and send it back.",
    reply: "Signed on page 6, initialed on the rest.",
    file: { name: "lease-signed.pdf", meta: "PDF, 412 KB", kind: "document" },
  },
  {
    id: "tickets",
    tab: "Check a ticket price",
    ask: "Is $212 good for Friday’s show?",
    reply: "A bit high. Same section is $168 elsewhere.",
  },
  {
    id: "receipts",
    tab: "Total my receipts",
    attachment: { name: "23 photos", meta: "Receipts, March", kind: "photos" },
    ask: "Turn these receipts into a spreadsheet.",
    reply: "23 receipts, $1,846.20, sorted by category.",
    file: { name: "receipts-march.xlsx", meta: "Spreadsheet, 18 KB", kind: "document" },
  },
  {
    id: "flight",
    tab: "Find a flight",
    ask: "Cheapest nonstop to Lisbon in May?",
    reply: "$612 round trip from Newark, May 6 to 14.",
  },
];

const abilities = [
  {
    title: "It has its own computer.",
    body: "Edit, fill in, sign, convert or merge documents. Build spreadsheets, charts, images and PDFs from what you send. It can work through a website that needs clicks, forms or a login. The finished file arrives in the chat.",
  },
  {
    title: "It reads the live web.",
    body: "Ticket, flight and hotel prices. What’s in stock and what it costs across stores. Tables tonight, apartments, job postings, reviews, filings and scores, as they stand right now.",
  },
  {
    title: "It keeps your place.",
    body: "It remembers the conversation, and your files stay on its computer between messages, whichever app you text from. Files are cleared after a week without use.",
  },
];

const steps = [
  {
    title: "Say hi",
    body: "Send any message on iMessage or Telegram. There’s nothing to install.",
  },
  {
    title: "Connect your account",
    body: "It replies with a sign-in link. Open it, sign in, and the chat is linked to you.",
  },
  {
    title: "Go Pro",
    body: "The assistant is part of the Pro plan, and it sends the upgrade link if you need one. After that, text it what you need.",
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
  --ground: #EDF2FA;
  --paper: #FFFFFF;
  --ink: #0B1B45;
  --muted: #56678A;
  --line: #D3DDEE;
  --blue: #1463FF;
  --blue-deep: #0E51DB;
  --link: #0F55E6;
  --display: "Wix Madefor Display", ui-sans-serif, system-ui, sans-serif;
  --text: "Wix Madefor Text", ui-sans-serif, system-ui, sans-serif;
  --gutter: clamp(1.25rem, 5vw, 3.5rem);
  --bubble: clamp(1.75rem, min(4.4vw, 6.6vh), 4rem);
  --spring: cubic-bezier(.2, .9, .25, 1.12);
}
@media (prefers-color-scheme: dark) {
  :root {
    --ground: #081434;
    --paper: #17285C;
    --ink: #EEF3FF;
    --muted: #9BABD0;
    --line: #22346B;
    --link: #8FB4FF;
  }
}
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
body {
  margin: 0;
  background: var(--ground);
  color: var(--ink);
  font: 400 1.0625rem/1.6 var(--text);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
h1, h2, h3, p, ol { margin: 0; }
ol { padding: 0; list-style: none; }
a { color: inherit; }
:focus-visible { outline: 2px solid var(--link); outline-offset: 3px; border-radius: 6px; }
.skip {
  position: absolute; left: var(--gutter); top: -4rem;
  padding: .6rem 1rem; border-radius: 999px;
  background: var(--ink); color: var(--ground); text-decoration: none; font-weight: 600;
}
.skip:focus { top: .75rem; z-index: 2; }
.wrap { width: min(100%, 77.5rem); margin-inline: auto; padding-inline: var(--gutter); }

/* Header */
.top { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding-block: 1.25rem; }
.mark {
  display: inline-flex; align-items: center; gap: .55rem;
  font: 700 1.1875rem/1 var(--display); letter-spacing: -.02em; text-decoration: none;
}
.mark svg { width: 1.5rem; height: 1.5rem; color: var(--blue); }
.top-links { display: flex; align-items: center; gap: clamp(.75rem, 2vw, 1.75rem); }
.quiet { font-weight: 500; font-size: .9375rem; text-decoration: none; }
.quiet:hover { text-decoration: underline; text-underline-offset: .25em; }

/* Buttons */
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: .5rem;
  padding: .8rem 1.35rem; border-radius: 999px;
  font: 600 1rem/1.2 var(--text); text-decoration: none; white-space: nowrap;
  transition: background-color .15s ease, transform .15s ease;
}
.btn:active { transform: scale(.98); }
.btn-primary { background: var(--blue); color: #fff; }
.btn-primary:hover { background: var(--blue-deep); }
.btn-plain { background: var(--paper); color: var(--ink); }
.btn-plain:hover { background: color-mix(in srgb, var(--paper) 86%, var(--blue)); }

/* Hero */
.hero { padding-block: clamp(1.25rem, 4vh, 3rem) clamp(3rem, 7vw, 5.5rem); }
.lead { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 1.5rem 3rem; }
.intro {
  flex: 1 1 22rem; max-width: 37rem;
  font: 600 clamp(1.3125rem, 2.2vw, 1.8125rem)/1.24 var(--display);
  letter-spacing: -.022em; text-wrap: balance; color: var(--muted);
}
.intro h1 { display: inline; font: inherit; letter-spacing: inherit; color: var(--ink); }
.intro p { display: inline; }
.threads { display: grid; margin-top: clamp(1.75rem, 5vh, 3.25rem); }
.thread { grid-area: 1 / 1; align-self: end; display: flex; flex-direction: column; gap: .5rem; }
html:not(.js) .thread:not(:first-child) { display: none; }
.js .thread:not(.is-active) { visibility: hidden; pointer-events: none; }
.me { align-self: flex-end; }
.them { align-self: flex-start; }
.reply-slot { position: relative; align-self: stretch; display: flex; flex-direction: column; gap: .5rem; margin-top: .75rem; }

.bubble {
  --k: .04em;
  position: relative; max-width: min(100%, 13.5em);
  padding: .34em .62em .4em; border-radius: .74em;
  font: 600 var(--bubble)/1.07 var(--display); letter-spacing: -.034em; text-wrap: balance;
}
.bubble::before, .bubble::after { content: ""; position: absolute; bottom: 0; height: calc(25 * var(--k)); }
.bubble.me { background: var(--blue); color: #fff; transform-origin: 100% 100%; }
.bubble.me::before {
  right: calc(-7 * var(--k)); width: calc(20 * var(--k));
  background: var(--blue); border-bottom-left-radius: calc(16 * var(--k)) calc(14 * var(--k));
}
.bubble.me::after {
  right: calc(-26 * var(--k)); width: calc(26 * var(--k));
  background: var(--ground); border-bottom-left-radius: calc(10 * var(--k));
}
.bubble.them { background: var(--paper); color: var(--ink); transform-origin: 0 100%; }
.bubble.them::before {
  left: calc(-7 * var(--k)); width: calc(20 * var(--k));
  background: var(--paper); border-bottom-right-radius: calc(16 * var(--k)) calc(14 * var(--k));
}
.bubble.them::after {
  left: calc(-26 * var(--k)); width: calc(26 * var(--k));
  background: var(--ground); border-bottom-right-radius: calc(10 * var(--k));
}
.receipt { align-self: flex-end; font-size: .8125rem; font-weight: 500; color: var(--muted); padding-right: .25rem; }

.chip {
  display: inline-flex; align-items: center; gap: .7rem;
  padding: .6rem 1.05rem .6rem .7rem; border-radius: 1.15rem;
  background: var(--paper); line-height: 1.25;
}
.chip.me { background: color-mix(in srgb, var(--blue) 14%, var(--ground)); transform-origin: 100% 100%; }
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

/* The one orchestrated moment: the conversation arrives the way a real one does */
.motion .thread [data-step] { opacity: 0; transform: translateY(.6rem) scale(.92); }
.motion .thread [data-step].in { opacity: 1; transform: none; transition: opacity .2s ease, transform .42s var(--spring); }
.motion .thread .receipt[data-step] { transform: none; }

.tabs { display: none; flex-wrap: wrap; gap: .4rem; margin: clamp(1.5rem, 4vh, 2.5rem) 0 0 -.35rem; }
.js .tabs { display: flex; }
.tab {
  appearance: none; border: 0; cursor: pointer;
  padding: .5rem .9rem; border-radius: 999px; background: transparent; color: var(--muted);
  font: 500 .9375rem/1.2 var(--text);
  transition: background-color .15s ease, color .15s ease;
}
.tab:hover { color: var(--ink); }
.tab[aria-selected="true"] { background: var(--ink); color: var(--ground); }
.actions { display: flex; flex-direction: column; align-items: flex-end; gap: .6rem; }
.buttons { display: flex; flex-wrap: wrap; gap: .6rem; }
.number { font-size: .875rem; font-weight: 500; color: var(--muted); font-variant-numeric: tabular-nums; padding-inline: .35rem; }

/* What it does */
.part { padding-block: clamp(3.5rem, 8vw, 6.5rem); }
.part > h2 {
  max-width: 16ch;
  font: 600 clamp(2.125rem, 5vw, 4rem)/1.03 var(--display); letter-spacing: -.035em; text-wrap: balance;
}
.abilities { margin-top: clamp(2.5rem, 6vw, 5rem); }
.ability { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); column-gap: 1.5rem; row-gap: .75rem; padding-block: clamp(1.5rem, 3vw, 2.25rem); border-top: 1px solid var(--line); }
.ability h3 { grid-column: 1 / span 5; font: 600 clamp(1.4375rem, 2.4vw, 1.875rem)/1.15 var(--display); letter-spacing: -.024em; }
.ability p { grid-column: 7 / span 6; max-width: 34rem; text-wrap: pretty; }

/* Getting started */
.steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 2.5rem 1.5rem; margin-top: clamp(2.5rem, 6vw, 5rem); counter-reset: step; }
.step { counter-increment: step; padding-top: 1.25rem; border-top: 1px solid var(--line); }
.step::before { content: counter(step); display: block; font: 600 .9375rem/1 var(--display); color: var(--link); font-variant-numeric: tabular-nums; }
.step h3 { margin-top: 1.5rem; font: 600 1.4375rem/1.15 var(--display); letter-spacing: -.02em; }
.step p { margin-top: .6rem; max-width: 22rem; color: var(--muted); text-wrap: pretty; }

/* Closing */
.close { padding-block: clamp(3.5rem, 8vw, 6.5rem) clamp(4.5rem, 11vw, 9rem); display: flex; flex-direction: column; align-items: flex-end; gap: .9rem; }
.close h2 { align-self: flex-start; max-width: 20ch; font: 600 clamp(1.3125rem, 2.2vw, 1.8125rem)/1.24 var(--display); letter-spacing: -.022em; color: var(--muted); text-wrap: balance; }
.send { margin-top: clamp(1.5rem, 4vw, 3rem); font-size: clamp(3.5rem, 15vw, 11.5rem); text-decoration: none; transition: background-color .15s ease; }
.send:hover, .send:hover::before { background: var(--blue-deep); }
.send:focus-visible { outline-color: var(--ink); outline-offset: 6px; border-radius: .74em; }
.close .receipt { font-size: .9375rem; text-align: right; }
.close .receipt a { color: var(--ink); font-weight: 600; text-underline-offset: .25em; }

/* Footer */
.foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .75rem 2rem; padding-block: 1.75rem 2.5rem; border-top: 1px solid var(--line); font-size: .875rem; color: var(--muted); }
.foot a { text-underline-offset: .25em; }

@media (max-width: 52rem) {
  .ability h3, .ability p { grid-column: 1 / -1; }
  .steps { grid-template-columns: 1fr; }
  .actions { flex: 1 1 100%; align-items: stretch; }
  .buttons .btn { flex: 1 1 auto; }
}
@media (max-width: 34rem) {
  .bubble { max-width: 94%; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; animation: none !important; }
}
`;

// Plays the active conversation in order (attachment, message, receipt, typing, reply, file) and
// swaps conversations from the tabs. Without it, the first conversation is simply shown.
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
      var move = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (!move) return;
      event.preventDefault();
      select((i + move + tabs.length) % tabs.length, true);
    });
  });
  if (threads.length) play(threads[0], false);
})();
`;

const BubbleMark = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2.5c5.6 0 10 3.9 10 8.9s-4.4 8.9-10 8.9c-1.1 0-2.2-.2-3.2-.4-1.3 1.3-3 2-5 2.1 1.1-1.1 1.7-2.5 1.7-4C3.4 16.3 2 14 2 11.4c0-5 4.4-8.9 10-8.9Z" />
  </svg>
);

const ChipIcon = ({ kind }: { kind: Chip["kind"] }) =>
  kind === "photos" ? (
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

const Page = ({ imessageNumber, telegramUsername, accountUrl }: LandingLinks) => {
  const imessageUrl = imessageNumber && `sms:${imessageNumber}`;
  const telegramUrl = telegramUsername && `https://t.me/${telegramUsername}`;
  // The first way in that is configured: iMessage, then Telegram, then the account page
  const start = imessageUrl
    ? { href: imessageUrl, label: "Text it on iMessage" }
    : telegramUrl
      ? { href: telegramUrl, label: "Open in Telegram" }
      : accountUrl
        ? { href: accountUrl, label: "Sign in" }
        : undefined;
  const description =
    "Text it what you need. It has its own computer and live access to the web, so it sends back the finished file or the answer. Works in iMessage and Telegram.";

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
        <meta name="theme-color" content="#EDF2FA" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#081434" media="(prefers-color-scheme: dark)" />
        <link
          rel="icon"
          href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%231463FF' d='M12 2.5c5.6 0 10 3.9 10 8.9s-4.4 8.9-10 8.9c-1.1 0-2.2-.2-3.2-.4-1.3 1.3-3 2-5 2.1 1.1-1.1 1.7-2.5 1.7-4C3.4 16.3 2 14 2 11.4c0-5 4.4-8.9 10-8.9Z'/%3E%3C/svg%3E"
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Wix+Madefor+Display:wght@500..800&family=Wix+Madefor+Text:wght@400..700&display=swap"
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
            <BubbleMark />
            {NAME}
          </a>
          <div class="top-links">
            {accountUrl && (
              <a class="quiet" href={accountUrl}>
                Account
              </a>
            )}
          </div>
        </header>

        <main id="main">
          <section class="wrap hero">
            <div class="lead">
              <div class="intro">
                <h1>A personal assistant in iMessage and Telegram.</h1>{" "}
                <p>It has its own computer and the live web, so it sends back the finished thing.</p>
              </div>
              <div class="actions">
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
                  {!imessageUrl && !telegramUrl && accountUrl && (
                    <a class="btn btn-primary" href={accountUrl}>
                      Sign in
                    </a>
                  )}
                </div>
                {imessageNumber && (
                  <span class="number">or text {displayNumber(imessageNumber)}</span>
                )}
              </div>
            </div>

            <div class="threads">
              {examples.map((example, index) => (
                <Thread example={example} first={index === 0} />
              ))}
            </div>

            <div class="tabs" role="tablist" aria-label="Example conversations">
              {examples.map((example, index) => (
                <button
                  type="button"
                  class="tab"
                  role="tab"
                  id={`tab-${example.id}`}
                  aria-controls={`thread-${example.id}`}
                  aria-selected={index === 0 ? "true" : "false"}
                  tabindex={index === 0 ? 0 : -1}
                >
                  {example.tab}
                </button>
              ))}
            </div>
          </section>

          <section class="wrap">
            <div class="part">
              <h2>Ask for the result, not the how-to.</h2>
              <div class="abilities">
                {abilities.map((ability) => (
                  <div class="ability">
                    <h3>{ability.title}</h3>
                    <p>{ability.body}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section class="wrap">
            <div class="part">
              <h2>Start with a text.</h2>
              <ol class="steps">
                {steps.map((step) => (
                  <li class="step">
                    <h3>{step.title}</h3>
                    <p>{step.body}</p>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          {start && (
            <section class="wrap">
              <div class="close">
                <h2>It’s one message away.</h2>
                <a class="bubble me send" href={start.href} aria-label={start.label}>
                  Hi
                </a>
                <span class="receipt">
                  {imessageNumber
                    ? `Text it on iMessage at ${displayNumber(imessageNumber)}`
                    : start.label}
                  {imessageUrl && telegramUrl && (
                    <>
                      , or <a href={telegramUrl}>open in Telegram</a>
                    </>
                  )}
                </span>
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
      </body>
    </html>
  );
};

export const landingPage = (links: LandingLinks) => html`<!doctype html>${(<Page {...links} />)}`;
