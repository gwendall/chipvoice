#!/usr/bin/env node
// Builds apps/sounds/generated/catalog.json: renders every chipvoice recipe
// and runs every variant through the same trim/level/encode/measure pipeline
// (scripts/lib/audio.mjs). gamesounds is our own sound bank - every sound is
// made procedurally by chipvoice itself, no third-party sounds and no
// external generation API (see docs/DECISIONS.md, decision 50) - so this
// build never touches the network and never depends on anything being up
// outside this repo.
//
// Usage:
//   node scripts/build-catalog.mjs            builds and writes generated/catalog.json
//   node scripts/build-catalog.mjs --out path  writes elsewhere instead (used by
//     scripts/check-determinism.mjs, which rebuilds the catalogue fresh and
//     checks its WAV hashes against the committed catalog.json, rather than
//     trusting that ffmpeg on today's machine reproduces yesterday's bytes -
//     a fresh build must never clobber the committed file it is checking
//     against).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { chipvoiceGroups, VARIANTS_PER_GROUP } from "../catalog/chipvoice-recipes.mjs";
import { generatedGroups, VARIANTS_PER_GROUP as GENERATED_VARIANTS_PER_GROUP } from "../catalog/generated-recipes.mjs";
import {
  decodeToRender,
  trimToZeroCrossing,
  levelToConvention,
  encodeVariant,
  computePeaks,
  sha256Hex,
  toWavBytes,
  peakOf,
  energyPerChannel,
} from "./lib/audio.mjs";
import { checkSound, collectFormatEnergyDeltas, FORMAT_ENERGY_TOLERANCE_DB } from "./lib/checks.mjs";

// Presets excluded from the generated half, with why - see this file's
// buildGenerated(). Each reason is a measured judgment, not a guess: decode
// the shipped ogg/mp3 back to PCM and compare its total energy (the sum of
// each sample squared, not a mean - see energyPerChannel in scripts/lib/
// audio.mjs for why) against the source wav's, per channel (scripts/lib/checks.mjs's
// checkFormatEnergies/FORMAT_ENERGY_TOLERANCE_DB is the same measurement the
// build gate itself runs on every other variant). These three lose real
// energy - not the harmless peak-only "transient smearing" a first pass
// wrongly assumed - because most of their own synthesized content sits above
// ~16 kHz, inside the range both ffmpeg's native vorbis encoder and
// libmp3lame filter away at this catalogue's quality settings. A follow-up
// ticket (docs/BACKLOG.md, GS-05) tracks finding why sfx-engine's modal
// synthesis puts energy there and fixing it at the source; tuning the engine
// itself is out of scope for this ticket (decision 52, decision 54).
const EXCLUDED_PRESETS = {
  "pickup-key": "97.4% of the source wav's own energy sits above 16 kHz (steep highpass measurement); the shipped ogg/mp3 lose 13.2 to 18.2 dB of real (summed) energy against the wav across the seed ladder, far outside FORMAT_ENERGY_TOLERANCE_DB - a codec passband loss, not transient smearing",
  "impact-glass-light": "77.6% of the source wav's own energy sits above 16 kHz; the shipped ogg/mp3 lose 6.1 to 6.9 dB of real (summed) energy against the wav across the seed ladder, outside FORMAT_ENERGY_TOLERANCE_DB - a codec passband loss, not transient smearing",
  "footstep-metal": "31.0% of the source wav's own energy sits above 16 kHz; the shipped ogg/mp3 lose 2.2 to 15.6 dB of real (summed) energy against the wav across the seed ladder - every one of the eight candidate seeds exceeds FORMAT_ENERGY_TOLERANCE_DB, not only the worst ones - a codec passband loss, not transient smearing",
};

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
// Served by Next.js as a static file with no extra route: content-addressed,
// immutable (decision 40's `/f/<sha256>.<ext>` pattern), so it is safe to
// cache forever once the site sets that header for this path (vercel.json).
const outAudioDir = join(root, "public", "f");
const catalogPath = join(root, "generated", "catalog.json");
const taxonomyPath = join(root, "catalog", "taxonomy.json");

