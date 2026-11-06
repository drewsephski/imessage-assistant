import { z } from "zod";

// Strings avoid floating-point money and JSON rounding. $1 = 1,000,000 microUSD.
const money = z
  .string()
  .regex(/^(0|[1-9]\d{0,14})$/)
  .transform(BigInt);
export const spendingPolicySchema = z.strictObject({
  version: z.string().regex(/^[a-zA-Z0-9._-]{1,64}$/),
  userMonthlyMicrousd: money,
  serviceMonthlyMicrousd: money,
  globalMonthlyMicrousd: money,
  maxTaskMicrousd: money,
  maxConcurrentUserTasks: z.number().int().min(1).max(100),
  maxConcurrentGlobalTasks: z.number().int().min(1).max(10000),
  maxModelOutputTokens: z.number().int().min(1).max(32000),
  computerLeaseSeconds: z.number().int().min(60).max(1800),
  // An absent operation is denied. These are conservative allowances, not guessed invoices.
  ceilings: z.record(
    z.string().regex(/^(model|web|computer|messaging|storage|integration):[a-zA-Z0-9._:-]+$/),
    money,
  ),
});
export type SpendingPolicy = z.infer<typeof spendingPolicySchema>;

export class SpendingDenied extends Error {
  override name = "SpendingDenied";
  constructor(
    public readonly reason:
      | "unconfigured"
      | "unpriced"
      | "paused"
      | "limit"
      | "busy"
      | "stale"
      | "duplicate",
  ) {
    super(`Spending admission denied: ${reason}`);
  }
}

export const readSpendingPolicy = (): SpendingPolicy => {
  try {
    if (!process.env.ASSISTANT_SPENDING_POLICY) throw new Error("Missing policy");
    return spendingPolicySchema.parse(JSON.parse(process.env.ASSISTANT_SPENDING_POLICY));
  } catch {
    // Never expose the environment value or a validation error containing config data.
    throw new SpendingDenied("unconfigured");
  }
};

export const operationCeiling = (policy: SpendingPolicy, operation: string) => {
  const amount = policy.ceilings[operation];
  if (amount === undefined || (amount === 0n && /^(model|web|computer|integration):/.test(operation))) {
    throw new SpendingDenied("unpriced");
  }
  return amount;
};

export const utcMonth = (date: Date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
