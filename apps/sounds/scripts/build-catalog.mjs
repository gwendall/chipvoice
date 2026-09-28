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
} from "./lib/audio.mjs";
import { checkSound, checkCatalogFormatPeakMean, CATALOG_MEAN_FORMAT_PEAK_TOLERANCE_DB } from "./lib/checks.mjs";

// Presets excluded from the generated half, with why - see this file's
// buildGenerated(). Empty for now: every preset that reaches the build
// passes checkSound; if one is added here later, name it, quote the actual
// failure/judgment, and say what the engine (a separate ticket) would need.
const EXCLUDED_PRESETS = {};

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
      // Decoded back from the actually-shipped ogg/mp3 bytes by encodeVariant
      // itself (scripts/lib/audio.mjs) - checkSound's checkFormatPeaks uses
      // this to catch a format that ships quieter (or louder) than its wav
      // sibling per channel, the class of bug a missing libvorbis fallback's
      // old `-ac 2` upmix caused (see encodeVariant's own header).
      formatPeaks: encoded.formatPeaks,
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
  // leading silence, plus the loudness ceilings and the one-ceiling-binds
  // gate - every variant now, not just the first (see checkSound's own
  // header).
  //
  // formatPeakDeltas collects every per-format/per-channel dB delta
  // checkSound measures, across every sound in the whole build - once the
  // loop is done, checkCatalogFormatPeakMean judges their aggregate mean,
  // the check that actually catches a systematic per-file bug like the old
  // fallback ogg path's `-ac 2` upmix (see checks.mjs's own comment on
  // CATALOG_MEAN_FORMAT_PEAK_TOLERANCE_DB for why this has to be a
  // whole-build aggregate and not just another per-variant tolerance).
  const failures = [];
  const formatPeakDeltas = [];
  for (const sound of sounds) {
    const reasons = checkSound(sound, variantChecks, sha256Hex, {}, formatPeakDeltas);
    if (reasons.length) failures.push(`${sound.id}: ${reasons.join("; ")}`);
  }
  if (formatPeakDeltas.length) {
    const meanAbsDb = formatPeakDeltas.reduce((sum, d) => sum + Math.abs(d), 0) / formatPeakDeltas.length;
    log(
      `format peak check: mean |delta| ${meanAbsDb.toFixed(4)} dB across ${formatPeakDeltas.length} ogg/mp3 ` +
        `format/channel reading(s) (bound: ${CATALOG_MEAN_FORMAT_PEAK_TOLERANCE_DB} dB) - see checkCatalogFormatPeakMean in scripts/lib/checks.mjs`,
    );
    const catalogFormatPeak = checkCatalogFormatPeakMean(formatPeakDeltas);
    if (!catalogFormatPeak.ok) failures.push(catalogFormatPeak.reason);
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
