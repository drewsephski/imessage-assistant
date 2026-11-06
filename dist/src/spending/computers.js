import { Daytona, DaytonaNotFoundError } from "@daytona/sdk";
import { db } from "../db/index.js";
import { createSpendingStore, withResourceLock } from "../db/spending.js";
import { SpendingDenied } from "./policy.js";
export const withReservedComputerStartup = (database, execution, reservation, startup) => {
    const key = reservation.resourceKey;
    if (!key || key !== `user-${execution.clerkUserId}`)
        throw new SpendingDenied("stale");
    return withResourceLock(database, key, async (tx) => {
        const locked = createSpendingStore(tx);
        if (!(await locked.computerLeaseUsable(execution, reservation.id)))
            throw new SpendingDenied("stale");
        const result = await startup();
        if (!(await locked.computerLeaseUsable(execution, reservation.id)))
            throw new SpendingDenied("stale");
        return result;
    });
};
// The injected stop function makes wall-clock shutdown testable without a real computer.
export const stopExpiredComputers = async (database = db, stop = async (key) => {
    const client = new Daytona();
    try {
        const sandbox = await client.get(key);
        if (sandbox.state !== "stopped" && sandbox.state !== "archived") {
            await sandbox.stop(60);
            await sandbox.refreshData();
            const confirmedState = sandbox.state;
            if (confirmedState !== "stopped" &&
                confirmedState !== "archived" &&
                confirmedState !== "destroyed")
                throw new Error("Computer shutdown not confirmed");
        }
    }
    catch (error) {
        if (!(error instanceof DaytonaNotFoundError))
            throw error;
    }
}) => {
    const store = createSpendingStore(database);
    const resources = await store.resourcesToInspect();
    let stopped = 0;
    let failures = 0;
    for (const resource of resources) {
        if (!resource.key)
            continue;
        const key = resource.key;
        await store.noteResourceStopAttempt(key);
        // A new lease cannot commit between checking expiry and stopping the shared computer.
        try {
            await withResourceLock(database, key, async (tx) => {
                const locked = createSpendingStore(tx);
                if (!(await locked.resourceCanStop(key)))
                    return;
                await stop(key);
                await locked.confirmResourceStopped(key);
                stopped++;
            });
        }
        catch {
            failures++;
        }
    }
    if (failures > 0)
        throw new Error(`Computer cleanup could not confirm ${failures} shutdowns; their reservations remain held`);
    return stopped;
};
