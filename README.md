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

## Product foundations

See [the implementation plan](docs/product-foundations.md) for sequencing, acceptance criteria, and rollout.

The first increment adds `assistant_tasks` and `task_attempts`. Each incoming agent turn has one logical task and a separate record for every permitted worker retry. Token usage is retained per attempt. Ordinary reads/writes check the Clerk owner and current attempt; no public task-history endpoint is exposed yet. No prompt text or file contents are stored in these tables.

Model completion and reply delivery are separate. A normal model finish is `completed`; errors are `failed`; stops/truncation/step exhaustion are `interrupted`. Reply status `accepted` means the messaging API accepted the entire text reply, not that a recipient read it. `pending` means delivery has not been confirmed by this ledger. Files sent by tools are outside this text-reply status; they will gain their own artifact/delivery records in the storage increment.

The `reconcile-assistant-tasks` schedule runs every five minutes. A processing attempt left open for 35 minutes (30-minute agent maximum plus grace) becomes interrupted. A later SDK retry or explicit successor run can recover the logical task; callbacks from older attempts cannot overwrite it. Known usage from earlier attempts remains available and must be included in future cost accounting. Unknown usage remains null. This does not provide exactly-once execution of external actions or enforce dollar spending limits yet.

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
