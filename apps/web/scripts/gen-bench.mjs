// The generation benchmark (GEN-01, GEN-05): drives the same generation path
// the server uses (`src/lib/composition/{model,score,admission,checks}.ts`,
// unmodified, bundled the way `test-whole-song-checks.mjs` and
// `eval-composition.mjs` already bundle this package's own TS) over the
// committed prompt set (`gen-bench-prompts.json`, about 50 original prompts
// per console), and records latency, usage, cost priced exactly the way the
// monthly budget prices it, the GEN-03 whole-song checks and the rendered
// WAV for each one, plus the known-melody gate's best match on each
// generation (decision 56) and the generated project itself. See
// docs/GENERATION-BENCHMARK.md.
//
// `--mock` swaps in a loopback HTTP server that speaks the same OpenAI
// Responses SSE protocol `model.ts` expects, so the harness itself - and the
// unit tests in test-gen-bench.mjs - never touch the network or spend money.
// Without `--mock`, more than five real model calls are refused unless
// `--confirm-paid-run` is also given (see `guardPaidRun` in
// src/lib/composition/bench.ts); the estimated cost of the requested run is
// printed before anything is sent either way.
import { createServer } from "node:http";
import { appendFile, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { build } from "../../../packages/chipvoice/node_modules/esbuild/lib/main.js";
import { renderProject, toWav, performanceClock } from "chipvoice";

const scriptDir = path.dirname(fileURLToPath(import.meta.url)); // apps/web/scripts
const webDir = path.resolve(scriptDir, "..");                    // apps/web
const repoRoot = path.resolve(webDir, "..", "..");                // repo root
try { process.loadEnvFile(path.join(webDir, ".env.local")); } catch (error) { if (error.code !== "ENOENT") throw error; }

// ---- bundle the production composition modules, unmodified -----------------
// Written to a real file (like eval-composition.mjs's own bundle), not a
// data: URL (like test-whole-song-checks.mjs's): these modules have bare
// "chipvoice"/"@libsql/client" imports (`packages: "external"`), which only
// resolve against a real file's node_modules, not a data: URL's.
const libPath = path.join(webDir, "generated", "gen-bench-lib.mjs");
await build({
  stdin: {
    contents: [
      "export * from './src/lib/composition/model';",
      "export * from './src/lib/composition/score';",
      "export * from './src/lib/composition/admission';",
      "export * from './src/lib/composition/checks';",
      "export * from './src/lib/composition/bench';",
      "export * from './src/lib/composition/similarity';",
    ].join(""),
    resolveDir: webDir,
  },
  bundle: true, platform: "node", format: "esm", packages: "external", outfile: libPath, logLevel: "silent",
});
const lib = await import(pathToFileURL(libPath).href);
const {
  openAIModel, compositionConfig, compositionInstructions, compositionSchema, compositionProject,
  decodeWav, wholeSongChecks,
  selectPrompts, guardPaidRun, estimateRunCost, costFromUsage, summarize, meanCostOf,
  formatSummaryMarkdown, listeningGridCsv, validatePromptSet,
  knownMelodySimilarity, interleaveByConsole, budgetAllows, FALLBACK_COST_PER_CALL_USD,
} = lib;

// ---- CLI ---------------------------------------------------------------
function parseArgs(argv) {
  const args = { mock: false, confirmPaidRun: false, sample: false, consoles: null, limit: undefined, prompts: null, out: null, resume: null, concurrency: 1, maxCostUsd: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--mock") args.mock = true;
    else if (a === "--confirm-paid-run") args.confirmPaidRun = true;
    else if (a === "--sample") args.sample = true;
    else if (a === "--console") args.consoles = argv[++i].split(",").map((s) => s.trim());
    else if (a === "--limit") args.limit = Number(argv[++i]);
    else if (a === "--prompts") args.prompts = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--resume") args.resume = argv[++i];
    else if (a === "--concurrency") args.concurrency = Number(argv[++i]);
    else if (a === "--max-cost-usd") args.maxCostUsd = Number(argv[++i]);
    else throw Error(`Unknown argument: ${a}`);
  }
  return args;
}
const args = parseArgs(process.argv.slice(2));
if (!Number.isInteger(args.concurrency) || args.concurrency < 1 || args.concurrency > 8) {
  console.error("--concurrency takes a whole number from 1 to 8.");
  process.exit(1);
}
if (args.maxCostUsd !== null && !(args.maxCostUsd > 0)) {
  console.error("--max-cost-usd takes a positive number of US dollars.");
  process.exit(1);
}
if (args.resume && args.out) {
  console.error("--resume already names the run directory; drop --out.");
  process.exit(1);
}

const promptsPath = args.prompts ? path.resolve(process.cwd(), args.prompts) : path.join(scriptDir, "gen-bench-prompts.json");
const allPrompts = JSON.parse(await readFile(promptsPath, "utf8"));
const problems = validatePromptSet(allPrompts);
if (problems.length) {
  console.error(`The prompt set at ${promptsPath} has ${problems.length} problem(s):`);
  for (const p of problems.slice(0, 20)) console.error(`  ${p.id}: ${p.message}`);
  process.exit(1);
}

const selected = selectPrompts(allPrompts, { consoles: args.consoles ?? undefined, sample: args.sample, limit: args.limit });
if (!selected.length) { console.error("No prompts matched the requested filters."); process.exit(1); }

// ---- --resume: a run directory's results.jsonl holds every record written
// so far, one line each as it finished. Its rendered records are kept and
// their prompts not sent again; failed ones are retried. A mock run's
// records never stand in for a real run's, nor the other way round.
const outDir = args.resume
  ? path.resolve(process.cwd(), args.resume)
  : args.out ? path.resolve(process.cwd(), args.out) : path.join(repoRoot, ".artifacts", "gen-bench", `${args.mock ? "mock-" : ""}${new Date().toISOString().replace(/[:.]/g, "-")}`);
const done = new Map();
if (args.resume) {
  let lines = [];
  try { lines = (await readFile(path.join(outDir, "results.jsonl"), "utf8")).split("\n").filter(Boolean); }
  catch (error) { console.error(`Cannot resume ${outDir}: ${error.message}`); process.exit(1); }
  for (const line of lines) {
    const record = JSON.parse(line);
    if (record.mock !== args.mock) { console.error(`Cannot resume ${outDir}: it holds ${record.mock ? "mock" : "real"} records.`); process.exit(1); }
    if (record.status === "ok") done.set(record.id, record);
  }
  console.log(`Resuming ${outDir}: ${done.size} rendered record(s) kept.`);
}
const pending = selected.filter((p) => !done.has(p.id));

const plannedRealCalls = args.mock ? 0 : pending.length;

// ---- the spending guard, before any credential is read or call is made ----
async function priorMeanCostUsd() {
  const dir = path.join(repoRoot, ".artifacts", "gen-bench");
  let entries = [];
  try { entries = await readdir(dir); } catch { return null; }
  let latest = null;
  for (const entry of entries) {
    try {
      const summary = JSON.parse(await readFile(path.join(dir, entry, "summary.json"), "utf8"));
      if (summary.mock) continue;
      const mean = meanCostOf(summary);
      if (mean === null) continue;
      if (!latest || summary.generatedAt > latest.generatedAt) latest = summary;
    } catch { /* not a run directory, or an incomplete one */ }
  }
  return latest ? meanCostOf(latest) : null;
}

let perCallEstimateUsd = FALLBACK_COST_PER_CALL_USD;
if (!args.mock) {
  const prior = await priorMeanCostUsd();
  const estimate = estimateRunCost(plannedRealCalls, prior);
  perCallEstimateUsd = estimate.perCallUsd;
  console.log(`Estimated cost of this run: ${plannedRealCalls} real call(s) x $${estimate.perCallUsd.toFixed(4)}/call (${estimate.source}) = $${estimate.totalUsd.toFixed(2)}.`);
  const fullSetEstimate = estimateRunCost(allPrompts.length, prior);
  if (selected.length < allPrompts.length)
    console.log(`Extrapolated cost of the full ${allPrompts.length}-prompt set at the same per-call rate: $${fullSetEstimate.totalUsd.toFixed(2)} (${fullSetEstimate.source}).`);
  const guard = guardPaidRun(plannedRealCalls, args.confirmPaidRun);
  if (!guard.allowed) {
    console.error(`Refusing to run: ${guard.reason}. Pass --confirm-paid-run to proceed, or --mock to run without spending anything.`);
    process.exit(1);
  }
  if (args.maxCostUsd !== null) console.log(`Spending cap: no new call once this invocation would pass $${args.maxCostUsd.toFixed(2)}.`);
}

// ---- the model: a loopback mock, or the real adapter -----------------------
async function makeMockModel() {
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const seconds = Number(body.instructions.match(/Duration is exactly (\d+)/)[1]);
    const score = syntheticScore(seconds, body.input);
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.write(`data: ${JSON.stringify({ type: "response.output_text.delta", delta: JSON.stringify(score) })}\n\n`);
    // Deterministic, prompt-length-derived usage so a mock run still exercises
    // varied, non-degenerate cost/latency statistics without any real call.
    const inputTokens = 6500 + (body.input.length % 800);
    const outputTokens = 3500 + ((body.input.length * 7) % 1500);
    response.end(`data: ${JSON.stringify({
      type: "response.completed",
      response: {
        status: "completed", model: body.model,
        usage: { input_tokens: inputTokens, output_tokens: outputTokens, input_tokens_details: { cached_tokens: 0 }, total_tokens: inputTokens + outputTokens },
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(score) }] }],
      },
    })}\n\n`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const config = { apiKey: "mock-key", maxTokens: 24000, endpoint: `http://127.0.0.1:${port}/v1/responses`, model: process.env.OPENAI_MODEL?.trim() || "gpt-6-astra" };
  return { model: openAIModel(config), config, close: () => new Promise((resolve) => server.close(resolve)) };
}
// A flat, unpatterned "score" (see score.ts's expandScore: anything that does
// not match the patterned transport schema passes through unchanged), well
// inside every target's voice budget: one monophonic lead and a half-time
// bass, exactly filling the requested duration. Proves the harness's
// compose/project/validate/render path end to end without claiming to be music.
function syntheticScore(seconds, prompt) {
  const bpm = 120, step = 480, endTick = Math.round(seconds * bpm * 8);
  const pitches = [60, 64, 67, 65];
  const lead = [], bass = [];
  for (let tick = 0, i = 0; tick + step <= endTick; tick += step, i++)
    lead.push({ tick, endTick: tick + Math.round(step * 0.8), pitch: pitches[i % 4], velocity: 90, drum: null });
  if (!lead.length) lead.push({ tick: 0, endTick: Math.min(endTick, step), pitch: 60, velocity: 90, drum: null });
  for (let tick = 0, i = 0; tick + step * 2 <= endTick; tick += step * 2, i++)
    bass.push({ tick, endTick: tick + step, pitch: pitches[i % 4] - 24, velocity: 70, drum: null });
  return {
    title: `Gen-bench mock (${prompt.slice(0, 40)})`.slice(0, 160),
    description: "Synthetic mock response for the generation benchmark's harness tests; not a real model composition.",
    bpm,
    parts: [
      { name: "Lead", role: "lead", program: 80, priority: 100, importance: 1, notes: lead },
      ...(bass.length ? [{ name: "Bass", role: "bass", program: 38, priority: 80, importance: 0.5, notes: bass }] : []),
    ],
  };
}

let model, mockServer, config;
if (args.mock) {
  ({ model, config, close: mockServer } = await makeMockModel());
} else {
  try {
    config = compositionConfig(); // throws without OPENAI_API_KEY; no other key is ever tried
  } catch (error) {
    console.error(`Cannot start a real run: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
  model = openAIModel(config);
}

// ---- run every selected prompt ---------------------------------------------
await mkdir(path.join(outDir, "audio"), { recursive: true });
await mkdir(path.join(outDir, "projects"), { recursive: true });
// A fresh run (not --resume) starts its own results.jsonl, even in a reused --out directory.
if (!args.resume) await writeFile(path.join(outDir, "results.jsonl"), "");

async function runOne(prompt) {
  const request = { prompt: prompt.prompt, target: prompt.console, durationSeconds: prompt.durationSeconds, loop: prompt.loop, visibility: "private" };
  const record = { id: prompt.id, console: prompt.console, prompt: prompt.prompt, durationSeconds: prompt.durationSeconds, loop: prompt.loop, mock: args.mock, status: "ok" };
  const t0 = performance.now();
  let modelMs = null, renderMs = null;
  try {
    const instructions = compositionInstructions(request);
    const modelStart = performance.now();
    const result = await model.generate({ instructions, prompt: request.prompt, schema: compositionSchema, signal: AbortSignal.timeout(210000) });
    modelMs = performance.now() - modelStart;
    record.model = result.model;
    record.usage = result.usage;
    record.costUsd = costFromUsage(result.model, result.usage);

    const project = compositionProject(result.value, request);
    // Decision 56's gate, measured the way jobs.ts measures it in production.
    const melodicParts = project.source.kind === "performance" ? project.source.performance.parts : [];
    const melodyMatch = knownMelodySimilarity(melodicParts);
    record.melody = melodyMatch ? { similarity: melodyMatch.similarity, referenceId: melodyMatch.referenceId, part: melodyMatch.part } : null;
    const projectJson = JSON.stringify(project);
    const projectPath = path.join("projects", `${prompt.id}.json`);
    await writeFile(path.join(outDir, projectPath), projectJson);
    record.project = { path: projectPath, sha256: createHash("sha256").update(projectJson).digest("hex") };

    const renderStart = performance.now();
    const rendered = renderProject(project, {});
    const wav = toWav(rendered.audio);
    renderMs = performance.now() - renderStart;

    const audio = decodeWav(wav);
    let parts;
    if (project.source.kind === "performance") {
      const clock = performanceClock(project.source.performance);
      parts = project.source.performance.parts.map((part) => ({ id: part.id, ranges: part.notes.map((note) => [clock(note.tick), clock(note.endTick)]) }));
    }
    record.findings = wholeSongChecks(audio, { durationSeconds: request.durationSeconds, loop: request.loop, ...(parts ? { parts } : {}) });

    const audioPath = path.join("audio", `${prompt.id}.wav`);
    await writeFile(path.join(outDir, audioPath), Buffer.from(wav));
    record.audio = { path: audioPath, seconds: audio.left.length / audio.sampleRate, sha256: createHash("sha256").update(wav).digest("hex") };
  } catch (error) {
    record.status = "failed";
    record.errorCode = error?.code ?? error?.name ?? "bench_error";
    record.error = error instanceof Error ? error.message : String(error);
  }
  record.timings = { modelMs: modelMs ?? 0, renderMs: renderMs ?? 0, totalMs: performance.now() - t0 };
  return record;
}

// `--concurrency` workers take the pending prompts one console at a time in
// turn (`interleaveByConsole`), so a run that stops early still covers every
// console. Each record is appended to results.jsonl the moment it finishes,
// so a crash or an interrupted paid run keeps every generation already paid
// for, and `--resume` picks up from there. `--max-cost-usd` stops handing out
// new prompts once one more call could pass the cap.
const byId = new Map(done);
const queue = interleaveByConsole(pending);
// A failed call has no usage to price but may still have been billed: it counts
// against the cap at the per-call rate, and stays out of the run's mean.
let next = 0, inFlight = 0, spentUsd = 0, pricedCalls = 0, unpricedUsd = 0, capped = false;
async function worker() {
  while (next < queue.length) {
    const perCallUsd = pricedCalls ? spentUsd / pricedCalls : perCallEstimateUsd;
    if (!budgetAllows(spentUsd + unpricedUsd, inFlight, perCallUsd, args.maxCostUsd)) { capped = true; return; }
    const prompt = queue[next++];
    inFlight++;
    const record = await runOne(prompt);
    inFlight--;
    if (typeof record.costUsd === "number") { spentUsd += record.costUsd; pricedCalls++; }
    else if (!args.mock) unpricedUsd += pricedCalls ? spentUsd / pricedCalls : perCallEstimateUsd;
    byId.set(record.id, record);
    await appendFile(path.join(outDir, "results.jsonl"), `${JSON.stringify(record)}\n`);
    const cost = record.costUsd !== null && record.costUsd !== undefined ? ` $${record.costUsd.toFixed(4)}` : "";
    const melody = record.melody ? `, melody ${record.melody.similarity.toFixed(3)}` : "";
    console.log(`${record.status === "ok" ? "ok  " : "FAIL"} ${record.id} (${record.console}, ${record.durationSeconds}s${record.loop ? ", loop" : ""})${cost} ${record.status === "failed" ? `- ${record.errorCode}: ${record.error}` : `- ${(record.findings ?? []).length} finding(s)${melody}`}`);
  }
}
await Promise.all(Array.from({ length: Math.min(args.concurrency, pending.length) }, worker));
if (mockServer) await mockServer();
if (capped) console.log(`Stopped at the spending cap: $${spentUsd.toFixed(2)} priced${unpricedUsd ? ` (plus up to $${unpricedUsd.toFixed(2)} for failed calls)` : ""}, ${queue.length - next} prompt(s) not sent. Continue with --resume ${outDir}.`);
const records = selected.map((p) => byId.get(p.id)).filter(Boolean);

// ---- write the results -----------------------------------------------------
const summary = summarize(records);
await writeFile(path.join(outDir, "results.json"), JSON.stringify(records, null, 2));
await writeFile(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
await writeFile(path.join(outDir, "summary.md"), formatSummaryMarkdown(summary));
await writeFile(path.join(outDir, "listening-grid.csv"), listeningGridCsv(records));

console.log(`\nWrote ${records.length} record(s) to ${outDir}`);
if (!args.mock) {
  const mean = meanCostOf(summary);
  if (mean !== null) {
    console.log(`Measured mean cost: $${mean.toFixed(4)}/generation.`);
    const fullEstimate = estimateRunCost(allPrompts.length, mean);
    console.log(`Extrapolated cost of the full ${allPrompts.length}-prompt set: $${fullEstimate.totalUsd.toFixed(2)} (measured).`);
  }
}
if (records.some((r) => r.status === "failed")) process.exitCode = 1;
