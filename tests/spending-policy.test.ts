import assert from "node:assert/strict";
import { test } from "node:test";
import {
  operationCeiling,
  readSpendingPolicy,
  spendingPolicySchema,
  SpendingDenied,
  utcMonth,
} from "../src/spending/policy.js";
import { testPolicy } from "./helpers/spending-policy.js";

test("money accepts exact integer strings and rejects floats, negatives and unsafe amounts", () => {
  assert.equal(
    testPolicy({ userMonthlyMicrousd: "900719925474099" }).userMonthlyMicrousd,
    900719925474099n,
  );
  for (const value of [10, -1, "-1", "0.1", "1e6", "01", "9999999999999999"]) {
    assert.throws(() => testPolicy({ userMonthlyMicrousd: value }));
  }
});

test("unconfigured or absent operation ceilings deny admission", () => {
  assert.throws(() => operationCeiling(testPolicy(), "web:unknown"), SpendingDenied);
  assert.throws(
    () =>
      operationCeiling(
        testPolicy({ ceilings: { "model:mock-model-id": "0" } }),
        "model:mock-model-id",
      ),
    SpendingDenied,
  );
  assert.equal(
    operationCeiling(
      testPolicy({ ceilings: { "messaging:telegram:sendMessage": "0" } }),
      "messaging:telegram:sendMessage",
    ),
    0n,
  );
  const previous = process.env.ASSISTANT_SPENDING_POLICY;
  try {
    delete process.env.ASSISTANT_SPENDING_POLICY;
    assert.throws(readSpendingPolicy, SpendingDenied);
    process.env.ASSISTANT_SPENDING_POLICY = "private malformed config";
    assert.throws(
      readSpendingPolicy,
      (error) => error instanceof SpendingDenied && !error.message.includes("private"),
    );
  } finally {
    if (previous === undefined) delete process.env.ASSISTANT_SPENDING_POLICY;
    else process.env.ASSISTANT_SPENDING_POLICY = previous;
  }
});

test("calendar month boundaries use UTC and configuration is strict", () => {
  assert.equal(
    utcMonth(new Date("2026-11-01T00:00:00Z")).toISOString(),
    "2026-11-01T00:00:00.000Z",
  );
  assert.equal(
    utcMonth(new Date("2026-11-01T00:00:00+02:00")).toISOString(),
    "2026-10-01T00:00:00.000Z",
  );
  assert.equal(spendingPolicySchema.safeParse({ unexpected: true }).success, false);
});
