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
import {
  decodeToRender,
  trimToZeroCrossing,
  levelToConvention,
  encodeVariant,
  computePeaks,
  sha256Hex,
  toWavBytes,
} from "./lib/audio.mjs";
import { checkSound, deriveLoudnessFloor } from "./lib/checks.mjs";

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
  const { sounds } = await buildChipvoice(variantChecks);

  // The loudness floor is derived from this very build's own output (see
  // deriveLoudnessFloor's header): the widest peak-to-loudness gap any
  // variant in the whole catalogue actually measured, plus a stated margin.
  // Computed once, over every variant of every sound, before any per-sound
  // check runs, so no single sound's own check can shift the floor that
  // checks it.
  const allMeasures = sounds.flatMap((s) => s.variants.map((v) => v.measure));
  const floorLufs = deriveLoudnessFloor(allMeasures);
  log(`loudness floor: ${floorLufs} LUFS (derived from the widest measured peak-to-loudness gap plus a ${allMeasures.length ? "" : "default "}margin - see deriveLoudnessFloor in scripts/lib/checks.mjs)`);

  // Every sound goes through the same signal checks the negative tests
  // exercise (test/checks.test.mjs) before it is allowed into the catalogue:
  // license, chipvoice variant count, per-variant sha256, clipping and
  // leading silence, plus the loudness ceilings and the derived floor -
  // every variant now, not just the first (see checkSound's own header).
  const failures = [];
  for (const sound of sounds) {
    const reasons = checkSound(sound, variantChecks, sha256Hex, { floorLufs });
    if (reasons.length) failures.push(`${sound.id}: ${reasons.join("; ")}`);
  }
  if (failures.length) throw new Error(`${failures.length} sound(s) failed signal checks:\n${failures.join("\n")}`);

  const taxonomy = JSON.parse(readFileSync(taxonomyPath, "utf8"));
  const catalog = {
    $comment: "Generated by scripts/build-catalog.mjs. Do not hand-edit; change catalog/taxonomy.json or catalog/chipvoice-recipes.mjs and rebuild.",
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
    log(`dropped ${renderGroupVariants.dropped} rejected candidate(s) (silent or byte-identical to an already-kept take) - see renderGroupVariants in this file`);
  }
}

main().catch((error) => {
  console.error("[build-catalog] FAILED:", error.message);
  process.exit(1);
});
