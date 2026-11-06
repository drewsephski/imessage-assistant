import { AsyncLocalStorage } from "node:async_hooks";
import type { TaskExecution } from "../db/tasks.js";

type SpendingContext =
  | { kind: "task"; execution: TaskExecution; signal: AbortSignal }
  | { kind: "service" };
const context = new AsyncLocalStorage<SpendingContext>();
export const currentSpendingContext = () => context.getStore();
export const withTaskSpending = <T>(
  execution: TaskExecution,
  signal: AbortSignal,
  work: () => T,
): T => context.run({ kind: "task", execution, signal }, work);
export const withServiceSpending = <T>(work: () => T): T => context.run({ kind: "service" }, work);
