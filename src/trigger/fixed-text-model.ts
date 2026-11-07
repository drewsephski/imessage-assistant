import type { LanguageModel } from "ai";

type Model = Extract<LanguageModel, { specificationVersion: "v3" }>;
type ProviderStreamPart =
  Awaited<ReturnType<Model["doStream"]>>["stream"] extends ReadableStream<infer Part> ? Part : never;

const FINISH = { unified: "stop", raw: undefined } as const;
// Nothing is sent to a provider, so these are known zeros rather than unknown provider counts
const USAGE = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

// Application text in the shape of a model reply, so a deterministic turn still runs through the
// normal streamText lifecycle. It reads no prompt and calls nothing, which is why it never reserves
// spending. Callers only ever give it prompts without files, so the SDK has nothing to download.
export const fixedTextModel = (text: string): Model => ({
  specificationVersion: "v3",
  provider: "application",
  modelId: "fixed-text",
  supportedUrls: {},
  doGenerate: async () => ({
    content: [{ type: "text", text }],
    finishReason: FINISH,
    usage: USAGE,
    warnings: [],
  }),
  doStream: async () => ({
    stream: new ReadableStream<ProviderStreamPart>({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        controller.enqueue({ type: "text-start", id: "text" });
        controller.enqueue({ type: "text-delta", id: "text", delta: text });
        controller.enqueue({ type: "text-end", id: "text" });
        controller.enqueue({ type: "finish", finishReason: FINISH, usage: USAGE });
        controller.close();
      },
    }),
  }),
});
