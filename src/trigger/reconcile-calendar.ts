import { schedules } from "@trigger.dev/sdk";
import { createCalendarStore } from "../db/calendar.js";
import { db } from "../db/index.js";

export const reconcileCalendarDrafts = schedules.task({
  id: "reconcile-calendar-drafts",
  cron: "17 3 * * *",
  maxDuration: 60,
  run: async () => {
    // Does not require calendar credentials: retention must continue after disabling it.
    return { deleted: await createCalendarStore(db).purgeExpired() };
  },
});
