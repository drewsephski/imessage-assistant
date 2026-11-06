import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, beforeEach, test } from "node:test";
import { eq } from "drizzle-orm";
import { chat } from "@trigger.dev/sdk/ai";
import { mockChatAgent, recordingChannelConnector } from "@trigger.dev/sdk/ai/test";
import { simulateReadableStream, stepCountIs, tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";
import { assistantTasks, spendingControls, spendingReservations } from "../../src/db/schema.js";
import { createSpendingStore, userControlId } from "../../src/db/spending.js";
import type { StartTask, TaskExecution } from "../../src/db/tasks.js";
import { SpendingDenied, utcMonth } from "../../src/spending/policy.js";
import { stopExpiredComputers, withReservedComputerStartup } from "../../src/spending/computers.js";
import { taskOutcome } from "../../src/tasks/outcome.js";
import { testPolicy } from "../helpers/spending-policy.js";
import { testDatabase } from "./fixture.js";
import { scopedTools } from "../../src/trigger/scoped-tools.js";
import { withServiceSpending } from "../../src/spending/context.js";
import { withModelSpending } from "../../src/spending/model.js";
import {
  createSpendingRuntime,
  resetSpendingNotice,
  spendingNotice,
  withAllowanceNotice,
  reserveComputerLease,
  withComputerStartup,
} from "../../src/spending/runtime.js";
import {
  currentTaskExecution,
  deliverTaskReply,
  taskTracking,
} from "../../src/trigger/task-tracking.js";

const { pool, db, store: tasks } = testDatabase();
type ProviderStreamPart =
  Awaited<ReturnType<MockLanguageModelV3["doStream"]>>["stream"] extends ReadableStream<infer Part>
    ? Part
    : never;
const spending = createSpendingStore(db);
after(() => pool.end());
beforeEach(async () => {
  // Only this suite uses spending tables; fixture.ts enforces a local throwaway database.
  await db.delete(spendingReservations);
  await db.delete(spendingControls);
});
const input = (user = `user-${randomUUID()}`): StartTask => ({
  clerkUserId: user,
  platform: "telegram",
  chatId: randomUUID(),
  messageId: randomUUID(),
  runId: randomUUID(),
  runAttempt: 1,
});
const task = async (request = input()) => {
  const execution = await tasks.start(request);
  assert.ok(execution);
  return execution;
};
const operation = (execution?: TaskExecution) => ({
  execution,
  operation: "web:searchWeb",
  operationKey: randomUUID(),
});

test("simultaneous work on both channels shares one atomic user allowance", async () => {
  const user = `user-${randomUUID()}`;
  const first = await task(input(user));
  const second = await task({ ...input(user), platform: "linq" });
  const policy = testPolicy({ userMonthlyMicrousd: "100" });
  const results = await Promise.allSettled(
    Array.from({ length: 10 }, (_, index) =>
      spending.reserve(operation(index % 2 ? first : second), policy),
    ),
  );
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 3);
  assert.equal(await spending.totalExposure(new Date(), userControlId(user)), 90n);
  assert.equal(await spending.totalExposure(new Date()), 90n);
});

test("global allowance serializes callers from different accounts", async () => {
  const executions = await Promise.all(Array.from({ length: 8 }, () => task()));
  const policy = testPolicy({ globalMonthlyMicrousd: "100" });
  const results = await Promise.allSettled(
    executions.map((execution) => spending.reserve(operation(execution), policy)),
  );
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 3);
  assert.equal(await spending.totalExposure(new Date()), 90n);
});

test("task limits include actual repeated work from retries", async () => {
  const request = input();
  const first = await task(request);
  const policy = testPolicy({ maxTaskMicrousd: "60" });
  await spending.reserve(operation(first), policy);
  const next = await task({ ...request, runAttempt: 2 });
  await spending.reserve(operation(next), policy);
  await assert.rejects(spending.reserve(operation(next), policy), SpendingDenied);
  assert.equal(await spending.taskExposure(first.taskId), 60n);
  await assert.rejects(
    spending.reserve(operation(first), policy),
    (error) => error instanceof SpendingDenied && error.reason === "stale",
  );
});

test("wrong owners, missing prices and forged resource ownership cannot reserve", async () => {
  const execution = await task();
  const policy = testPolicy();
  await assert.rejects(
    spending.reserve(operation({ ...execution, clerkUserId: "another-user" }), policy),
    SpendingDenied,
  );
  await assert.rejects(
    spending.reserve({ ...operation(execution), operation: "web:unknown" }, policy),
    SpendingDenied,
  );
  await assert.rejects(
    spending.reserve(
      {
        ...operation(execution),
        operation: "computer:lease",
        resourceKey: "someone-elses-computer",
      },
      policy,
    ),
    SpendingDenied,
  );
  assert.equal(await spending.totalExposure(new Date()), 0n);
});

