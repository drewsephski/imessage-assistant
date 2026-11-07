# Personal assistant

A Hono ingress service and Trigger.dev agents for iMessage and Telegram. Account linking and Pro access use Clerk; app data uses Postgres through Drizzle.

Use pnpm (the version is pinned in `package.json`). Configure the existing provider credentials in `.env`; never commit environment files.

```sh
pnpm install
pnpm run lint
pnpm run typecheck
pnpm test
```

Use the Hono CLI for local route checks, without starting a dev server. Dependencies that rely on Node's module loader must remain external to the CLI bundle:

```sh
pnpm exec hono batch - src/app.ts -e pg -e @sentry/node -e @trigger.dev/sdk -e @linqapp/sdk -e @daytona/sdk -e ai -e drizzle-orm <<'JSONL'
{"method":"GET","path":"/","expect":{"status":200}}
{"method":"POST","path":"/telegram/webhook","body":{},"expect":{"status":401}}
{"method":"POST","path":"/linq/webhook","body":{},"expect":{"status":401}}
JSONL
```

## Landing page

`GET /` serves the public landing page from `src/landing.tsx` (styles and script are inline; fonts load from Google Fonts). Its blob characters are WebP files in `public/blobs`, served at `/blobs/*` from the directory the server starts in, so start it from the repository root. Its buttons come from configuration, and a button is left off when its value is unset or malformed:

| Variable | Used for |
| --- | --- |
| `LINQ_PHONE_NUMBER` | The iMessage button and the number shown beside it. E.164, such as `+14155550123`. |
| `TELEGRAM_BOT_USERNAME` | The Telegram button (`https://t.me/<username>`). |
| `CLERK_PUBLISHABLE_KEY` | The account link, which points to the Account Portal's billing page. |
| `CALENDAR_LANDING_ENABLED` | Set to `true` only after live calendar verification. Also requires both Composio settings; credentials alone do not enable calendar advertising. |
| `PRODUCT_NAME` | The name shown on the landing and pricing pages. Production uses `Ossie`; unset shows "Assistant". See [naming and positioning](docs/naming-and-positioning.md) for the decision. |

The conversations on the page are illustrative examples, defined as plain constants at the top of `src/landing.tsx`.

## Reminders and memory

[Reminders and memory](docs/reminders-and-memory.md) are core features on both channels: the assistant texts the user back at a chosen time, and keeps a small profile (name, timezone, up to 20 notes) the user asked for, shared across iMessage and Telegram. They need the additive `user_profiles` and `reminders` tables and the `reconcile-reminders` schedule. Apply the schema before deploying the agents; an ordinary turn reads the profile first and fails without the table. Verified locally only; the live checks in that document are still open.

## Calendar and attachment improvements

See [the repository audit](docs/repository-audit.md) for architecture, remaining gaps and priorities, and [user acquisition research](docs/user-acquisition-research.md) for sourced competitor findings and a proposed pilot.

The optional [Google Calendar integration](docs/calendar-integration.md) uses Composio for per-user OAuth, with fixed application-owned tools on both channels: connect, check status, list events, prepare a timed event, and confirm creation. It requires `COMPOSIO_API_KEY`, `COMPOSIO_GOOGLE_CALENDAR_AUTH_CONFIG_ID`, and the documented spending ceilings. No calendar write occurs until the user sends the saved draft's exact confirmation phrase in a later message. There are no attendee invitations. An uncertain submission is checked rather than automatically written again.

Apply the additive calendar and `received_attachments` tables, plus the replacement spending-category check, before deploying. Attachment access is now registered at verified ingress and checked against the owner and platform for both model and computer downloads. Files from before this rollout need to be attached again; do not infer ownership from transcript text. Download limits apply to actual bytes, not just file metadata. These registrations are not durable file storage.

## Open loops

[Open loops](docs/open-loops.md) is an optional, explicitly saved follow-up list shared across iMessage and Telegram. It is off unless `OPEN_LOOPS_ENABLED=true`, needs its additive tables first, sends nothing proactively (timed messages are reminders, above), and has only been tested locally. Do not advertise it until the live checks in that document pass.

## Product foundations

See [the implementation plan](docs/product-foundations.md) for sequencing, acceptance criteria, and rollout.

The first increment adds `assistant_tasks` and `task_attempts`. Each incoming agent turn has one logical task and a separate record for every permitted worker retry. Token usage is retained per attempt. Ordinary reads/writes check the Clerk owner and current attempt; no public task-history endpoint is exposed yet. No prompt text or file contents are stored in these tables.

Model completion and reply delivery are separate. A normal model finish is `completed`; errors are `failed`; stops/truncation/step exhaustion are `interrupted`. Reply status `accepted` means the messaging API accepted the entire text reply, not that a recipient read it. `pending` means delivery has not been confirmed by this ledger. Files sent by tools are outside this text-reply status; they will gain their own artifact/delivery records in the storage increment.

The `reconcile-assistant-tasks` schedule runs every five minutes. A processing attempt left open for 35 minutes (30-minute agent maximum plus grace) becomes interrupted. A later SDK retry or explicit successor run can recover the logical task; callbacks from older attempts cannot overwrite it. Known usage from earlier attempts remains available for cost reconciliation. Unknown usage remains null. This does not provide exactly-once execution of external actions; spending admission is enforced separately below.

Apply the additive schema before deploying the updated agents. Use `npm run db:push`, as required by this repository; do not generate/run Drizzle migrations. Production/shared schema changes and deployment are separate rollout steps.

## Database and runtime tests

Spending enforcement now builds on this ledger. See [spending controls](docs/spending-controls.md) for required configuration, operation coverage, independent computer shutdown, and operator commands. Allowances are conservative reservations until provider costs are verified; they are not a guaranteed cap on all vendor invoices. Missing policy/operation ceilings deny provider work. Configure the policy before deploying this increment.

Tests require an explicit local throwaway database named `assistant_test_*`. They never load `.env` or fall back to the app's database. They insert synthetic records; use a disposable database and remove it afterward.

With a local PostgreSQL instance running, for example:

```sh
createdb assistant_test_foundations
DATABASE_URL='postgresql://localhost/assistant_test_foundations' \
DATABASE_URL_UNPOOLED='postgresql://localhost/assistant_test_foundations' npm run db:push
TEST_DATABASE_URL='postgresql://localhost/assistant_test_foundations' pnpm run test:db
```

The database suite exercises actual Postgres locks, ownership checks, retries, reconciliation, and constraints. Runtime tests use Trigger.dev's offline chat harness and mock model responses, with real database writes; they do not contact messaging or model providers. Live channel delivery, hosted schedules, and production billing still require rollout checks.
