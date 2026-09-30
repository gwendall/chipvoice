// Decision 56 (NEXT-21): builds a realistic negative set for the
// known-melody gate from real, redistribution-licensed chiptunes already
// committed to the repo, and reports each song's strongest match against
// the reference set - the report the coordinator's review asked for before
// trusting KNOWN_MELODY_THRESHOLD to refuse a paid generation.
//
// The calibration set `test-known-melody-similarity.mjs` used until now
// paired the repository's own three tiny original fixtures with 20
// seeded-random tunes. Random tunes are the easy case: no repetition, no
// stepwise motion, no long parts. Real music is where a melodic-similarity
// gate is actually at risk of a false positive, and a false positive here
// happens AFTER the paid model call, so the user pays and gets refused.
//
// The corpus: every real (non-probe) song in `scores/nsf-corpus` - eight
// independently authored, CC0/CC-BY/zlib-licensed NES chiptunes (three of
// them explicitly named "loop" - short, repetitive material, the hardest
// case) - captured through the same offline 6502
// (`scores/capture-nsf.mjs`) and the same musical observer
// (`scores/extract-nsf-performance.mjs`) the NSF corpus's own native-command
// parity suite already uses, run far enough (12,000 PLAY frames, 200
// seconds) to cover each short loop several times over. `vrc6-probe` and
// `sunsoft5b-probe` are excluded: hand-assembled hardware-coverage test
// signals, not real music, per `scores/nsf-corpus/sources.json`'s own
// description of them.
//
// The second negative set is real generations: the generation benchmark's
// full run (docs/GENERATION-BENCHMARK.md), whose prompts all ask for
// original music. `--gen-bench <run-dir>` reads a run's `results.jsonl` and
// `projects/`, keeps each rendered generation's pitched notes (tick and
// pitch, percussion dropped exactly as `knownMelodySimilarity` drops it,
// each note stored as its tick and pitch minus the previous note's in the
// same part, which gzips about four times smaller than absolute values),
// and writes them to `test/melody-negatives-gen-bench.json.gz`, which
// `test-known-melody-similarity.mjs` scores in CI. The report below covers
// both sets.
//
// Usage: node scripts/melody-negative-corpus.mjs [--gen-bench run-dir] [--json out.json]
import { readFile, writeFile } from "node:fs/promises";
import { gunzipSync, gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "../../../packages/chipvoice/node_modules/esbuild/lib/main.js";
import { captureNsf } from "../../../scores/capture-nsf.mjs";
import { nsfPerformance } from "../../../scores/extract-nsf-performance.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(HERE, "..");
const REPO_ROOT = path.resolve(WEB_ROOT, "..", "..");
const NSF_DIR = path.join(REPO_ROOT, "scores", "nsf-corpus");
export const GEN_BENCH_FIXTURE = path.join(WEB_ROOT, "test", "melody-negatives-gen-bench.json.gz");

async function loadSimilarity() {
  const built = await build({
    entryPoints: [path.join(WEB_ROOT, "src/lib/composition/similarity.ts")],
    bundle: true, platform: "node", format: "esm", write: false,
  });
  const module = await import("data:text/javascript;base64," + Buffer.from(built.outputFiles[0].text).toString("base64"));
  const builtMelodies = await build({
    entryPoints: [path.join(WEB_ROOT, "src/lib/composition/known-melodies.ts")],
    bundle: true, platform: "node", format: "esm", write: false,
  });
  const melodies = await import("data:text/javascript;base64," + Buffer.from(builtMelodies.outputFiles[0].text).toString("base64"));
  return { ...module, KNOWN_MELODIES: melodies.KNOWN_MELODIES };
}

/** Every real (non-probe) song in the NSF corpus, converted to the
 * melodic-part shape `similarity.ts` measures: non-percussion parts, one
 * `{tick, pitch}` per note (percussion is dropped by role or drum tag
 * inside `knownMelodySimilarity` itself, same as production). */
export async function extractNsfCorpusSongs() {
  const sources = JSON.parse(await readFile(path.join(NSF_DIR, "sources.json"), "utf8"));
  const songs = [];
  for (const [id, spec] of Object.entries(sources)) {
    if (id.endsWith("-probe")) continue; // hand-assembled hardware coverage, not real music
    const bytes = await readFile(path.join(NSF_DIR, "files", spec.file));
    const capture = captureNsf(bytes, { frames: 12000, track: spec.track ?? 0 });
    const { score } = nsfPerformance(capture, {
      title: spec.title, endFrame: capture.calls.length - 1, loopFrame: 0,
      source: { kind: "nsf-corpus", id, url: spec.url, licence: spec.licence, author: spec.author },
    });
    songs.push({
      id, title: spec.title, author: spec.author, url: spec.url, licence: spec.licence,
      parts: score.parts.map((part) => ({ id: part.id, role: part.role, notes: part.notes.map((note) => ({ tick: note.tick, pitch: note.pitch, drum: note.drum ?? null })) })),
    });
  }
  return songs;
}

/** A generation benchmark run's rendered generations, as the fixture stores
 * them: `{id, console, parts: [{id, role, notes: [[dTick, dPitch], ...]}]}`
 * (each note relative to the previous one in its part, the first to 0), in
 * the prompt set's file order. Failed records have no score to measure. */
export async function genBenchNegatives(runDir) {
  const lines = (await readFile(path.join(runDir, "results.jsonl"), "utf8")).trim().split("\n");
  const byId = new Map();
  for (const line of lines) {
    const record = JSON.parse(line);
    if (record.status === "ok" && record.project) byId.set(record.id, record);
  }
  const prompts = JSON.parse(await readFile(path.join(HERE, "gen-bench-prompts.json"), "utf8"));
  const generations = [];
  for (const prompt of prompts) {
    const record = byId.get(prompt.id);
    if (!record) continue;
    const project = JSON.parse(await readFile(path.join(runDir, record.project.path), "utf8"));
    const parts = project.source.kind === "performance" ? project.source.performance.parts : [];
    generations.push({
      id: record.id, console: record.console,
      parts: parts.filter((part) => part.role !== "perc").map((part) => ({
        id: part.id, role: part.role,
        notes: deltas(part.notes.filter((note) => note.drum == null).map((note) => [note.tick, note.pitch])),
      })),
    });
  }
  return generations;
}

function deltas(notes) {
  let tick = 0, pitch = 0;
  return notes.map(([t, p]) => { const d = [t - tick, p - pitch]; tick = t; pitch = p; return d; });
}

/** The committed fixture, in the melodic-part shape `similarity.ts` takes. */
export async function readGenBenchFixture(file = GEN_BENCH_FIXTURE) {
  const fixture = JSON.parse(gunzipSync(await readFile(file)).toString("utf8"));
  return fixture.generations.map((generation) => ({
    ...generation,
    parts: generation.parts.map((part) => {
      let tick = 0, pitch = 0;
      return { ...part, notes: part.notes.map(([dTick, dPitch]) => ({ tick: (tick += dTick), pitch: (pitch += dPitch) })) };
    }),
  }));
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function report(label, items, { knownMelodySimilarity, KNOWN_MELODY_THRESHOLD }, { perItem }) {
  const results = items.map((item) => {
    const match = knownMelodySimilarity(item.parts);
    return { id: item.id, similarity: match?.similarity ?? 0, matchedReference: match?.referenceId ?? null };
  });
  const sortedSims = results.map((r) => r.similarity).sort((a, b) => a - b);
  const p50 = percentile(sortedSims, 50), p95 = percentile(sortedSims, 95), max = sortedSims.at(-1) ?? 0;
  const falsePositives = results.filter((r) => r.similarity >= KNOWN_MELODY_THRESHOLD);
  console.log(`${label}: ${items.length}`);
  if (perItem) for (const r of results) console.log(`  ${r.id}: similarity=${r.similarity.toFixed(3)} best-match=${r.matchedReference}`);
  console.log(`  p50=${p50.toFixed(3)} p95=${p95.toFixed(3)} max=${max.toFixed(3)}`);
  console.log(`  False positives at ${KNOWN_MELODY_THRESHOLD}: ${falsePositives.length} (${falsePositives.map((r) => r.id).join(", ") || "none"})`);
  return { results, p50, p95, max };
}

async function main() {
  const similarity = await loadSimilarity();
  const argValue = (flag) => (process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] : null);
  const runDir = argValue("--gen-bench");
  if (runDir) {
    const generations = await genBenchNegatives(path.resolve(runDir));
    const fixture = { source: `generation benchmark run ${path.basename(path.resolve(runDir))}, rendered generations only, pitched notes as [dTick, dPitch] from the previous note in the part`, generations };
    await writeFile(GEN_BENCH_FIXTURE, gzipSync(JSON.stringify(fixture), { level: 9 }));
    console.log(`Wrote ${generations.length} generations to ${path.relative(REPO_ROOT, GEN_BENCH_FIXTURE)}.`);
  }
  const songs = await extractNsfCorpusSongs();
  const nsf = report(`Real NSF-corpus songs (${songs.map((s) => s.id).join(", ")})`, songs, similarity, { perItem: true });
  const generations = await readGenBenchFixture();
  const genBench = report("Real generations (generation benchmark)", generations, similarity, { perItem: false });
  const jsonPath = argValue("--json");
  if (jsonPath) await writeFile(jsonPath, JSON.stringify({ nsf, genBench }, null, 2) + "\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