test("operation replay cannot authorize a second external request", async () => {
  const execution = await task();
  const request = operation(execution);
  await spending.reserve(request, testPolicy());
  await assert.rejects(
    spending.reserve(request, testPolicy()),
    (error) => error instanceof SpendingDenied && error.reason === "duplicate",
  );
  assert.equal(await spending.taskExposure(execution.taskId), 30n);
});

test("uncertain and abandoned reservations survive expiration and month reset", async () => {
  const execution = await task();
  const reservation = await spending.reserve(operation(execution), testPolicy());
  const previousMonth = new Date(utcMonth(new Date()).getTime() - 24 * 3600_000);
  await db
    .update(spendingReservations)
    .set({ periodStart: utcMonth(previousMonth), expiresAt: new Date(0) })
    .where(eq(spendingReservations.id, reservation.id));
  await spending.retainExpired();
  assert.equal(await spending.totalExposure(new Date()), 30n);
  const [retained] = await db
    .select()
    .from(spendingReservations)
    .where(eq(spendingReservations.id, reservation.id));
  assert.equal(retained?.status, "uncertain");
  await spending.settle(reservation.controlId, reservation.id, 20n, "provider-receipt-1");
  assert.equal(await spending.totalExposure(new Date()), 0n);
});

test("settlement is owner-scoped, idempotent, and cannot erase spending through task deletion", async () => {
  const execution = await task();
  const reservation = await spending.reserve(operation(execution), testPolicy());
  await assert.rejects(spending.settle("user:wrong", reservation.id, 1n, "receipt"));
  await spending.settle(reservation.controlId, reservation.id, 20n, "receipt");
  await spending.settle(reservation.controlId, reservation.id, 20n, "receipt");
  await assert.rejects(spending.settle(reservation.controlId, reservation.id, 10n, "receipt"));
  assert.equal(await spending.totalExposure(new Date()), 20n);
  await assert.rejects(db.delete(assistantTasks).where(eq(assistantTasks.id, execution.taskId)));
  assert.equal(await spending.totalExposure(new Date()), 20n);
});

test("a confirmed cost above its ceiling is retained and pauses further spending", async () => {
  const execution = await task();
  const reservation = await spending.reserve(operation(execution), testPolicy());
  await spending.settle(reservation.controlId, reservation.id, 60n, "overrun-receipt");
  assert.equal(await spending.totalExposure(new Date()), 60n);
  await assert.rejects(
    spending.reserve(operation(execution), testPolicy()),
    (error) => error instanceof SpendingDenied && error.reason === "paused",
  );
});

test("concurrency slots span channels and release after a task finishes", async () => {
  const user = `user-${randomUUID()}`;
  const first = await task(input(user));
  const second = await task({ ...input(user), platform: "linq" });
  const policy = testPolicy({ maxConcurrentUserTasks: 1, maxConcurrentGlobalTasks: 2 });
  await spending.reserve(operation(first), policy);
  await assert.rejects(
    spending.reserve(operation(second), policy),
    (error) => error instanceof SpendingDenied && error.reason === "busy",
  );
  const other = await task();
  await spending.reserve(operation(other), policy);
  await assert.rejects(spending.reserve(operation(await task()), policy), SpendingDenied);
  await tasks.finish(first, taskOutcome({ stopped: false, finishReason: "stop" }));
  await spending.reserve(operation(second), policy);
  assert.equal(await spending.totalExposure(new Date(), userControlId(user)), 60n);
});

test("service notifications use a separate bounded account and the global allowance", async () => {
  const policy = testPolicy({ serviceMonthlyMicrousd: "2" });
  const reservation = await spending.reserve(
    { operation: "messaging:linq:sendMessage", operationKey: randomUUID() },
    policy,
  );
  assert.equal(reservation.controlId, "service");
  assert.equal(reservation.attemptId, null);
  await assert.rejects(
    spending.reserve(
      { operation: "messaging:linq:sendMessage", operationKey: randomUUID() },
      policy,
    ),
    SpendingDenied,
  );
  await assert.rejects(spending.reserve(operation(), policy), SpendingDenied);
});

