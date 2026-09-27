/**
 * Generation benchmark (GEN-01, GEN-05).
 *
 * Pure logic for `scripts/gen-bench.mjs`: selecting prompts, deciding whether
 * a run may spend real money, pricing a sample the same way the monthly
 * budget prices it (`./admission`), and turning per-prompt records into the
 * generated summary and listening grid the runner writes to disk. Nothing
 * here calls the model, renders audio or touches the filesystem or network,
 * so it is exercised directly, without a server, in `test-gen-bench.mjs` -
 * the same split `./checks.ts` uses for the same reason.
 */
import { modelPrices, priceUsage, type Prices } from "./admission";

export type Console = "2a03" | "dmg" | "md" | "snes" | "c64";
export const CONSOLES: Console[] = ["2a03", "dmg", "md", "snes", "c64"];

export interface BenchPrompt {
  id: string;
  console: Console;
  prompt: string;
  durationSeconds: number;
  loop: boolean;
}

/** Names this benchmark's own prompts must never use (decision 39's rule that
 * generation declines a known theme applies to the benchmark's prompts too,
 * not only to what a visitor might type). Lower-cased substrings; deliberately
 * covers franchises and composers a "varied original prompt" could otherwise
 * drift towards, not an exhaustive moderation list - the benchmark's prompts
 * are authored, not user input, so this is a safety net, not the enforcement. */
export const KNOWN_WORK_DENYLIST = [
  "mario", "zelda", "sonic", "mega man", "megaman", "metroid", "kirby", "pokemon", "pokémon",
  "final fantasy", "dragon quest", "castlevania", "contra", "tetris", "pac-man", "pacman",
  "street fighter", "donkey kong", "star fox", "earthbound", "chrono trigger", "sonic the hedgehog",
  "star wars", "indiana jones", "harry potter", "lord of the rings", "james bond", "jurassic park",
  "john williams", "koji kondo", "nobuo uematsu", "yuzo koshiro", "david wise", "rob hubbard",
  "hirokazu tanaka", "michael giacchino", "danny elfman", "hans zimmer",
];

export interface PromptProblem { id: string; message: string }

/** Checks the committed prompt set is what the ticket asks for: about 50 per
 * console, unique ids, durations inside the request schema's 10-90s bound
 * (`compositionRequest` in `./score`), and no hit against the denylist above.
 * Returns every problem found; an empty array means the set is fit to run. */
