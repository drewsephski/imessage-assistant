import { randomUUID } from "node:crypto";
import * as Sentry from "@sentry/node";
import { locals } from "@trigger.dev/sdk";
import { db } from "../db/index.js";
import { createSpendingStore, withResourceLock, } from "../db/spending.js";
import { currentTaskExecution } from "../trigger/task-tracking.js";
import { SpendingDenied, readSpendingPolicy } from "./policy.js";
import { withReservedComputerStartup } from "./computers.js";
import { currentSpendingContext } from "./context.js";
const store = createSpendingStore(db);
const deniedKey = locals.create("assistant.spendingDenied");
export const resetSpendingNotice = () => locals.set(deniedKey, undefined);
export const spendingNotice = () => {
    const reason = locals.get(deniedKey);
    if (!reason)
        return undefined;
    if (reason === "limit")
        return "You've reached your current usage allowance. Please contact support if you need more.";
    if (reason === "busy")
        return "I'm already handling other requests. Please try again shortly.";
    return "I can't start more work right now. Please try again later or contact support.";
};
const rememberDenial = (error) => {
    const context = currentSpendingContext();
    if (context?.kind === "task" && context.execution.attemptId !== currentTaskExecution()?.attemptId)
        return;
    if (error instanceof SpendingDenied)
        locals.set(deniedKey, error.reason);
};
const spendingExecution = () => {
    const context = currentSpendingContext();
    if (context?.kind === "task") {
        if (context.signal.aborted)
            throw new SpendingDenied("stale");
        return context.execution;
    }
    return context?.kind === "service" ? undefined : currentTaskExecution();
};
export const createSpendingRuntime = (spendingStore = store, policy = readSpendingPolicy) => ({
    async reserve(operation, options = {}) {
        try {
            const execution = spendingExecution();
            const service = options.service === true || currentSpendingContext()?.kind === "service";
            if (!execution && !service)
                throw new SpendingDenied("stale");
            const priorDenial = locals.get(deniedKey);
            if (!service && execution && priorDenial)
                throw new SpendingDenied(priorDenial);
            const reservation = await spendingStore.reserve({
                execution: service ? undefined : execution,
                operation,
                operationKey: options.operationKey ?? randomUUID(),
                resourceKey: options.resourceKey,
                reuseComputerLease: options.resourceKey !== undefined,
            }, policy());
            return reservation;
        }
        catch (error) {
            rememberDenial(error);
            throw error;
        }
    },
    async uncertain(reservation) {
        try {
            await spendingStore.markUncertain(reservation.controlId, reservation.id);
        }
        catch (error) {
            // The committed reservation remains charged against allowance. Never retry paid work
            // merely because a post-request accounting update failed.
            Sentry.captureException(error);
        }
    },
    policy,
});
export const spending = createSpendingRuntime();
export const spendOperation = async (operation, work, service = false) => {
    const reservation = await spending.reserve(operation, { service });
    try {
        return await work();
    }
    finally {
        await spending.uncertain(reservation);
    }
};
// The original send remains marked failed by deliverTaskReply. A bounded service-account
// notice is separate delivery, not proof the paid result reached the user.
export const withAllowanceNotice = async (originalText, send, notify) => {
    try {
        return await send();
    }
    catch (error) {
        const notice = spendingNotice();
        if (!(error instanceof SpendingDenied) || !notice || notice === originalText)
            throw error;
        return notify(notice);
    }
};
// Commit the reservation before any provider request. The advisory lock coordinates that
// commit with the stop worker; it must never wrap a provider call that could be rolled back.
export const reserveComputerLease = async (resourceKey) => {
    const priorDenial = locals.get(deniedKey);
    if (priorDenial)
        throw new SpendingDenied(priorDenial);
    const execution = spendingExecution();
    if (!execution || resourceKey !== `user-${execution.clerkUserId}`)
        throw new SpendingDenied("stale");
    try {
        return await withResourceLock(db, resourceKey, async (tx) => createSpendingStore(tx).reserve({
            execution,
            operation: "computer:lease",
            resourceKey,
            operationKey: `computer:${execution.attemptId}`,
            reuseComputerLease: true,
        }, readSpendingPolicy()));
    }
    catch (error) {
        rememberDenial(error);
        throw error;
    }
};
export const withComputerStartup = async (resourceKey, reservation, startup) => {
    const priorDenial = locals.get(deniedKey);
    if (priorDenial)
        throw new SpendingDenied(priorDenial);
    const execution = spendingExecution();
    if (!execution)
        throw new SpendingDenied("stale");
    // The hold was committed in the earlier reservation phase. Rolling back this lock-only
    // transaction after an API failure/crash cannot erase it.
    if (resourceKey !== reservation.resourceKey)
        throw new SpendingDenied("stale");
    try {
        return await withReservedComputerStartup(db, execution, reservation, async () => {
            const denied = locals.get(deniedKey);
            if (denied)
                throw new SpendingDenied(denied);
            return startup();
        });
    }
    catch (error) {
        rememberDenial(error);
        throw error;
    }
};
export const endComputerLeases = async () => {
    const execution = currentTaskExecution();
    if (execution)
        await store.endComputerLeases(execution);
};
