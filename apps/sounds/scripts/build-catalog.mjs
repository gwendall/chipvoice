#!/usr/bin/env node
// Builds apps/sounds/generated/catalog.json: downloads and verifies every
// curated source, maps its files to categories, renders every chipvoice
// recipe, and runs every variant through the same trim/level/encode/measure
// pipeline (scripts/lib/audio.mjs) regardless of where it came from - so a
// curated Kenney take and a chipvoice render are held to byte-identical
// rules, not two diverging code paths that happen to agree today.
//
// Usage:
//   node scripts/build-catalog.mjs            full build
//   node scripts/build-catalog.mjs --fetch-only   only download+extract sources, no encoding
//   node scripts/build-catalog.mjs --skip-fetch   assume sources are already extracted under .artifacts/
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { mapFile, sourceIds } from "../catalog/mapping.mjs";
import { chipvoiceRecipes } from "../catalog/chipvoice-recipes.mjs";
import {
  decodeToRender,
  trimToZeroCrossing,
  levelToConvention,
  encodeVariant,
  computePeaks,
  sha256Hex,
  toWavBytes,
} from "./lib/audio.mjs";
import { checkSound } from "./lib/checks.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const artifactsDir = join(root, ".artifacts", "sounds");
const downloadsDir = join(artifactsDir, "downloads");
const extractedDir = join(artifactsDir, "extracted");
// Served by Next.js as a static file with no extra route: content-addressed,
// immutable (decision 40's `/f/<sha256>.<ext>` pattern), so it is safe to
// cache forever once the site sets that header for this path (vercel.json).
const outAudioDir = join(root, "public", "f");
const catalogPath = join(root, "generated", "catalog.json");
const sourcesDir = join(root, "catalog", "sources");
const taxonomyPath = join(root, "catalog", "taxonomy.json");

const args = new Set(process.argv.slice(2));
const fetchOnly = args.has("--fetch-only");
const skipFetch = args.has("--skip-fetch");

function log(...m) { console.log("[build-catalog]", ...m); }

function run(cmd, cmdArgs, options = {}) {
  const result = spawnSync(cmd, cmdArgs, { maxBuffer: 1024 * 1024 * 512, ...options });
  if (result.error) throw new Error(`${cmd} failed to start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${cmd} ${cmdArgs.join(" ")} exited ${result.status}: ${(result.stderr ?? "").toString().slice(0, 2000)}`);
  return result;
}

function loadSourceConfigs() {
  return sourceIds().map((id) => JSON.parse(readFileSync(join(sourcesDir, `${id}.json`), "utf8")));
}

/** Downloads (if missing), verifies sha256, and extracts (if missing) one Kenney source zip. */
function fetchSource(source) {
  mkdirSync(downloadsDir, { recursive: true });
  const zipPath = join(downloadsDir, `${source.id}.zip`);
  if (!existsSync(zipPath)) {
    log(`downloading ${source.id} from ${source.zipUrl}`);
    run("curl", ["-fsSL", "-o", zipPath, source.zipUrl]);
  }
  const bytes = readFileSync(zipPath);
  const actual = sha256Hex(bytes);
  if (actual !== source.sha256) {
    throw new Error(`${source.id}: downloaded zip sha256 ${actual} does not match catalog/sources/${source.id}.json's recorded ${source.sha256} - refusing to use a file that does not match what license verification was actually run against`);
  }
  const dest = join(extractedDir, source.id);
  if (!existsSync(dest) || readdirSync(dest).length === 0) {
    mkdirSync(dest, { recursive: true });
    log(`extracting ${source.id}`);
    run("unzip", ["-o", "-q", zipPath, "-d", dest]);
  }
  return dest;
}

