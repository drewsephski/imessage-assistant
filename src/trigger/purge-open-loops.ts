import { schedules } from "@trigger.dev/sdk";
import { db } from "../db/index.js";
import { createLoopStore, type LoopStore } from "../db/loops.js";
import { log } from "./log.js";
import { openLoopsEnabled } from "./loop-tools.js";

// Off means no access to the new tables, so this also pauses retention while the feature is off.
export const purgeOpenLoopRows = async (store?: Pick<LoopStore, "purgeExpired">) => {
  if (!openLoopsEnabled()) return { enabled: false, deleted: 0 };
  const deleted = await (store ?? createLoopStore(db)).purgeExpired();
  log.info("Expired open loops purged", { "assistant.deleted_count": deleted });
  return { enabled: true, deleted };
};

export const purgeOpenLoops = schedules.task({
  id: "purge-open-loops",
  cron: "29 3 * * *",
  maxDuration: 60,
  run: () => purgeOpenLoopRows(),
});
