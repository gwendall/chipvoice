import { ProjectHttpError } from "../projects";
import { readSSE } from "../sse";

export type ModelProgress = { outputCharacters: number };

export interface CompositionModel {
  generate(input: {
    instructions: string;
    prompt: string;
    schema: Record<string, unknown>;
    signal: AbortSignal;
    onProgress?: (progress: ModelProgress) => void;
  }): Promise<{ value: unknown; model: string; usage: unknown }>;
}

/** Server configuration only: callers cannot select a credential or endpoint. */
export function compositionConfig() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey)
    throw new ProjectHttpError(503, "generation_disabled", "Set OPENAI_API_KEY on the server to enable composition");
  const provider = process.env.COMPOSITION_PROVIDER ?? "openai";
  if (provider !== "openai")
    throw new ProjectHttpError(503, "generation_disabled", "Unsupported composition provider");
  const maxTokens = Number(process.env.OPENAI_MAX_OUTPUT_TOKENS ?? 24000);
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1024 || maxTokens > 64000)
    throw new ProjectHttpError(503, "generation_disabled", "Invalid OPENAI_MAX_OUTPUT_TOKENS");
  const base = new URL(process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1/");
  if (base.protocol !== "https:" && !(base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)))
    throw new ProjectHttpError(503, "generation_disabled", "The model endpoint must use HTTPS");
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  return {
    apiKey, maxTokens, endpoint: new URL("responses", base).href,
    model: process.env.OPENAI_MODEL?.trim() || "gpt-6-astra",
    effort: process.env.OPENAI_REASONING_EFFORT?.trim(),
  };
}

/** One small adapter; another provider implements the same generate method. */
export function openAIModel(config = compositionConfig()): CompositionModel {
  return {
    async generate({ instructions, prompt, schema, signal, onProgress }) {
      const response = await fetch(config.endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.model, instructions, input: prompt, store: false, stream: true,
          max_output_tokens: config.maxTokens,
          ...(config.effort ? { reasoning: { effort: config.effort } } : {}),
          text: { format: { type: "json_schema", name: "chipvoice_composition", strict: true, schema } },
        }),
        signal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        // Provider bodies can contain private input; never relay them to clients/logs.
        throw new ProjectHttpError(502, "model_error", `The composition provider returned HTTP ${response.status}`);
      }
      if (!response.body) throw new ProjectHttpError(502, "model_error", "The composition provider returned no response");
      let body;
      let outputCharacters = 0;
      try {
        for await (const frame of readSSE(response.body)) {
          const event = JSON.parse(frame.data);
          // Never forward reasoning, provider messages or private score fragments.
          if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
            outputCharacters += event.delta.length;
            onProgress?.({ outputCharacters });
          }
          if (["response.completed", "response.incomplete", "response.failed"].includes(event.type)) {
            body = event.response;
            break;
          }
          if (event.type === "error") throw new ProjectHttpError(502, "model_error", "The composition provider interrupted the response");
        }
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof ProjectHttpError) throw error;
        throw new ProjectHttpError(502, "model_stream_interrupted", "The composition connection was interrupted before the score was complete");
      }
      if (!body) throw new ProjectHttpError(502, "model_stream_interrupted", "The composition connection ended before the score was complete");
      if (body.status === "failed")
        throw new ProjectHttpError(502, "model_error", "The composition provider could not complete the request");
      if (body.status !== "completed")
        throw new ProjectHttpError(502, "model_incomplete", "The model did not finish the composition; try a shorter piece or increase the server token limit");
      const content = (body.output ?? []).filter((item: { type: string }) => item.type === "message")
        .flatMap((item: { content: { type: string; text?: string }[] }) => item.content ?? []);
      if (content.some((item: { type: string }) => item.type === "refusal"))
        throw new ProjectHttpError(422, "model_refused", "The model declined this composition request");
      const text = content.filter((item: { type: string }) => item.type === "output_text")
        .map((item: { text: string }) => item.text).join("");
      if (!text) throw new ProjectHttpError(502, "model_error", "The model returned no composition");
      let value;
      try { value = JSON.parse(text); }
      catch { throw new ProjectHttpError(422, "invalid_composition", "The model returned an invalid musical structure"); }
      return { value, model: String(body.model ?? config.model), usage: body.usage ?? null };
    },
  };
}
