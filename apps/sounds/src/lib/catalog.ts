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
import type { Category, Manifest, ManifestCredit, ManifestEvent, Sound, Style, Variant } from "../../../../packages/gamesounds/src/types.ts";
import { MANIFEST_SCHEMA_URL, MANIFEST_VERSION, STYLES } from "../../../../packages/gamesounds/src/types.ts";

export type { Category, Manifest, ManifestCredit, ManifestEvent, Sound, Style, Variant };
export { STYLES };

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

export function listSounds(): Sound[] {
  return loadCatalogFile().sounds;
}

export function getSound(id: string): Sound | null {
  return loadCatalogFile().sounds.find((s) => s.id === id) ?? null;
}

/** Finds the sound and the exact variant a given shipped file's sha256 belongs to - used to verify a download's bytes match the catalogue's own record. */
export function getSoundByVariantSha(sha256: string): { sound: Sound; variant: Variant } | null {
  for (const sound of loadCatalogFile().sounds) {
    const variant = sound.variants.find((v) => v.sha256 === sha256);
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
 */
export function pickSoundForEvent(category: string, { style, tag }: { style?: Style; tag?: string | null } = {}): Sound | null {
  let candidates = listSounds().filter((s) => s.category === category);
  if (tag) {
    const needle = tag.toLowerCase();
    candidates = candidates.filter((s) => s.tags.some((t) => t.toLowerCase() === needle));
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
 * the Phase 1 catalogue is CC0-1.0 (catalog/sources/*.json and the
 * chipvoice-origin builder both hardcode it - see
 * test/mapping.test.mjs and the binding "Kenney + chipvoice only" sourcing
 * rule in docs/DECISIONS.md), so "all CC0" holds by construction, not by a
 * runtime filter here.
 */
export function buildManifest(events: string[], { style }: { style?: Style } = {}): ResolveResult {
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
    const sound = pickSoundForEvent(category, { style, tag });
    if (!sound) {
      unresolved.push(raw);
      resolved.push({ event: raw, sound: null, category });
      continue;
    }
    manifestEvents[raw] = {
      sound: sound.id,
      files: sound.variants.map((v) => v.files.ogg),
      fallback: sound.variants.map((v) => v.files.mp3),
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
