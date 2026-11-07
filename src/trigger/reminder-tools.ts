import * as Sentry from "@sentry/node";
import { runs, tasks } from "@trigger.dev/sdk";
import { chat } from "@trigger.dev/sdk/ai";
import { tool } from "ai";
import { z } from "zod";
import { InactiveExecutionError } from "../db/execution.js";
import { db } from "../db/index.js";
import { createReminderStore, type ReminderStore } from "../db/reminders.js";
import { PLATFORMS } from "../db/schema.js";
import type { TaskExecution } from "../db/tasks.js";
import {
  formatWhen,
  ReminderError,
  reminderInputSchema,
  renderReminderList,
  resolveDueAt,
} from "../reminders/domain.js";
import { currentSpendingContext } from "../spending/context.js";
import type { sendReminder } from "./send-reminder.js";

const defaultStore = createReminderStore(db);

// Where a reminder goes back to: the chat this turn came from, as the channel declared it
const surfaceSchema = z.object({ platform: z.enum(PLATFORMS), chatId: z.string().min(1) });

type Work<T> = (execution: TaskExecution, surface: z.infer<typeof surfaceSchema>, now: Date) => Promise<T>;

// Every tool runs under the turn's own task identity and abort signal (scopedTools binds them), so
// a stopped turn or a stale retry can't schedule anything. Expected problems come back as a
// message for the model to relay; storage failures are reported without their bound parameters.
const withReminders = async <T>(work: Work<T>) => {
  const context = currentSpendingContext();
  if (context?.kind !== "task" || context.signal.aborted)
    return { status: "needs_attention" as const, message: new InactiveExecutionError().message };
  const surface = surfaceSchema.safeParse(chat.surface());
  if (!surface.success)
    return { status: "unavailable" as const, message: "Reminders aren't available on this chat." };
  try {
    return await work(context.execution, surface.data, new Date());
  } catch (error) {
    if (error instanceof ReminderError || error instanceof InactiveExecutionError)
      return { status: "needs_attention" as const, message: error.message };
    const failure = new Error("Reminder storage failed.");
    Sentry.captureException(failure);
    throw failure;
  }
};

export const reminderTools = (store: ReminderStore = defaultStore) => ({
  setReminder: tool({
    description:
      "Text the user back in this chat at a time they chose, with a short message in their words. dueAt is ISO 8601 with the correct UTC offset for timeZone (an IANA zone). One-time only; at least a minute and at most a year ahead.",
    inputSchema: reminderInputSchema,
    execute: (input) =>
      withReminders(async (execution, surface, now) => {
        const dueAt = resolveDueAt(input, now);
        const { reminder, created } = await store.schedule(execution, {
          platform: surface.platform,
          chatId: surface.chatId,
          message: input.message,
          dueAt,
          timeZone: input.timeZone,
        });
        if (created) {
          try {
            const handle = await tasks.trigger<typeof sendReminder>(
              "send-reminder",
              { reminderId: reminder.id },
              { delay: dueAt, tags: [`user:${execution.clerkUserId}`] },
            );
            await store.attachRun(execution.clerkUserId, reminder.id, handle.id);
          } catch (error) {
            // The row is saved, so the five-minute sweep delivers it a little late instead
            Sentry.captureException(error);
          }
        }
        return {
          status: "scheduled" as const,
          id: reminder.id,
          when: formatWhen(reminder.dueAt, reminder.timeZone),
          message: reminder.message,
          alreadyExisted: !created,
        };
      }),
  }),
  listReminders: tool({
    description: "List the user's scheduled reminders with their ids, soonest first.",
    inputSchema: z.strictObject({}),
    execute: () =>
      withReminders(async (execution) => ({
        status: "ok" as const,
        reminders: renderReminderList(await store.list(execution)),
      })),
  }),
  cancelReminder: tool({
    description: "Cancel one scheduled reminder by the id from listReminders or setReminder.",
    inputSchema: z.strictObject({ id: z.string().uuid() }),
    execute: ({ id }) =>
      withReminders(async (execution) => {
        const result = await store.cancel(execution, id);
        if (result.runId) {
          // Best effort: a run that fires anyway finds the row canceled and sends nothing
          try {
            await runs.cancel(result.runId);
          } catch (error) {
            Sentry.captureException(error);
          }
        }
        return { status: result.outcome };
      }),
  }),
});

export const reminderToolsInstructions = `
## Reminders
You can text the user back in this chat at a time they choose, with setReminder: "remind me", "ping me at", "text me when it's", "don't let me forget". It sends one message at that time; it doesn't do the task itself.
Work out the time in the user's timezone from what you know about them. If their timezone is unknown, ask once, save it with rememberAboutUser, then set the reminder. Pass dueAt as ISO 8601 with that zone's correct UTC offset at that date, and the zone as timeZone. Confirm back exactly the day, time and zone the tool returns, in one short line.
Keep the reminder message short and in the user's words, so it makes sense when it arrives on its own. Reminders are one-time: for "every day" or "weekly", say so and offer to set the next few individually.
listReminders shows what's scheduled with ids; cancelReminder cancels one. If the user asks to cancel or change one and you don't know its id, list first. To change a reminder, cancel it and set a new one.
A reminder goes to the chat app it was set from, even if the user later writes from another. Delivery is retried a few times if the app is unreachable, then dropped.
`.trim();
