# Spending controls

This increment enforces conservative **application allowances** in integer microUSD. It does not promise that a vendor invoice can never exceed a configured ceiling. Provider-side account limits remain necessary for that guarantee.

## What is enforced

- All agent model invocations, including SDK retries, require a committed reservation before the provider is called. Model output tokens also have a configured cap. That cap alone is not a price guarantee: reasoning, cache writes, long context, and gateway behavior must be included in the configured operation ceiling.
- Web tools, computer startup/use, outbound messaging, typing/read-receipt requests, and file transfer require explicit operation ceilings. Missing configuration/pricing, unavailable accounting, paused controls, stale attempts, exhausted allowance, and excess task concurrency deny admission.
- Both channels share the Clerk user's allowance. A global allowance also includes unlinked-user/service traffic. A task's allowance includes every paid operation across its retries.
- Reservations consume their full ceiling until verified provider costs are reconciled. Completion, errors, cancellation, worker death, and month rollover do not make uncertain charges free. An uncertain reservation from an earlier month continues reducing available allowance.
- Settlements are idempotent, owner-scoped operator actions. Actual repeated provider work gets separate reservations. A provider-confirmed cost above a ceiling is recorded in full and pauses global/user admission until investigated.
- Spending rows restrict task/attempt deletion. Cleanup must preserve financial liabilities, including after user data is removed or anonymized.

The installed Neon provider does not expose a normalized dollar charge, and the current web tools can have variable provider/capability costs. The app therefore does **not** automatically convert tokens or a successful tool call into a guessed invoice. It reserves conservative, versioned operation allowances and retains them for reconciliation. This is intentionally stricter than charging only successful answers.

## Configuration

Set `ASSISTANT_SPENDING_POLICY` to a JSON object in the Hono and Trigger.dev environments. There is no permissive default or production price supplied by this change. Missing/invalid configuration blocks new provider operations. Do not copy the synthetic amounts in tests into production.

Required fields:

| Field | Meaning |
| --- | --- |
| `version` | Immutable reference for the verified ceilings, e.g. an internal price-sheet version |
| `userMonthlyMicrousd` | Default monthly allowance for a newly seen paid account, encoded as a decimal integer string |
| `serviceMonthlyMicrousd` | Separate monthly allowance for signup messages, non-agent channel traffic, and bounded limit notices |
| `globalMonthlyMicrousd` | Global monthly allowance, including service traffic |
| `maxTaskMicrousd` | Maximum allowance used by one logical request across all attempts |
| `maxConcurrentUserTasks`, `maxConcurrentGlobalTasks` | Limits for tasks that have reserved allowance and are still running |
| `maxModelOutputTokens` | Per-provider-invocation output setting, from 1 to 32,000 |
| `computerLeaseSeconds` | Wall-clock computer lease, from 60 to 1,800 seconds; allow sufficient startup and task time |
| `ceilings` | Map of operation names to verified conservative microUSD amounts, as integer strings |

$1 equals `"1000000"` microUSD. Limits and monetary amounts are strings to avoid floating-point rounding. Zero ceilings are allowed only for explicitly free messaging/transfer operations; model/web/computer ceilings must be positive. To disable an operation, omit it.

The initial monthly amounts seed `spending_controls` rows. **Stored controls are authoritative afterward**: changing an environment default does not silently reset an existing customer's limit or pause switch. Use the operator commands below for existing accounts. Per-operation/task/concurrency settings are read for new admissions; existing reservations retain their original amount/version.

Supported operation names:

| Group | Operations |
| --- | --- |
| Model | `model:claude-opus-5-5` (the actual configured model ID) |
| Web | `web:searchWeb`, `web:findDataSources`, `web:runDataSource`, `web:inspectSavedResult`, `web:readWebPage` |
| Computer | `computer:lease` |
| Telegram | `messaging:telegram:sendMessage`, `messaging:telegram:sendPhoto`, `messaging:telegram:sendDocument`, `messaging:telegram:getFile`, `storage:telegram:download` |
| iMessage | `messaging:linq:sendMessage`, `messaging:linq:sendFile`, `messaging:linq:markRead`, `messaging:linq:startTyping`, `messaging:linq:stopTyping`, `storage:linq:download` |

