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
// Usage: node scripts/melody-negative-corpus.mjs [--json out.json]
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "../../../packages/chipvoice/node_modules/esbuild/lib/main.js";
import { captureNsf } from "../../../scores/capture-nsf.mjs";
import { nsfPerformance } from "../../../scores/extract-nsf-performance.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(HERE, "..");
const REPO_ROOT = path.resolve(WEB_ROOT, "..", "..");
const NSF_DIR = path.join(REPO_ROOT, "scores", "nsf-corpus");

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

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

async function main() {
  const { knownMelodySimilarity, KNOWN_MELODY_THRESHOLD } = await loadSimilarity();
  const songs = await extractNsfCorpusSongs();
  const results = songs.map((song) => {
    const match = knownMelodySimilarity(song.parts);
    return { id: song.id, title: song.title, similarity: match?.similarity ?? 0, matchedReference: match?.referenceId ?? null };
  });
  const sortedSims = results.map((r) => r.similarity).sort((a, b) => a - b);
  const p50 = percentile(sortedSims, 50), p95 = percentile(sortedSims, 95), max = sortedSims.at(-1) ?? 0;
  const falsePositives = results.filter((r) => r.similarity >= KNOWN_MELODY_THRESHOLD);
  console.log(`Extracted ${songs.length} real NSF-corpus songs (${songs.map((s) => s.id).join(", ")}).`);
  for (const r of results) console.log(`  ${r.id}: similarity=${r.similarity.toFixed(3)} best-match=${r.matchedReference}`);
  console.log(`p50=${p50.toFixed(3)} p95=${p95.toFixed(3)} max=${max.toFixed(3)}`);
  console.log(`False positives at ${KNOWN_MELODY_THRESHOLD}: ${falsePositives.length} (${falsePositives.map((r) => r.id).join(", ") || "none"})`);
  const jsonPath = process.argv.includes("--json") ? process.argv[process.argv.indexOf("--json") + 1] : null;
  if (jsonPath) await (await import("node:fs/promises")).writeFile(jsonPath, JSON.stringify({ results, p50, p95, max }, null, 2) + "\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
