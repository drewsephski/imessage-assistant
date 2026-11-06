# Repository audit and delivery plan

Audited November 6, 2026, starting at commit `d4b43dc` with a clean working tree. This report describes source code and local verification. It does not assert that this checkout, schema, or configuration is deployed. Acquisition evidence and hypotheses are in [user acquisition research](user-acquisition-research.md); connector setup and limits are in [calendar integration](calendar-integration.md).

**Later deployment update:** commit `304efd7` was subsequently deployed under a separate user instruction. Railway success and the updated public landing page were rechecked; the deployment report records the production schema push and Trigger.dev version `20261106.4`. Calendar remains disabled and real channel/calendar acceptance tests remain outstanding. See the [production rollout update](calendar-integration.md#production-rollout-update-2026-11-06), which supersedes this audit's historical local-only rollout statements. Production spending operation amounts are placeholders, not verified provider prices.

## Product and architecture

This is a personal assistant reached through one-to-one iMessage conversations (Linq) or private Telegram chats. Users link their messaging identity to a Clerk account and need an active Pro subscription. The assistant can research the live web, read supplied files, run code on a user-specific Linux computer, and return text or files.

The stack is a small pnpm/TypeScript application, not a Next.js dashboard:

| Layer | Implementation | Responsibility |
| --- | --- | --- |
| Public site | `src/landing.tsx`, Hono JSX, inline CSS/JS, WebP illustrations | Product explanation and channel/account links; no authenticated customer dashboard |
| HTTP ingress | `src/app.ts`, channel webhooks | Verify channel credentials/signatures, ignore unsupported chat contexts, gate access, forward verified events |
| Identity and billing | `channel-gate.ts`, `billing.ts`, `trigger/link-account.ts` | Clerk OAuth device linking and backend Pro entitlement checks |
| Durable execution | Trigger.dev custom channels and `channel-agent.ts` | Per-channel conversation sessions, shared model/tools, lifecycle hooks and outbound replies |
| Intelligence and tools | AI SDK 7, Neon model gateway, Firecrawl, Daytona | Claude responses, current web research, isolated file/code work |
| Persistence | Postgres/Drizzle `src/db/*` | Channel links, task attempts, spending liabilities; new attachment registrations and calendar state |
| Operations | Sentry plus scheduled reconciliation tasks | Error/tracing metadata, expired task detection, independently stopping computers, calendar draft cleanup |

Both channels share the Clerk owner's computer and allowance. Their conversation histories are separate. Trigger's transcript storage is distinct from the task ledger: the ledger avoids prompt/file contents, while the chat runtime stores conversation/tool history. A durable transcript does not imply a durable file archive.

## Strengths already present

- Shared channel logic avoids two separate agents drifting apart. Private-chat restrictions, webhook verification and paid access gating are present.
- Task identity survives retries. Transactional row locks and attempt fencing prevent stale workers from overwriting newer work. Interrupted and failed runs are distinct from successful completion.
- Reply delivery is tracked separately from model completion. An API accepting a reply is not represented as a human reading it.
- Spending is admitted before provider work, including model retries, and user allowances span channels. Missing policy, accounting outages, stale attempts, or exhausted limits fail closed.
- Unknown provider costs remain reserved instead of being silently treated as free. Independent computer cleanup handles workers that cannot execute finalizers.
- The test suite exercises real PostgreSQL locks, ownership, retries, reconciliation, and Trigger's offline agent harness. Baseline: 11 unit tests and 40 database/runtime tests passed locally. Lint had no errors and 22 existing non-null assertion warnings; type checking passed.
- The landing page already had a cohesive responsive visual system; the frontend increment preserves it.

## Problems addressed in this increment

1. **No calendar integration.** Added narrow Google Calendar connection, status, bounded event listing, draft and confirmation tools shared by iMessage/Telegram. Composio manages OAuth; application code controls the permitted actions. Immutable drafts, owner checks, explicit timezone/offset validation and a single-submission marker protect against confused authorization and duplicate retries. No generic Composio executor is exposed to the model.
2. **Attachment ownership was not checked.** A known provider file ID could previously be passed to a download tool using global channel credentials. Verified, entitled ingress now registers each actual attachment reference for its owner/platform. Both model-inline and computer-tool downloads require that registration before any provider call. A file ID appearing in user text does not register it.
3. **Download limits trusted metadata.** Actual received bytes now enforce the limit, including chunked responses and false/missing Content-Length. Oversized streams are canceled; network errors do not echo signed URLs or bot tokens. Outgoing computer files receive a second byte check after download.
4. **Concurrent linking could claim the wrong success.** If another OAuth flow won the unique channel link, the losing flow previously could announce its email as connected. It now reports a conflict, preserves the existing account, and reveals no losing-account email. Successful linking explicitly asks the user to resend the original request.
5. **Telegram input was only a TypeScript cast.** Runtime validation now checks message identities and attachment references before gating/registration, while retaining provider fields for forwarding. Malformed updates receive 400 instead of failing unpredictably.
6. **Acquisition copy exceeded what was established.** Claude's frontend changes replace signing/live-price examples, explain Pro and signup requirements, disclose temporary files and separate chat histories, provide a useful no-configuration state, and gate the optional calendar example on server configuration.

The repository's former review-service mandate and installed project-local review skills were removed at the user's request. Independent code review, linting, type checks, builds and focused regression tests replace that dependency. No packages were added for the calendar connector.

## Material gaps still open

| Priority | Gap | Practical consequence |
| --- | --- | --- |
| P0 rollout | Calendar credentials, OAuth configuration and verified spending ceilings | The original key failed; a privately supplied replacement now passes live API checks, and a dedicated least-scope auth config was created and saved locally. Neither local environment file had a spending policy. These observations do not establish remote environment state. Without the required settings, this version denies provider work. |
| P0 rollout | Shared schema and hosted schedules have not been verified for this increment | Apply schema before dependent services, verify retention/cleanup tasks, and test actual channel delivery and Google Calendar results before advertising availability. |
| P1 | First-request replay is absent | Signing in does not resume the user's original message. The copy now states this; a durable, bounded onboarding queue is still needed. |
| P1 | No durable reply outbox or artifact store | Completed model work with failed delivery cannot simply be resent from a reliable saved artifact. Retrying the model can repeat work; implement delivery recovery separately from execution. |
| P1 | Files can disappear | Daytona auto-deletion and provider URL/attachment retention can outlive chat history. Private object storage, checksums, retention and deletion remain unfinished. |
| P1 | Account controls and data lifecycle | There is no customer task/file/allowance portal, complete deletion flow or channel unlink UI. Google access can be revoked through Google account connections; that does not delete local/transcript records. |
| P1 | Unit economics and settlement are operational work | Conservative reservations accumulate until reconciled. No automatic invoice reconciliation or evidence-backed plan price was established. Hosted/vendor costs and support time need measurement. |
| P2 | Activation and retention measurement | Task ledgers measure execution, not satisfied users, first-task success, paid conversion or repeat use. Add a minimal privacy-conscious funnel before acquisition spend. |
| P2 | Broad arbitrary computer capability | The computer is powerful and can reach external networks. Provider caps, sandbox boundaries and background-process behavior need live validation. Calendar tool constraints do not turn the whole computer into a capability-restricted system. |

Historical attachments without trusted registrations now require re-upload. Do not backfill ownership from model-visible transcript text. The registration table contains references only; it is not the deferred file-storage increment.

## Final verification

- `pnpm run lint`: passed, with the same 22 existing warnings and no errors.
- `pnpm run typecheck` and `pnpm run build`: passed. Generated build artifacts were removed/restored afterward so this change contains source work, not unrelated stale build output.
- `pnpm test`: 44 passed. `pnpm run test:db`: 52 passed against isolated local PostgreSQL, including concurrent connection selection, calendar spending, attachment isolation and existing agent/runtime coverage. A repeated-run test-ID collision was corrected before the final passing database run.
- Hono CLI: seven route checks passed, including unauthorized webhook rejection, malformed Telegram updates, ignored non-message/group updates and landing rendering. The installed `hono diff` command rejects the external-dependency flags needed by this app; explicit batch checks supplied route verification.
- Independent backend reviews found and rechecked the attachment ownership fix, integration spending category, deleted-connection recovery and concurrent OAuth mapping fixes. No remaining concrete production-code findings in those review scopes.
- Claude completed all frontend code. Fifteen rendering tests passed; browser interaction and visual appearance were not manually verified in this task.
- Live Composio project authentication and least-privilege auth-config creation/readback passed. Actual user OAuth, Google event creation, remote schema/deployment, hosted schedules and physical channel delivery remain unverified. No production environment variables were changed.

## Prioritized next steps

1. **Activate a controlled test environment.** Verify a dedicated Composio project key and least-privilege Google Calendar auth config. Set verified spending ceilings and bounded pilot allowances. Apply the schema, deploy code and verify all scheduled jobs. Keep the production Trigger secret unchanged during unrelated environment synchronization.
2. **Prove the whole workflow on both channels.** Connect an explicitly consenting test Google account; read a known event; draft and confirm an event; inspect its actual time and link; repeat confirmation and verify no duplicate; revoke access and verify failure. Also test attachment ownership, expired drafts, missing allowance and delivery failure. Record this separately from local test results.
3. **Finish recovery before broad recruitment.** Implement private durable artifacts and a reply outbox that retries delivery without re-executing side effects. Then preserve the first onboarding request with explicit expiry, quotas, ownership and current-entitlement checks.
4. **Run a ten-person focused pilot.** Recruit solo consultants/freelancers using iPhone and Google Calendar through relevant introductions and permitted small-community demonstrations. Observe their first real task. Test repeat usage and actual paid continuation before expanding integrations or buying ads. The numerical experiment gates in the research report are proposed choices, not market benchmarks.
5. **Make trust and economics visible.** Publish the actual price/allowance, support route and verified retention/processor disclosures; provide disconnect/deletion controls. Reconcile reservations against provider receipts and measure support time before choosing margins or acquisition budgets.
6. **Expand from observed blocked jobs.** Add the next integration only when pilot users repeatedly encounter the same missing action. Measure global spending-lock contention before changing the correctness-first admission design.

The immediate objective is one dependable, repeatable workflow. The repository has strong execution foundations; product recovery, operator configuration and evidence from real users are the remaining work that determines whether it is ready for a wider launch.
