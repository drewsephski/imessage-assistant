# Calendar integration

Implemented locally on 2026-11-06. Both iMessage and Telegram use the same five tools: connect Google Calendar, check connection, list events, prepare an event, and confirm creation. This is Google Calendar access from a messaging conversation; it does not read Apple Calendar or all of someone's iMessages.

## Decision: Composio for managed authentication, application-owned actions

Composio fits this increment because it supports per-user hosted OAuth and authenticated provider requests while the application keeps its own narrow tool definitions. Its documented flow derives the owner on the server, persists the returned connected-account ID, and passes both identifiers on later requests. OAuth tokens remain with Composio. Direct Google OAuth would remove that additional processor, but would require implementing and operating refresh-token storage, encryption/key rotation, callback state verification, refresh races, and revocation handling here. The current repository has none of that infrastructure. This is an engineering tradeoff, not a claim that Composio is always preferable. [Composio managed authentication](https://docs.composio.dev/docs/authentication/managed-auth-for-custom-tools)

The implementation uses the documented REST v3.1 endpoints with native `fetch`, avoiding a new SDK dependency and hidden SDK retries. It exposes no generic Composio execution/search tool to the model. Only fixed requests to Google Calendar's primary-calendar events endpoint are possible. Composio's proxy supports custom request shapes; that lets this application set its own Google event ID for recovery. [Proxy API](https://docs.composio.dev/reference/api-reference/tools/postToolsExecuteProxy), [Google event creation](https://developers.google.com/workspace/calendar/api/guides/create-events)

Before production, confirm Composio's token custody, actual OAuth consent branding, scopes, quotas, and commercial terms fit the intended customers. Managed OAuth apps may be suitable for production, but custom auth configurations are available when branding/scopes/quotas require them. No pricing assumption is hardcoded. Review the current [Composio pricing](https://composio.dev/pricing) and [scope controls](https://docs.composio.dev/docs/authentication/controlling-scopes).

## User flow

1. Text “Connect my Google Calendar.” Open the returned hosted authorization link and explicitly grant access. Return to the conversation after authorization.
2. Ask for upcoming events or request an appointment, providing a timezone (for example, `America/Chicago`). The assistant must ask when the timezone is unknown.
3. The assistant prepares a draft with exact dates, start/end, timezone, title and optional location/description. It shows a confirmation phrase such as `confirm calendar abcd12345678`. No event exists yet.
4. Send that exact phrase as a separate text message within 15 minutes. The backend reads the real inbound message; the model cannot supply an approval boolean, user ID, connection ID, or edited event fields to the confirmation tool.
5. Success is reported only after verifying the returned Google event. If a write times out, sending the same confirmation again only checks the original event, never submits it twice.

Limits are intentional: one timed event per request, the connected account's primary calendar, no guests/invitations, recurrence, all-day creation, editing, deletion or automatic reminders sent by this assistant. Listing returns at most 25 events in a maximum 31-day interval and reports truncation. It is not a conflict-free scheduling promise. Google may apply the calendar's default reminders to created events. [Google events list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list), [Google events insert](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert)

To disconnect, open https://myaccount.google.com/connections, select the connected app under access to your Google Account, and remove its access. This revokes provider access; it does not delete existing calendar events or the assistant's retained records. The assistant's next operation checks connection status and provider responses; revoked credentials cannot be used successfully. Operator removal of the stored connection and drafts is still needed for an account-deletion request. [Google's removal instructions](https://support.google.com/accounts/answer/13533235)

## Configuration and rollout

Required on the Trigger.dev worker:

| Variable | Purpose |
| --- | --- |
| `COMPOSIO_API_KEY` | Dedicated project API key, kept server-side. |
| `COMPOSIO_GOOGLE_CALENDAR_AUTH_CONFIG_ID` | An enabled Google Calendar OAuth auth configuration in the same Composio project. |
| `ASSISTANT_SPENDING_POLICY` | Existing spending policy plus the integration operation ceilings below. |

Missing either Composio setting returns an explicit unavailable result; no provider request is made. The public landing page additionally requires `CALENDAR_LANDING_ENABLED=true` in the Hono environment and both Composio settings. Keep that flag unset until the worker and a real end-to-end flow are verified; installing credentials alone does not advertise the feature.

Configure the Google auth configuration with the least permissions for primary-calendar event reads/writes, starting with `https://www.googleapis.com/auth/calendar.events.owned`, which Google's list and insert references support. Verify the actual consent screen and granted scope set. Composio also needs permissions to create/read connected accounts and execute proxy requests; restrict its project key to those operations. Use a dedicated application project, not unrelated personal connections. A browser callback is not used as proof of connection: each operation verifies the saved account's owner, toolkit, auth config, status and disabled/sharing flags.

Add positive integer microUSD reservation ceilings for:

```text
integration:calendar.connect
integration:calendar.status
integration:calendar.read
integration:calendar.create
```

These are conservative application allowance reservations, not invented vendor prices. Determine ceilings from the chosen plan/provider configuration. Missing or zero ceilings deny calls; every status/proxy/link request reserves separately. A denied write reservation does not consume the confirmation. Model and messaging costs still require their existing configured ceilings.

Apply additive `calendar_connections` and `calendar_drafts` schema changes and the expanded spending category check with `npm run db:push` before deploying this version. Never use Drizzle migrations. The replacement check is named `spending_reservations_category_v2_check` because this Drizzle version did not detect an expression-only change to the existing check; verify the old check has been replaced and the new one accepts `integration`. The nightly `reconcile-calendar-drafts` task must be deployed with the worker; it removes unsubmitted drafts at least one day past expiry and submitted drafts after 30 days. Retention continues when credentials are removed. This deletes draft metadata, not Google events.

## Safety and failure behavior

- The authenticated task determines the Clerk owner. Every local store operation checks the current running attempt, and reads/writes are owner-scoped. Connected accounts are checked against the owner and expected toolkit/config; shared connections are refused.
- Draft details are immutable. Repeated preparation within one task returns that task's original draft. Changing details requires a new message/draft. A code can authorize only a draft from an earlier task belonging to the same owner and current connection.
- Only the latest standalone user text can confirm. Attachments, filenames, older messages and tool output cannot authorize a write. Offsets must match the IANA timezone on the specified date, including daylight-saving transitions.
- A committed submission marker permits at most one application POST per draft. Google receives a deterministic ID and private draft marker. Concurrent confirmations cannot both submit. After an ambiguous timeout/crash, only readback occurs; even a missing event does not automatically retry a potentially delayed write. This can require operator help after a crash before submission. It is deliberate conservative recovery, not a claim of end-to-end exactly-once delivery.
- The application never requests guest invitations. Provider errors are sanitized, network calls have timeouts, redirects are refused, and raw auth state is never returned to the model. A fixed proxy endpoint avoids arbitrary outbound credential use.
- Calendar drafts contain event details in Postgres; listing and tool results also enter the existing Trigger.dev chat transcript. Composio and Google receive the requests. The nightly draft cleanup does not erase transcript/provider logs. Set and disclose those vendors' retention policies before a public pilot; the repository still needs a complete account-data deletion flow.

## Verification status

Local checks passed: type checking, targeted lint, 10 calendar unit tests, 7 calendar real-Postgres tests, and a real reservation test in the spending suite. Tests cover DST/offset validation, exact text confirmation, owner/config/toolkit isolation, bounded listings, sanitized errors, spending denials, immutable drafts, concurrent connection selection and submissions, expired/reconnected drafts, revoked access, uncertain-write recovery, retention, and the integration spending category.

The additive schema was applied only to `assistant_test_product_audit` on local PostgreSQL. The original local key returned HTTP 401. The user supplied a replacement through a private secret prompt; auth-config listing then returned 200. A dedicated managed Google Calendar auth configuration was created (201), and readback (200) confirmed only `https://www.googleapis.com/auth/calendar.events.owned`. The replacement key and config ID were saved only to ignored local `.env`. No accounts were connected or live calendar events created. Spending policy, shared schema rollout, deployed configuration and real OAuth/event verification remain outstanding. Test with an explicitly consenting Google account before enabling the landing-page claim or production traffic.

Live acceptance: connect from each channel, list a known event, prepare in a timezone with daylight saving, confirm once and inspect Google Calendar, repeat confirmation and verify there is still one event, revoke access and verify reads/writes fail. Check actual allowance records and the hosted retention schedule separately. Local tests do not establish any of these live outcomes.

### Production rollout update, 2026-11-06

The subsequent authorized deployment reports that commit `304efd7` applied the three new tables (`calendar_connections`, `calendar_drafts`, `received_attachments`) and replacement spending-category check to the shared production Neon database, then deployed Railway `3d02b362-bf79-430e-bbab-7993edab629a` and Trigger.dev version `20261106.4`. This supersedes the earlier local-only schema status above. Railway's successful deployment and the public landing response were independently rechecked; the worker version and schema application are recorded from the deployment report.

Calendar remains disabled. Railway has no Composio key or calendar auth-config variable; the worker deployment report likewise says its credentials remain unset. The public page does not advertise calendar. No real message/attachment, end-user OAuth flow, calendar write, or mobile visual check was verified after deployment.

The live Railway spending policy is `placeholder-2026-11-06`, with operation ceilings of zero or one microUSD and no `integration:calendar.*` entries. Reservation enforcement exists, but these placeholder amounts are not calibrated to provider charges and do not provide meaningful real-spend protection. Choose verified operation ceilings and pilot allowances before enabling calendar or recruiting users; existing stored account controls require the documented operator commands rather than merely changing environment defaults. Do not alter `TRIGGER_SECRET_KEY` during this configuration work.