export function validatePromptSet(prompts: BenchPrompt[]): PromptProblem[] {
  const problems: PromptProblem[] = [];
  const seen = new Set<string>();
  const perConsole = new Map<Console, number>();
  for (const p of prompts) {
    if (seen.has(p.id)) problems.push({ id: p.id, message: "duplicate prompt id" });
    seen.add(p.id);
    if (!CONSOLES.includes(p.console)) problems.push({ id: p.id, message: `unknown console "${p.console}"` });
    perConsole.set(p.console, (perConsole.get(p.console) ?? 0) + 1);
    if (!Number.isInteger(p.durationSeconds) || p.durationSeconds < 10 || p.durationSeconds > 90)
      problems.push({ id: p.id, message: `durationSeconds ${p.durationSeconds} outside the request schema's 10-90s bound` });
    if (!p.prompt.trim() || p.prompt.length > 2000)
      problems.push({ id: p.id, message: "prompt is empty or exceeds the request schema's 2000-character bound" });
    const lower = p.prompt.toLowerCase();
    for (const known of KNOWN_WORK_DENYLIST)
      // Whole-word/phrase match: "contra" must not flag "contrasting".
      if (new RegExp(`\\b${known.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(lower))
        problems.push({ id: p.id, message: `prompt names a known work ("${known}"); decision 39 applies to the benchmark's own prompts too` });
  }
  for (const console of CONSOLES) {
    const count = perConsole.get(console) ?? 0;
    if (count < 40) problems.push({ id: `console:${console}`, message: `only ${count} prompts for ${console}; the backlog asks for about 50 per console` });
  }
  return problems;
}

export interface SelectOptions {
  consoles?: Console[];
  limit?: number;
  sample?: boolean; // one prompt per console, in file order
}

/** Applies `--console`/`--limit`/`--sample` (in that order) to the committed
 * set. `--sample` is the paid-sample shape the backlog asks for: exactly one
 * prompt per requested console. */
export function selectPrompts(prompts: BenchPrompt[], options: SelectOptions = {}): BenchPrompt[] {
  const consoles = options.consoles?.length ? options.consoles : CONSOLES;
  let selected = prompts.filter((p) => consoles.includes(p.console));
  if (options.sample) {
    const perConsole = new Map<Console, BenchPrompt>();
    for (const p of selected) if (!perConsole.has(p.console)) perConsole.set(p.console, p);
    selected = consoles.map((c) => perConsole.get(c)).filter((p): p is BenchPrompt => Boolean(p));
  }
  if (options.limit !== undefined && options.limit >= 0) selected = selected.slice(0, options.limit);
  return selected;
}

const MAX_FREE_REAL_CALLS = 5;

export interface GuardResult { allowed: boolean; reason?: string }

/** The hard spending guard: more than five real model calls need
 * `--confirm-paid-run`. Mock calls never count (no network, no cost), and the
 * check runs before any credential is even read, so a run this refuses never
 * gets as far as needing `OPENAI_API_KEY`. */
export function guardPaidRun(plannedRealCalls: number, confirmPaidRun: boolean): GuardResult {
  if (plannedRealCalls <= MAX_FREE_REAL_CALLS || confirmPaidRun) return { allowed: true };
  return {
    allowed: false,
    reason: `${plannedRealCalls} real model calls requested, past the ${MAX_FREE_REAL_CALLS} allowed without --confirm-paid-run`,
  };
}

/** Six generations recorded before decision 42 averaged about 0.28 USD each
 * (decision 42, DECISIONS.md); used only until this benchmark has its own
 * measured runs to draw from (see `estimateRunCost`). */
export const FALLBACK_COST_PER_CALL_USD = 0.28;

export interface CostEstimate { perCallUsd: number; totalUsd: number; source: "measured" | "fallback" }

/** The estimate the guard prints before spending anything: a run's planned
 * real calls times a per-call cost. `priorMeanCostUsd` is this benchmark's
 * own past measurement (the runner reads it from earlier runs' summaries);
 * without one yet, decision 42's measured production average is the
 * documented fallback, not an invented number. */
export function estimateRunCost(plannedRealCalls: number, priorMeanCostUsd: number | null): CostEstimate {
  const perCallUsd = priorMeanCostUsd ?? FALLBACK_COST_PER_CALL_USD;
  return { perCallUsd, totalUsd: perCallUsd * plannedRealCalls, source: priorMeanCostUsd === null ? "fallback" : "measured" };
}

/** The Responses API usage shape `openAIModel().generate()` returns
 * (`body.usage`, model.ts) and `jobs.ts` stores verbatim as a generation's
 * `usage` column - the same shape `admission.ts`'s `monthSpend` reads with
 * `json_extract`. */
export interface ResponsesUsage {
  input_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
  output_tokens?: number;
}

/** Prices one generation's recorded usage exactly the way the monthly budget
 * prices it (`priceUsage`, `./admission`): the same field names, the same
 * cached-token clamp, the same per-million arithmetic. Returns `null` when
 * the model has no known price, the same condition that stops composition in
 * production (`compositionBudget` in `./admission`). */
export function costFromUsage(model: string, usage: ResponsesUsage | null | undefined): number | null {
  if (!usage) return null;
  const prices: Prices | null = modelPrices(model);
  if (!prices) return null;
  return priceUsage(prices, {
    input: usage.input_tokens ?? 0,
    cached: usage.input_tokens_details?.cached_tokens ?? 0,
    output: usage.output_tokens ?? 0,
  });
}

export interface CheckFindingLike { code: string; level: "warning" | "error" }

export interface BenchRecord {
  id: string;
  console: Console;
  prompt: string;
  durationSeconds: number;
  loop: boolean;
  mock: boolean;
  status: "ok" | "failed";
  errorCode?: string;
  error?: string;
  model?: string;
  usage?: ResponsesUsage | null;
  costUsd?: number | null;
  timings?: { modelMs: number; renderMs: number; totalMs: number };
  findings?: CheckFindingLike[];
  audio?: { path: string; seconds: number; sha256: string };
}

/** Which of GEN-03's check codes apply to a record, mirroring the same gates
 * `checks.ts` itself applies (`checkEndingDecay` only without a loop,
 * `checkLoopSeam` only with one); a code's pass rate is only meaningful over
 * the records it could have fired on. */
export function applicableCodes(loop: boolean): string[] {
  const always = ["duration_mismatch", "clipping", "level_jump", "silence_gap"];
  return loop ? [...always, "loop_level_jump", "loop_click"] : [...always, "abrupt_ending"];
}

export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

export interface ConsoleSummary {
  console: Console;
  total: number;
  succeeded: number;
  failed: number;
  checks: Record<string, { applicable: number; passed: number; passRate: number | null }>;
  latencyMs: {
    model: { p50: number | null; p90: number | null };
    render: { p50: number | null; p90: number | null };
    total: { p50: number | null; p90: number | null };
  };
  meanCostUsd: number | null;
}

export interface BenchSummary {
  generatedAt: string;
  mock: boolean;
  totalPrompts: number;
  consoles: ConsoleSummary[];
}

const CHECK_CODES = ["duration_mismatch", "clipping", "level_jump", "silence_gap", "abrupt_ending", "loop_level_jump", "loop_click"];

/** Turns a run's per-prompt records into the generated summary the doc and
 * the report quote: per console, each check's pass rate over the records it
 * applies to, model/render/total latency p50/p90, and mean cost. */
export function summarize(records: BenchRecord[], generatedAt = new Date().toISOString()): BenchSummary {
  const mock = records.length > 0 && records.every((r) => r.mock);
  const consoles = CONSOLES.filter((c) => records.some((r) => r.console === c)).map((console): ConsoleSummary => {
    const rows = records.filter((r) => r.console === console);
    const ok = rows.filter((r) => r.status === "ok");
    const checks: ConsoleSummary["checks"] = {};
    for (const code of CHECK_CODES) {
      const applicableRows = ok.filter((r) => applicableCodes(r.loop).includes(code));
      const passed = applicableRows.filter((r) => !(r.findings ?? []).some((f) => f.code === code));
      checks[code] = { applicable: applicableRows.length, passed: passed.length, passRate: applicableRows.length ? passed.length / applicableRows.length : null };
    }
    const modelMs = ok.map((r) => r.timings?.modelMs).filter((v): v is number => v !== undefined);
    const renderMs = ok.map((r) => r.timings?.renderMs).filter((v): v is number => v !== undefined);
    const totalMs = ok.map((r) => r.timings?.totalMs).filter((v): v is number => v !== undefined);
    const costs = ok.map((r) => r.costUsd).filter((v): v is number => v !== null && v !== undefined);
    return {
      console, total: rows.length, succeeded: ok.length, failed: rows.length - ok.length, checks,
      latencyMs: {
        model: { p50: percentile(modelMs, 50), p90: percentile(modelMs, 90) },
        render: { p50: percentile(renderMs, 50), p90: percentile(renderMs, 90) },
        total: { p50: percentile(totalMs, 50), p90: percentile(totalMs, 90) },
      },
      meanCostUsd: costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null,
    };
  });
  return { generatedAt, mock, totalPrompts: records.length, consoles };
}

/** This run's own mean cost per real generation, for `estimateRunCost` to
 * offer a future run instead of the fallback - `null` when this run made no
 * priced real calls (a mock run, or one where every call failed before
 * usage was recorded). */
export function meanCostOf(summary: BenchSummary): number | null {
  const costs = summary.consoles.map((c) => c.meanCostUsd).filter((v): v is number => v !== null);
  if (!costs.length) return null;
  const totalSucceeded = summary.consoles.reduce((n, c) => n + c.succeeded, 0);
  if (!totalSucceeded) return null;
  return summary.consoles.reduce((sum, c) => sum + (c.meanCostUsd ?? 0) * c.succeeded, 0) / totalSucceeded;
}

const fmtMs = (ms: number | null) => (ms === null ? "-" : `${Math.round(ms)}ms`);
const fmtPct = (rate: number | null) => (rate === null ? "n/a" : `${Math.round(rate * 100)}%`);
const fmtUsd = (usd: number | null) => (usd === null ? "n/a" : `$${usd.toFixed(4)}`);

/** The generated summary document: one table per console over the run's own
 * numbers, nothing hand-typed. */
export function formatSummaryMarkdown(summary: BenchSummary): string {
  const lines: string[] = [];
  lines.push(`# Generation benchmark summary`, "");
  lines.push(`Generated ${summary.generatedAt}. ${summary.totalPrompts} prompt${summary.totalPrompts === 1 ? "" : "s"}, ${summary.mock ? "mock provider (no network, no cost)" : "real model"}.`, "");
  for (const c of summary.consoles) {
    lines.push(`## ${c.console}`, "");
    lines.push(`${c.succeeded}/${c.total} rendered. Mean cost per generation: ${fmtUsd(c.meanCostUsd)}.`, "");
    lines.push(`| Latency | p50 | p90 |`, `| --- | --- | --- |`);
    lines.push(`| model call | ${fmtMs(c.latencyMs.model.p50)} | ${fmtMs(c.latencyMs.model.p90)} |`);
    lines.push(`| render | ${fmtMs(c.latencyMs.render.p50)} | ${fmtMs(c.latencyMs.render.p90)} |`);
    lines.push(`| total | ${fmtMs(c.latencyMs.total.p50)} | ${fmtMs(c.latencyMs.total.p90)} |`, "");
    lines.push(`| Check | pass rate | applicable |`, `| --- | --- | --- |`);
    for (const code of CHECK_CODES) {
      const check = c.checks[code];
      if (check.applicable) lines.push(`| ${code} | ${fmtPct(check.passRate)} | ${check.applicable} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** A table a person fills in by listening to each saved audio file: the
 * objective columns are already known from the run, the judgment columns are
 * blank for a human to score. */
export function listeningGridCsv(records: BenchRecord[]): string {
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const header = ["id", "console", "durationSeconds", "loop", "audio", "musicality (1-5)", "fit to prompt (1-5)", "console idiom (1-5)", "defects", "notes"];
  const rows = records.filter((r) => r.status === "ok" && r.audio).map((r) => [
    r.id, r.console, String(r.durationSeconds), String(r.loop), r.audio!.path, "", "", "", "", "",
  ]);
  return [header, ...rows].map((row) => row.map(escape).join(",")).join("\n") + "\n";
}
