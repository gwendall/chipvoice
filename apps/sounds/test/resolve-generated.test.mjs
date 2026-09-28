// GS-03: adding the generated half of the catalogue (packages/sfx-engine's
// 53 presets) must never change what an EXISTING request already resolved
// to - it may only fill in gaps that previously resolved to nothing. This
// is an exhaustive proof of that invariant, not a couple of hand-picked
// examples: for every (category, tag-or-none, style-or-none) combination
// the real, built catalogue actually has, the full-catalogue pick must
// equal the chipvoice-only pick WHENEVER the chipvoice-only pick is
// non-null. (An earlier version of this test asserted the stronger, wrong
// claim that "8bit/16bit/no-style behavior is unchanged by construction" -
// that is false: `pickSoundForEvent`'s own style-fallback ("a style with no
// candidates falls back to any style in the category rather than resolving
// to nothing" - src/lib/catalog.ts) means a retro-style request CAN now
// resolve to a generated sound, for a (category, tag) pair no chipvoice
// sound ever covered under ANY style. That is filling a gap, not
// overriding an existing answer, so it is exactly what this test allows and
// what it does not allow overriding.)
//
// Both picks are produced by the SAME production function,
// `pickSoundForEvent`, called with different `sounds` pools (a test-only
// override added to that function for exactly this purpose - see its own
// header) - never a second, hand-written copy of its selection logic, which
// could silently drift from what the real API actually does.
import assert from "node:assert/strict";
import { pickSoundForEvent, listSounds, listCategories } from "../src/lib/catalog.ts";

const allSounds = listSounds();
const chipvoiceSounds = allSounds.filter((s) => s.origin === "chipvoice");
const categories = listCategories();
const styles = [undefined, "8bit", "16bit"];

assert.ok(chipvoiceSounds.length > 0, "this test needs real chipvoice sounds in the built catalogue to mean anything");
assert.ok(allSounds.some((s) => s.origin === "generated"), "this test needs real generated sounds in the built catalogue to mean anything");

let combinations = 0;
const newlyResolved = [];

for (const category of categories) {
  const catSounds = allSounds.filter((s) => s.category === category.id);
  if (catSounds.length === 0) continue;
  const tags = new Set();
  for (const s of catSounds) for (const t of s.tags) tags.add(t);
  const tagOptions = [null, ...tags];

  for (const tag of tagOptions) {
    for (const style of styles) {
      combinations++;
      const chipvoicePick = pickSoundForEvent(category.id, { style, tag, sounds: chipvoiceSounds });
      const fullPick = pickSoundForEvent(category.id, { style, tag, sounds: allSounds });
      const label = `category=${category.id} tag=${tag ?? "none"} style=${style ?? "none"}`;

      if (chipvoicePick) {
        // The binding invariant: a request that already had a chipvoice
        // answer keeps that exact answer once generated sounds exist too.
        assert.equal(
          fullPick?.id,
          chipvoicePick.id,
          `${label}: full-catalogue pick (${fullPick?.id ?? "null"}) must equal the chipvoice-only pick (${chipvoicePick.id}) - a generated sound must never override an existing chipvoice pick`,
        );
      } else if (fullPick) {
        // No chipvoice sound ever answered this combination (under this
        // style OR under the fallback-to-any-style pool) - a generated
        // sound filling that gap is allowed, and is what GS-03 is FOR.
        // Since chipvoiceSounds is a subset of allSounds, fullPick can only
        // exist here because a generated sound supplied it.
        assert.equal(fullPick.origin, "generated", `${label}: the only way ${label} newly resolves is via a generated sound, got origin ${fullPick.origin}`);
        newlyResolved.push({ category: category.id, tag, style: style ?? null, sound: fullPick.id });
      }
      // Both null: still nothing resolves for this combination, unchanged.
    }
  }
}

