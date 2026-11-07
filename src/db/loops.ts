import { randomBytes } from "node:crypto";
import { and, asc, count, eq, lt, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  LoopError,
  type LoopAction,
  type LoopMutationResult,
  type LoopProposal,
  type LoopRecord,
  validateLoopEvidence,
} from "../loops/domain.js";
import * as schema from "./schema.js";
import type { TaskExecution } from "./tasks.js";

const { assistantTasks, taskAttempts, openLoops, openLoopReceipts } = schema;
type Database = NodePgDatabase<typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type LoopRow = typeof openLoops.$inferSelect;
type Outcome = LoopMutationResult["outcome"];

const MAX_ROWS_PER_OWNER = 50;
const PROPOSAL_TTL_MS = 24 * 60 * 60_000;
const RETENTION_MS = 30 * 24 * 60 * 60_000;
const HANDLE_PATTERN = /^L[0-9A-F]{12}$/;
const LOOP_ACTIONS: ReadonlySet<LoopAction> = new Set(["keep", "waiting", "mine", "done", "forget"]);

const newHandle = () => `L${randomBytes(6).toString("hex").toUpperCase()}`;

// An explicit list, so the owner and any future column stay out of what reaches rendering.
const toRecord = (row: LoopRow): LoopRecord => ({
  handle: row.handle,
  status: row.status,
  sourcePlatform: row.sourcePlatform,
  title: row.title,
  direction: row.direction,
  nextAction: row.nextAction,
  reviewOn: row.reviewOn,
  evidenceQuote: row.evidenceQuote,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  expiresAt: row.expiresAt,
});

const pastRetention = (now: Date) => {
  const cutoff = new Date(now.getTime() - RETENTION_MS);
  return or(
    and(eq(openLoops.status, "proposed"), lt(openLoops.expiresAt, cutoff)),
    and(eq(openLoops.status, "done"), lt(openLoops.updatedAt, cutoff)),
  );
};

// `forget` always succeeds on a row that still exists; it is the user's way to erase anything.
const decide = (
  row: LoopRow,
  action: LoopAction,
  now: Date,
): { outcome: Outcome; changes?: Partial<Pick<LoopRow, "status" | "direction" | "expiresAt">> } => {
  if (action === "forget") return { outcome: "applied" };
  if (row.status === "proposed" && row.expiresAt && row.expiresAt <= now) return { outcome: "expired" };
  switch (action) {
    case "keep":
      if (row.status === "proposed")
        return { outcome: "applied", changes: { status: "open", expiresAt: null } };
      return { outcome: row.status === "open" ? "already_applied" : "invalid_transition" };
    case "done":
      if (row.status === "open") return { outcome: "applied", changes: { status: "done" } };
      return { outcome: row.status === "done" ? "already_applied" : "invalid_transition" };
    case "mine":
    case "waiting":
      if (row.status !== "open") return { outcome: "invalid_transition" };
      return row.direction === action
        ? { outcome: "already_applied" }
        : { outcome: "applied", changes: { direction: action } };
  }
};

