/**
 * Prompt-side screens (decision 56, NEXT-21): the two cheap checks that run
 * on a generation's PROMPT, before any paid model call. Decision 39 promised
 * both that "generation declines requests to reproduce a known theme" and,
 * per the closed beta's own restraint, that a flagged prompt is refused
 * without costing anything against the monthly budget - so both checks here
 * run in `jobs.ts` before the generation row's status ever leaves "queued"
 * (see that file), and neither ever calls the paid Responses API.
 *
 * `moderatePrompt` calls OpenAI's Moderation API (`omni-moderation-latest`),
 * a free endpoint on the same provider and credential the paid model uses
 * (`./model.ts`'s `openAICredentials`). Only the flagged categories are kept
 * - never the per-category scores, which are more detail than a refusal
 * reason needs and more surface than a decision record should carry. If the
 * call itself fails (network, non-2xx, a malformed body), this fails CLOSED:
 * it throws a retryable `moderation_unavailable` rather than letting
 * generation proceed unchecked.
 *
 * `knownWorkInPrompt` is the prompt-side half of the known-melody screen:
 * the benchmark's own prompts were already checked against
 * `./bench.ts`'s `KNOWN_WORK_DENYLIST` (`validatePromptSet`), but that check
 * was never applied to a real request - this reuses the same list (imported,
 * not duplicated) so a prompt that names a franchise or composer by name is
 * refused for free, before generation, with no model or network call at
 * all. It cannot catch a melody the model reproduces without being asked to;
 * that is `./similarity.ts`'s job, measured on the OUTPUT after generation.
 */
import { ProjectHttpError } from "../projects";
import { openAICredentials } from "./model";
import { KNOWN_WORK_DENYLIST } from "./bench";

export const MODERATION_MODEL = "omni-moderation-latest";
/** Generous relative to the model call's own 210s deadline - moderation is a
 * small, fast request and should fail fast rather than hold up the queue. */
export const MODERATION_TIMEOUT_MS = 10000;

export interface ModerationOutcome {
  flagged: boolean;
  /** Flagged category names only (e.g. "violence", "hate") - never scores. */
  categories: string[];
  model: string;
}

/** Whole-word/phrase match against the known-work denylist, sharing
 * `./bench.ts`'s escaping so the two checks can never drift apart. Returns
 * the matched name (for the refusal message) or null. */
export function knownWorkInPrompt(prompt: string): string | null {
  const lower = prompt.toLowerCase();
  for (const known of KNOWN_WORK_DENYLIST)
    if (new RegExp(`\\b${known.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(lower)) return known;
  return null;
}

/** Calls the free Moderation API. Fails closed with a retryable
 * `moderation_unavailable` on any network error, non-2xx response or
 * malformed body - a prompt is never allowed to generate unchecked. */
export async function moderatePrompt(prompt: string, signal?: AbortSignal): Promise<ModerationOutcome> {
  const { apiKey, base } = openAICredentials();
  const endpoint = new URL("moderations", base).href;
  const timeout = AbortSignal.timeout(MODERATION_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODERATION_MODEL, input: prompt }),
      signal: combined,
    });
  } catch {
    signal?.throwIfAborted();
    throw new ProjectHttpError(503, "moderation_unavailable", "Content moderation is temporarily unavailable. Please try again shortly.");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new ProjectHttpError(503, "moderation_unavailable", "Content moderation is temporarily unavailable. Please try again shortly.");
  }
  let body: unknown;
  try { body = await response.json(); }
  catch { throw new ProjectHttpError(503, "moderation_unavailable", "Content moderation is temporarily unavailable. Please try again shortly."); }
  const result = (body as { results?: unknown[] })?.results?.[0] as
    | { flagged?: boolean; categories?: Record<string, boolean> }
    | undefined;
  if (!result || typeof result.flagged !== "boolean")
    throw new ProjectHttpError(503, "moderation_unavailable", "Content moderation is temporarily unavailable. Please try again shortly.");
  const categories = Object.entries(result.categories ?? {}).filter(([, value]) => value).map(([key]) => key);
  return { flagged: result.flagged, categories, model: (body as { model?: string })?.model ?? MODERATION_MODEL };
}
