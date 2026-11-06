import { spendingPolicySchema } from "../../src/spending/policy.js";

// Synthetic test amounts, deliberately unrelated to provider prices or production allowances.
export const testPolicy = (overrides: Record<string, unknown> = {}) =>
  spendingPolicySchema.parse({
    version: "test-v1",
    userMonthlyMicrousd: "10000",
    serviceMonthlyMicrousd: "10000",
    globalMonthlyMicrousd: "100000",
    maxTaskMicrousd: "10000",
    maxConcurrentUserTasks: 100,
    maxConcurrentGlobalTasks: 1000,
    maxModelOutputTokens: 100,
    computerLeaseSeconds: 300,
    ceilings: {
      "model:mock-model-id": "30",
      "web:searchWeb": "30",
      "computer:lease": "30",
      "messaging:linq:sendMessage": "2",
      "storage:linq:download": "2",
    },
    ...overrides,
  });
