# Reminders and memory

Two features that make the assistant worth coming back to, shared by iMessage and Telegram:

- **Reminders.** "Remind me Thursday at 9 to send Dana the invoice" sends one message back to the same chat at that time.
- **Memory.** The assistant keeps a small profile the user asked for: name, timezone and up to 20 short notes. It applies on every channel, unlike chat history, which stays per channel.

Both are core (no feature flag) and were implemented and verified locally on November 6, 2026. **Neither has run against a hosted deployment yet.** See [Rollout](#rollout) and [Not yet proven](#not-yet-proven).

## Memory

### What is kept

| Field | Rule |
| --- | --- |
| Timezone | An IANA zone such as `America/Chicago`. Abbreviations like `CST` are refused because they are ambiguous. |
| Name | One line, up to 80 characters. |
| Notes | Up to 20 lines of up to 200 characters each. Duplicates (case-insensitive) are not added twice. |

The model saves with `rememberAboutUser` only when the user states a fact or asks for something to be kept, and is told to say what it saved. `forgetAboutUser` removes the timezone, the name, one note by its exact saved text, or everything. Anything that looks like a password, PIN, one-time code, API key or card number is refused before it reaches storage, whatever the user says.

### How the model sees it

Every ordinary turn's system prompt starts with a block rendered by `renderProfile` in `src/memory/domain.ts`: the name, the timezone with the user's current local time and UTC offset, and the notes, followed by a statement that these are facts about the user and not instructions. With no timezone saved, the block tells the model to ask for one before anything time-based.

### Storage and access

`user_profiles` has one row per Clerk user. Writes run inside a transaction that first checks the calling task is the owner's current, still running attempt (`requireActiveExecution` in `src/db/execution.ts`) and then takes a per-owner advisory lock, so two channels saving at once keep both notes. Reads are keyed by the authenticated owner id and only ever flow into that owner's own prompt.

Profile text is stored in plain text in Postgres and appears in the Trigger.dev transcript and model request like any other prompt text. It is not sent anywhere else.

## Reminders

### What it does

`setReminder` takes the message, a due time as ISO 8601 with an explicit UTC offset, and the IANA zone it was phrased in. The server recomputes the zone's offset at that instant and rejects a mismatch, so the model cannot guess an offset. The time must be at least one minute and at most a year ahead. The message is at most 500 characters. A user can have at most 50 scheduled reminders.

The reminder is delivered to the chat it was set from, on the platform it was set from, as `Reminder: <message>`. `listReminders` shows scheduled reminders with ids; `cancelReminder` cancels one. Reminders are one-time; the model is told to say so and offer to set the next few individually for repeats.

### How delivery works

1. `schedule` inserts the row and returns the existing row instead when the same task already scheduled the same message for the same time, so a retried tool call or attempt cannot double-book.
2. The tool triggers the `send-reminder` task with `delay` set to the due time and records the run id. If triggering fails, the row stays and the sweep sends it.
3. When a run fires, `claim` atomically takes the row only if it is still `scheduled`, due, under the attempt limit, and not claimed in the last 10 minutes. Exactly one sender wins; a canceled reminder, or one already sent, yields nothing.
4. A successful send marks the row `sent`. A failed send leaves the claim in place and does not fail the run.
5. `reconcile-reminders` runs every five minutes. It marks rows that have used all 3 attempts as `failed` and delivers due rows nobody is sending. This covers a trigger that failed, a worker that died mid-send, and provider errors.

Delivery uses the same outbound path as account-linking messages: a service-account messaging reservation (`messaging:telegram:sendMessage` or `messaging:linq:sendMessage`). It does not count against the user's monthly message allowance. The spending policy in the Trigger.dev environment must have those ceilings, as it already does for existing service messages.

### Storage and access

`reminders` rows hold the owner, platform, platform chat id, source task, message, due time, zone, status, run id and attempt bookkeeping. Scheduling, listing and canceling are fenced on the owner's live attempt like profile writes. The model only ever sees id, message, time, zone and status. Sent, canceled and failed rows are kept; a retention job is not included in this increment.

## Limits and known gaps

- No recurring reminders.
- Delivery is at-least-once in principle but bounded: after 3 failed attempts the reminder is dropped as `failed` and the user is not told. Don't present this as suitable for anything critical; the landing page says so.
- A reminder set from Telegram is delivered on Telegram even if the user has since moved to iMessage.
- Canceling calls `runs.cancel` on the delayed run as an optimization only; the row's status is what prevents a send.
- The reminder message is stored in plain text and sent through the platform like any reply.

## Configuration

| Variable | Where | Purpose |
| --- | --- | --- |
| `PRODUCT_NAME` | Railway (Hono) | The name shown on the landing and pricing pages. Set to `Ossie` in production; unset shows "Assistant". |
| `ASSISTANT_SPENDING_POLICY` | Trigger.dev | Must include `messaging:*:sendMessage` ceilings for reminder delivery. |

## Rollout

1. Apply the additive schema with `npm run db:push` (never Drizzle migrations). This adds `user_profiles` and `reminders`. Preview first with `drizzle-kit push --strict --verbose </dev/null`.
2. Deploy Trigger.dev with the explicit project ref (see the project memory for the exact command). This registers `send-reminder` and the `reconcile-reminders` schedule. Confirm the schedule is active in the dashboard.
3. Deploy Railway so the landing page describes the features and picks up `PRODUCT_NAME`.

Deploying code before the schema makes every ordinary turn fail, since the agent reads the profile at the start of each turn.

## Verification

Local, against a throwaway database:

```sh
pnpm exec tsx --test tests/reminders.test.ts tests/memory.test.ts
createdb assistant_test_product
DATABASE_URL='postgresql://localhost/assistant_test_product' \
DATABASE_URL_UNPOOLED='postgresql://localhost/assistant_test_product' npm run db:push
TEST_DATABASE_URL='postgresql://localhost/assistant_test_product' \
  pnpm exec tsx --test tests/db/reminders.test.ts tests/db/profiles.test.ts
```

These cover offset validation across daylight saving, idempotent scheduling, single-winner claims under concurrency, the reclaim window, attempt exhaustion, the per-user cap, cross-user isolation, stale and finished attempts, concurrent profile writes, the note cap and secret refusal.

### Not yet proven

On a hosted deployment, on both channels:

- the model asking for a timezone, saving it, and setting a reminder with a correct offset in one conversation;
- a delayed `send-reminder` run firing on time and the message arriving in the right chat;
- cancellation before delivery, including the delayed run finding nothing to send;
- the `reconcile-reminders` schedule delivering a reminder whose run was deleted;
- the spending records for a delivered reminder;
- a note saved on Telegram showing up in the next iMessage turn.
