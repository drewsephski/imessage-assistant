import assert from "node:assert/strict";
import { test } from "node:test";
import type { FinishReason, LanguageModelUsage } from "ai";
import { taskOutcome, usageSnapshot } from "../src/tasks/outcome.js";

test("only normal model completion counts as completed", () => {
  assert.equal(taskOutcome({ stopped: false, finishReason: "stop" }).status, "completed");
  const interruptions: [FinishReason | undefined, string][] = [
    ["tool-calls", "step_limit"],
    ["length", "output_limit"],
    ["content-filter", "content_filter"],
    ["other", "unknown_finish"],
    ["interrupted", "unknown_finish"],
    [undefined, "unknown_finish"],
  ];
  for (const [finishReason, reason] of interruptions) {
    const outcome = taskOutcome({ stopped: false, finishReason });
    assert.equal(outcome.status, "interrupted");
    assert.equal(outcome.interruptionReason, reason);
  }
});

test("errors and stops cannot appear as success", () => {
  assert.equal(
    taskOutcome({ stopped: false, error: new Error("provider failed"), finishReason: "stop" })
      .status,
    "failed",
  );
  assert.equal(taskOutcome({ stopped: false, finishReason: "error" }).status, "failed");
  assert.equal(taskOutcome({ stopped: true, finishReason: "stop" }).interruptionReason, "stopped");
});

export const knownUsage = (inputTokens = 10): LanguageModelUsage => ({
  inputTokens,
  inputTokenDetails: { noCacheTokens: inputTokens, cacheReadTokens: 0, cacheWriteTokens: 0 },
  outputTokens: 5,
  outputTokenDetails: { textTokens: 5, reasoningTokens: 0 },
  totalTokens: inputTokens + 5,
});

test("usage snapshots sum known steps without inventing missing usage", () => {
  assert.deepEqual(usageSnapshot([]), {
    stepCount: 0,
    toolCallCount: 0,
    inputTokens: null,
    cachedInputTokens: null,
    outputTokens: null,
  });
  assert.deepEqual(
    usageSnapshot([
      { usage: knownUsage(10), toolCalls: [{}] },
      { usage: knownUsage(20), toolCalls: [{}, {}] },
    ]),
    { stepCount: 2, toolCallCount: 3, inputTokens: 30, cachedInputTokens: 0, outputTokens: 10 },
  );
  const unknown = { ...knownUsage(), inputTokens: undefined, outputTokens: undefined };
  const snapshot = usageSnapshot([
    { usage: knownUsage(), toolCalls: [] },
    { usage: unknown, toolCalls: [] },
  ]);
  assert.equal(snapshot.inputTokens, null);
  assert.equal(snapshot.outputTokens, null);
  assert.equal(usageSnapshot([{ usage: knownUsage(-1), toolCalls: [] }]).inputTokens, null);
  assert.equal(
    usageSnapshot([
      { usage: knownUsage(Number.MAX_SAFE_INTEGER), toolCalls: [] },
      { usage: knownUsage(1), toolCalls: [] },
    ]).inputTokens,
    null,
  );
});
