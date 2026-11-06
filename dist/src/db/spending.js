import { and, countDistinct, eq, exists, gt, isNotNull, isNull, lt, ne, not, or, sql, } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { SpendingDenied, operationCeiling, utcMonth, } from "../spending/policy.js";
import * as schema from "./schema.js";
import { TASK_DEADLINE_MS } from "./tasks.js";
const { spendingControls: controls, spendingReservations: reservations, assistantTasks: tasks, taskAttempts: attempts, } = schema;
export const userControlId = (clerkUserId) => `user:${clerkUserId}`;
export const withResourceLock = (db, resourceKey, work) => db.transaction(async (tx) => {
    // Shared by startup and the independent stop worker, including across processes.
    await tx.execute(sql `select pg_advisory_xact_lock(hashtextextended(${`assistant-computer:${resourceKey}`}, 0))`);
    return work(tx);
});
export const createSpendingStore = (db) => {
    const exposure = (now) => or(eq(reservations.periodStart, utcMonth(now)), ne(reservations.status, "settled"));
    const total = async (where) => {
        const [result] = await db
            .select({
            amount: sql `coalesce(sum(case when ${reservations.status} = 'settled' then ${reservations.actualMicrousd} else ${reservations.maximumMicrousd} end), 0)::text`,
        })
            .from(reservations)
            .where(where);
        return BigInt(result?.amount ?? "0");
    };
    return {
        async reserve(input, policy) {
            const maximumMicrousd = operationCeiling(policy, input.operation);
            const category = schema.SPENDING_CATEGORIES.find((value) => input.operation.startsWith(`${value}:`));
            if (!category || !/^[a-zA-Z0-9:._-]{1,160}$/.test(input.operationKey))
                throw new SpendingDenied("unpriced");
            if ((category === "computer") !== (input.resourceKey !== undefined) ||
                (input.resourceKey &&
                    (!input.execution || input.resourceKey !== `user-${input.execution.clerkUserId}`)))
                throw new SpendingDenied("stale");
            if (!input.execution && category !== "messaging" && category !== "storage")
                throw new SpendingDenied("stale");
            const controlId = input.execution ? userControlId(input.execution.clerkUserId) : "service";
            return db.transaction(async (tx) => {
                const now = new Date();
                // Every admission locks global, then user. Across channels/workers, a concurrent
                // caller sees either the complete earlier reservation or none of it.
                await tx
                    .insert(controls)
                    .values({ id: "global", monthlyMicrousd: policy.globalMonthlyMicrousd })
                    .onConflictDoNothing();
                const [global] = await tx
                    .select()
                    .from(controls)
                    .where(eq(controls.id, "global"))
                    .for("update");
                await tx
                    .insert(controls)
                    .values({
                    id: controlId,
                    monthlyMicrousd: input.execution
                        ? policy.userMonthlyMicrousd
                        : policy.serviceMonthlyMicrousd,
                })
                    .onConflictDoNothing();
                const [owner] = await tx
                    .select()
                    .from(controls)
                    .where(eq(controls.id, controlId))
                    .for("update");
                if (!global || !owner || global.paused || owner.paused)
                    throw new SpendingDenied("paused");
                if (input.execution) {
                    const execution = input.execution;
                    const [current] = await tx
                        .select({ id: attempts.id })
                        .from(attempts)
                        .innerJoin(tasks, eq(tasks.id, attempts.taskId))
                        .where(and(eq(tasks.id, execution.taskId), eq(tasks.clerkUserId, execution.clerkUserId), eq(tasks.currentAttemptId, execution.attemptId), eq(attempts.id, execution.attemptId), eq(attempts.status, "running"), gt(attempts.deadlineAt, now)))
                        .for("update", { of: [tasks, attempts] });
                    if (!current)
                        throw new SpendingDenied("stale");
                }
                const [previous] = await tx
                    .select()
                    .from(reservations)
                    .where(and(eq(reservations.controlId, controlId), eq(reservations.operationKey, input.operationKey)));
                if (previous) {
                    if (input.reuseComputerLease &&
                        category === "computer" &&
                        previous.attemptId === input.execution?.attemptId &&
                        previous.resourceKey === input.resourceKey &&
                        previous.policyVersion === policy.version &&
                        previous.maximumMicrousd >= maximumMicrousd &&
                        !previous.resourceStoppedAt &&
                        previous.resourceExpiresAt &&
                        previous.resourceExpiresAt > now)
                        return previous;
                    throw new SpendingDenied("duplicate");
                }
                const txStore = createSpendingStore(tx);
                const globalUsed = await txStore.totalExposure(now);
                const ownerUsed = await txStore.totalExposure(now, controlId);
                if (globalUsed + maximumMicrousd > global.monthlyMicrousd ||
                    ownerUsed + maximumMicrousd > owner.monthlyMicrousd)
                    throw new SpendingDenied("limit");
                if (input.execution) {
                    const taskUsed = await txStore.taskExposure(input.execution.taskId);
                    if (taskUsed + maximumMicrousd > policy.maxTaskMicrousd)
                        throw new SpendingDenied("limit");
                    const [active] = await tx
                        .select({
                        global: countDistinct(reservations.attemptId),
                        owner: sql `count(distinct ${reservations.attemptId}) filter (where ${reservations.controlId} = ${controlId})::text`,
                    })
                        .from(reservations)
                        .innerJoin(attempts, eq(reservations.attemptId, attempts.id))
                        .where(and(eq(attempts.status, "running"), gt(attempts.deadlineAt, now), ne(attempts.id, input.execution.attemptId)));
                    if ((active?.global ?? 0) >= policy.maxConcurrentGlobalTasks ||
                        Number(active?.owner ?? 0) >= policy.maxConcurrentUserTasks)
                        throw new SpendingDenied("busy");
                }
                const [reservation] = await tx
                    .insert(reservations)
                    .values({
                    controlId,
                    taskId: input.execution?.taskId,
                    attemptId: input.execution?.attemptId,
                    operationKey: input.operationKey,
                    operation: input.operation,
                    category,
                    policyVersion: policy.version,
                    maximumMicrousd,
                    periodStart: utcMonth(now),
                    expiresAt: new Date(now.getTime() + TASK_DEADLINE_MS),
                    resourceKey: input.resourceKey,
                    resourceExpiresAt: input.resourceKey
                        ? new Date(now.getTime() + policy.computerLeaseSeconds * 1000)
                        : undefined,
                })
                    .returning();
                if (!reservation)
                    throw new Error("Spending reservation could not be recorded");
                return reservation;
            });
        },
        totalExposure: (now, controlId) => total(and(exposure(now), controlId ? eq(reservations.controlId, controlId) : undefined)),
        taskExposure: (taskId) => total(eq(reservations.taskId, taskId)),
        async markUncertain(controlId, id) {
            await db
                .update(reservations)
                .set({ status: "uncertain" })
                .where(and(eq(reservations.id, id), eq(reservations.controlId, controlId), eq(reservations.status, "reserved")));
        },
        // Trusted operator/provider reconciliation only. No model tool or public route exposes it.
        async settle(controlId, id, actualMicrousd, receipt) {
            if (actualMicrousd < 0n ||
                actualMicrousd > 999999999999999n ||
                !/^[a-zA-Z0-9._:-]{1,128}$/.test(receipt))
                throw new Error("Invalid spending settlement");
            return db.transaction(async (tx) => {
                await tx.select().from(controls).where(eq(controls.id, "global")).for("update");
                const [record] = await tx
                    .select()
                    .from(reservations)
                    .where(and(eq(reservations.id, id), eq(reservations.controlId, controlId)))
                    .for("update");
                if (!record)
                    throw new Error("Spending reservation not found");
                if (record.status === "settled") {
                    if (record.actualMicrousd !== actualMicrousd || record.settlementReference !== receipt)
                        throw new Error("Spending settlement already recorded");
                    return;
                }
                if (record.resourceKey && !record.resourceStoppedAt)
                    throw new Error("Computer must be confirmed stopped before settlement");
                await tx
                    .update(reservations)
                    .set({ status: "settled", actualMicrousd, settlementReference: receipt })
                    .where(eq(reservations.id, id));
                if (actualMicrousd > record.maximumMicrousd) {
                    // A violated price ceiling affects every caller. Keep the true liability and stop
                    // admission until the operator corrects the policy and reconciles the incident.
                    await tx
                        .update(controls)
                        .set({ paused: true })
                        .where(or(eq(controls.id, "global"), eq(controls.id, controlId)));
                }
            });
        },
        async endComputerLeases(execution) {
            await db
                .update(reservations)
                .set({ resourceExpiresAt: new Date() })
                .where(and(eq(reservations.controlId, userControlId(execution.clerkUserId)), eq(reservations.attemptId, execution.attemptId), isNotNull(reservations.resourceKey), isNull(reservations.resourceStoppedAt)));
        },
        async resourcesToInspect() {
            const live = alias(reservations, "live_spending_leases");
            const liveOwner = alias(controls, "live_spending_owner");
            const globalPaused = exists(db
                .select({ id: controls.id })
                .from(controls)
                .where(and(eq(controls.id, "global"), eq(controls.paused, true))));
            const hasLiveLease = exists(db
                .select({ id: live.id })
                .from(live)
                .innerJoin(liveOwner, eq(liveOwner.id, live.controlId))
                .where(and(eq(live.resourceKey, reservations.resourceKey), isNull(live.resourceStoppedAt), gt(live.resourceExpiresAt, new Date()), eq(liveOwner.paused, false))));
            return db
                .select({ key: reservations.resourceKey })
                .from(reservations)
                .where(and(isNotNull(reservations.resourceKey), isNull(reservations.resourceStoppedAt), or(globalPaused, not(hasLiveLease))))
                .groupBy(reservations.resourceKey)
                .orderBy(sql `min(${reservations.resourceStopAttemptedAt}) asc nulls first`, sql `min(${reservations.resourceExpiresAt})`)
                .limit(100);
        },
        async noteResourceStopAttempt(resourceKey) {
            // Called outside the network/lock transaction. A timeout or worker death must not
            // roll this back and put the same failing resource first on every scheduled run.
            await db
                .update(reservations)
                .set({ resourceStopAttemptedAt: new Date() })
                .where(and(eq(reservations.resourceKey, resourceKey), isNull(reservations.resourceStoppedAt)));
        },
        async computerLeaseUsable(execution, reservationId) {
            const now = new Date();
            const [global] = await db.select().from(controls).where(eq(controls.id, "global"));
            if (!global || global.paused)
                return false;
            const [live] = await db
                .select({ id: reservations.id })
                .from(reservations)
                .innerJoin(controls, eq(controls.id, reservations.controlId))
                .innerJoin(attempts, eq(attempts.id, reservations.attemptId))
                .innerJoin(tasks, eq(tasks.id, attempts.taskId))
                .where(and(eq(reservations.id, reservationId), eq(reservations.controlId, userControlId(execution.clerkUserId)), eq(reservations.attemptId, execution.attemptId), eq(tasks.id, execution.taskId), eq(tasks.clerkUserId, execution.clerkUserId), eq(tasks.currentAttemptId, execution.attemptId), eq(attempts.status, "running"), gt(attempts.deadlineAt, now), eq(controls.paused, false), isNull(reservations.resourceStoppedAt), gt(reservations.resourceExpiresAt, now)))
                .limit(1);
            return live !== undefined;
        },
        async resourceCanStop(resourceKey) {
            const [pending] = await db
                .select({ id: reservations.id })
                .from(reservations)
                .where(and(eq(reservations.resourceKey, resourceKey), isNull(reservations.resourceStoppedAt)))
                .limit(1);
            if (!pending)
                return false;
            const [global] = await db.select().from(controls).where(eq(controls.id, "global"));
            const active = await db
                .select({ id: reservations.id })
                .from(reservations)
                .innerJoin(controls, eq(controls.id, reservations.controlId))
                .where(and(eq(reservations.resourceKey, resourceKey), isNull(reservations.resourceStoppedAt), gt(reservations.resourceExpiresAt, new Date()), eq(controls.paused, false)))
                .limit(1);
            return global?.paused === true || active.length === 0;
        },
        async confirmResourceStopped(resourceKey) {
            await db
                .update(reservations)
                .set({ resourceStoppedAt: new Date(), status: "uncertain" })
                .where(and(eq(reservations.resourceKey, resourceKey), isNull(reservations.resourceStoppedAt), ne(reservations.status, "settled")));
        },
        async retainExpired() {
            await db
                .update(reservations)
                .set({ status: "uncertain" })
                .where(and(eq(reservations.status, "reserved"), lt(reservations.expiresAt, new Date())));
        },
    };
};
