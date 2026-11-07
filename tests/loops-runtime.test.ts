import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { streamText, type UIMessage } from "ai";
import { fixedTextModel } from "../src/trigger/fixed-text-model.js";
import { classifyLoopMessage, openLoopsEnabled } from "../src/trigger/loop-tools.js";
import { purgeOpenLoopRows } from "../src/trigger/purge-open-loops.js";

const HANDLE = "L0123456789AB";
const user = (...parts: UIMessage["parts"]): UIMessage => ({ id: "m1", role: "user", parts });
const text = (value: string) => ({ type: "text" as const, text: value });
const file = {
  type: "file" as const,
  url: "https://telegram.invalid/files/f1",
  mediaType: "image/png",
};
const note = text('[Attached file "photo.png" (image/png, 1.0 KB), attachment id: f1]');

const original = process.env.OPEN_LOOPS_ENABLED;
afterEach(() => {
  if (original === undefined) delete process.env.OPEN_LOOPS_ENABLED;
  else process.env.OPEN_LOOPS_ENABLED = original;
});

test("the feature flag is on only for the exact value true", () => {
  for (const value of [undefined, "", "1", "TRUE", "yes", " true"]) {
    if (value === undefined) delete process.env.OPEN_LOOPS_ENABLED;
    else process.env.OPEN_LOOPS_ENABLED = value;
    assert.equal(openLoopsEnabled(), false, String(value));
  }
  process.env.OPEN_LOOPS_ENABLED = "true";
  assert.equal(openLoopsEnabled(), true);
});

test("a standalone text message classifies as a command or capture", () => {
  assert.deepEqual(classifyLoopMessage(user(text("/loops"))), {
    kind: "command",
    command: { kind: "list" },
  });
  assert.deepEqual(classifyLoopMessage(user(text("/loops 3"))), {
    kind: "command",
    command: { kind: "list", page: 3 },
  });
  assert.deepEqual(classifyLoopMessage(user(text(`/done ${HANDLE.toLowerCase()}`))), {
    kind: "command",
    command: { kind: "mutate", action: "done", handle: HANDLE },
  });
  assert.deepEqual(classifyLoopMessage(user(text("/track Ask Dana"))), {
    kind: "capture",
    capture: "Ask Dana",
  });
  assert.deepEqual(classifyLoopMessage(user(text("track this: Ask Dana"))), {
    kind: "capture",
    capture: "Ask Dana",
  });
});

test("ordinary chat stays ordinary, including quoted and embedded commands", () => {
  for (const value of [
    "hello",
    `> /done ${HANDLE}`,
    `please /done ${HANDLE}`,
    `/done ${HANDLE} now`,
    `/done ${HANDLE}\n/forget ${HANDLE}`,
    "/track",
    "track this:",
    "keep tracking this: please",
  ]) {
    assert.equal(classifyLoopMessage(user(text(value))), null, value);
  }
  assert.equal(classifyLoopMessage(undefined), null);
  assert.equal(classifyLoopMessage(user()), null);
  assert.equal(classifyLoopMessage(user(note)), null, "a filename note is not a caption");
  assert.equal(classifyLoopMessage(user(note, file)), null);
  assert.equal(classifyLoopMessage(user(note, file, text("what is this?"))), null);
});

test("a command or capture beside a file is rejected rather than run", () => {
  for (const parts of [
    [note, file, text(`/forget ${HANDLE}`)],
    [note, text(`/forget ${HANDLE}`)],
    [note, file, text("/track this photo")],
    [text("/loops"), text("/loops")],
  ]) {
    const plan = classifyLoopMessage(user(...parts));
    assert.equal(plan?.kind, "rejected");
    assert.ok(plan?.kind === "rejected" && plan.reply.includes("Nothing was saved or changed"));
  }
});

test("an oversize capture is rejected with the safe limit message, not treated as chat", () => {
  const plan = classifyLoopMessage(user(text(`/track ${"x".repeat(4001)}`)));
  assert.deepEqual(plan, {
    kind: "rejected",
    reply: "That is too long to track. Keep it under 4000 characters.",
  });
  assert.equal(classifyLoopMessage(user(text(`/track ${"x".repeat(4000)}`)))?.kind, "capture");
});

test("the fixed model runs through streamText with a normal stop and zero tokens", async () => {
  const steps: unknown[] = [];
  const result = streamText({
    model: fixedTextModel("Fixed reply"),
    messages: [{ role: "user", content: "ignored" }],
    onStepFinish: (step) => {
      steps.push(step);
    },
  });
  assert.equal(await result.text, "Fixed reply");
  assert.equal(await result.finishReason, "stop");
  const usage = await result.totalUsage;
  assert.equal(usage.inputTokens, 0);
  assert.equal(usage.outputTokens, 0);
  assert.equal(steps.length, 1);
});

test("the retention schedule is a no-op unless the feature is on", async () => {
  let purges = 0;
  const store = {
    purgeExpired: async () => {
      purges++;
      return 3;
    },
  };
  delete process.env.OPEN_LOOPS_ENABLED;
  assert.deepEqual(await purgeOpenLoopRows(store), { enabled: false, deleted: 0 });
  process.env.OPEN_LOOPS_ENABLED = "false";
  assert.deepEqual(await purgeOpenLoopRows(store), { enabled: false, deleted: 0 });
  assert.equal(purges, 0);
  process.env.OPEN_LOOPS_ENABLED = "true";
  assert.deepEqual(await purgeOpenLoopRows(store), { enabled: true, deleted: 3 });
  assert.equal(purges, 1);
});
