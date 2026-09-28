// GS-03's "known trap": sfx-engine meters and normalizes mono, internally,
// BEFORE panning to stereo at pan 0 (packages/sfx-engine/src/render/renderRecipe.ts) -
// so its own self-reported loudness figure describes a signal about 3.01 LU
// louder than what actually ships (equal-power pan law: left = mono *
// cos(pi/4), about -3.01dB). Trusting that figure instead of re-measuring
// the actual shipped bytes through the catalogue's own levelToConvention
// would silently under-level every generated variant. This proves the
// catalogue's build (scripts/build-catalog.mjs's renderGeneratedVariants)
// avoids that trap, and that the trap is real: a variant built the wrong
// way (skipping levelToConvention, trusting the engine's own pre-pan
// figure) fails checkOneCeilingBinds on its true, independently-measured
// shipped bytes even though the engine's own stale figure looks fine.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { levelToConvention, measureLoudness, toWavBytes, peakOf } from "../scripts/lib/audio.mjs";
import { checkOneCeilingBinds } from "../scripts/lib/checks.mjs";

const sfxEngineDist = new URL("../../../packages/sfx-engine/dist/index.js", import.meta.url).href;
const { renderRecipe, recipeForPreset } = await import(sfxEngineDist);

const recipe = recipeForPreset("impact-metal-heavy", 1, 44100);
const rendered = renderRecipe(recipe);
const left = Float32Array.from(rendered.left);
const render = { sampleRate: rendered.sampleRate, left, right: null, seconds: rendered.durationSeconds, peak: peakOf(left, null) };

let dir;
try {
  dir = mkdtempSync(join(tmpdir(), "gamesounds-generated-loudness-"));

  // Correct: run the raw render through the catalogue's OWN levelToConvention
  // (re-measures the exact bytes about to ship, on their actual mono
  // layout) before shipping - exactly what renderGeneratedVariants does.
  const leveled = levelToConvention(render);
  const correctPath = join(dir, "correct.wav");
  writeFileSync(correctPath, toWavBytes(leveled));
  const correctMeasured = measureLoudness(correctPath);
  const correctResult = checkOneCeilingBinds(correctMeasured);
  assert.equal(
    correctResult.ok,
    true,
    `a variant leveled by the catalogue's own levelToConvention on its actual shipped (mono) layout must reach one of the two ceilings, got ${correctMeasured.lufs} LUFS / ${correctMeasured.peakDb} dBTP: ${correctResult.reason ?? ""}`,
  );
  console.log(
    `PASS a generated variant leveled through the catalogue's own pipeline on its actual shipped layout passes checkOneCeilingBinds (${correctMeasured.lufs} LUFS / ${correctMeasured.peakDb} dBTP)`,
  );

  // The trap: ship the raw (never re-leveled) bytes, and trust sfx-engine's
  // own self-reported momentary/true-peak figures - computed on the pre-pan
  // MONO signal, about 3dB hotter than what `left` (the post-pan channel
  // actually shipped) really measures - as this variant's recorded measure,
  // the exact mistake "never trusting the engine's own mono -18" warns
  // against.
  const untrustedPath = join(dir, "untrusted.wav");
  writeFileSync(untrustedPath, toWavBytes(render));
  const staleMeasure = { lufs: rendered.loudness.momentaryLufsAfter, peakDb: rendered.loudness.truePeakDbAfter };
  assert.equal(
    checkOneCeilingBinds(staleMeasure).ok,
    true,
    "sanity: the engine's own stale, pre-pan self-report looks like it binds a ceiling in isolation - the negative case below is what actually catches the trap",
  );
  const actualShipped = measureLoudness(untrustedPath);
  const trapResult = checkOneCeilingBinds(actualShipped);
  assert.equal(
    trapResult.ok,
    false,
    `trusting the engine's own pre-pan mono figure instead of re-measuring the actually-shipped bytes must be caught: the real shipped file measures ${actualShipped.lufs} LUFS / ${actualShipped.peakDb} dBTP, which should reach neither ceiling`,
  );
  assert.match(trapResult.reason, /neither/, "the failure explains that the actually-shipped bytes reach neither ceiling");
  console.log(
    `PASS a variant shipped without re-leveling (trusting the engine's own pre-pan mono figure) fails checkOneCeilingBinds on its true, independently-measured bytes (${actualShipped.lufs} LUFS / ${actualShipped.peakDb} dBTP), proving the trap is real and the catalogue's own re-leveling pass is required`,
  );
} finally {
  if (dir) rmSync(dir, { recursive: true, force: true });
}