console.log(
  `PASS exhaustive resolve invariant held across ${combinations} (category, tag, style) combination(s) over ${categories.length} categories: ` +
    `every combination with an existing chipvoice answer kept that exact answer; ${newlyResolved.length} previously-unresolvable combination(s) ` +
    "now resolve to a generated sound (a gap filled, never an override) - see docs/GAMESOUNDS.md's \"Generated sounds (GS-03)\" section for the full list.",
);

// Requirement 3 (round-2 review): the resolve invariant above also has to
// hold on the EXCLUDE (swap) path, not just the plain pick - `exclude`
// removes a given sound id from the candidate pool before picking, so "swap
// for the next best" must agree between the chipvoice-only pool and the
// full pool exactly the way the plain pick does above.
//
// For every combination that has a chipvoice-only pick, exclude that pick's
// own id and compare what each pool resolves to next:
//   - if the chipvoice-only pool still has another candidate once its own
//     pick is excluded, the full pool (excluding that same id) must resolve
//     to that SAME alternate - a generated sound must never step in ahead of
//     a real remaining chipvoice alternate.
//   - if the chipvoice-only pool has no other candidate, pickSoundForEvent's
//     own documented fallback returns the same excluded sound again (see its
//     header) - the only permitted difference on the full pool is a
//     generated sound filling that gap in place of "the same sound again".
let excludeCombinations = 0;
let excludeAlternateFound = 0;
let excludeGapFilledByGenerated = 0;

for (const category of categories) {
  const catSounds = allSounds.filter((s) => s.category === category.id);
  if (catSounds.length === 0) continue;
  const tags = new Set();
  for (const s of catSounds) for (const t of s.tags) tags.add(t);
  const tagOptions = [null, ...tags];

  for (const tag of tagOptions) {
    for (const style of styles) {
      const chipvoicePick = pickSoundForEvent(category.id, { style, tag, sounds: chipvoiceSounds });
      if (!chipvoicePick) continue; // requirement 3 only applies where a chipvoice-only pick exists
      excludeCombinations++;
      const label = `category=${category.id} tag=${tag ?? "none"} style=${style ?? "none"}`;
      const exclude = new Set([chipvoicePick.id]);
      const chipvoiceOnlyNext = pickSoundForEvent(category.id, { style, tag, exclude, sounds: chipvoiceSounds });
      const fullNext = pickSoundForEvent(category.id, { style, tag, exclude, sounds: allSounds });

      if (chipvoiceOnlyNext && chipvoiceOnlyNext.id !== chipvoicePick.id) {
        excludeAlternateFound++;
        assert.equal(
          fullNext?.id,
          chipvoiceOnlyNext.id,
          `${label}: excluding ${chipvoicePick.id} on the full pool must give the same next pick (${chipvoiceOnlyNext.id}) as the chipvoice-only pool, not ${fullNext?.id ?? "null"}`,
        );
      } else if (fullNext && fullNext.id !== chipvoicePick.id) {
        excludeGapFilledByGenerated++;
        assert.equal(
          fullNext.origin,
          "generated",
          `${label}: with no other chipvoice candidate once ${chipvoicePick.id} is excluded, the full pool may only differ by a generated sound filling the gap, got origin ${fullNext.origin}`,
        );
      } else {
        assert.equal(
          fullNext?.id,
          chipvoicePick.id,
          `${label}: with no other chipvoice candidate once ${chipvoicePick.id} is excluded and no generated sound fills the gap, the full pool must fall back to the same sound again too, got ${fullNext?.id ?? "null"}`,
        );
      }
    }
  }
}

console.log(
  `PASS exhaustive exclude/swap resolve invariant held across ${excludeCombinations} combination(s) with an existing chipvoice pick: ` +
    `${excludeAlternateFound} had a genuine alternate chipvoice candidate (the full pool matched it exactly); ${excludeGapFilledByGenerated} had none, ` +
    "and a generated sound filled the gap in place of \"the same sound again\" (the only permitted difference) - see docs/GAMESOUNDS.md's resolve-invariant paragraph.",
);

// Exposed so a one-off script (or a future doc-generation step) can print
// the exact list without re-deriving it - see the build note this test's
// own PASS line points to.
export { newlyResolved };
