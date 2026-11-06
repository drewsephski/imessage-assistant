import { schedules } from "@trigger.dev/sdk";
import { db } from "../db/index.js";
import { createTaskStore } from "../db/tasks.js";
import { log } from "./log.js";
// A killed/OOM worker cannot run onTurnComplete. Reconcile only after the maximum
// agent duration plus grace, so old processing records don't stay running forever.
export const reconcileAssistantTasks = schedules.task({
    id: "reconcile-assistant-tasks",
    cron: "*/5 * * * *",
    maxDuration: 60,
    run: async () => {
        const interrupted = await createTaskStore(db).interruptExpired();
        log.info("Expired assistant tasks reconciled", { "assistant.interrupted_count": interrupted });
        return { interrupted };
    },
});
