import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { chat } from "@trigger.dev/sdk/ai";
import { mockChatAgent, recordingChannelConnector } from "@trigger.dev/sdk/ai/test";
import { simulateReadableStream, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import type { Platform } from "../../src/db/schema.js";
import type { TaskStore } from "../../src/db/tasks.js";
import { deliverTaskReply, taskTracking } from "../../src/trigger/task-tracking.js";
import { testDatabase } from "./fixture.js";

const { pool, store } = testDatabase();
after(() => pool.end());

const model = (finish: "stop" | "length" = "stop") =>
  new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "text-start", id: "text-1" },
          { type: "text-delta", id: "text-1", delta: "Finished your document." },
          { type: "text-end", id: "text-1" },
          {
            type: "finish",
            finishReason: { unified: finish, raw: undefined },
            usage: {
              inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 5, text: 5, reasoning: 0 },
            },
          },
        ],
      }),
    }),
  });

const scenario = async (
  options: {
    platform?: Platform;
    failModel?: boolean;
    failDelivery?: boolean;
    failFinalAccounting?: boolean;
    failDeliveryAccounting?: boolean;
    failAfterStep?: boolean;
    stop?: boolean;
    turns?: number;
    finish?: "stop" | "length";
  } = {},
) => {
  const clerkUserId = `user-${randomUUID()}`;
  const chatId = randomUUID();
  const taskStore: TaskStore = {
    ...store,
    ...(options.failFinalAccounting
      ? {
          finish: async () => {
            throw new Error("Final accounting unavailable");
          },
        }
      : {}),
    ...(options.failDeliveryAccounting
      ? {
          recordDelivery: async () => {
            throw new Error("Delivery accounting unavailable");
          },
        }
      : {}),
  };
  const tracking = taskTracking(options.platform ?? "telegram", taskStore);
  let modelStarted: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    modelStarted = resolve;
  });
  let modelCalls = 0;
  const channel = recordingChannelConnector({ ack: null, surface: () => ({ clerkUserId }) });
  const originalSend = channel.send;
  assert.ok(originalSend);
  let sends = 0;
  channel.send = (message, ctx) =>
    deliverTaskReply(async () => {
      sends++;
      if (options.failDelivery) throw new Error("Messaging service unavailable");
      return originalSend(message, ctx);
    }, taskStore);
  let complete: () => void = () => {};
  const agent = chat.agent({
    id: `test-agent-${randomUUID()}`,
    channels: [channel],
    maxTurns: options.turns ?? 1,
    tools: { noop: tool({ inputSchema: z.object({}), execute: async () => "ok" }) },
    onTurnStart: tracking.onTurnStart,
    onTurnComplete: async (event) => {
      try {
        await tracking.onTurnComplete(event);
      } finally {
        complete();
      }
    },
    run: async ({ messages, streamText, signal, tools }) =>
      streamText({
        model: options.failModel
          ? new MockLanguageModelV4({
              doStream: async () => {
                throw new Error("Provider unavailable");
              },
            })
          : options.failAfterStep
            ? new MockLanguageModelV4({
                doStream: async () => {
                  modelCalls++;
                  if (modelCalls > 1) throw new Error("Provider failed after a paid step");
                  return {
                    stream: simulateReadableStream({
                      chunks: [
                        { type: "tool-call", toolCallId: "call-1", toolName: "noop", input: "{}" },
                        {
                          type: "finish",
                          finishReason: { unified: "tool-calls", raw: undefined },
                          usage: {
                            inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
                            outputTokens: { total: 5, text: 5, reasoning: 0 },
                          },
                        },
                      ],
                    }),
                  };
                },
              })
            : options.stop
              ? new MockLanguageModelV4({
                  doStream: async () => {
                    modelStarted();
                    return {
                      stream: simulateReadableStream({
                        chunkDelayInMs: 1000,
                        chunks: [
                          { type: "text-start", id: "text-1" },
                          { type: "text-delta", id: "text-1", delta: "Working..." },
                        ],
                      }),
                    };
                  },
                })
              : model(options.finish),
        messages,
        tools,
        abortSignal: signal,
        maxRetries: 0,
        stopWhen: ({ steps }) => steps.length >= 5,
        onStepFinish: tracking.onStepFinish,
        onError: tracking.onModelError,
      }),
  });
  const harness = mockChatAgent(agent, { chatId });
  try {
    for (let index = 0; index < (options.turns ?? 1); index++) {
      const completed = new Promise<void>((resolve) => {
        complete = resolve;
      });
      const turn = harness.sendChannelEvent({
        event: { text: "Make a document", threadId: "thread-1" },
        deliveryId: randomUUID(),
      });
      if (options.stop) {
        await started;
        await harness.sendStop();
      }
      await turn;
      await completed;
    }
    const tasks = await store.list(clerkUserId);
    assert.equal(tasks.length, options.turns ?? 1);
    return { record: tasks[0], records: tasks, sends, channel };
  } finally {
    await harness.close();
  }
};