function walkAudioFiles(dir) {
  const out = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkAudioFiles(full));
    else if (/\.(ogg|wav|mp3)$/i.test(entry.name) && !/preview/i.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Picks at most `max` items from a take-sorted list, evenly spaced across
 * the whole range rather than just the first `max` - a pack's early takes
 * are not guaranteed to be its most varied ones, and spreading the pick
 * across the full recorded range gives a better sample of what the pack
 * actually contains. Order is preserved (still ascending by take).
 */
function evenlySample(sortedItems, max) {
  if (sortedItems.length <= max) return sortedItems;
  const picked = [];
  for (let i = 0; i < max; i++) {
    const idx = Math.round((i * (sortedItems.length - 1)) / (max - 1));
    picked.push(sortedItems[idx]);
  }
  return [...new Set(picked)];
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

const CATEGORY_TITLES = JSON.parse(readFileSync(taxonomyPath, "utf8")).categories.reduce((acc, c) => ((acc[c.id] = c.title), acc), {});

function describeCurated(categoryId, style, tags, sourceName) {
  const title = CATEGORY_TITLES[categoryId] ?? categoryId;
  const tagText = tags.length ? ` (${tags.join(", ")})` : "";
  return `A ${style} ${title.toLowerCase()} sound${tagText}, from Kenney's ${sourceName}.`;
}

function describeChipvoice(eventDescription, chip, style) {
  const chipName = { "2a03": "NES", dmg: "Game Boy", md: "Sega Mega Drive", snes: "Super Nintendo", c64: "Commodore 64" }[chip] ?? chip;
  return `${eventDescription} Rendered on real ${chipName} (${style}) chip emulation by chipvoice.`;
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
  return {
    variant: {
      n,
      sha256: encoded.sha256,
      duration: Math.round(encoded.duration * 1000) / 1000,
      files: { ogg: `/f/${encoded.files.ogg}`, mp3: `/f/${encoded.files.mp3}`, wav: `/f/${encoded.files.wav}` },
      peaks,
      measure: encoded.measure,
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

/** Folds a list of `processVariant` results into the catalogue's `Variant[]`
 * and merges their checkData into the shared, sha256-keyed map `checkSound`
 * reads from - sha256 is content-addressed, so keys never collide across
 * sounds even though this map is shared by the whole build. */
/**
 * Drops any variant whose audio is byte-identical to an earlier variant of
 * the SAME sound, then renumbers what is left 1..k. Some chip+role
 * combinations (a fixed-pitch noise voice used for a short percussive hit,
 * for instance) render the same bytes for both takes no matter how the
 * recipe's duration or slide differ - verified per chip against the real
 * renderer, not assumed - so without this, a sound could silently claim two
 * "variants" that are secretly one take played twice. Shipping the one real
 * take is honest; shipping a fake second copy is not. Two DIFFERENT sounds
 * sharing a variant's bytes (a chip's fixed click reused by two events) is
 * left alone: that is content-addressed storage doing its job, not a
 * duplicate-variant defect - see docs/DECISIONS.md.
 */
function splitVariantResults(results, variantChecks) {
  const variants = [];
  const seen = new Set();
  let dropped = 0;
  for (const { variant, checkData } of results) {
    if (seen.has(variant.sha256)) { dropped++; continue; }
    seen.add(variant.sha256);
    variants.push({ ...variant, n: variants.length + 1 });
    variantChecks[variant.sha256] = checkData;
  }
  splitVariantResults.dropped = (splitVariantResults.dropped ?? 0) + dropped;
  return variants;
}

function assembleSound({ id, category, style, tags, title, description, license, attribution, source, origin, recipe, variantResults }) {
  const measure = { lufs: variantResults[0].measure.lufs, peakDb: variantResults[0].measure.peakDb, duration: variantResults[0].duration };
  return {
    id, category, style, tags, title, description, license, attribution, source, origin,
    ...(recipe !== undefined ? { recipe } : {}),
    loop: null,
    variants: variantResults.map(({ measure: _m, ...v }) => v),
    measure,
    rank: { score: 0, votes: 0, auditions: 0, kept: 0, replaced: 0 },
  };
}

async function buildCurated(variantChecks) {
  const sounds = [];
  const usedIds = new Set();
  const unmapped = [];
  for (const source of loadSourceConfigs()) {
    const dir = skipFetch ? join(extractedDir, source.id) : fetchSource(source);
    if (fetchOnly) continue;
    const files = walkAudioFiles(dir);
    const groups = new Map();
    for (const filePath of files) {
      const fileName = relative(dir, filePath).split("/").pop();
      const mapped = mapFile(source.id, fileName);
      if (!mapped) { unmapped.push(`${source.id}/${fileName}`); continue; }
      const key = mapped.group;
      if (!groups.has(key)) groups.set(key, { meta: mapped, files: [] });
      groups.get(key).files.push({ filePath, take: mapped.take });
    }
    for (const [groupKey, group] of groups) {
      const sorted = [...group.files].sort((a, b) => a.take - b.take);
      const picked = evenlySample(sorted, 8);
      const results = picked.map((item, i) => processVariant(decodeToRender(item.filePath), i + 1));
      const variantResults = splitVariantResults(results, variantChecks);
      const { category, style, tags } = group.meta;
      const title = CATEGORY_TITLES[category] ?? category;
      const id = uniqueId(`${slugify(category)}-${style}-${slugify(tags[0] ?? groupKey)}`, usedIds);
      sounds.push(assembleSound({
        id, category, style, tags, title,
        description: describeCurated(category, style, tags, source.name),
        license: source.license, attribution: null,
        source: { name: source.name, url: source.homepage, author: source.author, pack: source.id },
        origin: "curated", recipe: undefined, variantResults,
      }));
    }
  }
  return { sounds, unmapped };
}

async function buildChipvoice(variantChecks) {
  if (fetchOnly) return { sounds: [] };
  const chipvoiceDist = join(root, "..", "..", "packages", "chipvoice", "dist", "index.js");
  const { instrumentsFor, renderSfx } = await import(chipvoiceDist);
  const recipes = chipvoiceRecipes(instrumentsFor);
  const groups = new Map();
  for (const r of recipes) {
    if (!groups.has(r.group)) groups.set(r.group, { meta: r, items: [] });
    groups.get(r.group).items.push(r);
  }
  const sounds = [];
  const usedIds = new Set();
  for (const [groupKey, group] of groups) {
    const sorted = [...group.items].sort((a, b) => a.take - b.take);
    const results = sorted.map((item, i) => processVariant(renderSfx(item.recipe.chip, item.recipe), i + 1));
    const variantResults = splitVariantResults(results, variantChecks);
    const first = sorted[0];
    const id = uniqueId(`${slugify(first.category)}-${first.style}-${first.recipe.chip}`, usedIds);
    sounds.push(assembleSound({
      id, category: first.category, style: first.style, tags: first.tags, title: first.title,
      description: describeChipvoice(first.description, first.recipe.chip, first.style),
      license: "CC0-1.0", attribution: null,
      source: { name: "chipvoice", url: "https://chipvoice.dev", author: "Gwendall Esnault (https://gwendall.com)", pack: first.recipe.chip },
      origin: "chipvoice", recipe: first.recipe, variantResults,
    }));
  }
  return { sounds };
}

async function main() {
  log(fetchOnly ? "fetch-only run" : skipFetch ? "skip-fetch run (using existing .artifacts/)" : "full run");
  // sha256-keyed, shared by every sound from either origin: content-addressed
  // hashes never collide across sounds, so one map is simpler than threading
  // a per-sound one through assembleSound just for this.
  const variantChecks = {};
  const { sounds: curated, unmapped } = await buildCurated(variantChecks);
  if (unmapped.length > 0) {
    // The mapping is proven complete against a committed filelist snapshot
    // (test/mapping.test.mjs); a real extraction disagreeing with that
    // snapshot means the live pack changed, which is worth stopping for,
    // not silently dropping files over.
    throw new Error(`${unmapped.length} real file(s) had no mapping rule: ${unmapped.slice(0, 10).join(", ")}${unmapped.length > 10 ? ", ..." : ""}`);
  }
  if (fetchOnly) { log("fetch-only complete"); return; }
  const { sounds: chipvoiceSounds } = await buildChipvoice(variantChecks);
  const sounds = [...curated, ...chipvoiceSounds];

  // Every sound goes through the same signal checks the negative tests
  // exercise (test/checks.test.mjs) before it is allowed into the catalogue:
  // license, per-variant sha256, clipping and leading silence, plus the
  // loudness ceilings.
  const failures = [];
  for (const sound of sounds) {
    const reasons = checkSound(sound, variantChecks, sha256Hex);
    if (reasons.length) failures.push(`${sound.id}: ${reasons.join("; ")}`);
  }
  if (failures.length) throw new Error(`${failures.length} sound(s) failed signal checks:\n${failures.join("\n")}`);

  const taxonomy = JSON.parse(readFileSync(taxonomyPath, "utf8"));
  const catalog = {
    $comment: "Generated by scripts/build-catalog.mjs. Do not hand-edit; change catalog/*.json, catalog/mapping.mjs or catalog/chipvoice-recipes.mjs and rebuild.",
    generatedAt: new Date().toISOString().slice(0, 10),
    categories: taxonomy.categories,
    sounds,
  };
  mkdirSync(dirname(catalogPath), { recursive: true });
  writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));

  const byOrigin = {};
  const byCategory = {};
  for (const s of sounds) {
    byOrigin[s.origin] = (byOrigin[s.origin] ?? 0) + 1;
    byCategory[s.category] = (byCategory[s.category] ?? 0) + 1;
  }
  const totalVariants = sounds.reduce((n, s) => n + s.variants.length, 0);
  log(`wrote ${relative(process.cwd(), catalogPath)}: ${sounds.length} sounds, ${totalVariants} variants, ${Object.keys(byCategory).length} categories used of ${taxonomy.categories.length}`);
  log(`by origin: ${JSON.stringify(byOrigin)}`);
  if (splitVariantResults.dropped) {
    log(`dropped ${splitVariantResults.dropped} duplicate variant(s) (same sound, byte-identical audio) - see splitVariantResults in this file`);
  }
}

main().catch((error) => {
  console.error("[build-catalog] FAILED:", error.message);
  process.exit(1);
});
