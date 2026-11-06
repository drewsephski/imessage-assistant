import { randomBytes } from "node:crypto";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { CalendarError } from "../integrations/calendar.js";
import * as schema from "./schema.js";
const { assistantTasks, taskAttempts, calendarConnections, calendarDrafts } = schema;
export const createCalendarStore = (db) => {
    const withExecution = async (execution, work) => db.transaction(async (tx) => {
        const [task] = await tx.select().from(assistantTasks).where(and(eq(assistantTasks.id, execution.taskId), eq(assistantTasks.clerkUserId, execution.clerkUserId), eq(assistantTasks.currentAttemptId, execution.attemptId))).for("update");
        const [attempt] = task ? await tx.select().from(taskAttempts).where(and(eq(taskAttempts.id, execution.attemptId), eq(taskAttempts.taskId, execution.taskId), eq(taskAttempts.status, "running"))).for("update") : [];
        if (!attempt)
            throw new CalendarError("This request is no longer active. Please send a new message.");
        return work(tx);
    });
    return {
        connection: (execution) => withExecution(execution, async (tx) => {
            const [connection] = await tx.select().from(calendarConnections)
                .where(eq(calendarConnections.clerkUserId, execution.clerkUserId));
            return connection ?? null;
        }),
        saveConnection: (execution, accountId, authConfigId, previousAccountId) => withExecution(execution, async (tx) => {
            // Publish only one winning link. Concurrent channel requests must not
            // replace an account selected since this request read its prior state.
            const saved = previousAccountId === undefined
                ? await tx.insert(calendarConnections)
                    .values({ clerkUserId: execution.clerkUserId, accountId, authConfigId })
                    .onConflictDoNothing().returning({ id: calendarConnections.accountId })
                : await tx.update(calendarConnections)
                    .set({ accountId, authConfigId, createdAt: new Date() })
                    .where(and(eq(calendarConnections.clerkUserId, execution.clerkUserId), eq(calendarConnections.accountId, previousAccountId)))
                    .returning({ id: calendarConnections.accountId });
            return saved.length === 1;
        }),
        draft: (execution, accountId, event) => withExecution(execution, async (tx) => {
            const [connection] = await tx.select().from(calendarConnections).where(and(eq(calendarConnections.clerkUserId, execution.clerkUserId), eq(calendarConnections.accountId, accountId))).for("share");
            if (!connection)
                throw new CalendarError("Calendar connection changed. Please start again.");
            await tx.insert(calendarDrafts).values({
                clerkUserId: execution.clerkUserId, sourceTaskId: execution.taskId, accountId, event,
                confirmationCode: randomBytes(6).toString("hex"), expiresAt: new Date(Date.now() + 15 * 60_000),
            }).onConflictDoNothing({ target: calendarDrafts.sourceTaskId });
            const [draft] = await tx.select().from(calendarDrafts).where(and(eq(calendarDrafts.clerkUserId, execution.clerkUserId), eq(calendarDrafts.sourceTaskId, execution.taskId)));
            if (!draft)
                throw new CalendarError("Could not save this calendar draft.");
            // A repeated tool call/retry cannot silently modify details behind an existing code.
            return draft;
        }),
        findDraft: (execution, code) => withExecution(execution, async (tx) => {
            const [draft] = await tx.select().from(calendarDrafts).where(and(eq(calendarDrafts.clerkUserId, execution.clerkUserId), eq(calendarDrafts.confirmationCode, code)));
            return draft ?? null;
        }),
        claim: (execution, draftId, accountId) => withExecution(execution, async (tx) => {
            const [connection] = await tx.select().from(calendarConnections).where(and(eq(calendarConnections.clerkUserId, execution.clerkUserId), eq(calendarConnections.accountId, accountId))).for("share");
            if (!connection)
                throw new CalendarError("Calendar connection changed. Please make a new draft.");
            const [draft] = await tx.select().from(calendarDrafts).where(and(eq(calendarDrafts.id, draftId), eq(calendarDrafts.clerkUserId, execution.clerkUserId), eq(calendarDrafts.accountId, accountId))).for("update");
            if (!draft || draft.sourceTaskId === execution.taskId)
                throw new CalendarError("Confirm the saved draft in a new message.");
            if (draft.submittedAt)
                return false;
            if (draft.expiresAt.getTime() <= Date.now())
                throw new CalendarError("This draft expired. Please make a new one.");
            await tx.update(calendarDrafts).set({ submittedAt: new Date() }).where(eq(calendarDrafts.id, draft.id));
            return true;
        }),
        // Internal retention job, never exposed to the model. Submitted details remain briefly
        // available for reconciliation; expired unsubmitted proposals need no long-term history.
        purgeExpired: async () => {
            const rows = await db.delete(calendarDrafts).where(or(and(isNull(calendarDrafts.submittedAt), lt(calendarDrafts.expiresAt, new Date(Date.now() - 86400_000))), lt(calendarDrafts.submittedAt, new Date(Date.now() - 30 * 86400_000)))).returning({ id: calendarDrafts.id });
            return rows.length;
        },
    };
};