const argv = process.argv.slice(2);
function flagValue(name) {
  const i = argv.indexOf(name);
  return i === -1 ? null : (argv[i + 1] ?? null);
}
const outPath = flagValue("--out");

function log(...m) { console.log("[build-catalog]", ...m); }

const CATEGORY_TITLES = JSON.parse(readFileSync(taxonomyPath, "utf8")).categories.reduce((acc, c) => ((acc[c.id] = c.title), acc), {});

function describeChipvoice(eventDescription, chip, style) {
  const chipName = { "2a03": "NES", dmg: "Game Boy", md: "Sega Mega Drive", snes: "Super Nintendo", c64: "Commodore 64" }[chip] ?? chip;
  return `${eventDescription} Rendered on real ${chipName} (${style}) chip emulation by chipvoice.`;
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function uniqueId(base, used) {
  if (!used.has(base)) { used.add(base); return base; }
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) { used.add(candidate); return candidate; }
  }
}

/**
 * Runs one raw audio buffer through the shared trim/level/encode/measure
 * pipeline. Returns the `Variant` record that goes into the catalogue
 * alongside `checkData` - the leveled PCM and its own shipped WAV bytes,
 * keyed later by this variant's own sha256 so `checkSound` (scripts/lib/checks.mjs)
 * can run the sha256, clipping and leading-silence checks on the actual
 * shipped signal, not just the metadata that describes it.
 */
function processVariant(render, n) {
  const trimmed = trimToZeroCrossing(render);
  const leveled = levelToConvention(trimmed);
  const encoded = encodeVariant(leveled, outAudioDir, { mkdirSync });
  const peaks = computePeaks(leveled);
  const toEntry = (f) => ({ sha256: f.sha256, bytes: f.bytes, url: `/f/${f.name}` });
  return {
    variant: {
      n,
      sha256: encoded.sha256,
      duration: Math.round(encoded.duration * 1000) / 1000,
      files: { ogg: toEntry(encoded.files.ogg), mp3: toEntry(encoded.files.mp3), wav: toEntry(encoded.files.wav) },
      // Checked per variant (docs/GAMESOUNDS.md's loudness section, checks.mjs's
      // checkLoudnessBand) - not just on variant 1, which is what shipped
      // before this field existed here.
      measure: encoded.measure,
      peaks,
    },
    checkData: {
      bytes: toWavBytes(leveled),
      peakLinear: leveled.peak,
      left: leveled.left,
      right: leveled.right,
      sampleRate: leveled.sampleRate,
      // All three decoded back from the actually-shipped ogg/mp3 bytes by
      // encodeVariant itself (scripts/lib/audio.mjs). formatEnergy is what
      // checkSound's checkFormatEnergies gates on for LOUDNESS (total energy -
      // the sum of each sample squared - per channel) - the class of bug a
      // missing libvorbis fallback's old `-ac 2` upmix caused shows up here
      // as an exact -3.01 dB delta. formatFrames (GS-07) is what
      // checkSound's checkFormatLengths gates on for LENGTH - the native
      // fallback ogg encoder was found to drop its own entire final
      // 1024-sample block for a band of input lengths, invisible to the
      // energy gate because the lost tail was always a quiet decay (see
      // docs/DECISIONS.md's amendment to decision 54).
      // formatPeaks is kept only as informational build-log data
      // (collectFormatPeakDeltas) - see checks.mjs's own header for why peak
      // was retired as a gate.
      formatPeaks: encoded.formatPeaks,
      formatEnergy: encoded.formatEnergy,
      formatFrames: encoded.formatFrames,
    },
  };
}

