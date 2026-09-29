/**
 * Loads and indexes generated/catalog.json (built by scripts/build-catalog.mjs,
 * committed to git for Phase 1 - see docs/GAMESOUNDS.md) and resolves game
 * events to sounds for the search API and POST /api/v1/resolve.
 *
 * Types are imported directly from packages/gamesounds/src/types.ts, not
 * duplicated: that file is plain TypeScript with no imports of its own ("no
 * dependency on how a catalogue is built or served" - its own header), so
 * importing it by relative path costs nothing and needs no build step -
 * unlike packages/gamesounds's compiled dist, this app deliberately does not
 * depend on that package's own build (see docs/DECISIONS.md), so the CI job
 * that builds and tests this app never needs to build packages/gamesounds
 * first.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AudioFile, AudioFormat, Category, Manifest, ManifestCredit, ManifestEvent, Sound, Style, Variant } from "../../../../packages/gamesounds/src/types.ts";
import { AUDIO_FORMATS, MANIFEST_SCHEMA_URL, MANIFEST_VERSION, STYLES } from "../../../../packages/gamesounds/src/types.ts";

export type { AudioFile, AudioFormat, Category, Manifest, ManifestCredit, ManifestEvent, Sound, Style, Variant };
export { AUDIO_FORMATS, STYLES };

interface CatalogFile {
  $comment: string;
  generatedAt: string;
  categories: Category[];
  sounds: Sound[];
}

let cached: CatalogFile | null = null;

function loadCatalogFile(): CatalogFile {
  if (cached) return cached;
  const path = join(process.cwd(), "generated", "catalog.json");
  const raw = readFileSync(path, "utf8");
  cached = JSON.parse(raw) as CatalogFile;
  return cached;
}

export function getCatalog(): CatalogFile {
  return loadCatalogFile();
}

export function listCategories(): Category[] {
  return loadCatalogFile().categories;
}

export function getCategory(id: string): Category | null {
  return loadCatalogFile().categories.find((c) => c.id === id) ?? null;
}

export function childCategories(parentId: string | null): Category[] {
  return loadCatalogFile().categories.filter((c) => c.parent === parentId);
}

export interface CategoryWithCount extends Category {
  /** Sounds filed on this category's own leaf plus every descendant leaf
   * (a branch has none of its own). The taxonomy may keep a category with
   * zero sounds - a future style or the procedural engine (GS-02,
   * docs/BACKLOG.md) may fill it later - but nothing that shows this count
   * may omit it or otherwise present an empty category as if it had
   * content; see `GET /api/v1/categories`. */
  count: number;
}

export function listCategoriesWithCounts(): CategoryWithCount[] {
  const { categories, sounds } = loadCatalogFile();
  return categories.map((c) => ({
    ...c,
    count: sounds.filter((s) => s.category === c.id || s.category.startsWith(`${c.id}/`)).length,
  }));
}

export function listSounds(): Sound[] {
  return loadCatalogFile().sounds;
}

export function getSound(id: string): Sound | null {
  return loadCatalogFile().sounds.find((s) => s.id === id) ?? null;
}

/**
 * Finds the sound and the exact variant a given shipped file's sha256
 * belongs to - used to verify a download's bytes match the catalogue's own
 * record. Each of a variant's three formats is content-addressed by its own
 * bytes now (decision 40's pattern, extended per-file), so this matches
 * against the variant identity (`v.sha256`, the WAV/PCM source hash) or any
 * one of its three shipped files' own hashes.
 */
export function getSoundByVariantSha(sha256: string): { sound: Sound; variant: Variant } | null {
  for (const sound of loadCatalogFile().sounds) {
    const variant = sound.variants.find(
      (v) => v.sha256 === sha256 || v.files.ogg.sha256 === sha256 || v.files.mp3.sha256 === sha256 || v.files.wav.sha256 === sha256,
    );
    if (variant) return { sound, variant };
  }
  return null;
}

export interface SearchParams {
  q?: string;
  category?: string;
  style?: Style;
  tag?: string;
  /** Phase 1 ships no loopable sound (see docs/DECISIONS.md) - `loop: true`
   * always returns an empty page, honestly, rather than being ignored. */
  loop?: boolean;
}

/**
 * Free-text search over title, description, category, tags and the matched
 * category's own aliases (so "jewel" finds collect/gem, per its alias list
 * in catalog/taxonomy.json). Returns the full ranked, filtered list -
 * `/api/v1/sounds` (src/app/api/v1/sounds/route.ts) is the one place that
 * slices it into a page, so cursor math lives in exactly one file.
 */
