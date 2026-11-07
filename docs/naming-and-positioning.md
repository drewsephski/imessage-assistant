# Naming and positioning

Written November 6, 2026, as the decision to move kraftybot.app's focus to this product. Desk research only: the product's own code, competitors' public pages, search results, and live domain registry lookups. No customer interviews or paid tests.

## Where this sits

Krafty Bot sells an *AI workspace*: many Bots, each with memory and instructions, sharing a cloud computer, running routines, working in connected apps, at $20/month Pro. This product is the opposite shape: one assistant, reached from the messaging app already on the phone, no app or workspace to open. The category is "an assistant you text", and it is crowded:

| Product | Channels | Price (public pages, Nov 2026) | What people praise |
| --- | --- | --- | --- |
| Poke (Interaction Co., acquired by Cognition, July 2026) | iMessage, SMS, WhatsApp, Telegram | Free tier; Pro $19; Ultra $199 | Reminders ("amazing for reminders", medication reminders), email and calendar, messaging first when something matters |
| Martin | SMS, voice calls | Basic $21/mo yearly ($35 monthly); Pro $30 yearly ($49 monthly); no free plan | Voice calls |
| Lindy | iMessage, Slack | Team from $49.99/user | Breadth of connected tools, approvals |
| Aura | Text and call | Basic $20 | "Executive assistant you can text" |
| Ohai | App, calendar connections | $9.99 to $29.99 | Household coordination |

Two things come through consistently: people pay for **dependable daily utility**, not experimentation, and the specific behaviors they name are **reminders and proactive messages** and an assistant that **remembers context**. Trust is the main barrier (only about a quarter of surveyed consumers trust AI assistants with personal data), and AI subscription apps churn hard (one report cited by users says roughly 80% of subscribers leave within a year).

This product's real differentiators against that table are not the channel. They are the **computer that returns finished files**, **live structured web data**, and the deliberately careful execution model (confirm-before-write calendar, fenced tasks, spending admission). Until today it had none of the behaviors people name when they say why they pay: nothing proactive, no memory across channels, and the first message had to be resent after sign-in.

## What was built today

- **Reminders** that text back at a chosen time, with offset validation, single-winner delivery and a sweep for stragglers.
- **Memory** shared across iMessage and Telegram: name, timezone and up to 20 notes, saved only on request, with secrets refused.
- A **configurable product name** (`PRODUCT_NAME`) and landing/pricing copy rewritten around what is now true.

Details and rollout are in [reminders and memory](reminders-and-memory.md).

## Decision

**Ossie**, chosen November 7, 2026, and set as `PRODUCT_NAME` on Railway. Domains were still unregistered at that date; buy ossie.app, heyossie.com, ossie.chat and textossie.com, and run the trademark check, before public marketing. The options below are kept for the record.

## Name options

Nearly every short dictionary word is registered on `.app`, `.com`, `.chat` and `.ai` (checked live: nudge, holler, dibs, tally, knack, errand, otto, remy, juno, wren, sidekick, handy, doer, fetch, pepper, moxie, tilly, rudy, hank, sunny, bloop, plink, boop, squish, blobby and more are all taken). What follows is what is actually available, with registrar prices seen at the time of the check.

### 1. Ossie (chosen)

A person's name, warm, two syllables, says well out loud ("Hey Ossie, remind me…"), and suits the blob characters already on the landing page. The whole set is free: **ossie.app** ($9.99, renews $15), **heyossie.com** ($12.03), **ossie.chat**, **textossie.com**. No obvious trademark collision surfaced in search; still run a USPTO and EUIPO check before committing.

### 2. Gofer

The concept is exactly right: a gofer is the person you send to go for things. Weak on domains: gofer.app, .ai, .com, .co, .so and .bot are taken; **gofer.chat** ($9.99, renews $36) and **textgofer.com** are free. Also at risk of being read as "gopher".

### 3. Runsie

Coined from "runs errands". Distinctive and fully available: **runsie.app**, **runsie.chat**, **heyrunsie.com**. The cost is having to teach people the word.

### 4. Krafty, continued

Keeps the equity in kraftybot.app and the "Tell Krafty what you need done" line. Only **heykrafty.com** is free beyond the domain you own, and the name is tied to the Bot-workspace positioning you are leaving. Reasonable if the audience you already have matters more than a clean break.

Other available odds and ends from the check: textbloop.com, heypib.com, heydobbin.com, doozy.chat, pippit.app, tiptap.chat.

## Positioning to test

Lead with the thing competitors' users already say they value, and that this product can now deliver with care:

> **Text it once. It remembers, it reminds you, and it sends back the finished thing.**

Under it, three concrete beats: a reminder ("Remind me Thursday at 9 to send Dana the invoice"), a file ("Turn these receipts into a spreadsheet"), and a lookup with sources. Keep the existing honesty rules: illustrative examples labeled as such, no autonomous purchasing or signing claims, the free allowance stated plainly.

Price against cost, not against Poke's $19. Each turn runs on `claude-opus-5-5` for up to 40 steps; the Plus $9 / Pro $19 tiers were set without usage data. Use `task_attempts` token data from the first weeks to check the message allowances before any paid marketing.

## What should come next, in order

1. **Ship this increment** (schema, Trigger.dev, Railway) and run the live checks in the reminders doc on both channels.
2. **Replay the first request after sign-in.** Still the most embarrassing moment in the funnel. Persist the text of an unlinked user's first message for ten minutes and send it to the agent once linking finishes.
3. **Move Clerk to a production instance** so payments are real; the current instance only takes test cards.
4. **Ten-person pilot** per `user-acquisition-research.md`, now with a product that has something to come back for.
5. **Recurring reminders and a daily digest** only if pilot users ask; both are small on top of today's tables.
