# Product foundations implementation plan

## Order and scope

Keep Hono, Trigger.dev, Clerk, Drizzle/Postgres, and the existing messaging channels. Deliver the foundations in four independently verifiable increments. Do not launch unlimited usage or claim durable delivery until the relevant increment is deployed and verified.

| Priority | Increment | Concrete behavior | Completion checks |
| --- | --- | --- | --- |
| 1 | Durable task tracking | Record each agent turn against its authenticated owner; track processing, completion, failure, interruption, retries, and token usage across both channels. Keep message/file contents out of this ledger. | Real Postgres tests cover concurrent/repeated starts, retry fencing, cross-user access, interrupted workers, usage snapshots, and terminal state handling. Agent lifecycle tests cover successful, failed, stopped, and truncated turns. |
| 2 | Spending enforcement | Add a per-user monthly budget and a reservation ledger tied to task IDs. Atomically reserve capacity before paid work; reject requests when budget is unavailable. Account for model, research, computer, messaging, and storage separately. | Concurrent requests cannot oversubscribe an allowance; settle each actual paid operation once (a retry making another provider call still incurs cost); unknown pricing or unavailable accounting cannot silently permit paid work. Test reset boundaries and abandoned reservations. |
| 3 | Durable files | Store inbound source files and delivered artifacts in private object storage, with owner/task metadata in Postgres. Upload and verify outputs before sending them. Retrying delivery reuses the saved artifact. | Files survive computer deletion; another user cannot list/download them; expired download links fail; deletion removes stored bytes and metadata through a retryable process. |
| 4 | Onboarding and recovery | Preserve the initial request while account linking finishes; resume it once linked and entitled. Add a guided first task and a small account area for task history, files, allowance, billing, channel unlinking, and deletion. | Linking retries, expired codes, subscription changes, and repeated callbacks do not lose or duplicate the first request. Verify the complete signup-to-delivery flow on both channels. |

## Increment 1: task ledger

- A task represents one incoming user message being processed, not a long-lived Trigger.dev chat run. Use the stable chat/message identity, scoped by Clerk owner and platform, to identify it across worker retries.
- A processing attempt has a fencing token. A late callback from an older attempt cannot overwrite a newer attempt's state or usage.
- Record model completion separately from message delivery. A completed task means the agent produced a normally terminated response; delivery has its own state. An accepted messaging API response is not proof the user read it.
- Treat tool-step exhaustion, output truncation, unknown finish reasons, and user stops as interrupted work, not success. Model errors are failures.
- Persist usage after each completed model step, so later failure does not erase earlier known costs. Unknown usage stays unknown, not zero. Token counts are not a dollar bill.
- Use a bounded processing deadline and scheduled reconciliation for worker deaths that cannot execute a final callback. A later retry may recover the same logical task.
- Keep all customer-facing reads and writes scoped by owner. Do not add a public task endpoint before authenticated portal access exists.
- This increment tracks work from agent start. Durable ingress/queued status and replay of requests held during onboarding belong to increment 4. Do not claim end-to-end exactly-once execution of external actions.

## Increment 2: budget design

Use integer micro-units of currency and versioned provider prices, not floating-point dollar totals. Configure actual plan allowances explicitly; do not invent a production price or budget. Reserve conservatively before model calls/tools, including in-flight work from the user's other channel. Keep reservations unresolved when a provider's cost is uncertain; reconcile rather than refund blindly. Include global concurrency/provider ceilings and a per-user kill switch. Prefer server-enforced provider limits where available: an arbitrary shell command or open browser can otherwise bypass a tool-specific network budget. Until all provider paths are bounded, describe the protection as an application allowance rather than a guaranteed all-vendor dollar cap.

Computer billing can continue after a turn, including commands launched in the background. Keep compute reservations open until the resource stops or its usage is reconciled. Enforce resource lifetime limits through an independent stop/reconciliation path, not just a model callback. A completed task is not evidence all its spending has stopped.

## Increment 3: storage design

Choose a private S3-compatible bucket after checking the existing deployment's storage support. Store opaque object keys, byte size, media type, checksum, owner ID, task ID, and retention timestamps. Never put platform tokens, permanent public URLs, or user-controlled paths in object keys. Store durable files outside Daytona; its filesystem remains temporary working space. Use short-lived authorized downloads. Include storage quotas and lifecycle/deletion reconciliation in the rollout.

## Increment 4: onboarding design

Persist pending requests and attachment references with an expiry and an explicit source identity. After linking, recheck ownership and the current subscription/allowance before replay. Follow a clear state flow: waiting for sign-in, waiting for entitlement, ready, processing, completed, expired. Account-link races must resolve against the stored link, not the last browser session. Capture timezone explicitly before offering time-based workflows. Keep consent and retention information brief and accessible.

Before signup, apply per-source request/byte quotas, attachment limits, and expiry cleanup. There is no Clerk owner or paid allowance at this stage, so the onboarding queue needs its own abuse and storage limits.

## Rollout and verification

1. Run unit/lifecycle tests and local Postgres integration tests, type checking, and linting.
2. Apply schema changes with `npm run db:push` only. Never generate or run Drizzle migrations. Verify on an isolated local database first; identify the intended shared environment before applying there.
3. Deploy schema before code that requires it. Verify a real request on each channel, including a deliberate model failure and failed delivery.
4. Inspect records using a test account; verify no other account can retrieve them. Check interruption reconciliation and worker retry behavior.
5. Roll back code before removing schema; leave additive tables in place until data retention and rollback needs are resolved.

Local code review and checks apply to each increment. No deployment or production schema change is implied by completing increment 1 locally.

## Current implementation status

Increments 1 and 2 are implemented locally. See [spending controls](spending-controls.md) for configuration and operation coverage. Verification passed: type checking, 11 unit tests, 40 real-Postgres/runtime tests, operator command checks, and 3 Hono CLI route checks. Lint completes with no errors; it reports 22 non-null assertion warnings in existing code. Both code-review agents rechecked their fixes and reported no remaining concrete findings. A separate design review clarified provider pricing, retry liabilities, and computer lifecycle boundaries.

The new schema was pushed only to a temporary local Postgres database. Shared schema rollout, hosted schedules, actual channel delivery, and provider billing have not been verified. Spending uses conservative application allowance reservations, not a guaranteed all-vendor invoice cap. The production policy remains unset; missing policy/pricing denies provider work. There is no new public task UI yet. Durable storage is next, followed by onboarding.
