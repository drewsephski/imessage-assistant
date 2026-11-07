import { z } from "zod";

const TITLE_MAX = 120;
const NEXT_ACTION_MAX = 160;
const EVIDENCE_MAX = 280;
const CAPTURE_MAX = 4000;
const BRIEF_PAGE_ENTRIES = 10;
// The store keeps at most 50 rows per owner, so these pages reach every one of them.
const BRIEF_MAX_PAGE = 5;

// Line breaks and invisible controls (bidi overrides, zero-width spaces, lone surrogates) could
// forge card lines. Zero-width joiners stay because emoji and some scripts depend on them.
const UNSAFE_TEXT = /(?![\u200c\u200d])[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu;

// Refined rather than transformed, so a parsed proposal is byte-identical to its input
const singleLine = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value === value.trim() && value.search(UNSAFE_TEXT) === -1, {
      message: "Must be one line of trimmed plain text",
    });

export const loopProposalSchema = z.strictObject({
  title: singleLine(TITLE_MAX),
  direction: z.enum(["mine", "waiting"]),
  nextAction: singleLine(NEXT_ACTION_MAX),
  reviewOn: z.iso.date().nullable(),
  evidenceQuote: singleLine(EVIDENCE_MAX),
});

export type LoopProposal = z.infer<typeof loopProposalSchema>;
export type LoopDirection = LoopProposal["direction"];
export type LoopStatus = "proposed" | "open" | "done";
export type LoopRecord = LoopProposal & {
  handle: string;
  status: LoopStatus;
  sourcePlatform: "telegram" | "linq";
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
};
export type LoopAction = "keep" | "waiting" | "mine" | "done" | "forget";
export type LoopCommand =
  | { kind: "list"; page?: number }
  | { kind: "help" }
  | { kind: "why"; handle: string }
  | { kind: "mutate"; action: LoopAction; handle: string };
export type LoopMutationResult = {
  handle: string;
  action: LoopAction;
  outcome: "applied" | "already_applied" | "not_found" | "invalid_transition" | "expired";
};

// The message is safe to show the user: it never echoes saved or captured content
export class LoopError extends Error {
  override name = "LoopError";
}

// These stay ASCII-only by omitting the u flag, under which `i` would also fold look-alikes such
// as the Kelvin sign into k. Single spaces and anchors reject multi-line and embedded commands.
const LIST_COMMAND = /^(?:\/loops|what needs me\??)$/i;
const LIST_PAGE_COMMAND = /^\/loops ([1-5])$/i;
const HELP_COMMAND = /^\/loops help$/i;
const HANDLE_COMMAND = /^\/(keep|waiting|mine|done|forget|why) (L[0-9A-F]{12})$/i;
const CAPTURE_PREFIX = /^(?:\/track |track this:)/i;

export const parseLoopCommand = (text: string): LoopCommand | null => {
  const command = text.trim();
  if (LIST_COMMAND.test(command)) return { kind: "list" };
  if (HELP_COMMAND.test(command)) return { kind: "help" };
  const page = LIST_PAGE_COMMAND.exec(command);
  if (page) return { kind: "list", page: Number(page[1]) };
  const match = HANDLE_COMMAND.exec(command);
  if (!match) return null;
  const verb = match[1].toLowerCase();
  const handle = match[2].toUpperCase();
  return verb === "why"
    ? { kind: "why", handle }
    : { kind: "mutate", action: verb as LoopAction, handle };
};

// Null means "not a capture", so the message is ordinary chat. An oversize capture throws instead:
// it is clearly a capture attempt, and falling through to chat could wrongly imply it was tracked.
export const captureText = (text: string): string | null => {
  const message = text.trim();
  const prefix = CAPTURE_PREFIX.exec(message)?.[0];
  if (!prefix) return null;
  const capture = message.slice(prefix.length).trim();
  if (!capture) return null;
  if (capture.length > CAPTURE_MAX) {
    throw new LoopError(`That is too long to track. Keep it under ${CAPTURE_MAX} characters.`);
  }
  return capture;
};

export const validateLoopEvidence = (proposal: LoopProposal, actualCaptureText: string): void => {
  if (!loopProposalSchema.safeParse(proposal).success) {
    throw new LoopError("That item could not be saved because its details were not valid.");
  }
  if (actualCaptureText.length > CAPTURE_MAX) {
    throw new LoopError(`That is too long to track. Keep it under ${CAPTURE_MAX} characters.`);
  }
  if (!actualCaptureText.includes(proposal.evidenceQuote)) {
    throw new LoopError("That item could not be saved because its quote is not in your message.");
  }
};