test("real chat hooks record completed turns and usage on both platforms", async () => {
  for (const platform of ["telegram", "linq"] as const) {
    const result = await scenario({ platform });
    assert.equal(result.record?.task.platform, platform);
    assert.equal(result.record?.attempt.status, "completed");
    assert.equal(result.record?.attempt.deliveryStatus, "accepted");
    assert.equal(result.record?.attempt.inputTokens, 10);
    assert.equal(result.record?.attempt.outputTokens, 5);
    assert.equal(result.record?.attempt.stepCount, 1);
  }
});

test("two turns in one chat have separate task identities and usage", async () => {
  const { records, sends } = await scenario({ turns: 2 });
  assert.equal(sends, 2);
  assert.notEqual(records[0]?.task.id, records[1]?.task.id);
  assert.equal(records[0]?.task.chatId, records[1]?.task.chatId);
  for (const record of records) {
    assert.equal(record.attempt.status, "completed");
    assert.equal(record.attempt.inputTokens, 10);
    assert.equal(record.attempt.stepCount, 1);
  }
});

test("a provider stream failure is failed even when the SDK omits its finish reason", async () => {
  const { record } = await scenario({ failModel: true });
  assert.equal(record?.attempt.status, "failed");
  assert.equal(record?.attempt.finishReason, "error");
  assert.equal(record?.attempt.inputTokens, null);
  assert.equal(record?.attempt.deliveryStatus, "accepted");
});

test("truncated output is interrupted rather than completed", async () => {
  const { record } = await scenario({ finish: "length" });
  assert.equal(record?.attempt.status, "interrupted");
  assert.equal(record?.attempt.interruptionReason, "output_limit");
});

test("stopping a live turn records interruption", async () => {
  const { record } = await scenario({ stop: true });
  assert.equal(record?.attempt.status, "interrupted");
  assert.equal(record?.attempt.interruptionReason, "stopped");
});

test("a later provider failure retains earlier paid steps", async () => {
  const { record } = await scenario({ failAfterStep: true });
  assert.equal(record?.attempt.status, "failed");
  assert.equal(record?.attempt.inputTokens, 10);
  assert.equal(record?.attempt.outputTokens, 5);
  assert.equal(record?.attempt.stepCount, 1);
  assert.equal(record?.attempt.toolCallCount, 1);
});

test("a delivery outage does not change the model outcome", async () => {
  const { record } = await scenario({ failDelivery: true });
  assert.equal(record?.attempt.status, "completed");
  assert.equal(record?.attempt.deliveryStatus, "failed");
});

test("final accounting failure never sends a second misleading error message", async () => {
  const { record, sends } = await scenario({ failFinalAccounting: true });
  assert.equal(sends, 1);
  assert.equal(record?.attempt.status, "running");
  assert.equal(record?.attempt.deliveryStatus, "accepted");
});

test("delivery accounting failure keeps delivery unknown without retrying the send", async () => {
  const { record, sends } = await scenario({ failDeliveryAccounting: true });
  assert.equal(sends, 1);
  assert.equal(record?.attempt.status, "completed");
  assert.equal(record?.attempt.deliveryStatus, "pending");
});
