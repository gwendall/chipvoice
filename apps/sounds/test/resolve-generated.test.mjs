// GS-03: POST /api/v1/resolve (buildManifest, the function it calls) must
// reach the newly-wired generated half of the catalogue through a new style
// ("realistic" and friends), WITHOUT silently changing what an existing
// caller gets back for 8bit, 16bit or no style at all - the brief's own
// words: "existing 8bit/16bit/no-style behavior must NOT change silently
// (test explicitly, document the no-style default)".
//
// "combat/hit" is used throughout because it is the one category GS-03
// actually put generated sounds into that the existing chipvoice catalogue
// also already covers (see catalog/generated-recipes.mjs: 10 impact-*
// presets plus scifi-zap, all tagged "heavy" or "light" where that applies)
// - the sharpest test of "did adding sounds change who wins" is a category
// where there is now genuinely something else to win.
import assert from "node:assert/strict";
import { buildManifest, listSounds } from "../src/lib/catalog.ts";

{
  // A style this ticket adds reaches a generated sound, honestly labelled.
  const { manifest, resolved, unresolved } = buildManifest(["hit/heavy"], { style: "realistic" });
  assert.deepEqual(unresolved, []);
  const soundId = resolved[0].sound;
  assert.ok(soundId, `hit/heavy --style realistic must resolve to a sound: ${JSON.stringify(resolved)}`);
  const sound = listSounds().find((s) => s.id === soundId);
  assert.equal(sound.origin, "generated", `--style realistic must resolve a generated-origin sound, got origin ${sound.origin} (id ${soundId})`);
  assert.equal(sound.style, "realistic");
  assert.ok(manifest.events["hit/heavy"], "the manifest carries the resolved event");
  console.log(`PASS hit/heavy --style realistic resolves a generated-origin sound (${soundId})`);
}

{
  // Existing styles: still chipvoice, still that style, exactly as before
  // GS-03 added any generated sound to this category.
  for (const style of ["8bit", "16bit"]) {
    const { resolved } = buildManifest(["hit/heavy"], { style });
    const soundId = resolved[0].sound;
    assert.ok(soundId, `hit/heavy --style ${style} must still resolve: ${JSON.stringify(resolved)}`);
    const sound = listSounds().find((s) => s.id === soundId);
    assert.equal(sound.origin, "chipvoice", `hit/heavy --style ${style} must still resolve a chipvoice-origin sound, got origin ${sound.origin}`);
    assert.equal(sound.style, style);
  }
  console.log("PASS hit/heavy --style 8bit and --style 16bit still resolve chipvoice-origin sounds of that exact style, unchanged by the generated half existing");
}

{
  // The no-style default: pickSoundForEvent's tie-break is
  // `a.id.localeCompare(b.id)` ascending over every candidate regardless of
  // origin (src/lib/catalog.ts). Every generated sound id is composed as
  // `${category-slug}-${style}-${preset}` (scripts/build-catalog.mjs's
  // buildGenerated), and every one of the ten style facets a generated sound
  // can carry (realistic, scifi, fantasy, cartoon, minimal-ui) starts with a
  // letter, while both chipvoice styles ("8bit", "16bit") start with a
  // digit - and under localeCompare a digit always sorts before a letter -
  // so a generated sound can never become the alphabetically-first (and so
  // selected) candidate in a category a chipvoice sound already occupies.
  // This proves that invariant on the real, built catalogue, not just by
  // the argument above.
  const before = buildManifest(["hit/heavy"]).resolved[0].sound;
  assert.ok(before, "hit/heavy with no style must resolve to a sound");
  const beforeSound = listSounds().find((s) => s.id === before);
  assert.equal(beforeSound.origin, "chipvoice", `the no-style default for hit/heavy must still pick a chipvoice sound now that generated sounds share its category, got origin ${beforeSound.origin} (id ${before})`);

  // And directly, on the candidate pool itself: no generated sound in this
  // category sorts ahead of every chipvoice sound in it.
  const candidates = listSounds().filter((s) => s.category === "combat/hit" && s.tags.includes("heavy"));
  const chipvoiceIds = candidates.filter((s) => s.origin === "chipvoice").map((s) => s.id);
  const generatedIds = candidates.filter((s) => s.origin === "generated").map((s) => s.id);
  assert.ok(chipvoiceIds.length > 0 && generatedIds.length > 0, "this test needs both an existing chipvoice sound and a new generated one in the same pool to mean anything");
  const winner = [...candidates].sort((a, b) => b.rank.score - a.rank.score || a.id.localeCompare(b.id))[0];
  assert.equal(winner.origin, "chipvoice", `the id-sorted winner of combat/hit's "heavy" pool must stay chipvoice-origin, got ${winner.id} (${winner.origin})`);
  console.log(`PASS no-style default for hit/heavy still resolves chipvoice sound ${before}; the id-sort winner of its whole "heavy" pool (${chipvoiceIds.length} chipvoice, ${generatedIds.length} generated candidate(s)) stays chipvoice-origin`);
}