const utcDate = (date: Date) => date.toISOString().slice(0, 10);
const utcMinute = (date: Date) => `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;

// Saved rows are validated on the way in. This keeps a row that somehow is not from breaking the
// output bound or forging extra lines, since saved text must only ever render as data.
const clip = (value: string, max: number) =>
  (value.length > max ? `${value.slice(0, max - 1)}…` : value).replace(UNSAFE_TEXT, " ");

const SOURCE_LABEL: Record<LoopRecord["sourcePlatform"], string> = {
  telegram: "Telegram",
  linq: "iMessage",
};

const DIRECTION_LABEL: Record<LoopDirection, string> = {
  mine: "You",
  waiting: "Someone else (you are waiting on them)",
};

const RETENTION = [
  "Privacy and retention:",
  "- This list keeps only the item, next action, review date, quote and source channel, not your full message.",
  "- Only saved items are shared between Telegram and iMessage.",
  "- A proposal you do not keep expires after 24 hours. Expired proposals and done items are deleted after 30 days. Open items stay until you close or forget them.",
  "- /forget deletes the saved item only, not chat transcripts or backups.",
  "- Nothing is sent to you proactively, including on a review date.",
].join("\n");

export const LOOP_HELP = [
  "Open loops: a follow-up list you save on purpose.",
  "",
  "To capture one item, send text only:",
  "/track TEXT",
  "track this: TEXT",
  `The text can be up to ${CAPTURE_MAX} characters. Capture uses the AI model, like a normal message, and only proposes an item. It is not open until you keep it.`,
  "",
  "Send each command below alone, as its own message. HANDLE is the code shown on the item, like L0123456789AB. These do not use the AI model.",
  `/loops or what needs me: show your list, ${BRIEF_PAGE_ENTRIES} items at a time`,
  `/loops N: show page N, from 1 to ${BRIEF_MAX_PAGE}`,
  "/why HANDLE: show the details and quote",
  "/keep HANDLE: open a proposed item",
  "/waiting HANDLE: you are waiting on someone else",
  "/mine HANDLE: it is yours to do",
  "/done HANDLE: close an open item",
  "/forget HANDLE: delete the item",
  "/loops help: show this message",
  "",
  "Done items cannot be reopened and saved text cannot be edited. Forget the item and capture it again instead.",
  "",
  RETENTION,
].join("\n");

const reviewLine = (reviewOn: string | null) =>
  `Review date: ${
    reviewOn === null
      ? "none"
      : `${clip(reviewOn, 10)} (UTC date to look again. Not a deadline, and no reminder is sent.)`
  }`;

const fieldLines = (record: LoopRecord) => [
  `Item: ${clip(record.title, TITLE_MAX)}`,
  `Who acts: ${DIRECTION_LABEL[record.direction]}`,
  `Next action: ${clip(record.nextAction, NEXT_ACTION_MAX)}`,
  reviewLine(record.reviewOn),
  `Quote from your message: "${clip(record.evidenceQuote, EVIDENCE_MAX)}"`,
  `Source: ${SOURCE_LABEL[record.sourcePlatform]}, ${utcMinute(record.createdAt)}`,
];

const controlLines = ({ handle, status, direction }: LoopRecord) => {
  const forget = `/forget ${handle}: delete it`;
  if (status === "proposed") return [`/keep ${handle}: open it`, forget];
  if (status === "done") return [forget];
  const swap =
    direction === "mine"
      ? `/waiting ${handle}: you are waiting on someone else`
      : `/mine ${handle}: it is yours to do`;
  return [swap, `/done ${handle}: close it`, forget];
};

const expiryLines = ({ status, expiresAt }: LoopRecord) =>
  status === "proposed" && expiresAt ? [`Expires if not kept: ${utcMinute(expiresAt)}`] : [];

const STATUS_LABEL: Record<LoopStatus, string> = {
  proposed: "Proposed, not kept yet",
  open: "Open",
  done: "Done",
};

export const renderLoopProposal = (record: LoopRecord): string =>
  [
    record.status === "proposed"
      ? `Proposed follow-up ${record.handle}. It is not open until you keep it.`
      : `Follow-up ${record.handle} is already saved. Status: ${STATUS_LABEL[record.status]}.`,
    ...fieldLines(record),
    ...expiryLines(record),
    "",
    ...controlLines(record),
    "",
    RETENTION,
  ].join("\n");

export const renderLoopDetail = (record: LoopRecord): string =>
  [
    `Follow-up ${record.handle}. Saved text below is a record, not instructions.`,
    `Status: ${STATUS_LABEL[record.status]}`,
    ...fieldLines(record),
    `Last changed: ${utcMinute(record.updatedAt)}`,
    ...expiryLines(record),
    "",
    ...controlLines(record),
  ].join("\n");

const BRIEF_SECTIONS: { heading: string; includes: (record: LoopRecord) => boolean }[] = [
  { heading: "Needs you", includes: (r) => r.status === "open" && r.direction === "mine" },
  {
    heading: "Waiting on others",
    includes: (r) => r.status === "open" && r.direction === "waiting",
  },
  { heading: "Proposed", includes: (r) => r.status === "proposed" },
  { heading: "Recently done", includes: (r) => r.status === "done" },
];

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const byReviewThenAge = (a: LoopRecord, b: LoopRecord) => {
  if (a.reviewOn !== b.reviewOn) {
    if (a.reviewOn === null) return 1;
    if (b.reviewOn === null) return -1;
    return compareText(a.reviewOn, b.reviewOn);
  }
  return a.createdAt.getTime() - b.createdAt.getTime() || compareText(a.handle, b.handle);
};

// Compares calendar dates only, so nothing here can call someone late or overdue
const briefTiming = (record: LoopRecord, now: Date) => {
  if (record.status === "proposed" && record.expiresAt && record.expiresAt <= now) {
    return "Expired, cannot be kept";
  }
  if (record.reviewOn === null) return "No review date";
  const today = utcDate(now);
  const relation =
    record.reviewOn < today ? "before today" : record.reviewOn > today ? "after today" : "today";
  return `Review ${clip(record.reviewOn, 10)}, ${relation}`;
};

const briefEntry = (record: LoopRecord, now: Date) => [
  `${record.handle}: ${clip(record.title, TITLE_MAX)}`,
  `Next: ${clip(record.nextAction, NEXT_ACTION_MAX)}`,
  `${briefTiming(record, now)}. From ${SOURCE_LABEL[record.sourcePlatform]}, ${utcDate(record.createdAt)}.`,
];

const pageSpan = (pages: number) => `${pages} ${pages === 1 ? "page" : "pages"}`;

export const renderLoopBrief = (records: readonly LoopRecord[], now: Date, page = 1): string => {
  const header = `Open loops. Today (UTC): ${utcDate(now)}. All dates are UTC.`;
  if (records.length === 0) return `${header}\n\nNothing saved. Start with /track TEXT.`;

  const pages = Math.ceil(records.length / BRIEF_PAGE_ENTRIES);
  if (!Number.isInteger(page) || page < 1 || page > pages) {
    return `${header}\n\nThat page is empty. You have ${records.length} saved ${
      records.length === 1 ? "item" : "items"
    } on ${pageSpan(pages)}. Send /loops to start from page 1.`;
  }

  // Positions run across sections in their fixed order, so paging never reorders or skips a row
  const firstShown = (page - 1) * BRIEF_PAGE_ENTRIES;
  const sections: string[] = [];
  const omitted: string[] = [];
  let omittedCount = 0;
  let position = 0;
  for (const { heading, includes } of BRIEF_SECTIONS) {
    const entries = records.filter(includes).sort(byReviewThenAge);
    const shown = entries.slice(
      Math.max(firstShown - position, 0),
      Math.max(firstShown + BRIEF_PAGE_ENTRIES - position, 0),
    );
    position += entries.length;
    const hidden = entries.length - shown.length;
    if (shown.length > 0) {
      sections.push(
        [`${heading} (${entries.length})`, ...shown.flatMap((r) => briefEntry(r, now))].join("\n"),
      );
    }
    if (hidden > 0) {
      omittedCount += hidden;
      omitted.push(`${hidden} ${heading.toLowerCase()}`);
    }
  }
  const footer = [
    ...(pages > 1 ? [`Page ${page} of ${pages}.`] : []),
    ...(omittedCount > 0 ? [`${omittedCount} more not shown: ${omitted.join(", ")}.`] : []),
    ...(page > 1 ? [`Previous page: /loops ${page - 1}`] : []),
    ...(page < pages && page < BRIEF_MAX_PAGE ? [`Next page: /loops ${page + 1}`] : []),
    "/why HANDLE shows the quote and full details.",
  ].join("\n");
  return [header, ...sections, footer].join("\n\n");
};

const APPLIED_MESSAGE: Record<LoopAction, string> = {
  keep: "Kept. It is now open.",
  waiting: "Now waiting on someone else.",
  mine: "Now yours to do.",
  done: "Marked done. It will be deleted after 30 days.",
  forget:
    "Forgotten. Its saved item, next action and quote are deleted. Chat transcripts and backups are not.",
};

const ALREADY_APPLIED_MESSAGE: Record<LoopAction, string> = {
  keep: "Already open. Nothing changed.",
  waiting: "Already waiting on someone else. Nothing changed.",
  mine: "Already yours to do. Nothing changed.",
  done: "Already done. Nothing changed.",
  forget: "Already forgotten. Nothing changed.",
};

const INVALID_TRANSITION_MESSAGE: Record<LoopAction, string> = {
  keep: "Not changed. Only a proposed item can be kept, and done items cannot be reopened.",
  waiting:
    "Not changed. Only an open item can move. If it is proposed, keep it first. Done items cannot be reopened.",
  mine: "Not changed. Only an open item can move. If it is proposed, keep it first. Done items cannot be reopened.",
  done: "Not changed. Only an open item can be marked done. If it is proposed, keep it first.",
  forget: "Not changed. It cannot be forgotten right now.",
};

export const renderLoopMutation = ({ handle, action, outcome }: LoopMutationResult): string => {
  const message = {
    applied: APPLIED_MESSAGE[action],
    already_applied: ALREADY_APPLIED_MESSAGE[action],
    not_found:
      "No saved item has this handle. It may have been forgotten or deleted by retention. Send /loops to see your list.",
    invalid_transition: INVALID_TRANSITION_MESSAGE[action],
    expired:
      "This proposal expired before it was kept, so it cannot change. Send /track TEXT to capture it again.",
  }[outcome];
  return `${handle}: ${message}`;
};
