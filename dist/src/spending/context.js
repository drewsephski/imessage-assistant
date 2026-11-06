import { AsyncLocalStorage } from "node:async_hooks";
const context = new AsyncLocalStorage();
export const currentSpendingContext = () => context.getStore();
export const withTaskSpending = (execution, signal, work) => context.run({ kind: "task", execution, signal }, work);
export const withServiceSpending = (work) => context.run({ kind: "service" }, work);