Linq's automatic SDK retries are disabled. A Linq file-send allowance covers the complete bounded upload-and-send protocol (create upload, transfer bytes, send media). Each text bubble reserves separately. The web allowance must cover the tool's complete internal behavior; leave variable/unbounded capabilities disabled until a suitable provider ceiling or account cap is verified. File-transfer allowances cover bytes until completion; actual durable object storage is the next increment.

## Computers and cleanup

Computer admission commits a hold before create/start. Startup then reacquires the shared resource lock and revalidates current ownership, attempt, pause switches, expiry, and shutdown status before and after readiness. The stop worker uses the same lock, preventing an old worker from reviving an already-cleaned computer.

Tool calls reuse one lease for their attempt without repeatedly charging for the same lease. A newer attempt needs a new reservation. Completing a turn ends its lease, and `reconcile-assistant-spending` checks every minute for computers with no live, unpaused lease. A computer shared by overlapping requests stays available until the last lease ends. Worker deaths are bounded by lease expiry plus scheduler/provider shutdown latency. Shutdown failure retains the record and allowance and is retried independently of other resources. No monetary refund occurs merely because a computer stopped.

The cleanup job preserves files by stopping computers; it does not apply Daytona's destructive TTL. [Daytona's idle auto-stop](https://www.daytona.io/docs/en/sandboxes/) is an additional safeguard, not a wall-clock spending limit. Hosted scheduling, stop latency, existing untracked computers, disk retention, network egress, and background commands must be verified during rollout. Provision provider-side caps as an independent boundary. Trigger/hosting/database fixed overhead is not represented as a per-request invoice here.

## Operator commands

Commands use the local `.env` database connection. Identify the intended environment before running a write. They are not HTTP endpoints or model tools. Replace example targets/amounts with the intended values.

```sh
pnpm spending status global
pnpm spending status user_EXAMPLE
pnpm spending limit user_EXAMPLE INTEGER_MICROUSD
pnpm spending limit global INTEGER_MICROUSD
pnpm spending pause user_EXAMPLE
pnpm spending pause global
pnpm spending unpause global
pnpm spending settle user_EXAMPLE RESERVATION_UUID ACTUAL_INTEGER_MICROUSD PROVIDER_RECEIPT_REFERENCE
```

`service` is also a target. Pausing an uninitialized target creates a zero-limit paused control. Unpausing does not increase a zero allowance. Reducing a limit below current exposure blocks future operations without rewriting historical charges.

Only settle against independently verified provider evidence. A repeated identical settlement is a no-op; a conflicting settlement is rejected. Computer reservations cannot settle until shutdown has been confirmed. After an overrun, correct the operation ceiling, reconcile actual charges, and explicitly unpause the relevant controls. Do not settle unknown costs to zero to restore capacity.

When an allowance is exhausted, further paid work stops for that turn. A bounded service-account notice can still explain the limit. If the final result cannot reserve delivery, its delivery record remains failed while the separate notice is sent. If the service/global allowance is also exhausted, no additional metered notice is sent.

## Rollout

1. Apply the additive tables with `npm run db:push` to an isolated database and run `pnpm run test:db`, `pnpm test`, `pnpm run typecheck`, and `pnpm run lint`.
2. Choose allowances, verify every enabled operation ceiling/provider-side cap, and configure both app and worker environments. Exclude `TRIGGER_SECRET_KEY` from environment synchronization.
3. Apply the shared schema before deploying code. Enable/verify the one-minute cleanup schedule. Stop or explicitly account for pre-existing app computers that have no new lease record before enabling computer tools.
4. Verify a real request on both channels, budget exhaustion, the final-notice path, account/global pause, and a killed worker's computer shutdown. Compare retained reservations against actual provider receipts before enabling automatic refunds or presenting an exact cost to customers.

Local tests use synthetic amounts and mocked provider behavior. They establish app admission/accounting behavior, not external billing or deployment proof.
