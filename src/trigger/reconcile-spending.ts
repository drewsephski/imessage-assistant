import { schedules } from "@trigger.dev/sdk";
import { db } from "../db/index.js";
import { createSpendingStore } from "../db/spending.js";
import { stopExpiredComputers } from "../spending/computers.js";
import { log } from "./log.js";

export const reconcileSpending = schedules.task({
  id: "reconcile-assistant-spending",
  cron: "* * * * *",
  maxDuration: 300,
  run: async () => {
    await createSpendingStore(db).retainExpired();
    const stopped = await stopExpiredComputers();
    log.info("Spending reservations reconciled", { "assistant.computers_stopped": stopped });
    return { stopped };
  },
});
