import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { APICallError, simulateReadableStream, streamText } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import type { Reservation } from "../src/db/spending.js";
import { withModelSpending } from "../src/spending/model.js";
import { SpendingDenied } from "../src/spending/policy.js";
import type { SpendingRuntime } from "../src/spending/runtime.js";
import { testPolicy } from "./helpers/spending-policy.js";

const fixture = (allowCalls = 10) => {
  const reservations: Reservation[] = [];
  const uncertain: string[] = [];
  const runtime: SpendingRuntime = {
    policy: testPolicy,
    reserve: async (operation) => {
      if (reservations.length >= allowCalls) throw new SpendingDenied("limit");
      const record: Reservation = {
        id: randomUUID(),
        controlId: "user:test",
        taskId: null,
        attemptId: null,
        operationKey: randomUUID(),
        operation,
        policyVersion: "test-v1",
        category: "model",
        maximumMicrousd: 30n,
        actualMicrousd: null,
        status: "reserved",
        settlementReference: null,
        createdAt: new Date(),
        periodStart: new Date(),
        expiresAt: new Date(Date.now() + 1000),
        resourceKey: null,
        resourceExpiresAt: null,
        resourceStoppedAt: null,
        resourceStopAttemptedAt: null,
      };
      reservations.push(record);
      return record;
    },
    uncertain: async (reservation) => {
      uncertain.push(reservation.id);
    },
  };
  return { runtime, reservations, uncertain };
};
export const finishedStream = () => ({
  stream: simulateReadableStream({
    chunks: [
      { type: "text-start" as const, id: "text-1" },
      { type: "text-delta" as const, id: "text-1", delta: "done" },
      { type: "text-end" as const, id: "text-1" },
      {
        type: "finish" as const,
        finishReason: { unified: "stop" as const, raw: undefined },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 5, text: 5, reasoning: 0 },
        },
      },
    ],
  }),
});

test("denied model reservations make no provider call", async () => {
  const { runtime } = fixture(0);
  let calls = 0;
  const provider = new MockLanguageModelV3({
    doStream: async () => {
      calls++;
      return finishedStream();
    },
  });
  await assert.rejects(
    async () => withModelSpending(provider, runtime).doStream({ prompt: [] }),
    SpendingDenied,
  );
  assert.equal(calls, 0);
});

test("a streaming call retains its hold until consumption and never invents an invoice", async () => {
  const { runtime, reservations, uncertain } = fixture();
  let requestedOutput: number | undefined;
  const provider = new MockLanguageModelV3({
    doStream: async (options) => {
      requestedOutput = options.maxOutputTokens;
      return finishedStream();
    },
  });
  const result = await withModelSpending(provider, runtime).doStream({
    prompt: [],
    maxOutputTokens: 1000,
  });
  assert.equal(requestedOutput, 100);
  assert.equal(uncertain.length, 0);
  for await (const _part of result.stream) {
    /* drain the actual provider stream */
  }
  assert.equal(uncertain.length, 1);
  assert.equal(reservations[0]?.actualMicrousd, null);
});

test("SDK provider retries each need another reservation", async () => {
  const { runtime, reservations } = fixture();
  let calls = 0;
  const provider = new MockLanguageModelV3({
    doStream: async () => {
      calls++;
      if (calls === 1)
        throw new APICallError({
          message: "temporary outage",
          url: "https://provider.invalid",
          requestBodyValues: {},
          statusCode: 503,
          isRetryable: true,
        });
      return finishedStream();
    },
  });
  const result = streamText({
    model: withModelSpending(provider, runtime),
    prompt: "hello",
    maxRetries: 1,
  });
  assert.equal(await result.text, "done");
  assert.equal(calls, 2);
  assert.equal(reservations.length, 2);
  assert.notEqual(reservations[0]?.id, reservations[1]?.id);
});

test("a retry cannot call the provider when its second reservation is denied", async () => {
  const { runtime, reservations } = fixture(1);
  let calls = 0;
  const provider = new MockLanguageModelV3({
    doStream: async () => {
      calls++;
      throw new Error("provider failed");
    },
  });
  const model = withModelSpending(provider, runtime);
  await assert.rejects(async () => model.doStream({ prompt: [] }));
  await assert.rejects(async () => model.doStream({ prompt: [] }), SpendingDenied);
  assert.equal(calls, 1);
  assert.equal(reservations.length, 1);
});

test("cancelled or broken streams keep their original reservation", async () => {
  const { runtime, reservations } = fixture();
  const provider = new MockLanguageModelV3({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.error(new Error("connection lost"));
        },
      }),
    }),
  });
  const result = await withModelSpending(provider, runtime).doStream({ prompt: [] });
  await assert.rejects(result.stream.getReader().read());
  assert.equal(reservations.length, 1);
  assert.equal(reservations[0]?.maximumMicrousd, 30n);
  assert.equal(reservations[0]?.actualMicrousd, null);
});
