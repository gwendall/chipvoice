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

// Exposed so a one-off script (or a future doc-generation step) can print
// the exact list without re-deriving it - see the build note this test's
// own PASS line points to.
export { newlyResolved };
