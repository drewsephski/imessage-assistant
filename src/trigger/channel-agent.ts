import * as Sentry from "@sentry/node";
import { chat, defaultStorage, type AnyChannelConnector } from "@trigger.dev/sdk/ai";
import { stepCountIs, type LanguageModel } from "ai";
import { log } from "./log.js";
import { chatModel } from "./model.js";
import { computerTools, computerToolsInstructions, type ComputerSurface } from "./computer-tools.js";
import { webTools, webToolsInstructions } from "./web-tools.js";
import type { LoopStore } from "../db/loops.js";
import type { Platform } from "../db/schema.js";
import { currentTaskExecution, taskTracking } from "./task-tracking.js";
import { scopedTools } from "./scoped-tools.js";
import { withTaskSpending } from "../spending/context.js";
import { endComputerLeases, resetSpendingNotice } from "../spending/runtime.js";
import { calendarTools, calendarToolsInstructions, calendarTurnStart } from "./calendar-tools.js";
import { fixedTextModel } from "./fixed-text-model.js";
import { db } from "../db/index.js";
import { createProfileStore, type ProfileStore } from "../db/profiles.js";
import { renderProfile } from "../memory/domain.js";
import { memoryTools, memoryToolsInstructions } from "./memory-tools.js";
import { reminderTools, reminderToolsInstructions } from "./reminder-tools.js";
import {
  clearLoopTurn,
  loopCaptureInstructions,
  loopCaptureText,
  loopCaptureTools,
  loopFixedReply,
  loopReply,
  loopToolsInstructions,
  loopTurnStart,
  openLoopsEnabled,
} from "./loop-tools.js";

const MODEL_ID = "claude-opus-5-5";

// What a channel's surface() hands the agent: the computer tools' surface, who the chat belongs
// to so errors, logs and AI spans can be attributed to the user, and which chat it is so a
// reminder set here can be sent back here
export type ChannelSurface = ComputerSurface & {
  clerkUserId: string;
  platform: Platform;
  chatId: string;
};

// The sandbox belongs to the Clerk user, so the same files are there whichever platform they
// write from
export const channelSurface = ({
  clerkUserId,
  ...surface
}: Omit<ComputerSurface, "sandboxName"> & {
  clerkUserId: string;
  platform: Platform;
  chatId: string;
}): ChannelSurface => ({
  sandboxName: `user-${clerkUserId}`,
  clerkUserId,
  ...surface,
});

const defaultProfiles = createProfileStore(db);