test("computer leases are reused only by their current attempt and keep holds until stopped", async () => {
  const execution = await task();
  const request = {
    execution,
    operation: "computer:lease",
    operationKey: `computer:${execution.attemptId}`,
    resourceKey: `user-${execution.clerkUserId}`,
    reuseComputerLease: true,
  };
  const first = await spending.reserve(request, testPolicy());
  assert.equal((await spending.reserve(request, testPolicy())).id, first.id);
  assert.equal(await spending.computerLeaseUsable(execution, first.id), true);
  await assert.rejects(spending.settle(first.controlId, first.id, 0n, "not-stopped"));
  await spending.endComputerLeases(execution);
  assert.equal(await spending.computerLeaseUsable(execution, first.id), false);
  let stopped = 0;
  await stopExpiredComputers(db, async () => {
    stopped++;
  });
  assert.equal(stopped, 1);
  assert.equal(await spending.totalExposure(new Date()), 30n);
  await spending.settle(first.controlId, first.id, 10n, "stopped-receipt");
  assert.equal(await spending.totalExposure(new Date()), 10n);
});

test("a failed shutdown retains its hold but cannot starve other expired computers", async () => {
  const first = await task();
  const second = await task();
  for (const execution of [first, second]) {
    await spending.reserve(
      {
        execution,
        operation: "computer:lease",
        operationKey: randomUUID(),
        resourceKey: `user-${execution.clerkUserId}`,
      },
      testPolicy(),
    );
    await spending.endComputerLeases(execution);
  }
  let calls = 0;
  await assert.rejects(
    stopExpiredComputers(db, async () => {
      calls++;
      if (calls === 1) throw new Error("Provider stop failed");
    }),
  );
  assert.equal(calls, 2);
  assert.equal((await spending.resourcesToInspect()).length, 1);
  assert.equal(await spending.totalExposure(new Date()), 60n);
});

test("a resumed worker cannot restart a computer already stopped by cleanup", async () => {
  const execution = await task();
  const reservation = await spending.reserve(
    {
      execution,
      operation: "computer:lease",
      operationKey: randomUUID(),
      resourceKey: `user-${execution.clerkUserId}`,
    },
    testPolicy(),
  );
  await spending.endComputerLeases(execution);
  await stopExpiredComputers(db, async () => {});
  let starts = 0;
  await assert.rejects(
    withReservedComputerStartup(db, execution, reservation, async () => {
      starts++;
    }),
    SpendingDenied,
  );
  assert.equal(starts, 0);
  assert.equal(await spending.totalExposure(new Date()), 30n);
});

test("startup failure cannot roll back a precommitted computer hold", async () => {
  const execution = await task();
  const reservation = await spending.reserve(
    {
      execution,
      operation: "computer:lease",
      operationKey: randomUUID(),
      resourceKey: `user-${execution.clerkUserId}`,
    },
    testPolicy(),
  );
  await assert.rejects(
    withReservedComputerStartup(db, execution, reservation, async () => {
      throw new Error("Provider startup timed out");
    }),
  );
  assert.equal(await spending.totalExposure(new Date()), 30n);
  assert.equal(await spending.computerLeaseUsable(execution, reservation.id), true);
});

test("cleanup rotates beyond a full batch of repeatedly failing computers", async () => {
  await db.insert(spendingControls).values([
    { id: "global", monthlyMicrousd: 100000n },
    { id: "user:fairness", monthlyMicrousd: 100000n },
  ]);
  const values = Array.from({ length: 101 }, (_, index) => ({
    controlId: "user:fairness",
    operationKey: randomUUID(),
    operation: "computer:lease",
    category: "computer" as const,
    policyVersion: "test",
    maximumMicrousd: 1n,
    periodStart: utcMonth(new Date()),
    expiresAt: new Date(0),
    resourceKey: `user-fairness-${index}`,
    resourceExpiresAt: new Date(index),
  }));
  await db.insert(spendingReservations).values(values);
  const firstBatch = new Set<string>();
  await assert.rejects(
    stopExpiredComputers(db, async (key) => {
      firstBatch.add(key);
      throw new Error("Cannot stop");
    }),
  );
  assert.equal(firstBatch.size, 100);
  const next = await spending.resourcesToInspect();
  assert.ok(next[0]?.key && !firstBatch.has(next[0].key));
});

