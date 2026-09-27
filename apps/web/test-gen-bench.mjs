// The generation benchmark's own harness (GEN-01, GEN-05): `--mock` never
// touches the network or spends money, so this covers it in CI the same way
// test-whole-song-checks.mjs covers its pure module - plus the spending
// guard, exercised as a real subprocess so a bug in it cannot accidentally
// place a real call. No live Next server is needed; this script ignores the
// one test-local.mjs starts around it.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = new URL("../..", import.meta.url).pathname;
const script = new URL("./scripts/gen-bench.mjs", import.meta.url).pathname;

function run(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: repoRoot,
      env: { ...process.env, OPENAI_API_KEY: "", OPENAI_BASE_URL: "", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

// ---- a small real mock run: proves the harness drives the actual generation
// path (model.ts/score.ts/checks.ts, unmodified) end to end, no network ------
const workDir = await mkdtemp(join(tmpdir(), "gen-bench-test-"));
try {
  const outDir = join(workDir, "sample-run");
  const sample = await run(["--mock", "--console", "2a03,dmg", "--sample", "--out", outDir]);
  assert.equal(sample.code, 0, `mock run should succeed:\n${sample.stdout}\n${sample.stderr}`);
  assert.match(sample.stdout, /ok\s+2a03-01/);
  assert.match(sample.stdout, /ok\s+dmg-01/);

  const results = JSON.parse(await readFile(join(outDir, "results.json"), "utf8"));
  assert.equal(results.length, 2);
  for (const record of results) {
    assert.equal(record.status, "ok", JSON.stringify(record));
    assert.equal(record.mock, true);
    assert.equal(typeof record.model, "string");
    assert.ok(record.usage && typeof record.usage.input_tokens === "number" && typeof record.usage.output_tokens === "number");
    assert.ok(typeof record.costUsd === "number" && record.costUsd > 0, "costUsd is priced from usage, the way the budget prices it");
    assert.ok(record.timings.modelMs >= 0 && record.timings.renderMs > 0 && record.timings.totalMs >= record.timings.modelMs + record.timings.renderMs - 1);
    assert.ok(Array.isArray(record.findings), "GEN-03 whole-song checks ran");
    assert.ok(record.audio && record.audio.seconds > 0 && /^[0-9a-f]{64}$/.test(record.audio.sha256));
    const wavPath = join(outDir, record.audio.path);
    const wav = await readFile(wavPath);
    assert.equal(wav.subarray(0, 4).toString("ascii"), "RIFF");
    assert.equal(wav.subarray(8, 12).toString("ascii"), "WAVE");
    assert.ok(Math.abs(wav.length - (44 + record.audio.seconds * 44100 * 2 * 2)) < 1000, "roughly the expected 16-bit stereo byte count");
  }

  const summary = JSON.parse(await readFile(join(outDir, "summary.json"), "utf8"));
  assert.equal(summary.mock, true);
  assert.equal(summary.totalPrompts, 2);
  assert.deepEqual(summary.consoles.map((c) => c.console).sort(), ["2a03", "dmg"]);
  for (const c of summary.consoles) {
    assert.equal(c.succeeded, 1);
    assert.equal(c.checks.duration_mismatch.applicable, 1);
    assert.ok(c.meanCostUsd > 0);
    assert.ok(c.latencyMs.render.p50 !== null);
  }

  const summaryMd = await readFile(join(outDir, "summary.md"), "utf8");
  assert.match(summaryMd, /# Generation benchmark summary/);
  assert.match(summaryMd, /## 2a03/);
  assert.match(summaryMd, /## dmg/);

  const grid = await readFile(join(outDir, "listening-grid.csv"), "utf8");
  const gridLines = grid.trim().split("\n");
  assert.equal(gridLines.length, 3); // header + 2 songs
  assert.match(gridLines[0], /musicality/);
  assert.match(gridLines[0], /console idiom/);
} finally {
  await rm(workDir, { recursive: true, force: true });
}

// ---- the spending guard: no network, no key, refuses before starting -------
{
  const guarded = await run(["--limit", "6"]);
  assert.equal(guarded.code, 1);
  assert.match(guarded.stdout, /Estimated cost of this run: 6 real call/);
  assert.match(guarded.stderr, /Refusing to run: 6 real model calls requested, past the 5 allowed/);
  assert.ok(!/OPENAI_API_KEY/.test(guarded.stderr), "the guard trips before OPENAI_API_KEY is even read");
}
{
  // Exactly five is the free allowance: the guard admits it, so the next
  // failure is the missing key, not a refusal, and it is reported plainly
  // rather than hunting for another key anywhere else.
  const atLimit = await run(["--sample"]);
  assert.equal(atLimit.code, 1);
  assert.match(atLimit.stdout, /Estimated cost of this run: 5 real call/);
  assert.doesNotMatch(atLimit.stdout, /Refusing to run/);
  assert.match(atLimit.stderr, /Set OPENAI_API_KEY/);
}
{
  // --confirm-paid-run lifts the call-count guard only; it still never spends
  // without a real key, and still never looks for one anywhere else.
  const confirmed = await run(["--limit", "6", "--confirm-paid-run"]);
  assert.equal(confirmed.code, 1);
  assert.doesNotMatch(confirmed.stdout, /Refusing to run/);
  assert.match(confirmed.stderr, /Set OPENAI_API_KEY/);
}
{
  const badTarget = await run(["--mock", "--console", "not-a-console"]);
  assert.equal(badTarget.code, 1);
  assert.match(badTarget.stderr, /No prompts matched/);
}

// ---- the committed prompt set validates under the harness's own rules ------
{
  const libPath = pathToFileURL(join(repoRoot, "apps/web/generated/gen-bench-lib.mjs")).href;
  const lib = await import(libPath);
  const prompts = JSON.parse(await readFile(join(repoRoot, "apps/web/scripts/gen-bench-prompts.json"), "utf8"));
  const problems = lib.validatePromptSet(prompts);
  assert.deepEqual(problems, [], "the committed prompt set: ~50 originals per console, none naming a known work");
  assert.equal(prompts.length, 250);
  for (const console of ["2a03", "dmg", "md", "snes", "c64"])
    assert.ok(prompts.filter((p) => p.console === console).length >= 40, `${console} has too few prompts`);

  // selectPrompts: --console / --sample / --limit compose the way the CLI relies on.
  const md = lib.selectPrompts(prompts, { consoles: ["md"] });
  assert.ok(md.length >= 40 && md.every((p) => p.console === "md"));
  const one = lib.selectPrompts(prompts, { sample: true });
  assert.deepEqual(one.map((p) => p.console), ["2a03", "dmg", "md", "snes", "c64"]);
  const limited = lib.selectPrompts(prompts, { limit: 3 });
  assert.equal(limited.length, 3);

  // guardPaidRun / estimateRunCost: the exact boundary and the two cost sources.
  assert.equal(lib.guardPaidRun(5, false).allowed, true);
  assert.equal(lib.guardPaidRun(6, false).allowed, false);
  assert.equal(lib.guardPaidRun(6, true).allowed, true);
  const fallback = lib.estimateRunCost(10, null);
  assert.equal(fallback.source, "fallback");
  assert.equal(fallback.totalUsd, lib.FALLBACK_COST_PER_CALL_USD * 10);
  const measured = lib.estimateRunCost(10, 0.5);
  assert.equal(measured.source, "measured");
  assert.equal(measured.totalUsd, 5);

  // costFromUsage prices exactly the way admission.ts's budget does: GPT-6
  // Astra is 10 USD/M input, 1 USD/M cached input, 50 USD/M output.
  const usd = lib.costFromUsage("gpt-6-astra", { input_tokens: 10000, output_tokens: 2000, input_tokens_details: { cached_tokens: 4000 } });
  const expected = ((10000 - 4000) * 10 + 4000 * 1 + 2000 * 50) / 1e6;
  assert.ok(Math.abs(usd - expected) < 1e-9);
  assert.equal(lib.costFromUsage("unknown-model-xyz", { input_tokens: 1, output_tokens: 1 }), null);
  assert.equal(lib.costFromUsage("gpt-6-astra", null), null);

  // summarize/percentile/formatSummaryMarkdown/listeningGridCsv on a small fixture.
  const fixture = [
    { id: "a", console: "2a03", durationSeconds: 10, loop: false, mock: true, status: "ok", costUsd: 0.1, timings: { modelMs: 100, renderMs: 200, totalMs: 300 }, findings: [], audio: { path: "audio/a.wav" } },
    { id: "b", console: "2a03", durationSeconds: 10, loop: false, mock: true, status: "ok", costUsd: 0.3, timings: { modelMs: 300, renderMs: 400, totalMs: 700 }, findings: [{ code: "clipping", level: "error" }], audio: { path: "audio/b.wav" } },
    { id: "c", console: "2a03", durationSeconds: 10, loop: false, mock: true, status: "failed", errorCode: "model_error", error: "boom" },
  ];
  const summary = lib.summarize(fixture, "2026-01-01T00:00:00.000Z");
  assert.equal(summary.consoles.length, 1);
  const [c] = summary.consoles;
  assert.equal(c.total, 3); assert.equal(c.succeeded, 2); assert.equal(c.failed, 1);
  assert.equal(c.checks.clipping.applicable, 2); assert.equal(c.checks.clipping.passed, 1); assert.equal(c.checks.clipping.passRate, 0.5);
  assert.equal(c.checks.duration_mismatch.passRate, 1);
  assert.ok(Math.abs(c.meanCostUsd - 0.2) < 1e-9);
  assert.equal(c.latencyMs.model.p50, 100); // percentile() takes ceil(p/100 * n) - 1: index 0 of [100, 300] sorted
  assert.equal(lib.meanCostOf(summary), 0.2);
  assert.match(lib.formatSummaryMarkdown(summary), /## 2a03/);
  const csv = lib.listeningGridCsv(fixture);
  assert.equal(csv.trim().split("\n").length, 3); // header + 2 succeeded (c failed, no audio)
}

console.log("PASS gen-bench: mock run drives the real generation path (model/score/checks, unmodified) with no network and produces results/summary/listening-grid; the >5-real-call guard refuses before any credential is read; the committed 250-prompt set validates; cost pricing matches admission.ts's budget formula");