// The assistant on one chat platform: every channel gets the same model, tools and instructions,
// and only says which platform it is chatting over
export const channelAgent = <TId extends string>({
  id,
  channel,
  platform,
  platformName,
  model = chatModel,
  loopStore,
  profileStore = defaultProfiles,
}: {
  id: TId;
  channel: AnyChannelConnector;
  platform: Platform;
  // How the platform is named to the model, e.g. "Telegram" or "iMessage"
  platformName: string;
  // The provider model and the stores. Tests replace these to run offline
  model?: (modelId: string) => LanguageModel;
  loopStore?: LoopStore;
  profileStore?: ProfileStore;
}) => {
  const tracking = taskTracking(platform);
  return chat.agent({
    id,
    channels: [channel],
    // Turns that work on files run many tool calls, well past the project's 5 minute default
    maxDuration: 30 * 60,
    // The platform's transcript snapshot: a run that boots after the previous one ended
    // loads the conversation from it, so the agent remembers the chat without a database
    storage: defaultStorage,
    tools: scopedTools({
      ...webTools,
      ...computerTools,
      ...calendarTools,
      ...reminderTools(),
      ...memoryTools(profileStore),
    }),
    onTurnStart: async (event) => {
      resetSpendingNotice();
      // Cleared first: a rejected duplicate start must not leave the previous turn's reply behind
      clearLoopTurn();
      await tracking.onTurnStart(event);
      calendarTurnStart(event);
      loopTurnStart(event);
    },
    onTurnComplete: async (event) => {
      try { await endComputerLeases(); } catch (error) { Sentry.captureException(error); }
      await tracking.onTurnComplete(event);
    },
    run: async ({ messages, tools, signal, streamText, channel: surface }) => {
      const clerkUserId = (surface as Partial<ChannelSurface> | undefined)?.clerkUserId;
      // Opaque Clerk id only: shows up as the user on this turn's errors, logs and AI spans
      if (clerkUserId) Sentry.setUser({ id: clerkUserId });

      const execution = currentTaskExecution();
      if (!execution) throw new Error("An authenticated task is required");
      return withTaskSpending(execution, signal, async () => {
        const fixedReply = await loopFixedReply(loopStore);
        const capture = loopCaptureText();
        const attributes = {
          "gen_ai.agent.name": id,
          "gen_ai.request.model": fixedReply === undefined ? MODEL_ID : "fixed-text",
          "channel.platform": platformName,
        };
        const turnOptions = {
          // Names the agent on its gen_ai spans in Sentry. Content recording is decided by the
          // Sentry integration in init.ts, so the Trigger.dev run view still shows full turns
          experimental_telemetry: { isEnabled: true, functionId: id },
          abortSignal: signal,
          onStepFinish: tracking.onStepFinish,
          // One record per turn, so token use and cost per user stay complete even where traces
          // aren't kept. Hitting the step cap (finish reason "tool-calls" at 40 steps) means the
          // turn was cut short
          onFinish: ({ totalUsage, steps, finishReason }) => {
            log.info("Agent turn finished", {
              ...attributes,
              "gen_ai.response.finish_reasons": finishReason,
              "gen_ai.usage.input_tokens": totalUsage.inputTokens,
              "gen_ai.usage.input_tokens.cached": totalUsage.inputTokenDetails?.cacheReadTokens,
              "gen_ai.usage.output_tokens": totalUsage.outputTokens,
              "agent.steps": steps.length,
              "agent.tool_calls": steps.reduce((count, step) => count + step.toolCalls.length, 0),
            });
          },
          // A turn that errors mid-stream (model API failure, rate limit) doesn't fail the run: the
          // user just gets the channel's error message. Report it so it isn't silent
          onError: ({ error }) => {
            tracking.onModelError();
            Sentry.captureException(error, { tags: { "gen_ai.agent.name": id } });
            log.error("Agent turn failed", attributes);
          },
        } satisfies Partial<Parameters<typeof streamText>[0]>;

        // A deterministic turn uses no provider, tools or transcript: only its fixed text goes out
        if (fixedReply !== undefined) {
          return streamText({
            ...turnOptions,
            model: fixedTextModel(fixedReply),
            messages: [{ role: "user", content: "Send the fixed reply." }],
            tools: {},
            stopWhen: stepCountIs(1),
          });
        }

        // A capture sees only its own text, so it cannot mine the transcript or act on pasted
        // instructions with other tools. The closing step ends the turn normally without a second
        // provider call, and adapters send the application's reply whatever the model wrote.
        if (capture !== undefined) {
          return streamText({
            ...turnOptions,
            model: model(MODEL_ID),
            system: loopCaptureInstructions(new Date()),
            messages: [{ role: "user", content: capture }],
            tools: loopCaptureTools(loopStore),
            toolChoice: { type: "tool", toolName: "proposeOpenLoop" },
            stopWhen: stepCountIs(2),
            prepareStep: ({ stepNumber }) =>
              stepNumber === 0
                ? undefined
                : { model: fixedTextModel(loopReply() ?? ""), toolChoice: "none", activeTools: [] },
          });
        }

        // What the user has asked to be remembered, the same on every channel
        const now = new Date();
        const profile = await profileStore.get(execution.clerkUserId);
        return streamText({
          ...turnOptions,
          model: model(MODEL_ID),
          // Set per turn so relative requests like "tonight" or "this weekend" resolve correctly
          system: [
            `You are a helpful, concise personal assistant chatting over ${platformName}.`,
            `The current time is ${now.toUTCString()}.`,
            renderProfile(profile, now),
            memoryToolsInstructions,
            reminderToolsInstructions,
            webToolsInstructions,
            computerToolsInstructions,
            calendarToolsInstructions,
            ...(openLoopsEnabled() ? [loopToolsInstructions] : []),
          ].join("\n\n"),
          messages,
          tools,
          stopWhen: stepCountIs(40),
        });
      });
    },
  });
};
