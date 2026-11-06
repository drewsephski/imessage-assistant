import { spending } from "./runtime.js";
// Wrap the provider boundary, not onStepFinish: the AI SDK may retry a failed HTTP call.
// Each invocation reserves separately. A stream is still spending after doStream resolves.
export const withModelSpending = (model, runtime = spending) => ({
    ...model,
    specificationVersion: model.specificationVersion,
    provider: model.provider,
    modelId: model.modelId,
    get supportedUrls() {
        return model.supportedUrls;
    },
    doGenerate: async (options) => {
        const reservation = await runtime.reserve(`model:${model.modelId}`);
        const ceiling = runtime.policy().maxModelOutputTokens;
        try {
            return await model.doGenerate({
                ...options,
                maxOutputTokens: Math.min(options.maxOutputTokens ?? ceiling, ceiling),
            });
        }
        finally {
            await runtime.uncertain(reservation);
        }
    },
    doStream: async (options) => {
        const reservation = await runtime.reserve(`model:${model.modelId}`);
        const ceiling = runtime.policy().maxModelOutputTokens;
        try {
            const result = await model.doStream({
                ...options,
                maxOutputTokens: Math.min(options.maxOutputTokens ?? ceiling, ceiling),
            });
            return {
                ...result,
                stream: result.stream.pipeThrough(new TransformStream({
                    transform(part, controller) {
                        controller.enqueue(part);
                    },
                    async flush() {
                        await runtime.uncertain(reservation);
                    },
                })),
            };
        }
        catch (error) {
            await runtime.uncertain(reservation);
            throw error;
        }
        // Cancellation/crash may skip flush. The independent reconciler retains the reservation.
    },
});
