import { and, asc, count, eq, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  MAX_SCHEDULED_PER_USER,
  ReminderError,
  type ReminderRecord,
} from "../reminders/domain.js";
import { requireActiveExecution } from "./execution.js";
import * as schema from "./schema.js";
import type { Platform } from "./schema.js";
import type { TaskExecution } from "./tasks.js";

const { reminders } = schema;
type Database = NodePgDatabase<typeof schema>;
type Row = typeof reminders.$inferSelect;

// A claim that never reached "sent" is retried once this much time has passed, so a worker that
// died mid-send doesn't leave the reminder stuck, and a live one isn't sent twice
export const RECLAIM_AFTER_MS = 10 * 60_000;
// Deliveries that keep failing stop here, so an unreachable chat doesn't retry forever
export const MAX_ATTEMPTS = 3;

// An explicit list, so the owner, chat id and task id stay out of what the model sees
const toRecord = (row: Row): ReminderRecord => ({
  id: row.id,
  message: row.message,
  dueAt: row.dueAt,
  timeZone: row.timeZone,
  status: row.status,
});

export type DeliverableReminder = Pick<Row, "id" | "clerkUserId" | "platform" | "chatId" | "message" | "dueAt" | "timeZone" | "attempts">;

export const createReminderStore = (db: Database) => ({
  // Idempotent per source task: the same turn setting the same reminder twice (a retried
  // tool call, a retried attempt) gets the first row back and `created: false`
  async schedule(
    execution: TaskExecution,
    input: { platform: Platform; chatId: string; message: string; dueAt: Date; timeZone: string },
  ): Promise<{ reminder: ReminderRecord; created: boolean }> {
    return db.transaction(async (tx) => {
      await requireActiveExecution(tx, execution);
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`reminders:${execution.clerkUserId}`}, 0))`,
      );
      const [existing] = await tx
        .select()
        .from(reminders)
        .where(
          and(
            eq(reminders.sourceTaskId, execution.taskId),
            eq(reminders.dueAt, input.dueAt),
            eq(reminders.message, input.message),
          ),
        );
      if (existing) return { reminder: toRecord(existing), created: false };
      const [{ scheduled }] = await tx
        .select({ scheduled: count() })
        .from(reminders)
        .where(and(eq(reminders.clerkUserId, execution.clerkUserId), eq(reminders.status, "scheduled")));
      if (scheduled >= MAX_SCHEDULED_PER_USER)
        throw new ReminderError(
          `You already have ${MAX_SCHEDULED_PER_USER} reminders scheduled. Cancel one before adding another.`,
        );
      const [row] = await tx
        .insert(reminders)
        .values({
          clerkUserId: execution.clerkUserId,
          platform: input.platform,
          chatId: input.chatId,
          sourceTaskId: execution.taskId,
          message: input.message,
          dueAt: input.dueAt,
          timeZone: input.timeZone,
        })
        .returning();
      if (!row) throw new Error("Reminder could not be saved");
      return { reminder: toRecord(row), created: true };
    });
  },

  // Recorded after the delayed run exists. Not fenced: it is bookkeeping about a row this
  // owner just created, and the row's status alone decides whether anything is sent.
  async attachRun(clerkUserId: string, id: string, runId: string) {
    await db
      .update(reminders)
      .set({ runId, updatedAt: new Date() })
      .where(and(eq(reminders.id, id), eq(reminders.clerkUserId, clerkUserId)));
  },

  async list(execution: TaskExecution): Promise<ReminderRecord[]> {
    return db.transaction(async (tx) => {
      await requireActiveExecution(tx, execution);
      const rows = await tx
        .select()
        .from(reminders)
        .where(and(eq(reminders.clerkUserId, execution.clerkUserId), eq(reminders.status, "scheduled")))
        .orderBy(asc(reminders.dueAt), asc(reminders.id))
        .limit(MAX_SCHEDULED_PER_USER);
      return rows.map(toRecord);
    });
  },

  // Only a scheduled reminder can be canceled. The run id comes back so the caller can also
  // cancel the delayed run, which is an optimization: a run that fires anyway finds no claim.
  async cancel(
    execution: TaskExecution,
    id: string,
  ): Promise<{ outcome: "canceled" | "not_found" | "already_sent" | "already_canceled"; runId?: string }> {
    return db.transaction(async (tx) => {
      await requireActiveExecution(tx, execution);
      const [row] = await tx
        .select()
        .from(reminders)
        .where(and(eq(reminders.id, id), eq(reminders.clerkUserId, execution.clerkUserId)))
        .for("update");
      if (!row) return { outcome: "not_found" };
      if (row.status === "sent" || row.status === "failed") return { outcome: "already_sent" };
      if (row.status === "canceled") return { outcome: "already_canceled" };
      const now = new Date();
      await tx
        .update(reminders)
        .set({ status: "canceled", canceledAt: now, updatedAt: now })
        .where(eq(reminders.id, row.id));
      return { outcome: "canceled", ...(row.runId ? { runId: row.runId } : {}) };
    });
  },

  // Exactly one sender wins a due reminder. A canceled or sent row, one that isn't due yet, or one
  // another worker claimed in the last ten minutes yields null, and the caller sends nothing.
  async claim(id: string, now = new Date()): Promise<DeliverableReminder | null> {
    const [row] = await db
      .update(reminders)
      .set({ claimedAt: now, attempts: sql`${reminders.attempts} + 1`, updatedAt: now })
      .where(
        and(
          eq(reminders.id, id),
          eq(reminders.status, "scheduled"),
          lte(reminders.dueAt, now),
          lt(reminders.attempts, MAX_ATTEMPTS),
          or(isNull(reminders.claimedAt), lt(reminders.claimedAt, new Date(now.getTime() - RECLAIM_AFTER_MS))),
        ),
      )
      .returning();
    return row ?? null;
  },

  async markSent(id: string, now = new Date()) {
    await db
      .update(reminders)
      .set({ status: "sent", sentAt: now, updatedAt: now })
      .where(and(eq(reminders.id, id), eq(reminders.status, "scheduled")));
  },

  // The sweep's view: due reminders nobody is sending right now, and ones that have used up their
  // attempts, which it marks failed so they leave the list
  async due(now = new Date(), limit = 50) {
    const failed = await db
      .update(reminders)
      .set({ status: "failed", updatedAt: now })
      .where(
        and(
          eq(reminders.status, "scheduled"),
          lte(reminders.dueAt, now),
          sql`${reminders.attempts} >= ${MAX_ATTEMPTS}`,
          lt(reminders.claimedAt, new Date(now.getTime() - RECLAIM_AFTER_MS)),
        ),
      )
      .returning({ id: reminders.id });
    const rows = await db
      .select({ id: reminders.id })
      .from(reminders)
      .where(
        and(
          eq(reminders.status, "scheduled"),
          lte(reminders.dueAt, now),
          lt(reminders.attempts, MAX_ATTEMPTS),
          or(isNull(reminders.claimedAt), lt(reminders.claimedAt, new Date(now.getTime() - RECLAIM_AFTER_MS))),
        ),
      )
      .orderBy(asc(reminders.dueAt))
      .limit(limit);
    return { due: rows.map((row) => row.id), failed: failed.length };
  },
});

export type ReminderStore = ReturnType<typeof createReminderStore>;