/**
 * Renders a group's own candidate ladder (chipvoice-recipes.mjs's
 * `groupCandidates`) in order and keeps the first `VARIANTS_PER_GROUP` that
 * are both audible and byte-distinct from every take already kept for this
 * group, renumbered 1..k. A candidate is skipped, never accepted, when it is
 * silent (`peakLinear === 0` - a real failure mode seen on a Game Boy noise
 * take at a large nudge) or byte-identical to an earlier accepted take (some
 * chip+role combinations render the same bytes for more than one nearby
 * nudge - verified per chip against the real renderer, not assumed). Most
 * groups accept their first `VARIANTS_PER_GROUP` candidates outright, since
 * chipvoice-recipes.mjs orders the ladder to make that the common case; the
 * rest of the ladder exists for the chip/role combinations coarse enough
 * quantization (a clamped noise period, a 60Hz-rounded duration) that a
 * single fixed nudge cannot guarantee past. Shipping only the real, distinct
 * takes reached this way is honest; padding out to `VARIANTS_PER_GROUP` with
 * a fake or silent copy is not. Two DIFFERENT sounds sharing a variant's
 * bytes (a chip's fixed click reused by two events) is left alone: that is
 * content-addressed storage doing its job, not a duplicate-variant defect -
 * see docs/DECISIONS.md.
 */
function renderGroupVariants(candidates, renderSfx, variantChecks) {
  const variants = [];
  const seen = new Set();
  let dropped = 0;
  for (const candidate of candidates) {
    if (variants.length >= VARIANTS_PER_GROUP) break;
    const { variant, checkData } = processVariant(renderSfx(candidate.recipe.chip, candidate.recipe), variants.length + 1);
    if (checkData.peakLinear === 0 || seen.has(variant.sha256)) { dropped++; continue; }
    seen.add(variant.sha256);
    variants.push(variant);
    variantChecks[variant.sha256] = checkData;
  }
  renderGroupVariants.dropped = (renderGroupVariants.dropped ?? 0) + dropped;
  return variants;
}

function assembleSound({ id, category, style, tags, title, description, license, attribution, source, origin, recipe, variantResults }) {
  // Sound.measure is variant 1's own measure, kept as a quick summary (list
  // views, sorting) - the binding loudness check runs on every variant's
  // OWN measure (checkSound, below), not on this field. Every variant keeps
  // its own `measure` in `variants` too (Variant.measure) - it used to be
  // stripped here, which is why only variant 1 was ever actually checked.
  const measure = { lufs: variantResults[0].measure.lufs, peakDb: variantResults[0].measure.peakDb, duration: variantResults[0].duration };
  return {
    id, category, style, tags, title, description, license, attribution, source, origin,
    ...(recipe !== undefined ? { recipe } : {}),
    loop: null,
    variants: variantResults,
    measure,
    rank: { score: 0, votes: 0, auditions: 0, kept: 0, replaced: 0 },
  };
}

/**
 * Honest, per-preset description: the preset's own one-line summary (from
 * sfx-engine's own PRESETS registry, not re-typed here so it can never drift
 * from the engine's own words), then how it was made, naming the actual
 * synthesis technique (catalog/generated-recipes.mjs's own `technique`
 * field) and this preset's own defining param values - never "made by AI"
 * or any third-party/black-box language, since there is no such thing here
 * (docs/DECISIONS.md, decision 50).
 */
function describeGenerated(entry, presetDescription, params) {
  const values = Object.values(params).filter((v) => typeof v === "string" || typeof v === "number");
  const paramText = values.length ? `, ${values.join(", ")}` : "";
  return `${presetDescription} Synthesized by gamesounds' own procedural engine (sfx-engine, ${entry.technique}${paramText}).`;
}