export function searchSounds({ q, category, style, tag, loop }: SearchParams): Sound[] {
  let results = loadCatalogFile().sounds;
  if (category) results = results.filter((s) => s.category === category);
  if (style) results = results.filter((s) => s.style === style);
  if (loop !== undefined) results = results.filter((s) => (s.loop !== null) === loop);
  if (tag) {
    const needle = tag.toLowerCase();
    results = results.filter((s) => s.tags.some((t) => t.toLowerCase() === needle));
  }
  const needle = q?.trim().toLowerCase();
  if (needle) {
    const categoryAliases = new Map(loadCatalogFile().categories.map((c) => [c.id, c.aliases.map((a) => a.toLowerCase())]));
    results = results.filter((s) => {
      if (s.title.toLowerCase().includes(needle)) return true;
      if (s.description.toLowerCase().includes(needle)) return true;
      if (s.category.toLowerCase().includes(needle)) return true;
      if (s.tags.some((t) => t.toLowerCase().includes(needle))) return true;
      const aliases = categoryAliases.get(s.category) ?? [];
      return aliases.some((a) => a.includes(needle));
    });
  }
  return [...results].sort((a, b) => b.rank.score - a.rank.score || a.id.localeCompare(b.id));
}

export interface ResolvedEvent {
  input: string;
  category: string | null;
  tag: string | null;
}

function findCategoryByLeaf(leaf: string): Category | null {
  const needle = leaf.toLowerCase();
  const categories = listCategories();
  // A leaf name may itself be a top-level category ("combat").
  const topLevel = categories.find((c) => c.parent === null && c.id.toLowerCase() === needle);
  if (topLevel) return topLevel;
  // Or the last segment of a two-level id ("jump" -> "movement/jump").
  const bySegment = categories.find((c) => c.id.toLowerCase().split("/").pop() === needle);
  if (bySegment) return bySegment;
  // Or an alias ("hop" -> "movement/jump", per catalog/taxonomy.json).
  return categories.find((c) => c.aliases.some((a) => a.toLowerCase() === needle)) ?? null;
}

/**
 * Accepts the three short forms catalog/taxonomy.json documents and the
 * spec's own examples use: a fully qualified id ("ui/confirm"), a bare leaf
 * name ("jump"), or "leaf/tag" ("hit/heavy", "footstep/grass") - a tag
 * filter on a two-level category, not a third taxonomy level.
 */
export function resolveEvent(input: string): ResolvedEvent {
  const trimmed = input.trim();
  const categories = listCategories();
  const exact = categories.find((c) => c.id === trimmed);
  if (exact) return { input, category: exact.id, tag: null };
  if (trimmed.includes("/")) {
    const [leafPart, ...rest] = trimmed.split("/");
    const tag = rest.join("/").trim();
    const found = findCategoryByLeaf(leafPart);
    return found ? { input, category: found.id, tag: tag || null } : { input, category: null, tag: null };
  }
  const found = findCategoryByLeaf(trimmed);
  return { input, category: found?.id ?? null, tag: null };
}

/**
 * Picks exactly one sound for a resolved category (+ optional tag/style),
 * deterministically: every sound in Phase 1 has rank.score 0 (no votes or
 * usage data exist yet - that is Phase 2), so the tie-break is the sound's
 * own id, sorted ascending. This is a documented placeholder for Phase 2's
 * real ranking, not an attempt at variety - the same request always
 * resolves to the same sound, which is what a reproducible CLI/API needs.
 * A style with no candidates falls back to any style in the category rather
 * than resolving to nothing, since a category is more important to answer
 * than a style preference.
 *
 * `exclude` (the CLI's `swap`) drops given sound ids from the candidate pool
 * before picking, so "the next best" is simply "the best of what is left" -
 * the same deterministic sort, just missing what the caller already has.
 *
 * `sounds` overrides the candidate pool (defaulting to the full loaded
 * catalogue, `listSounds()`). No production caller passes it - it exists so
 * test/resolve-generated.test.mjs can run this EXACT function against a
 * chipvoice-only subset of the real catalogue and compare the result to a
 * full-catalogue call, proving the GS-03 resolve invariant against the
 * actual selection logic rather than a second, hand-copied implementation
 * of it that could silently drift from this one.
 */
