import type { Client, Transaction } from "@libsql/client";
import { ProjectHttpError } from "../projects";

/**
 * Who may compose, and whether this month's spend allows one more composition.
 *
 * Decision 39 opens prompt composition as a closed beta: by invitation, free,
 * bounded by each owner's daily limit and by a monthly spend cap. Decision 42
 * enforces the invitation and the cap here, in the server that spends the
 * money, instead of only in the provider's dashboard: the server records every
 * generation's token usage, so it can price a month itself, refuse before a
 * call rather than after a bill, and be tested like the rest of the API.
 *
 * - Access: `COMPOSITION_ACCESS` is `invite` or `open`. Unset, it is `invite`
 *   on every Vercel deployment and `open` on a developer's machine. With
 *   `invite`, an account composes only when its email is in
 *   `composition_invites` (`scripts/composition-invites.mjs` manages it).
 * - Budget: `COMPOSITION_MONTHLY_BUDGET_USD` caps the calendar month (UTC).
 *   Production refuses to compose without it. A month's spend is the priced
 *   usage of its generations, plus a worst case for every generation whose
 *   usage is not known yet or was never recorded (running, or failed after the
 *   model was called), so concurrent admissions cannot overshoot the cap.
 */

export type Prices = { input: number; cachedInput: number; output: number };

/** USD per million tokens, standard tier, from OpenAI's pricing page
 * (developers.openai.com/api/docs/pricing, read 2026-09-27). A model missing
 * here needs `COMPOSITION_USD_PER_MILLION_INPUT`, `_CACHED_INPUT` and
 * `_OUTPUT`; without a price the budget cannot be kept, so composing stops. */
const PRICES: Record<string, Prices> = {
  "gpt-6-astra": { input: 10, cachedInput: 1, output: 50 },
};

/** Input tokens assumed for a generation whose usage is unknown. The
 * instructions, schema and prompt measured about 6800 on average in production
 * (2026-09); this bounds that several times over. */
const RESERVE_INPUT_TOKENS = 32768;

function error(status: number, code: string, message: string, retryAfter?: number): never {
  throw new ProjectHttpError(status, code, message, retryAfter);
}

export type CompositionAccess = "invite" | "open";

export function compositionAccess(): CompositionAccess {
  const value = process.env.COMPOSITION_ACCESS?.trim() || (process.env.VERCEL_ENV ? "invite" : "open");
  if (value !== "invite" && value !== "open") error(503, "generation_disabled", "Invalid COMPOSITION_ACCESS");
  return value;
}

function price(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) error(503, "generation_disabled", `Invalid ${name}`);
  return value;
}

export function modelPrices(model: string): Prices | null {
  const input = price("COMPOSITION_USD_PER_MILLION_INPUT");
  const cachedInput = price("COMPOSITION_USD_PER_MILLION_CACHED_INPUT");
  const output = price("COMPOSITION_USD_PER_MILLION_OUTPUT");
  if (input !== undefined && output !== undefined) return { input, cachedInput: cachedInput ?? input, output };
  return PRICES[model] ?? null;
}

/** One generation's cost in USD at a given model's prices: the same sum
 * `monthSpend` totals across a month of rows, pulled out so the generation
 * benchmark (`scripts/gen-bench.mjs`) prices each sample exactly the way the
 * budget prices it, rather than a second formula that could drift from this
 * one. `cached` is clamped to `input` here too, so a caller need not repeat
 * that guard. */
export function priceUsage(prices: Prices, usage: { input: number; cached: number; output: number }): number {
  const cached = Math.min(usage.input, usage.cached);
  return ((usage.input - cached) * prices.input + cached * prices.cachedInput + usage.output * prices.output) / 1e6;
}

export type CompositionBudget = { monthlyUsd: number; prices: Prices; reserveUsd: number };

/** The month's cap and the model's prices, or null where no cap is configured
 * outside production (local work and the test fixtures). */
export function compositionBudget(model: string, maxOutputTokens: number): CompositionBudget | null {
  const raw = process.env.COMPOSITION_MONTHLY_BUDGET_USD?.trim();
  if (!raw) {
    if (process.env.VERCEL_ENV === "production") error(503, "generation_disabled", "Set COMPOSITION_MONTHLY_BUDGET_USD on the server to enable composition");
    return null;
  }
  const monthlyUsd = Number(raw);
  if (!Number.isFinite(monthlyUsd) || monthlyUsd <= 0) error(503, "generation_disabled", "Invalid COMPOSITION_MONTHLY_BUDGET_USD");
  const prices = modelPrices(model);
  if (!prices) error(503, "generation_disabled", `No price is known for ${model}; set COMPOSITION_USD_PER_MILLION_INPUT and _OUTPUT`);
  const reserveUsd = (RESERVE_INPUT_TOKENS * prices.input + maxOutputTokens * prices.output) / 1e6;
  return { monthlyUsd, prices, reserveUsd };
}

const monthStart = (now: number) => { const d = new Date(now); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };
const nextMonth = (now: number) => { const d = new Date(now); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); };

/** This calendar month's spend in USD: priced usage per model, plus the
 * budget's worst case for each generation still running or failed after its
 * model call without a recorded usage. */
export async function monthSpend(db: Client | Transaction, now: number, budget: CompositionBudget) {
  const rows = (await db.execute({
    sql: `select model,
      coalesce(sum(json_extract(usage,'$.input_tokens')),0) as input,
      coalesce(sum(json_extract(usage,'$.input_tokens_details.cached_tokens')),0) as cached,
      coalesce(sum(json_extract(usage,'$.output_tokens')),0) as output,
      sum(case when usage is null and (status not in ('ready','failed','cancelled') or started_at is not null) then 1 else 0 end) as unmetered
      from generations where created_at>=? group by model`,
    args: [monthStart(now)],
  })).rows;
  let usd = 0, unmetered = 0;
  for (const row of rows) {
    const prices = modelPrices(String(row.model)) ?? budget.prices;
    usd += priceUsage(prices, { input: Number(row.input), cached: Number(row.cached), output: Number(row.output) });
    unmetered += Number(row.unmetered);
  }
  return { usd: usd + unmetered * budget.reserveUsd, unmetered };
}

export async function isInvited(db: Client | Transaction, userId: string): Promise<boolean> {
  return (await db.execute({
    sql: "select 1 from composition_invites i join users u on u.email=i.email where u.id=?",
    args: [userId],
  })).rows.length > 0;
}

export async function requireInvitation(db: Client | Transaction, userId: string) {
  if (compositionAccess() === "invite" && !(await isInvited(db, userId)))
    error(403, "generation_invite_required", "Prompt composition is in a closed beta, by invitation");
}

/** Refuses one more composition when the month's spend plus this one's worst
 * case would pass the cap. Runs inside the admission transaction. */
export async function requireBudget(tx: Transaction, now: number, budget: CompositionBudget | null) {
  if (!budget) return;
  const spent = await monthSpend(tx, now, budget);
  if (spent.usd + budget.reserveUsd > budget.monthlyUsd)
    error(429, "generation_budget", "This month's composition budget is spent; composition reopens on the first of next month (UTC)", Math.max(60, Math.ceil((nextMonth(now) - now) / 1000)));
}
