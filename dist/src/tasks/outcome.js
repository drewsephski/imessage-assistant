export const taskOutcome = ({ stopped, finishReason, error, }) => {
    if (stopped)
        return {
            status: "interrupted",
            finishReason: finishReason ?? null,
            interruptionReason: "stopped",
        };
    if (error !== undefined || finishReason === "error") {
        return { status: "failed", finishReason: "error", interruptionReason: null };
    }
    if (finishReason === "stop")
        return { status: "completed", finishReason, interruptionReason: null };
    const reasons = {
        "tool-calls": "step_limit",
        length: "output_limit",
        "content-filter": "content_filter",
        other: "unknown_finish",
        interrupted: "unknown_finish",
    };
    return {
        status: "interrupted",
        finishReason: finishReason ?? null,
        interruptionReason: finishReason === undefined ? "unknown_finish" : reasons[finishReason],
    };
};
// A missing provider count is unknown, not a free call. Keep null if any step lacks a count.
const sumKnown = (values) => {
    if (values.length === 0)
        return null;
    let total = 0;
    for (const value of values) {
        if (value === undefined || !Number.isSafeInteger(value) || value < 0)
            return null;
        total += value;
    }
    return Number.isSafeInteger(total) ? total : null;
};
export const usageSnapshot = (steps) => ({
    stepCount: steps.length,
    toolCallCount: steps.reduce((count, step) => count + step.toolCalls.length, 0),
    inputTokens: sumKnown(steps.map((step) => step.usage.inputTokens)),
    cachedInputTokens: sumKnown(steps.map((step) => step.usage.inputTokenDetails?.cacheReadTokens)),
    outputTokens: sumKnown(steps.map((step) => step.usage.outputTokens)),
});