const spendingTurn = async (
  options: {
    userLimit?: string;
    deniedTool?: boolean;
    testComputerLatch?: boolean;
    unavailable?: boolean;
  } = {},
) => {
  const user = `user-${randomUUID()}`;
  const policy = testPolicy({ userMonthlyMicrousd: options.userLimit ?? "10000" });
  const runtime = createSpendingRuntime(
    options.unavailable
      ? {
          ...spending,
          reserve: async () => {
            throw new Error("Accounting unavailable");
          },
        }
      : spending,
    () => policy,
  );
  const tracking = taskTracking("telegram", tasks);
  let modelCalls = 0;
  let sends = 0;
  let computerStarts = 0;
  const computerDenials: string[] = [];
  const channel = recordingChannelConnector({
    ack: null,
    surface: () => ({ clerkUserId: user }),
    outbound: (reply) => ({ text: spendingNotice() ?? reply.text }),
  });
  const originalSend = channel.send;
  assert.ok(originalSend);
  channel.send = (message, ctx) => {
    const send = async (text: string, service: boolean) => {
      const reservation = await runtime.reserve("messaging:linq:sendMessage", { service });
      try {
        sends++;
        return await originalSend({ text }, ctx);
      } finally {
        await runtime.uncertain(reservation);
      }
    };
    return withAllowanceNotice(
      message.text,
      () =>
        deliverTaskReply(
          () =>
            send(message.text, spendingNotice() !== undefined && message.text === spendingNotice()),
          tasks,
        ),
      (notice) => send(notice, true),
    );
  };
  const provider = new MockLanguageModelV3({
    modelId: "mock-model-id",
    doStream: async () => {
      modelCalls++;
      return {
        stream: simulateReadableStream<ProviderStreamPart>({
          chunks:
            options.deniedTool || options.testComputerLatch
              ? [
                  { type: "tool-call", toolName: "blocked", toolCallId: "blocked-1", input: "{}" },
                  {
                    type: "finish",
                    finishReason: { unified: "tool-calls", raw: undefined },
                    usage: {
                      inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
                      outputTokens: { total: 5, text: 5, reasoning: 0 },
                    },
                  },
                ]
              : [
                  { type: "text-start", id: "answer" },
                  { type: "text-delta", id: "answer", delta: "Your completed result" },
                  { type: "text-end", id: "answer" },
                  {
                    type: "finish",
                    finishReason: { unified: "stop", raw: undefined },
                    usage: {
                      inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
                      outputTokens: { total: 5, text: 5, reasoning: 0 },
                    },
                  },
                ],
        }),
      };
    },
  });
  let complete: () => void = () => {};
  const completed = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const agent = chat.agent({
    id: `spending-test-${randomUUID()}`,
    channels: [channel],
    maxTurns: 1,
    onTurnStart: async (event) => {
      resetSpendingNotice();
      await tracking.onTurnStart(event);
    },
    onTurnComplete: async (event) => {
      try {
        await tracking.onTurnComplete(event);
      } finally {
        complete();
      }
    },
    tools: {
      blocked: tool({
        inputSchema: z.object({}),
        execute: async () => {
          if (!options.testComputerLatch) return runtime.reserve("web:unpriced");
          const execution = currentTaskExecution();
          if (!execution) throw new Error("No task");
          const resourceKey = `user-${execution.clerkUserId}`;
          const reservation = await spending.reserve(
            { execution, operation: "computer:lease", operationKey: randomUUID(), resourceKey },
            policy,
          );
          try {
            await runtime.reserve("web:unpriced");
          } catch {
            /* set terminal denial */
          }
          try {
            await reserveComputerLease(resourceKey);
          } catch (error) {
            if (error instanceof SpendingDenied) computerDenials.push(error.reason);
          }
          try {
            await withComputerStartup(resourceKey, reservation, async () => {
              computerStarts++;
            });
          } catch (error) {
            if (error instanceof SpendingDenied) computerDenials.push(error.reason);
          }
          return "denied";
        },
      }),
    },
    run: async ({ messages, tools, signal, streamText }) =>
      streamText({
        model: withModelSpending(provider, runtime),
        messages,
        tools,
        abortSignal: signal,
        maxRetries: 0,
        stopWhen: stepCountIs(3),
        onStepFinish: tracking.onStepFinish,
        onError: tracking.onModelError,
      }),
  });
  const harness = mockChatAgent(agent, { chatId: randomUUID() });
  try {
    await harness.sendChannelEvent({
      event: { text: "Do work", threadId: "thread" },
      deliveryId: randomUUID(),
    });
    await completed;
    const [record] = await tasks.list(user);
    return {
      modelCalls,
      sends,
      computerStarts,
      computerDenials,
      record,
      finalText: channel.finalText(),
    };
  } finally {
    await harness.close();
  }
};

test("runtime denial prevents provider calls and sends a bounded service notice", async () => {
  const result = await spendingTurn({ userLimit: "0" });
  assert.equal(result.modelCalls, 0);
  assert.equal(result.sends, 1);
  assert.match(result.finalText ?? "", /usage allowance/);
  assert.equal(result.record?.attempt.status, "failed");
  assert.equal(await spending.totalExposure(new Date()), 2n);
});

