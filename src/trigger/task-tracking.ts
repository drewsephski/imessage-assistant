import * as Sentry from "@sentry/node";
import { locals } from "@trigger.dev/sdk";
import { chat, type TurnCompleteEvent, type TurnStartEvent } from "@trigger.dev/sdk/ai";
import type { LanguageModelUsage } from "ai";
import { db } from "../db/index.js";
import type { DeliveryStatus, Platform } from "../db/schema.js";
import { createTaskStore, type TaskExecution, type TaskStore } from "../db/tasks.js";
import { taskOutcome, usageSnapshot } from "../tasks/outcome.js";
import { log } from "./log.js";
import { currentSpendingContext } from "../spending/context.js";

const store = createTaskStore(db);
type Step = { usage: LanguageModelUsage; toolCalls: readonly unknown[] };
type ActiveTask = {
  execution: TaskExecution;
  steps: Step[];
  modelError: boolean;
  deliveryUncertain: boolean;
};
const activeTaskKey = locals.create<ActiveTask | undefined>("assistant.activeTask");

export const currentTaskExecution = () => locals.get(activeTaskKey)?.execution;

const callbackTask = () => {
  const active = locals.get(activeTaskKey);
  const context = currentSpendingContext();
  if (context?.kind === "task" && context.execution.attemptId !== active?.execution.attemptId) return undefined;
  return active;
};

const reportTrackingError = (error: unknown) => {
  Sentry.captureException(error);
  log.error("Task tracking update failed");
};

// The store argument also lets lifecycle tests use an isolated database.
export const taskTracking = (platform: Platform, taskStore: TaskStore = store) => ({
  onTurnStart: async ({ ctx, chatId, uiMessages, runId, previousRunId }: TurnStartEvent) => {
    // Locals belong to the current Trigger.dev execution, never to a shared worker process.
    locals.set(activeTaskKey, undefined);
    const surface = chat.surface();
    const clerkUserId = surface?.clerkUserId;
    const messageId = uiMessages.findLast((message) => message.role === "user")?.id;
    if (typeof clerkUserId !== "string" || !clerkUserId || !messageId) {
      throw new Error("An authenticated task identity is required");
    }
    const execution = await taskStore.start({
      clerkUserId,
      platform,
      chatId,
      messageId,
      runId,
      runAttempt: ctx.attempt.number,
      ...(previousRunId ? { previousRunId } : {}),
    });
    if (!execution) throw new Error("This request has already been handled by another attempt");
    locals.set(activeTaskKey, {
      execution,
      steps: [],
      modelError: false,
      deliveryUncertain: false,
    });
    log.info("Assistant task started", {
      "assistant.task_id": execution.taskId,
      "assistant.attempt_id": execution.attemptId,
    });
  },

  onStepFinish: async (step: Step) => {
    const active = callbackTask();
    if (!active) {
      if (currentSpendingContext()?.kind === "task") return;
      throw new Error("No active task for model usage");
    }
    // Persist cumulative snapshots. Repeated or delayed writes cannot lower the recorded counts.
    active.steps.push(step);
    await taskStore.recordUsage(active.execution, usageSnapshot(active.steps));
  },

  onModelError: () => {
    const active = callbackTask();
    if (active) active.modelError = true;
  },

  onTurnComplete: async (event: TurnCompleteEvent) => {
    const active = locals.get(activeTaskKey);
    // In particular, do not let a rejected duplicate start finish the original task.
    if (!active) return;
    try {
      // A provider stream error can reach onError without an error/finishReason on this
      // event. A later normal finish, if the provider recovered, takes precedence.
      const outcome = taskOutcome({
        ...event,
        error:
          event.error ?? (active.modelError && event.finishReason !== "stop" ? true : undefined),
      });
      if (
        outcome.status === "completed" &&
        !active.deliveryUncertain &&
        !event.responseMessage?.parts.some((part) => part.type === "text" && part.text.trim())
      ) {
        // Only fill in an otherwise pending delivery: files and model errors may have no text.
        // A successful send or suppression recorded by the connector takes precedence.
        await taskStore.recordDelivery(active.execution, "not_applicable");
      }
      await taskStore.finish(active.execution, outcome);
      log.info("Assistant task finished", {
        "assistant.task_id": active.execution.taskId,
        "assistant.task_status": outcome.status,
      });
    } catch (error) {
      reportTrackingError(error);
      // Egress already happened. Throwing here makes the SDK send a second, misleading
      // error reply. Leave the unresolved record for deadline reconciliation instead.
    } finally {
      locals.set(activeTaskKey, undefined);
    }
  },
});

// Delivery is a separate outcome from model completion. Accounting failures after a send
// must not make the runtime retry that send and duplicate a message that already left the app.
export const recordTaskDelivery = async (
  deliveryStatus: DeliveryStatus,
  taskStore: TaskStore = store,
) => {
  const active = locals.get(activeTaskKey);
  if (!active) return;
  try {
    await taskStore.recordDelivery(active.execution, deliveryStatus);
  } catch (error) {
    active.deliveryUncertain = true;
    reportTrackingError(error);
  }
};

export const deliverTaskReply = async <T>(
  send: () => Promise<T>,
  taskStore: TaskStore = store,
): Promise<T> => {
  let result: T;
  try {
    result = await send();
  } catch (error) {
    await recordTaskDelivery("failed", taskStore);
    throw error;
  }
  await recordTaskDelivery("accepted", taskStore);
  return result;
};