/**
 * The generated-origin analogue of renderGroupVariants: renders one preset's
 * seed ladder (catalog/generated-recipes.mjs's `generatedGroups`) in order
 * and keeps the first VARIANTS_PER_GROUP takes that are audible and
 * byte-distinct, exactly like the chipvoice half.
 *
 * sfx-engine's own `renderRecipe` already normalizes loudness and pans to
 * stereo internally, but to its OWN convention, measured on the pre-pan mono
 * signal (packages/sfx-engine/src/render/renderRecipe.ts) - that internal
 * figure is never trusted here. The catalogue ships this half mono, same as
 * the chipvoice half (measured directly against the committed catalog.json:
 * every one of its 880 existing variants is mono - packages/chipvoice's own
 * renderSfx is never called with `stereo: true` - so "stereo dual-mono like
 * the rest of the catalogue" would in fact be the one inconsistent choice).
 * At pan 0 (every preset's only pan value), sfx-engine's equal-power pan law
 * makes `left` and `right` identical and loudness-equivalent to a true mono
 * signal, so `left` alone is taken as this variant's raw PCM and run through
 * the SAME trim/level/encode/measure pipeline as chipvoice - `levelToConvention`
 * re-measures whatever bytes it is actually given, so it is correct
 * regardless of what convention produced them. See
 * test/generated-loudness.test.mjs for the test proving this (and the
 * negative case: trusting the engine's own pre-pan mono figure instead of
 * re-measuring the actual shipped bytes).
 */
function renderGeneratedVariants(candidates, renderRecipeFn, variantChecks) {
  const variants = [];
  const seen = new Set();
  let dropped = 0;
  for (const candidate of candidates) {
    if (variants.length >= GENERATED_VARIANTS_PER_GROUP) break;
    const rendered = renderRecipeFn(candidate.recipe);
    const left = Float32Array.from(rendered.left);
    const render = { sampleRate: rendered.sampleRate, left, right: null, seconds: rendered.durationSeconds, peak: peakOf(left, null) };
    const { variant, checkData } = processVariant(render, variants.length + 1);
    if (checkData.peakLinear === 0 || seen.has(variant.sha256)) { dropped++; continue; }
    seen.add(variant.sha256);
    // Recorded per variant (not just at Sound level) since each variant's
    // seed differs - anyone can re-render this exact take bit-exactly from
    // its own recipe (packages/gamesounds/src/types.ts's Variant.recipe).
    variant.recipe = candidate.recipe;
    variants.push(variant);
    variantChecks[variant.sha256] = checkData;
  }
  renderGeneratedVariants.dropped = (renderGeneratedVariants.dropped ?? 0) + dropped;
  return variants;
}

/**
 * Renders every generated-origin sound (catalog/generated-recipes.mjs's
 * GENERATED_MAP): sfx-engine's own presets, seeded per variant, run through
 * the shared trim/level/encode/measure pipeline. Excludes and reports (never
 * silently drops) a preset named in EXCLUDED_PRESETS or one whose seed
 * ladder yields no surviving variant at all.
 */
async function buildGenerated(variantChecks) {
  const sfxEngineDist = join(root, "..", "..", "packages", "sfx-engine", "dist", "index.js");
  const { renderRecipe, recipeForPreset, getPreset } = await import(sfxEngineDist);
  const groups = generatedGroups(recipeForPreset);
  const sounds = [];
  const excluded = [];
  const usedIds = new Set();
  for (const { entry, candidates } of groups) {
    if (EXCLUDED_PRESETS[entry.preset]) {
      excluded.push({ preset: entry.preset, reason: EXCLUDED_PRESETS[entry.preset] });
      continue;
    }
    const variants = renderGeneratedVariants(candidates, renderRecipe, variantChecks);
    if (variants.length === 0) {
      excluded.push({ preset: entry.preset, reason: "no seed in its ladder rendered an audible, byte-distinct take" });
      continue;
    }
    const preset = getPreset(entry.preset);
    const id = uniqueId(`${slugify(entry.category)}-${entry.style}-${entry.preset}`, usedIds);
    sounds.push(assembleSound({
      id, category: entry.category, style: entry.style, tags: entry.tags, title: entry.title,
      description: describeGenerated(entry, preset.description, preset.params),
      license: "CC0-1.0", attribution: null,
      source: { name: "gamesounds sfx-engine", url: "https://gamesounds.ai", author: "Gwendall Esnault (https://gwendall.com)", pack: preset.model },
      origin: "generated", recipe: variants[0].recipe, variantResults: variants,
    }));
  }
  return { sounds, excluded };
}

