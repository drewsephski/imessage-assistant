import { and, desc, eq, exists, lt } from "drizzle-orm";
import { z } from "zod";
import * as schema from "./schema.js";
const { assistantTasks, taskAttempts } = schema;
// The agent's maximum run duration is 30 minutes. Allow cleanup/reporting a short grace period.
export const TASK_DEADLINE_MS = 35 * 60 * 1000;
const startSchema = z.object({
    clerkUserId: z.string().min(1),
    platform: z.enum(schema.PLATFORMS),
    chatId: z.string().min(1),
    messageId: z.string().min(1),
    runId: z.string().min(1),
    runAttempt: z.number().int().positive(),
    previousRunId: z.string().min(1).optional(),
});
export const createTaskStore = (db) => {
    const ownsCurrentAttempt = (execution) => exists(db
        .select({ id: assistantTasks.id })
        .from(assistantTasks)
        .where(and(eq(assistantTasks.id, execution.taskId), eq(assistantTasks.clerkUserId, execution.clerkUserId), eq(assistantTasks.currentAttemptId, execution.attemptId))));
    const currentRunningAttempt = (execution) => and(eq(taskAttempts.id, execution.attemptId), eq(taskAttempts.taskId, execution.taskId), eq(taskAttempts.status, "running"), ownsCurrentAttempt(execution));
    return {
        async start(input) {
            const request = startSchema.parse(input);
            return db.transaction(async (tx) => {
                await tx
                    .insert(assistantTasks)
                    .values({
                    clerkUserId: request.clerkUserId,
                    platform: request.platform,
                    chatId: request.chatId,
                    messageId: request.messageId,
                })
                    .onConflictDoNothing();
                const [task] = await tx
                    .select()
                    .from(assistantTasks)
                    .where(and(eq(assistantTasks.clerkUserId, request.clerkUserId), eq(assistantTasks.platform, request.platform), eq(assistantTasks.chatId, request.chatId), eq(assistantTasks.messageId, request.messageId)))
                    .for("update");
                if (!task)
                    throw new Error("Task could not be created");
                if (task.currentAttemptId) {
                    const [previous] = await tx
                        .select()
                        .from(taskAttempts)
                        .where(and(eq(taskAttempts.id, task.currentAttemptId), eq(taskAttempts.taskId, task.id)))
                        .for("update");
                    if (!previous)
                        throw new Error("Task attempt is missing");
                    // Only an SDK retry or its explicit successor may recover a request. A completed
                    // request and a duplicate/older worker cannot launch the model again.
                    const isRetry = previous.runId === request.runId && request.runAttempt > previous.runAttempt;
                    const isSuccessor = previous.runId !== request.runId && request.previousRunId === previous.runId;
                    if (previous.status === "completed" || (!isRetry && !isSuccessor))
                        return null;
                    if (previous.status === "running") {
                        await tx
                            .update(taskAttempts)
                            .set({
                            status: "interrupted",
                            interruptionReason: "worker_restarted",
                            finishedAt: new Date(),
                            updatedAt: new Date(),
                        })
                            .where(eq(taskAttempts.id, previous.id));
                    }
                }
                const now = new Date();
                const [attempt] = await tx
                    .insert(taskAttempts)
                    .values({
                    taskId: task.id,
                    runId: request.runId,
                    runAttempt: request.runAttempt,
                    startedAt: now,
                    updatedAt: now,
                    deadlineAt: new Date(now.getTime() + TASK_DEADLINE_MS),
                })
                    .returning({ id: taskAttempts.id });
                if (!attempt)
                    throw new Error("Task attempt could not be created");
                await tx
                    .update(assistantTasks)
                    .set({ currentAttemptId: attempt.id })
                    .where(and(eq(assistantTasks.id, task.id), eq(assistantTasks.clerkUserId, request.clerkUserId)));
                return { clerkUserId: request.clerkUserId, taskId: task.id, attemptId: attempt.id };
            });
        },
        async recordUsage(execution, snapshot) {
            await db
                .update(taskAttempts)
                .set({ ...snapshot, updatedAt: new Date() })
                .where(and(currentRunningAttempt(execution), lt(taskAttempts.stepCount, snapshot.stepCount)));
        },
        async recordDelivery(execution, deliveryStatus) {
            await db
                .update(taskAttempts)
                .set({ deliveryStatus, updatedAt: new Date() })
                .where(and(currentRunningAttempt(execution), deliveryStatus === "not_applicable"
                ? eq(taskAttempts.deliveryStatus, "pending")
                : undefined));
        },
        async finish(execution, outcome) {
            const now = new Date();
            await db
                .update(taskAttempts)
                .set({ ...outcome, updatedAt: now, finishedAt: now })
                .where(currentRunningAttempt(execution));
        },
        async get(clerkUserId, taskId) {
            const [record] = await db
                .select({ task: assistantTasks, attempt: taskAttempts })
                .from(assistantTasks)
                .innerJoin(taskAttempts, eq(assistantTasks.currentAttemptId, taskAttempts.id))
                .where(and(eq(assistantTasks.clerkUserId, clerkUserId), eq(assistantTasks.id, taskId)));
            return record ?? null;
        },
        async list(clerkUserId, limit = 20) {
            const count = z.number().int().min(1).max(100).parse(limit);
            return db
                .select({ task: assistantTasks, attempt: taskAttempts })
                .from(assistantTasks)
                .innerJoin(taskAttempts, eq(assistantTasks.currentAttemptId, taskAttempts.id))
                .where(eq(assistantTasks.clerkUserId, clerkUserId))
                .orderBy(desc(assistantTasks.createdAt), desc(assistantTasks.id))
                .limit(count);
        },
        // Internal maintenance only: no customer input, prompt content, or ownership changes.
        async interruptExpired() {
            const now = new Date();
            const expired = await db
                .update(taskAttempts)
                .set({
                status: "interrupted",
                interruptionReason: "deadline_exceeded",
                finishedAt: now,
                updatedAt: now,
            })
                .where(and(eq(taskAttempts.status, "running"), lt(taskAttempts.deadlineAt, now)))
                .returning({ id: taskAttempts.id });
            return expired.length;
        },
    };
};