test("a denied tool terminates subsequent paid model work", async () => {
  const result = await spendingTurn({ deniedTool: true });
  assert.equal(result.modelCalls, 1);
  assert.equal(result.record?.attempt.status, "failed");
  assert.equal(result.sends, 1);
  assert.equal(await spending.totalExposure(new Date()), 32n);
});

test("computer admission and startup honor a prior denial in the same turn", async () => {
  const result = await spendingTurn({ testComputerLatch: true });
  assert.equal(result.modelCalls, 1);
  assert.equal(result.computerStarts, 0);
  assert.deepEqual(result.computerDenials, ["unpriced", "unpriced"]);
  assert.equal(await spending.totalExposure(new Date()), 62n);
});

test("final delivery exhaustion sends a separate notice without marking the result delivered", async () => {
  const result = await spendingTurn({ userLimit: "30" });
  assert.equal(result.modelCalls, 1);
  assert.equal(result.sends, 1);
  assert.match(result.finalText ?? "", /usage allowance/);
  assert.equal(result.record?.attempt.status, "completed");
  assert.equal(result.record?.attempt.deliveryStatus, "failed");
});

test("accounting outage fails closed without model or messaging requests", async () => {
  const result = await spendingTurn({ unavailable: true });
  assert.equal(result.modelCalls, 0);
  assert.equal(result.sends, 0);
  assert.equal(result.record?.attempt.status, "failed");
  assert.equal(await spending.totalExposure(new Date()), 0n);
});

test("missing task identity is not implicit permission to spend from service", async () => {
  const runtime = createSpendingRuntime(spending, testPolicy);
  await assert.rejects(
    runtime.reserve("messaging:linq:sendMessage"),
    (error) => error instanceof SpendingDenied && error.reason === "stale",
  );
  assert.equal(await spending.totalExposure(new Date()), 0n);
  await withServiceSpending(() => runtime.reserve("messaging:linq:sendMessage"));
  assert.equal(await spending.totalExposure(new Date()), 2n);
});

test("a tool resuming after stop cannot charge a new task or the service account", async () => {
  const user = `user-${randomUUID()}`;
  const runtime = createSpendingRuntime(spending, testPolicy);
  const tracking = taskTracking("telegram", tasks);
  const channel = recordingChannelConnector({
    ack: null,
    surface: () => ({ clerkUserId: user }),
    outbound: () => null,
  });
  let enter: () => void = () => {};
  let release: () => void = () => {};
  let finishTool: () => void = () => {};
  let finishTurn: () => void = () => {};
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const toolDone = new Promise<void>((resolve) => {
    finishTool = resolve;
  });
  const turnDone = new Promise<void>((resolve) => {
    finishTurn = resolve;
  });
  let lateDenied = false;
  const provider = new MockLanguageModelV3({
    modelId: "mock-model-id",
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "tool-call", toolName: "late", toolCallId: "late-1", input: "{}" },
          {
            type: "finish",
            finishReason: { unified: "tool-calls", raw: undefined },
            usage: {
              inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 1, text: 1, reasoning: 0 },
            },
          },
        ],
      }),
    }),
  });
  const agent = chat.agent({
    id: `late-spending-${randomUUID()}`,
    channels: [channel],
    maxTurns: 1,
    onTurnStart: async (event) => {
      resetSpendingNotice();
      await tracking.onTurnStart(event);
    },
    onTurnComplete: async (event) => {
      await tracking.onTurnComplete(event);
      finishTurn();
    },
    tools: scopedTools({
      late: tool({
        inputSchema: z.object({}),
        execute: async () => {
          enter();
          await released;
          try {
            await runtime.reserve("messaging:linq:sendMessage");
          } catch (error) {
            lateDenied = error instanceof SpendingDenied && error.reason === "stale";
          } finally {
            finishTool();
          }
          return "done";
        },
      }),
    }),
    run: async ({ messages, tools, signal, streamText }) =>
      streamText({
        model: withModelSpending(provider, runtime),
        messages,
        tools,
        abortSignal: signal,
        maxRetries: 0,
      }),
  });
  const harness = mockChatAgent(agent, { chatId: randomUUID() });
  try {
    const turn = harness.sendChannelEvent({
      event: { text: "Start", threadId: "thread" },
      deliveryId: randomUUID(),
    });
    await entered;
    await harness.sendStop();
    await turnDone;
    release();
    await toolDone;
    await turn;
    assert.equal(lateDenied, true);
    assert.equal(await spending.totalExposure(new Date()), 30n);
    assert.equal(await spending.totalExposure(new Date(), "service"), 0n);
  } finally {
    release();
    await harness.close();
  }
});
