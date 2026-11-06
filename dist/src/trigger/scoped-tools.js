import { currentSpendingContext, withTaskSpending } from "../spending/context.js";
import { SpendingDenied } from "../spending/policy.js";
import { currentTaskExecution } from "./task-tracking.js";
// SDK stop/completion can happen before an async tool returns. Keep the original
// execution and abort signal through all its awaits, even after another turn starts.
export const scopedTools = (tools) => Object.fromEntries(Object.entries(tools).map(([name, tool]) => {
    const execute = tool.execute;
    return [
        name,
        execute
            ? {
                ...tool,
                execute: (input, options) => {
                    const bound = currentSpendingContext();
                    const execution = bound?.kind === "task" ? bound.execution : currentTaskExecution();
                    const signal = bound?.kind === "task"
                        ? AbortSignal.any([
                            bound.signal,
                            ...(options.abortSignal ? [options.abortSignal] : []),
                        ])
                        : (options.abortSignal ?? new AbortController().signal);
                    if (!execution || signal.aborted)
                        throw new SpendingDenied("stale");
                    return withTaskSpending(execution, signal, () => execute(input, options));
                },
            }
            : tool,
    ];
}));
