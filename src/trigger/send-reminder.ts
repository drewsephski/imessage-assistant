import * as Sentry from "@sentry/node";
import { schedules, schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { db } from "../db/index.js";
import { createReminderStore, type ReminderStore } from "../db/reminders.js";
import { renderReminderDelivery } from "../reminders/domain.js";
import { sendChannelText } from "./channel-messengers.js";
import { log } from "./log.js";

type Sender = typeof sendChannelText;

// Delivers one reminder, if it is still due and unsent. The claim is the only authority: a delayed
// run for a canceled reminder, or a second worker for the same one, finds nothing to send.
export const deliverReminder = async (
  store: Pick<ReminderStore, "claim" | "markSent">,
  reminderId: string,
  send: Sender,
  now = new Date(),
) => {
  const claimed = await store.claim(reminderId, now);
  if (!claimed) return { status: "skipped" as const };
  try {
    await send[claimed.platform](claimed.chatId, renderReminderDelivery(claimed.message));
  } catch (error) {
    // Left scheduled with its claim: the sweep retries after the reclaim window, and gives up
    // once the attempts are used. Not rethrown, so a provider blip isn't a failed run per retry
    Sentry.captureException(error);
    log.warn("Reminder delivery failed", {
      "channel.platform": claimed.platform,
      "assistant.reminder_attempt": claimed.attempts,
    });
    return { status: "failed" as const, attempts: claimed.attempts };
  }
  await store.markSent(reminderId, new Date());
  log.info("Reminder sent", { "channel.platform": claimed.platform });
  return { status: "sent" as const };
};

// Scheduled with `delay` set to the due time when the reminder is created
export const sendReminder = schemaTask({
  id: "send-reminder",
  schema: z.object({ reminderId: z.string().uuid() }),
  // A failed send is retried by the sweep, not by rerunning this: a retry inside the reclaim
  // window would only find its own claim and skip
  retry: { maxAttempts: 1 },
  machine: "micro",
  maxDuration: 60,
  run: ({ reminderId }) => deliverReminder(createReminderStore(db), reminderId, sendChannelText),
});

// Catches what the delayed runs miss: a trigger that failed when the reminder was set, a worker
// that died mid-send, or a delivery error. Bounded per pass; what's left waits for the next
export const sweepReminders = async (
  store: Pick<ReminderStore, "claim" | "markSent" | "due">,
  send: Sender,
  now = new Date(),
) => {
  const { due, failed } = await store.due(now);
  let sent = 0;
  for (const id of due) {
    if ((await deliverReminder(store, id, send, now)).status === "sent") sent++;
  }
  if (due.length || failed) {
    log.info("Reminders swept", {
      "assistant.due_count": due.length,
      "assistant.sent_count": sent,
      "assistant.failed_count": failed,
    });
  }
  return { due: due.length, sent, failed };
};

export const reconcileReminders = schedules.task({
  id: "reconcile-reminders",
  cron: "*/5 * * * *",
  maxDuration: 120,
  run: () => sweepReminders(createReminderStore(db), sendChannelText),
});
