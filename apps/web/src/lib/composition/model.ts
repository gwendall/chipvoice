import { ProjectHttpError } from "../projects";
import type { HttpError } from "web-kit/http";
import { readSSE } from "web-kit/sse";

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

/** The credential and base URL shared by every OpenAI-hosted endpoint this
 * server calls: the paid Responses API (below) and the free Moderation API
 * (`./moderation.ts`). Kept separate from `compositionConfig` so a
 * moderation-only environment (no `COMPOSITION_PROVIDER`/token-limit
 * concerns) still resolves the same credential and HTTPS check without
 * duplicating either. */
export function openAICredentials() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey)
    throw new ProjectHttpError(503, "generation_disabled", "Set OPENAI_API_KEY on the server to enable composition");
  const base = new URL(process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1/");
  if (base.protocol !== "https:" && !(base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)))
    throw new ProjectHttpError(503, "generation_disabled", "The model endpoint must use HTTPS");
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  return { apiKey, base };
}

/** Server configuration only: callers cannot select a credential or endpoint. */
export function compositionConfig() {
  const { apiKey, base } = openAICredentials();
  const provider = process.env.COMPOSITION_PROVIDER ?? "openai";
  if (provider !== "openai")
    throw new ProjectHttpError(503, "generation_disabled", "Unsupported composition provider");
  const maxTokens = Number(process.env.OPENAI_MAX_OUTPUT_TOKENS ?? 24000);
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1024 || maxTokens > 64000)
    throw new ProjectHttpError(503, "generation_disabled", "Invalid OPENAI_MAX_OUTPUT_TOKENS");
  return {
    apiKey, maxTokens, endpoint: new URL("responses", base).href,
    model: process.env.OPENAI_MODEL?.trim() || "gpt-6-astra",
    effort: process.env.OPENAI_REASONING_EFFORT?.trim(),
  };
}

/** OpenAI error identifiers meaning the account cannot pay for any call: no
 * request succeeds until someone restores the credit, so a retry never helps.
 * Since 2026-10-06 an exhausted balance arrives as HTTP 200, then an `error`
 * event `{ type: "insufficient_quota", code: "credit_balance_exhausted" }`,
 * then `response.failed` - it used to read as "interrupted the response". */
const CREDIT_EXHAUSTED = new Set(["insufficient_quota", "credit_balance_exhausted", "billing_hard_limit_reached", "billing_not_active"]);
const RATE_LIMITED = new Set(["rate_limit_exceeded", "rate_limit_error"]);

/** Failure codes for a call the provider refused before doing any work: it
 * cost nothing, so `jobs.ts` records zero usage for them (decision 61). */
export const PROVIDER_REFUSAL_CODES = new Set(["composition_unavailable", "composition_rate_limited"]);

/** A provider-defined identifier, or null: only these short tokens are ever
 * read from a provider failure, never its message or the rest of its body. */
function identifier(value: unknown) {
  return typeof value === "string" && /^[a-z0-9_.-]{1,64}$/i.test(value) ? value : null;
}

/** The provider's `type` and `code` for a failure, from an `error` event
 * (`{ error: { type, code } }`, or the documented flat `{ code }`), a failed
 * response's `error`, or an error response body's `error`. */
function providerFailure(source: unknown) {
  const record = (value: unknown) => value && typeof value === "object" ? value as Record<string, unknown> : null;
  const outer = record(source), inner = record(outer?.error);
  return inner ? { type: identifier(inner.type), code: identifier(inner.code) } : { type: null, code: identifier(outer?.code) };
}

/** The honest error for a provider failure, classified by identifier only.
 * The identifiers (never the message) are logged, so the next diagnosis is a
 * search of the deployment's logs rather than a reproduction. A failure after
 * the model already wrote output keeps `fallback`: that call did real work,
 * so it is not a free refusal. */
function classifyFailure(where: string, failure: { type: string | null; code: string | null }, fallback: HttpError, outputCharacters = 0) {
  console.warn("Composition provider failure", { where, type: failure.type, code: failure.code, outputCharacters });
  if (outputCharacters > 0) return fallback;
  const ids = [failure.type, failure.code].filter((id): id is string => id !== null);
  if (ids.some(id => CREDIT_EXHAUSTED.has(id)))
    return new ProjectHttpError(503, "composition_unavailable", "Composition is unavailable on chipvoice's side right now: the model provider's credit is exhausted. Retrying will not help until it is restored.");
  if (ids.some(id => RATE_LIMITED.has(id)))
    return new ProjectHttpError(503, "composition_rate_limited", "The model provider is rate-limiting chipvoice right now. Try again in a minute.");
  return fallback;
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
        // Provider bodies can contain private input; never relay them to
        // clients/logs. Only the error's identifiers are read from it.
        let failure = { type: null as string | null, code: null as string | null };
        try { failure = providerFailure(JSON.parse(await response.text())); } catch { await response.body?.cancel().catch(() => {}); }
        throw classifyFailure(`http_${response.status}`, failure, new ProjectHttpError(502, "model_error", `The composition provider returned HTTP ${response.status}`));
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
          if (event.type === "error")
            throw classifyFailure("error_event", providerFailure(event), new ProjectHttpError(502, "model_error", "The composition provider interrupted the response"), outputCharacters);
        }
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof ProjectHttpError) throw error;
        throw new ProjectHttpError(502, "model_stream_interrupted", "The composition connection was interrupted before the score was complete");
      }
      if (!body) throw new ProjectHttpError(502, "model_stream_interrupted", "The composition connection ended before the score was complete");
      if (body.status === "failed")
        throw classifyFailure("response_failed", providerFailure(body), new ProjectHttpError(502, "model_error", "The composition provider could not complete the request"), outputCharacters);
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
