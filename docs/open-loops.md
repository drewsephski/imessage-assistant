# Open loops

An optional follow-up list you save on purpose from Telegram or iMessage. You send a message to capture one item, keep it if the proposal is right, and check the list from either channel.

It is off by default and is not advertised on the landing page. **It has only been tested locally.** See [Verification](#verification) for what has not been proven yet.

## What it does not do

- It sends nothing on its own. There are no reminders, including on a review date.
- It does not read your inbox, your calendar, screenshots, files or earlier chat messages.
- The assistant cannot save, change or delete an item during ordinary chat, and cannot read the list there.

## Commands

Send each command as a text message on its own, with no file attached. Case does not matter and spaces around the message are ignored. Anything else, such as extra words or punctuation, is treated as ordinary chat.

A bare action such as `/keep` returns instructions to include the handle, without a model call. This also helps when tapping a command on Telegram sends just the verb. Numeric page requests outside 1 to 5 return page guidance.

| Message | What it does |
| --- | --- |
| `/track TEXT` or `track this: TEXT` | Proposes one item from up to 4000 characters of text. Uses the AI model. |
| `/keep HANDLE` | Opens a proposed item. |
| `/mine HANDLE` | Marks an open item as yours to do. |
| `/waiting HANDLE` | Marks an open item as waiting on someone else. |
| `/done HANDLE` | Closes an open item. Done items cannot be reopened. |
| `/forget HANDLE` | Deletes the item, whatever its state. |
| `/why HANDLE` | Shows the details and the saved quote. |
| `/loops` or `what needs me` (`?` optional) | Shows the list. |
| `/loops N` | Shows page N, from 1 to 5. Each page has 10 items. |
| `/loops help` | Shows this list of commands. |

Saved text cannot be edited. To correct an item, forget it and capture it again.

A command or `/track` sent as the caption of a file does nothing, and the reply says so. A quoted command (`> /done L...`) or one inside a longer message is ordinary chat and cannot change anything.

Telegram's native blockquote and expandable-blockquote formatting is preserved as provenance. A command or capture in such a message is rejected with instructions to send it as unquoted text.

## Example

You send this on Telegram:

```
/track Dana said she will send the signed SOW by Friday
```

The reply is written by the application, not the model, so its fields and commands cannot drift:

```
Proposed follow-up L3F9A0C21B7DE. It is not open until you keep it.
Item: Signed SOW from Dana
Who acts: Someone else (you are waiting on them)
Next action: Check for the signed SOW
Review date: 2026-11-13 (UTC date to look again. Not a deadline, and no reminder is sent.)
Quote from your message: "she will send the signed SOW"
Source: Telegram, 2026-11-06 15:30 UTC
Expires if not kept: 2026-11-07 15:30 UTC

/keep L3F9A0C21B7DE: open it
/forget L3F9A0C21B7DE: delete it

Privacy and retention:
- This list keeps only the item, next action, review date, quote and source channel, not your full message.
- Only saved items are shared between Telegram and iMessage.
- A proposal you do not keep expires after 24 hours. Expired proposals and done items are deleted after 30 days. Open items stay until you close or forget them.
- /forget deletes the saved item only, not chat transcripts or backups.
- Nothing is sent to you proactively, including on a review date.
```

Later, on iMessage, `/keep L3F9A0C21B7DE` replies `L3F9A0C21B7DE: Kept. It is now open.`, and `what needs me?` replies:

```
Open loops. Today (UTC): 2026-11-06. All dates are UTC.

Waiting on others (1)
L3F9A0C21B7DE: Signed SOW from Dana
Next: Check for the signed SOW
Review 2026-11-13, after today. From Telegram, 2026-11-06.

/why HANDLE shows the quote and full details.
```

A longer list ends with its page, what is on other pages, and how to get there:

```
Page 2 of 3.
13 more not shown: 13 waiting on others.
Previous page: /loops 1
Next page: /loops 3
/why HANDLE shows the quote and full details.
```

Sections always run in the order needs you, waiting on others, proposed, recently done. Within a section, items sort by review date (no date last), then creation time, then handle. The 50-item limit means five pages reach every item without deleting any. A page past the end says it is empty and sends you back to `/loops`.

## How capture works

- Only the text after the prefix goes to the model. Earlier messages, files and other tools are not available to it on that turn.
- The model can only propose one item. It cannot keep, change or delete anything, and the proposal never opens until you send `/keep`.
- The quote must be an exact one-line passage of what you sent. The server checks this against its own copy of your message, not anything the model reports.
- The owner and source channel come from the authenticated task. Neither you nor the model can supply them.
- If the proposal cannot be saved, the reply says so instead of showing a card. Check with `/loops` if you are unsure.

## Usage and limits

- Message quotas are unchanged. Each message you send, including a command, counts once against the monthly limit: 5 on Free, 100 on Plus and 300 on Pro (`MESSAGE_LIMITS` in `src/billing.ts`).
- Past that limit a message does not reach the agent, so `/loops` and `/track` stop working until the period resets or the plan changes. Saved items are kept, subject to the retention rules below.
- The same quota gate also blocks `/forget`; deletion through chat is unavailable until the period resets or the plan changes.
- Exact commands make no model call and reserve no model spending. Captures use the normal metered model, normally with one provider call and no second call to finish the turn.
- Before the agent runs, Trigger.dev may resolve files already in the chat transcript. Those attachment downloads can still use provider calls and spending reservations, even on a command turn; a resulting spending notice can replace the reply.
- Replies use the normal messaging spending checks on both channels. If a spending limit applies, its notice is sent instead of the reply. That can happen after the change was already saved, so send `/loops` to check.
- A list keeps at most 50 items, counting done and expired ones. Capture refuses past that until you `/forget` something.

## Retention and deletion

| Data | Where it lives | How long |
| --- | --- | --- |
| Open item: title, next action, review date, quote, direction, source channel, timestamps | `open_loops` | Until you close or forget it |
| Proposal you did not keep | `open_loops` | Cannot be kept after 24 hours. Deleted 30 days after that. |
| Done item | `open_loops` | Deleted 30 days after it was closed |
| Receipt: handle, action, outcome, task id, timestamp, with no item text | `open_loop_receipts` | As long as its task record exists |

Deletion happens when the owner next uses the list, and in the daily `purge-open-loops` job. Your full message is not stored in these tables. Receipts stop an old retried message from undoing a newer change or bringing back a forgotten item.

**`/forget` only deletes the saved item.** It does not remove:

- your `/track` message, or any card or list already sent, from the channel itself or from the Trigger.dev chat transcript for that channel;
- provider, Trigger.dev or log copies, or database backups;
- the receipt, which keeps the handle but no item text.

Only saved items are shared between channels, but viewing one copies it. A list or `/why` reply on iMessage becomes part of the iMessage transcript, and the model can see it in later ordinary chat there.

The capture text goes to the model provider through the Neon AI gateway, and appears in Trigger.dev run traces like any other message. The Sentry AI integration has content recording turned off (`src/trigger/init.ts`).

## Rollout

1. Deploy with `OPEN_LOOPS_ENABLED` unset. Off means no new table queries, no tool, no added instructions, and `purge-open-loops` does nothing. The new tables are not needed yet, and commands are ordinary chat.
2. Apply the additive schema to the target database with `npm run db:push`. Do not use Drizzle migrations. This is a separate, deliberate step for any shared or production database.
3. Set `OPEN_LOOPS_ENABLED=true` in the Trigger.dev environment that runs the agents. Only the exact value `true` turns it on. The Hono service does not read it.
4. Run the live checks below before relying on it. Do not advertise it on the landing page until they pass.

Turning it off again immediately stops the commands and capture. It also pauses retention, because off means no access to the new tables: saved rows stay in place, and users cannot `/forget` them until it is back on. Plan for that if you turn it off for long, and do not drop the tables while you owe anyone a deletion.

## Verification

Run these locally against a throwaway database. They use local models and replace each channel's outbound send, so they contact no messaging or model provider:

```sh
pnpm exec tsx --test tests/loops.test.ts tests/loops-runtime.test.ts
createdb assistant_test_open_loops
DATABASE_URL='postgresql://localhost/assistant_test_open_loops' \
DATABASE_URL_UNPOOLED='postgresql://localhost/assistant_test_open_loops' npm run db:push
TEST_DATABASE_URL='postgresql://localhost/assistant_test_open_loops' \
  pnpm exec tsx --test tests/db/loops.test.ts tests/db/loops-runtime.test.ts
```

**Not yet proven:** none of this has run against a hosted deployment. Still to check live, on both channels:

- capture through the real gateway model, including its forced tool call and a later ordinary turn whose history contains that call;
- delivery of the card, list and help text, including how they split into messages;
- Telegram command taps, native quotations, and iMessage smart punctuation in exact evidence quotes;
- commands after a registered model-readable attachment is in history, including attachment spending and denial notices;
- the ledger and spending records for a real command and a real capture;
- turning the flag on and off in the hosted environment;
- the hosted `purge-open-loops` schedule.