async function buildChipvoice(variantChecks) {
  const chipvoiceDist = join(root, "..", "..", "packages", "chipvoice", "dist", "index.js");
  const { instrumentsFor, renderSfx } = await import(chipvoiceDist);
  const groups = chipvoiceGroups(instrumentsFor);
  const sounds = [];
  const usedIds = new Set();
  for (const { event, chip, candidates } of groups) {
    const variantResults = renderGroupVariants(candidates, renderSfx, variantChecks);
    const style = candidates[0].style;
    const id = uniqueId(`${slugify(event.category)}-${style}-${chip}`, usedIds);
    sounds.push(assembleSound({
      id, category: event.category, style, tags: event.tags, title: event.title,
      description: describeChipvoice(event.description, chip, style),
      license: "CC0-1.0", attribution: null,
      source: { name: "chipvoice", url: "https://chipvoice.dev", author: "Gwendall Esnault (https://gwendall.com)", pack: chip },
      origin: "chipvoice", recipe: candidates[0].recipe, variantResults,
    }));
  }
  return { sounds };
}

async function main() {
  log("building the chipvoice-rendered catalogue (no network, no external sources)");
  // sha256-keyed: content-addressed hashes never collide across sounds, so
  // one map is simpler than threading a per-sound one through assembleSound
  // just for this.
  const variantChecks = {};
  const { sounds: chipvoiceSounds } = await buildChipvoice(variantChecks);

  log("building the generated (sfx-engine) catalogue (GS-03; no network, no external sources)");
  const { sounds: generatedSounds, excluded } = await buildGenerated(variantChecks);
  for (const { preset, reason } of excluded) log(`excluded generated preset "${preset}": ${reason}`);
  const sounds = [...chipvoiceSounds, ...generatedSounds];

  log(
    `loudness gate: every variant must reach at least one of its two ceilings (momentary LUFS at most -18, true peak at most -1 dBTP, within 0.2 dB rounding slack) - see checkOneCeilingBinds in scripts/lib/checks.mjs`,
  );

  // Every sound goes through the same signal checks the negative tests
  // exercise (test/checks.test.mjs) before it is allowed into the catalogue:
  // license, chipvoice variant count, per-variant sha256, clipping and
  // leading silence, plus the loudness ceilings, the one-ceiling-binds gate,
  // and the per-variant format energy gate (checkFormatEnergies) - every
  // variant now, not just the first (see checkSound's own header).
  //
  // formatPeakDeltas collects every per-format/per-channel peak dB delta
  // checkSound measures, purely as informational build-log data - it is
  // never a gate any more (see checks.mjs's own header for why the old
  // two-layer peak design, a loose per-variant backstop plus a whole-build
  // aggregate mean, was replaced by the per-variant energy gate above: a
  // partial regression could hide in an aggregate mean, energy cannot).
  // formatEnergyDeltas mirrors it for the metric that IS the gate - every
  // reading, not just the ones a failure message would print, so the build
  // log always shows the real distribution this file's own tolerance and
  // exclusions were set against (docs/DECISIONS.md decision 54).
  const failures = [];
  const formatPeakDeltas = [];
  const formatEnergyDeltas = [];
  const worstEnergyBySound = [];
  for (const sound of sounds) {
    const reasons = checkSound(sound, variantChecks, sha256Hex, {}, formatPeakDeltas, formatEnergyDeltas);
    if (reasons.length) failures.push(`${sound.id}: ${reasons.join("; ")}`);
    let worstDb = 0;
    for (const variant of sound.variants ?? []) {
      const data = variantChecks[variant.sha256];
      if (!data?.left || !data.formatEnergy) continue;
      const sourceEnergy = energyPerChannel(data.left, data.right ?? null);
      for (const d of collectFormatEnergyDeltas(sourceEnergy, data.formatEnergy)) {
        if (Math.abs(d) > Math.abs(worstDb)) worstDb = d;
      }
    }
    worstEnergyBySound.push({ id: sound.id, worstDb });
  }
  if (formatPeakDeltas.length) {
    const meanAbsDb = formatPeakDeltas.reduce((sum, d) => sum + Math.abs(d), 0) / formatPeakDeltas.length;
    const maxAbsDb = formatPeakDeltas.reduce((max, d) => Math.max(max, Math.abs(d)), 0);
    log(
      `format peak (informational only, not a gate): mean |delta| ${meanAbsDb.toFixed(4)} dB, max |delta| ${maxAbsDb.toFixed(4)} dB ` +
        `across ${formatPeakDeltas.length} ogg/mp3 format/channel reading(s) - see collectFormatPeakDeltas in scripts/lib/checks.mjs`,
    );
  }
  if (formatEnergyDeltas.length) {
    const abs = formatEnergyDeltas.map((d) => Math.abs(d)).sort((a, b) => a - b);
    const meanAbsDb = abs.reduce((sum, d) => sum + d, 0) / abs.length;
    const maxAbsDb = abs[abs.length - 1];
    const p99Db = abs[Math.min(abs.length - 1, Math.ceil(0.99 * abs.length) - 1)];
    const worstFive = [...worstEnergyBySound].sort((a, b) => Math.abs(b.worstDb) - Math.abs(a.worstDb)).slice(0, 5);
    log(
      `format energy (the actual gate, FORMAT_ENERGY_TOLERANCE_DB=${FORMAT_ENERGY_TOLERANCE_DB}): mean |delta| ${meanAbsDb.toFixed(4)} dB, ` +
        `p99 |delta| ${p99Db.toFixed(4)} dB, max |delta| ${maxAbsDb.toFixed(4)} dB across ${formatEnergyDeltas.length} ogg/mp3 format/channel reading(s); ` +
        `worst 5 by sound: ${worstFive.map((w) => `${w.id} (${w.worstDb.toFixed(2)} dB)`).join(", ")} - see collectFormatEnergyDeltas in scripts/lib/checks.mjs`,
    );
  }
  if (failures.length) throw new Error(`${failures.length} sound(s) failed signal checks:\n${failures.join("\n")}`);

  const taxonomy = JSON.parse(readFileSync(taxonomyPath, "utf8"));
  const catalog = {
    $comment: "Generated by scripts/build-catalog.mjs. Do not hand-edit; change catalog/taxonomy.json, catalog/chipvoice-recipes.mjs or catalog/generated-recipes.mjs and rebuild.",
    generatedAt: new Date().toISOString().slice(0, 10),
    categories: taxonomy.categories,
    sounds,
  };
  const writePath = outPath ? join(process.cwd(), outPath) : catalogPath;
  mkdirSync(dirname(writePath), { recursive: true });
  writeFileSync(writePath, JSON.stringify(catalog, null, 2));

  const byOrigin = {};
  const byCategory = {};
  const byStyle = {};
  for (const s of sounds) {
    byOrigin[s.origin] = (byOrigin[s.origin] ?? 0) + 1;
    byCategory[s.category] = (byCategory[s.category] ?? 0) + 1;
    byStyle[s.style] = (byStyle[s.style] ?? 0) + 1;
  }
  const totalVariants = sounds.reduce((n, s) => n + s.variants.length, 0);
  log(`wrote ${relative(process.cwd(), writePath)}: ${sounds.length} sounds, ${totalVariants} variants, ${Object.keys(byCategory).length} categories used of ${taxonomy.categories.length}`);
  log(`by origin: ${JSON.stringify(byOrigin)}`);
  log(`by style: ${JSON.stringify(byStyle)}`);
  if (renderGroupVariants.dropped) {
    log(`dropped ${renderGroupVariants.dropped} rejected chipvoice candidate(s) (silent or byte-identical to an already-kept take) - see renderGroupVariants in this file`);
  }
  if (renderGeneratedVariants.dropped) {
    log(`dropped ${renderGeneratedVariants.dropped} rejected generated candidate(s) (silent or byte-identical to an already-kept take) - see renderGeneratedVariants in this file`);
  }
  if (excluded.length) {
    log(`excluded ${excluded.length} generated preset(s) entirely - see the "excluded generated preset" lines above`);
  }
}

main().catch((error) => {
  console.error("[build-catalog] FAILED:", error.message);
  process.exit(1);
});
