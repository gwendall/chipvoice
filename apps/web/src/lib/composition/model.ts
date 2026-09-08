import { ProjectHttpError } from "../projects";

export interface CompositionModel {
  generate(input: {
    instructions: string;
    prompt: string;
    schema: Record<string, unknown>;
    signal: AbortSignal;
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
    async generate({ instructions, prompt, schema, signal }) {
      const response = await fetch(config.endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.model, instructions, input: prompt, store: false,
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
      const reader = response.body?.getReader();
      if (!reader) throw new ProjectHttpError(502, "model_error", "The composition provider returned no response");
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 4 * 1024 * 1024) {
            await reader.cancel();
            throw new ProjectHttpError(502, "model_limit", "The composition response was too large");
          }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (body.status !== "completed")
        throw new ProjectHttpError(502, "model_incomplete", "The model did not finish the composition; try a shorter piece or increase the server token limit");
      const content = (body.output ?? []).filter((item: { type: string }) => item.type === "message")
        .flatMap((item: { content: { type: string; text?: string }[] }) => item.content ?? []);
      if (content.some((item: { type: string }) => item.type === "refusal"))
        throw new ProjectHttpError(422, "model_refused", "The model declined this composition request");
      const text = content.filter((item: { type: string }) => item.type === "output_text")
        .map((item: { text: string }) => item.text).join("");
      if (!text) throw new ProjectHttpError(502, "model_error", "The model returned no composition");
      return { value: JSON.parse(text), model: String(body.model ?? config.model), usage: body.usage ?? null };
    },
  };
}