export const createLoopStore = (db: Database) => {
  // Fence on the current running attempt, then serialize the owner. Task locks always come
  // first so that a retry and a concurrent command for the same owner cannot deadlock.
  const withOwner = <T>(
    execution: TaskExecution,
    work: (tx: Transaction, platform: LoopRecord["sourcePlatform"], now: Date) => Promise<T>,
  ) =>
    db.transaction(async (tx) => {
      const [task] = await tx
        .select({ platform: assistantTasks.platform })
        .from(assistantTasks)
        .where(
          and(
            eq(assistantTasks.id, execution.taskId),
            eq(assistantTasks.clerkUserId, execution.clerkUserId),
            eq(assistantTasks.currentAttemptId, execution.attemptId),
          ),
        )
        .for("update");
      const [attempt] = task
        ? await tx
            .select({ id: taskAttempts.id })
            .from(taskAttempts)
            .where(
              and(
                eq(taskAttempts.id, execution.attemptId),
                eq(taskAttempts.taskId, execution.taskId),
                eq(taskAttempts.status, "running"),
              ),
            )
            .for("update")
        : [];
      if (!task || !attempt)
        throw new LoopError("This request is no longer active. Please send a new message.");
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`open-loops:${execution.clerkUserId}`}, 0))`,
      );
      // Taken after the lock wait, so a queued request sees expiry as of when it actually runs.
      const now = new Date();
      await tx
        .delete(openLoops)
        .where(and(eq(openLoops.clerkUserId, execution.clerkUserId), pastRetention(now)));
      return work(tx, task.platform, now);
    });

  const findReceipt = async (tx: Transaction, execution: TaskExecution) => {
    const [receipt] = await tx
      .select()
      .from(openLoopReceipts)
      .where(
        and(
          eq(openLoopReceipts.clerkUserId, execution.clerkUserId),
          eq(openLoopReceipts.taskId, execution.taskId),
        ),
      );
    return receipt ?? null;
  };

  const findRow = async (tx: Transaction, clerkUserId: string, handle: string) => {
    const [row] = await tx
      .select()
      .from(openLoops)
      .where(and(eq(openLoops.clerkUserId, clerkUserId), eq(openLoops.handle, handle)))
      .for("update");
    return row ?? null;
  };

  // Tells a repeated /forget from a handle this owner never had, without keeping any content.
  const wasForgotten = async (tx: Transaction, clerkUserId: string, handle: string) => {
    const [receipt] = await tx
      .select({ handle: openLoopReceipts.handle })
      .from(openLoopReceipts)
      .where(
        and(
          eq(openLoopReceipts.clerkUserId, clerkUserId),
          eq(openLoopReceipts.handle, handle),
          eq(openLoopReceipts.action, "forget"),
          eq(openLoopReceipts.outcome, "applied"),
        ),
      )
      .limit(1);
    return receipt !== undefined;
  };

  return {
    propose: (
      execution: TaskExecution,
      proposal: LoopProposal,
      actualCaptureText: string,
    ): Promise<LoopRecord> =>
      withOwner(execution, async (tx, platform, now) => {
        const receipt = await findReceipt(tx, execution);
        if (receipt) {
          if (receipt.kind !== "proposal")
            throw new LoopError("This message already ran a loop command. Please send a new message.");
          // The first result stands, even if the retried model call worded it differently.
          const existing = await findRow(tx, execution.clerkUserId, receipt.handle);
          if (!existing)
            throw new LoopError(
              "That item was already removed, so it was not saved again. Send a new message to track it.",
            );
          return toRecord(existing);
        }

        validateLoopEvidence(proposal, actualCaptureText);

        const [{ rows }] = await tx
          .select({ rows: count() })
          .from(openLoops)
          .where(eq(openLoops.clerkUserId, execution.clerkUserId));
        // Done and expired rows count too: the cap bounds what is stored, not what is active.
        if (rows >= MAX_ROWS_PER_OWNER)
          throw new LoopError(
            `You already have ${MAX_ROWS_PER_OWNER} saved items, the most this list keeps. Use /forget to make room, then try again.`,
          );

        const [row] = await tx
          .insert(openLoops)
          .values({
            clerkUserId: execution.clerkUserId,
            handle: newHandle(),
            status: "proposed",
            direction: proposal.direction,
            sourcePlatform: platform,
            title: proposal.title,
            nextAction: proposal.nextAction,
            reviewOn: proposal.reviewOn,
            evidenceQuote: proposal.evidenceQuote,
            createdAt: now,
            updatedAt: now,
            expiresAt: new Date(now.getTime() + PROPOSAL_TTL_MS),
          })
          .returning();
        if (!row) throw new LoopError("That item could not be saved. Please try again.");
        await tx.insert(openLoopReceipts).values({
          clerkUserId: execution.clerkUserId,
          taskId: execution.taskId,
          kind: "proposal",
          handle: row.handle,
        });
        return toRecord(row);
      }),

    // Includes expired proposals, so everything still stored stays visible and can be forgotten.
    list: (execution: TaskExecution): Promise<LoopRecord[]> =>
      withOwner(execution, async (tx) => {
        const rows = await tx
          .select()
          .from(openLoops)
          .where(eq(openLoops.clerkUserId, execution.clerkUserId))
          .orderBy(sql`${openLoops.reviewOn} asc nulls last`, asc(openLoops.createdAt), asc(openLoops.handle));
        return rows.map(toRecord);
      }),

    get: (execution: TaskExecution, handle: string): Promise<LoopRecord | null> =>
      withOwner(execution, async (tx) => {
        const normalized = handle.trim().toUpperCase();
        if (!HANDLE_PATTERN.test(normalized)) return null;
        const row = await findRow(tx, execution.clerkUserId, normalized);
        return row ? toRecord(row) : null;
      }),

    mutate: (execution: TaskExecution, action: LoopAction, handle: string): Promise<LoopMutationResult> =>
      withOwner(execution, async (tx, _platform, now) => {
        if (!LOOP_ACTIONS.has(action)) throw new LoopError("That is not a loop command.");
        const normalized = handle.trim().toUpperCase();
        const receipt = await findReceipt(tx, execution);
        if (receipt) {
          // Replaying the stored result, rather than re-deciding, is what keeps a retried
          // command from undoing anything the user has done since.
          if (
            receipt.kind !== "mutation" ||
            !receipt.outcome ||
            receipt.action !== action ||
            receipt.handle !== normalized
          )
            throw new LoopError("This message already ran a different loop command. Please send a new message.");
          return { handle: normalized, action, outcome: receipt.outcome };
        }
        // Nothing can match it and it may not be a handle at all, so it must not reach a receipt.
        if (!HANDLE_PATTERN.test(normalized)) return { handle: normalized, action, outcome: "not_found" };

        const row = await findRow(tx, execution.clerkUserId, normalized);
        const { outcome, changes } = row
          ? decide(row, action, now)
          : {
              outcome:
                action === "forget" && (await wasForgotten(tx, execution.clerkUserId, normalized))
                  ? ("already_applied" as const)
                  : ("not_found" as const),
              changes: undefined,
            };
        if (row && action === "forget") {
          await tx
            .delete(openLoops)
            .where(and(eq(openLoops.clerkUserId, execution.clerkUserId), eq(openLoops.handle, normalized)));
        } else if (changes) {
          await tx
            .update(openLoops)
            .set({ ...changes, updatedAt: now })
            .where(and(eq(openLoops.clerkUserId, execution.clerkUserId), eq(openLoops.handle, normalized)));
        }
        await tx.insert(openLoopReceipts).values({
          clerkUserId: execution.clerkUserId,
          taskId: execution.taskId,
          kind: "mutation",
          handle: normalized,
          action,
          outcome,
        });
        return { handle: normalized, action, outcome };
      }),

    // Internal retention job, never exposed to the model. Receipts stay with their tasks.
    purgeExpired: async (): Promise<number> => {
      const rows = await db
        .delete(openLoops)
        .where(pastRetention(new Date()))
        .returning({ handle: openLoops.handle });
      return rows.length;
    },
  };
};
export type LoopStore = ReturnType<typeof createLoopStore>;
