#!/usr/bin/env node
// CI has no license to trust that whatever ffmpeg ships on the runner
// re-encodes bytes identically to the author's own machine (decision 50 in
// docs/DECISIONS.md), so it never just serves the committed catalog.json
// as-is. gamesounds has no third-party source and no external generation
// API (decision 50), so the build needs no network either: CI rebuilds the
// WHOLE catalogue fresh from committed recipes (`build-catalog.mjs`) and
// this script checks every sound's WAV/PCM hashes - each variant's own
// `sha256` identity, produced before any format-specific encoder runs -
// against the COMMITTED catalog.json's entries. A mismatch means today's
// build produced different audio than what is committed and served, which
// is exactly the drift this check exists to catch; it says nothing about
// ogg/mp3 bytes, which CI never re-derives independently (see
// docs/GAMESOUNDS.md's "site points at the CI-built catalogue" note).
//
// Usage: node scripts/check-determinism.mjs <freshly-built-catalog.json> [committed.json]
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const defaultCommittedPath = join(here, "..", "generated", "catalog.json");

/**
 * Compares `fresh` (a just-built catalog, normally the whole thing) against
 * `committed` (the catalog.json actually checked in and served). Only
 * sounds present in `fresh` are checked, so a partial or scratch build is
 * not penalized for what it left out - a full CI build simply has nothing
 * left out. Returns a list of human-readable failure strings; empty means
 * every fresh sound's variants matched the committed catalogue exactly.
 */
export function compareCatalogs(fresh, committed) {
  const failures = [];
  const committedById = new Map(committed.sounds.map((s) => [s.id, s]));
  for (const freshSound of fresh.sounds) {
    const committedSound = committedById.get(freshSound.id);
    if (!committedSound) {
      failures.push(`${freshSound.id}: built fresh but missing from the committed catalog.json - was catalog.json rebuilt and committed after the recipe changed?`);
      continue;
    }
    if (freshSound.variants.length !== committedSound.variants.length) {
      failures.push(`${freshSound.id}: fresh build has ${freshSound.variants.length} variant(s), committed catalog.json has ${committedSound.variants.length}`);
      continue;
    }
    for (const freshVariant of freshSound.variants) {
      const committedVariant = committedSound.variants.find((v) => v.n === freshVariant.n);
      if (!committedVariant) {
        failures.push(`${freshSound.id} variant ${freshVariant.n}: no matching variant number in the committed catalog.json`);
        continue;
      }
      if (freshVariant.sha256 !== committedVariant.sha256) {
        failures.push(
          `${freshSound.id} variant ${freshVariant.n}: WAV/PCM sha256 ${freshVariant.sha256} does not match committed ${committedVariant.sha256} - a rebuild produced different audio than what is committed`,
        );
      }
    }
  }
  return failures;
}

async function main() {
  const freshPath = process.argv[2];
  if (!freshPath) {
    console.error("usage: node scripts/check-determinism.mjs <freshly-built-subset.json> [committed.json]");
    process.exit(2);
  }
  const committedPath = process.argv[3] ?? defaultCommittedPath;
  const fresh = JSON.parse(readFileSync(freshPath, "utf8"));
  const committed = JSON.parse(readFileSync(committedPath, "utf8"));
  const failures = compareCatalogs(fresh, committed);
  if (failures.length) {
    console.error(`[check-determinism] FAILED: ${failures.length} mismatch(es):\n${failures.join("\n")}`);
    process.exit(1);
  }
  console.log(`[check-determinism] OK: ${fresh.sounds.length} sound(s) match the committed catalog.json exactly`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
