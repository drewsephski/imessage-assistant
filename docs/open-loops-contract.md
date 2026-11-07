# Open loops implementation contract

This increment tests a hypothesis: solo client-service operators will use an explicitly saved, cross-channel follow-up register without connecting an inbox. It is not a claim of market uniqueness. Text-only capture; no proactive sends, screenshot extraction, calendar coupling, dashboard, or automatic transcript mining.

## Ownership and shared interface

- Domain delegate owns `src/loops/domain.ts` and `tests/loops.test.ts`.
- Persistence delegate owns `src/db/schema.ts`, `src/db/loops.ts`, and `tests/db/loops.test.ts`.
- Runtime delegate subsequently owns integration, runtime tests and user documentation.
- Shared checkout: never revert another delegate's edits, change branches, commit, push, deploy, or apply a production schema. Parent owns integration and shipping.

Domain exports the following contract (type-only imports from persistence are forbidden):

```ts
type LoopDirection = "mine" | "waiting";
type LoopStatus = "proposed" | "open" | "done";
type LoopProposal = {
  title: string; direction: LoopDirection; nextAction: string;
  reviewOn: string | null; evidenceQuote: string;
};
type LoopRecord = LoopProposal & {
  handle: string; status: LoopStatus; sourcePlatform: "telegram" | "linq";
  createdAt: Date; updatedAt: Date; expiresAt: Date | null;
};
type LoopAction = "keep" | "waiting" | "mine" | "done" | "forget";
type LoopCommand = { kind: "list"; page?: number } | { kind: "help" } |
  { kind: "why"; handle: string } |
  { kind: "mutate"; action: LoopAction; handle: string };
type LoopMutationResult = { handle: string; action: LoopAction; outcome: "applied" | "already_applied" | "not_found" | "invalid_transition" | "expired" };
```

Exports: `loopProposalSchema` (strict Zod validation), `LoopError` (safe user message), `parseLoopCommand(text): LoopCommand | null`, `captureText(text): string | null`, `validateLoopEvidence(proposal, actualCaptureText): void`, `renderLoopProposal(record): string`, `renderLoopBrief(records, now: Date): string`, `renderLoopDetail(record): string`, `renderLoopMutation(result): string`, `LOOP_HELP: string`.

Limits: title 120 chars; next action 160; exact evidence quote 280; capture text 4000; 50 total rows per owner; one immutable proposal per logical source task; handles `L` followed by 12 uppercase hex characters, generated randomly by the store. No user-supplied owner, platform, source task, or quote provenance. `reviewOn` is a real ISO YYYY-MM-DD date or null; a review date is not a promised deadline. Reject newlines/control characters in single-line model fields, and require a nonempty exact substring of the server-captured user text for evidence. Never retain the full source text.

## Exact user controls

Commands are standalone, case-insensitive, outer whitespace permitted. Handles normalize uppercase. No punctuation or extra words unless explicitly noted. `/loops`, `what needs me`, and `what needs me?` list saved records; `/loops help` shows help. `/keep HANDLE`, `/waiting HANDLE`, `/mine HANDLE`, `/done HANDLE`, `/forget HANDLE`, `/why HANDLE` are the remaining controls. Quoted commands, attachment captions, commands embedded in paragraphs and older messages cannot mutate state.

Bare action verbs return fixed handle guidance, and numeric page requests outside 1 through 5 return fixed page guidance. Telegram native blockquote metadata must survive ingestion and prevent quoted commands or captures from executing; a plain `bot_command` entity alone does not block an otherwise valid command.

Capture is only enabled for a standalone text message starting `/track ` or `track this:` (case-insensitive), with nonempty trimmed text after the prefix. The model may only propose one item, never keep/change/delete it. Actual latest user message must contain exactly one text part, with no file parts. The proposal card is rendered by the application and replaces model output for that turn, so its fields, evidence and confirmation command cannot drift. Capture may use the existing metered model; all exact commands use deterministic rendered text without external model calls.

`keep` opens a proposed item; `mine`/`waiting` change direction only on open items; `done` closes an open item. Repeating an already satisfied action is a no-op. `forget` hard-deletes the record, including title, next action and evidence. It does not delete existing channel/Trigger transcripts. Expired proposals cannot be kept. No re-opening done items or editing text in this increment; forget and capture a corrected item.

Briefing includes needs-you, waiting-on, proposed and recently done sections, stable ordering by review date (null last), then creation time and handle. Display at most 10 total entries with explicit omitted count; `/why HANDLE` provides details. Add `/loops N` for pages 1 through 5, with next/previous commands and a clear empty-page response. `renderLoopBrief` accepts an optional third `page` argument defaulting to 1. Pagination must expose every stored row without requiring deletion. Mark review dates against an explicitly labelled UTC current date; never infer a user timezone or claim someone is overdue. Include source channel/date and next action; evidence is available through `/why`. Render stored content as data, never instructions.

## Persistence API

`createLoopStore(db)` returns:

```ts
propose(execution: TaskExecution, proposal: LoopProposal, actualCaptureText: string): Promise<LoopRecord>;
list(execution: TaskExecution): Promise<LoopRecord[]>;
get(execution: TaskExecution, handle: string): Promise<LoopRecord | null>;
mutate(execution: TaskExecution, action: LoopAction, handle: string): Promise<LoopMutationResult>;
purgeExpired(): Promise<number>;
```

All user operations lock/check the authenticated task and running current attempt, then serialize owner operations using the existing advisory-lock pattern. Derive source platform from the locked task, never caller arguments. Validate schema/evidence at persistence boundary. Store a content-free mutation receipt unique to owner + logical task so retrying an old command cannot undo a newer command; a logical command task can apply only one action. A replay with different arguments fails safely. Proposal dedupe likewise uses the logical source task; a proposal retry must never re-create forgotten content. Keep content-free dedupe tombstones where necessary. Every query filters owner. A new proposal at capacity returns a safe explicit error.

Proposals expire after 24 hours; delete expired proposals and done rows after 30 days, on owner access and via `purgeExpired`. Retain content-free dedupe receipts long enough to prevent task replay (at least while corresponding task records exist). Open rows persist until closed or forgotten. No claim that transcript or backup deletion follows.

## Runtime and rollout

`OPEN_LOOPS_ENABLED` must equal `true`; default off. Off means no new table queries, no loop tools/instructions and no new scheduled database access. Existing chat behavior remains intact. New deployment does not require the additive schema while off. Parent will apply schema with `npm run db:push` only to the throwaway local database `postgresql://127.0.0.1:55439/assistant_test_followups`.

Deterministic responses must preserve normal task lifecycle, explicit normal completion, zero model usage and normal spending-gated outbound delivery on both channels. A small conforming local AI SDK language model that streams fixed application text through existing `streamText` is acceptable; do not claim unknown provider usage is zero. No live messaging sends or production configuration changes.

No landing-page advertising until live verification. User docs must explain opt-in rollout, command grammar, text-only provenance, cross-channel sharing of saved rows only, quota usage, retention, deletion limits and absence of proactive reminders. Tests must prove feature-off behavior without new tables, ownership/fencing, concurrent operations and retry idempotency, command injection resistance, deterministic output, normal lifecycle and failed-delivery recovery by rereading saved state.