export function pickSoundForEvent(
  category: string,
  { style, tag, exclude, sounds }: { style?: Style; tag?: string | null; exclude?: Set<string>; sounds?: Sound[] } = {},
): Sound | null {
  let candidates = (sounds ?? listSounds()).filter((s) => s.category === category);
  if (tag) {
    const needle = tag.toLowerCase();
    candidates = candidates.filter((s) => s.tags.some((t) => t.toLowerCase() === needle));
  }
  if (exclude && exclude.size > 0) {
    const withoutExcluded = candidates.filter((s) => !exclude.has(s.id));
    // Excluding everything is worse than ignoring the exclusion: a swap
    // request with no other candidate should say so honestly (by returning
    // the same sound again, resolvable by the caller as "nothing else
    // exists"), not silently return nothing.
    if (withoutExcluded.length > 0) candidates = withoutExcluded;
  }
  if (candidates.length === 0) return null;
  let pool = style ? candidates.filter((s) => s.style === style) : candidates;
  if (pool.length === 0) pool = candidates;
  const sorted = [...pool].sort((a, b) => b.rank.score - a.rank.score || a.id.localeCompare(b.id));
  return sorted[0];
}

export interface ManifestResolution {
  event: string;
  sound: string | null;
  category: string | null;
}

export interface ResolveResult {
  manifest: Manifest;
  resolved: ManifestResolution[];
  unresolved: string[];
}

/**
 * Builds a sounds.json-shaped Manifest (validated against
 * public/schema/manifest-1.json by test/manifest.test.mjs) for a list of
 * event strings: one sound per event, deduplicated credits. Every sound in
 * the Phase 1 catalogue is CC0-1.0 (the chipvoice-origin builder hardcodes
 * it - see scripts/build-catalog.mjs's assembleSound, and the "chipvoice
 * only, no third-party sounds" rule in docs/DECISIONS.md), so "all CC0"
 * holds by construction, not by a runtime filter here.
 *
 * `formats` picks which of a variant's own content-addressed files
 * (decision 40, extended per-file - see `AudioFile`) become `files`
 * (formats[0]) and `fallback` (formats[1], if given) - the CLI's
 * `--formats` flag (packages/gamesounds/bin/gamesounds.mjs) passes this
 * straight through, so `--formats ogg` writes only ogg URLs into the
 * manifest and nothing else gets downloaded. Defaults to `["ogg", "mp3"]`,
 * the runtime's own primary/fallback pair.
 *
 * `exclude` drops given sound ids from every event's candidate pool before
 * picking - the CLI's `swap` uses it to resolve "the next best sound" as
 * "the best sound that isn't the one already chosen".
 */
export function buildManifest(
  events: string[],
  { style, formats, exclude }: { style?: Style; formats?: [AudioFormat] | [AudioFormat, AudioFormat]; exclude?: string[] } = {},
): ResolveResult {
  const [primaryFormat, fallbackFormat] = formats ?? (["ogg", "mp3"] as const);
  const excludeSet = exclude && exclude.length > 0 ? new Set(exclude) : undefined;
  const manifestEvents: Record<string, ManifestEvent> = {};
  const credits: ManifestCredit[] = [];
  const creditedSoundIds = new Set<string>();
  const resolved: ManifestResolution[] = [];
  const unresolved: string[] = [];

  for (const raw of events) {
    const { category, tag } = resolveEvent(raw);
    if (!category) {
      unresolved.push(raw);
      resolved.push({ event: raw, sound: null, category: null });
      continue;
    }
    const sound = pickSoundForEvent(category, { style, tag, exclude: excludeSet });
    if (!sound) {
      unresolved.push(raw);
      resolved.push({ event: raw, sound: null, category });
      continue;
    }
    manifestEvents[raw] = {
      sound: sound.id,
      files: sound.variants.map((v) => v.files[primaryFormat].url),
      ...(fallbackFormat ? { fallback: sound.variants.map((v) => v.files[fallbackFormat].url) } : {}),
    };
    if (!creditedSoundIds.has(sound.id)) {
      creditedSoundIds.add(sound.id);
      credits.push({
        sound: sound.id,
        license: sound.license,
        author: sound.source.author,
        source: sound.source.name,
        attribution: sound.attribution,
      });
    }
    resolved.push({ event: raw, sound: sound.id, category });
  }

  return {
    manifest: { $schema: MANIFEST_SCHEMA_URL, version: MANIFEST_VERSION, base: "/", events: manifestEvents, credits },
    resolved,
    unresolved,
  };
}
