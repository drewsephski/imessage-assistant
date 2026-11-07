import * as Sentry from "@sentry/node";
import { tool } from "ai";
import { InactiveExecutionError } from "../db/execution.js";
import { db } from "../db/index.js";
import { createProfileStore, type ProfileStore } from "../db/profiles.js";
import type { TaskExecution } from "../db/tasks.js";
import { forgetSchema, looksSecret, MemoryError, rememberSchema } from "../memory/domain.js";
import { currentSpendingContext } from "../spending/context.js";

const defaultStore = createProfileStore(db);

const withProfile = async <T>(work: (execution: TaskExecution) => Promise<T>) => {
  const context = currentSpendingContext();
  if (context?.kind !== "task" || context.signal.aborted)
    return { status: "needs_attention" as const, message: new InactiveExecutionError().message };
  try {
    return await work(context.execution);
  } catch (error) {
    if (error instanceof MemoryError || error instanceof InactiveExecutionError)
      return { status: "needs_attention" as const, message: error.message };
    // Drizzle errors carry bound parameters, which here would be the user's own words
    const failure = new Error("Memory storage failed.");
    Sentry.captureException(failure);
    throw failure;
  }
};

export const memoryTools = (store: ProfileStore = defaultStore) => ({
  rememberAboutUser: tool({
    description:
      "Save the user's timezone (IANA zone), their name, or one short note they'd want kept for next time. Shared across their chat apps. Only for what the user said or asked to keep; never secrets.",
    inputSchema: rememberSchema,
    execute: (item) =>
      withProfile(async (execution) => {
        if (looksSecret(item.value))
          return {
            status: "refused" as const,
            message: "That looks like a password, code or account number, which I don't keep.",
          };
        return { status: "saved" as const, ...(await store.remember(execution, item)) };
      }),
  }),
  forgetAboutUser: tool({
    description:
      "Forget the user's saved timezone, name, one note (by its exact saved text), or everything saved about them.",
    inputSchema: forgetSchema,
    execute: (item) =>
      withProfile(async (execution) => ({
        status: "forgotten" as const,
        ...(await store.forget(execution, item)),
      })),
  }),
});

export const memoryToolsInstructions = `
## Memory
What you know about this user is listed above, and it's the same whichever chat app they write from; chat history is not. Save with rememberAboutUser when they tell you their name, where they are (save it as an IANA timezone such as America/Chicago), or something they'd clearly want kept for next time: a standing preference, a recurring context, how they like replies. Write it as one short plain line and tell them what you saved. Don't save passing details, chat history, other people's private details, or anything secret. When they ask you to forget something, use forgetAboutUser and confirm.
`.trim();
