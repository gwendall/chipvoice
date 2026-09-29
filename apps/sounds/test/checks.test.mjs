// Negative tests for scripts/lib/checks.mjs: every exported check gets input
// built specifically to fail it, proving the check actually fires rather
// than passing everything by accident. See checks.mjs's own header comment.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  checkLicense,
  checkSha256,
  checkNoClipping,
  checkLeadingSilence,
  checkLoudnessBand,
  checkOneCeilingBinds,
  checkChipvoiceVariantCount,
  checkGeneratedVariantCount,
  checkSound,
  checkFormatEnergy,
  checkFormatEnergies,
  collectFormatPeakDeltas,
  collectFormatEnergyDeltas,
  LOUDNESS_CEILING_EPSILON_LU,
  PEAK_EPSILON_DB,
  FORMAT_ENERGY_TOLERANCE_DB,
} from "../scripts/lib/checks.mjs";
import { LOUDNESS_TARGET_LUFS, TRUE_PEAK_CEILING_DBTP } from "../scripts/lib/audio.mjs";

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

{
  const cc0WithAttribution = {
    license: "CC0-1.0",
    attribution: "Photo by Someone",
    source: { name: "chipvoice", url: "https://chipvoice.dev", author: "Gwendall Esnault" },
  };
  const result = checkLicense(cc0WithAttribution);
  assert.equal(result.ok, false, "CC0-1.0 must never carry required attribution text");
  console.log("PASS checkLicense fails a CC0-1.0 sound with attribution text");
}

{
  const attributedWithoutCredit = {
    license: "CC-BY-4.0",
    attribution: null,
    source: { name: "Someone", url: "https://example.com", author: "Someone" },
  };
  const result = checkLicense(attributedWithoutCredit);
  assert.equal(result.ok, false, "a non-CC0 license with no attribution text must fail");
  console.log("PASS checkLicense fails a non-CC0 sound missing attribution text");
}

{
  const missingSource = { license: "CC0-1.0", attribution: null, source: null };
  const result = checkLicense(missingSource);
  assert.equal(result.ok, false, "a sound with no source name/url/author must fail");
  console.log("PASS checkLicense fails a sound with no source record");
}

{
  const bytes = Buffer.from("real file bytes");
  const wrongExpected = sha256Hex(Buffer.from("a different file entirely"));
  const result = checkSha256(bytes, wrongExpected, sha256Hex);
  assert.equal(result.ok, false, "mismatched sha256 must fail, proving the digest is actually compared");
  console.log("PASS checkSha256 fails when the digest does not match");
}

{
  const result = checkNoClipping(1.0);
  assert.equal(result.ok, false, "a full-scale peak must fail as clipping");
  console.log("PASS checkNoClipping fails a peak at full scale");

  const overScale = checkNoClipping(1.5);
  assert.equal(overScale.ok, false, "a peak past full scale must also fail");
  console.log("PASS checkNoClipping fails a peak past full scale");
}

{
  // 50ms of true silence at 44100Hz, then a full-scale tone: well past the
  // 10ms default leading-silence budget.
  const sampleRate = 44100;
  const silentSamples = Math.round(sampleRate * 0.05);
  const toneSamples = Math.round(sampleRate * 0.05);
  const left = new Float32Array(silentSamples + toneSamples);
  for (let i = silentSamples; i < left.length; i++) {
    left[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate);
  }
  const result = checkLeadingSilence(left, null, sampleRate, { maxMs: 10, floorDb: -60 });
  assert.equal(result.ok, false, "50ms of leading silence must fail a 10ms budget");
  console.log("PASS checkLeadingSilence fails a file with excess leading silence");
}

{
  const silent = new Float32Array(1000);
  const result = checkLeadingSilence(silent, null, 44100, { maxMs: 10 });
  assert.equal(result.ok, false, "an entirely silent file must fail, not be treated as instant-onset");
  console.log("PASS checkLeadingSilence fails a fully silent file");
}

{
  // Peak ceiling must fail independently of an otherwise on-target LUFS
  // value: this is the "peak cap always wins" requirement.
  const measure = { lufs: LOUDNESS_TARGET_LUFS, peakDb: TRUE_PEAK_CEILING_DBTP + PEAK_EPSILON_DB + 1 };
  const result = checkLoudnessBand(measure);
  assert.equal(result.ok, false, "a true peak over the ceiling must fail even with on-target LUFS");
  console.log("PASS checkLoudnessBand fails on true peak alone, independent of LUFS");
}

{
  // Both figures are ceilings, not a symmetric band: a sound far quieter
  // than -18 LUFS is exactly what a peak-limited, high-crest-factor source
  // (a click, a hit) is expected to measure once the true-peak cap has
  // capped its gain (see levelToConvention's header) - it must pass, not
  // fail, or every such sound in the real catalogue would be refused for
  // being leveled correctly.
  const measure = { lufs: LOUDNESS_TARGET_LUFS - 20, peakDb: TRUE_PEAK_CEILING_DBTP - 3 };
  const result = checkLoudnessBand(measure);
  assert.equal(result.ok, true, "LUFS far below the ceiling must pass when true peak is safely under its own ceiling too (LUFS is a ceiling, not a target)");
  console.log("PASS checkLoudnessBand passes LUFS far under its ceiling, proving it is a ceiling and not a symmetric band");
}

{
  const measure = { lufs: LOUDNESS_TARGET_LUFS + (LOUDNESS_CEILING_EPSILON_LU + 5), peakDb: TRUE_PEAK_CEILING_DBTP - 3 };
  const result = checkLoudnessBand(measure);
  assert.equal(result.ok, false, "LUFS over its ceiling must fail even with a safe true peak");
  console.log("PASS checkLoudnessBand fails on LUFS alone, over its ceiling");
}

{
  // Sanity: the same measure, exactly on both ceilings, must pass -
  // otherwise the negative tests above would be meaningless (a check that
  // always fails would also "pass" every negative test).
  const measure = { lufs: LOUDNESS_TARGET_LUFS, peakDb: TRUE_PEAK_CEILING_DBTP };
  const result = checkLoudnessBand(measure);
  assert.equal(result.ok, true, "a measure exactly on both ceilings must pass");
  console.log("PASS checkLoudnessBand passes a measure exactly on both ceilings (sanity check for the negative tests above)");
}

{
  // checkSound orchestrates: feed it a sound broken in two independent ways
  // (bad license, bad loudness on its one variant) and confirm both
  // failures are reported, not just the first.
  const clean = { lufs: LOUDNESS_TARGET_LUFS, peakDb: TRUE_PEAK_CEILING_DBTP };
  const badSound = {
    license: "CC0-1.0",
    attribution: "should not be here",
    source: { name: "chipvoice", url: "https://chipvoice.dev", author: "Gwendall Esnault" },
    origin: "generated", // meets the 3-variant floor below, isolating this test from checkGeneratedVariantCount
    variants: [
      { n: 1, sha256: "badloud", measure: { lufs: -5, peakDb: -10 } }, // over the LUFS ceiling, independent of the license failure above
      { n: 2, sha256: "clean2", measure: clean },
      { n: 3, sha256: "clean3", measure: clean },
    ],
  };
  const failures = checkSound(badSound, {}, sha256Hex);
  assert.ok(failures.some((f) => f.startsWith("license:")), "checkSound must surface the license failure");
  assert.ok(failures.some((f) => f.startsWith("variant 1 loudness:")), "checkSound must surface the per-variant loudness failure");
  assert.equal(failures.length, 2, "both independent failures must be reported, not just one");
  console.log("PASS checkSound reports every independent failure, not just the first");
}

{
  // checkSound must check EVERY variant's own measure, not just the first -
  // a sound with a clean variant 1 and a broken variant 2 must still fail,
  // proving a bad later variant cannot hide behind a good first one (the
  // exact bug this was written against: assembleSound used to strip every
  // variant's own measure and check only variant 1's).
  const sound = {
    license: "CC0-1.0",
    attribution: null,
    source: { name: "chipvoice", url: "https://chipvoice.dev", author: "Gwendall Esnault" },
    origin: "generated", // meets the 3-variant floor below, isolating this test from checkGeneratedVariantCount
    variants: [
      { n: 1, sha256: "clean1", measure: { lufs: LOUDNESS_TARGET_LUFS, peakDb: TRUE_PEAK_CEILING_DBTP } },
      { n: 2, sha256: "broken2", measure: { lufs: -3, peakDb: -2 } },
      { n: 3, sha256: "clean3", measure: { lufs: LOUDNESS_TARGET_LUFS, peakDb: TRUE_PEAK_CEILING_DBTP } },
    ],
  };
  const failures = checkSound(sound, {}, sha256Hex);
  assert.ok(!failures.some((f) => f.startsWith("variant 1 loudness:")), "variant 1's clean measure must not itself fail");
  assert.ok(failures.some((f) => f.startsWith("variant 2 loudness:")), "variant 2's broken measure must fail even though variant 1 is clean");
  console.log("PASS checkSound checks every variant's own measure, not just the first");
}

{
  // checkChipvoiceVariantCount: a chipvoice sound is generated, not
  // sourced, so it has no excuse for fewer than the required minimum.
  const tooFew = { origin: "chipvoice", variants: [{ n: 1 }, { n: 2 }] };
  const result = checkChipvoiceVariantCount(tooFew);
  assert.equal(result.ok, false, "a chipvoice sound with 2 variants must fail the 3-variant minimum");
  console.log("PASS checkChipvoiceVariantCount fails a chipvoice sound with fewer than 3 variants");

  const enough = { origin: "chipvoice", variants: [{ n: 1 }, { n: 2 }, { n: 3 }] };
  assert.equal(checkChipvoiceVariantCount(enough).ok, true, "3 variants meets the minimum");

  // A non-chipvoice origin (generated, GS-03) is not held to this floor by
  // this check - checkGeneratedVariantCount (below) defines its own rule
  // instead of inheriting chipvoice's by accident.
  const generatedWithOne = { origin: "generated", variants: [{ n: 1 }] };
  assert.equal(checkChipvoiceVariantCount(generatedWithOne).ok, true, "a non-chipvoice origin is not held to the chipvoice minimum");
  console.log("PASS checkChipvoiceVariantCount only binds chipvoice-origin sounds");
}

{
  // checkGeneratedVariantCount: the generated-origin analogue (GS-03). A
  // generated sound is rendered from a seed ladder, not sourced, so it has
  // the same lack of excuse for fewer than the minimum.
  const tooFew = { origin: "generated", variants: [{ n: 1 }, { n: 2 }] };
  const result = checkGeneratedVariantCount(tooFew);
  assert.equal(result.ok, false, "a generated sound with 2 variants must fail the 3-variant minimum");
  console.log("PASS checkGeneratedVariantCount fails a generated sound with fewer than 3 variants");

  const enough = { origin: "generated", variants: [{ n: 1 }, { n: 2 }, { n: 3 }] };
  assert.equal(checkGeneratedVariantCount(enough).ok, true, "3 variants meets the minimum");

  // A chipvoice-origin sound is not held to this floor by this check - it
  // has its own (checkChipvoiceVariantCount, above).
  const chipvoiceWithOne = { origin: "chipvoice", variants: [{ n: 1 }] };
  assert.equal(checkGeneratedVariantCount(chipvoiceWithOne).ok, true, "a non-generated origin is not held to the generated minimum");
  console.log("PASS checkGeneratedVariantCount only binds generated-origin sounds");
}

{
  // checkSound wires checkGeneratedVariantCount in too, under the same
  // "variant count:" label chipvoice's own failure uses (GS-03's rule is
  // meant to read as the same rule applied to the other origin, not a
  // different kind of failure).
  const tooFewGenerated = {
    license: "CC0-1.0",
    attribution: null,
    source: { name: "gamesounds sfx-engine", url: "https://gamesounds.ai", author: "Gwendall Esnault" },
    origin: "generated",
    variants: [
      { n: 1, sha256: "a", measure: { lufs: LOUDNESS_TARGET_LUFS, peakDb: TRUE_PEAK_CEILING_DBTP } },
      { n: 2, sha256: "b", measure: { lufs: LOUDNESS_TARGET_LUFS, peakDb: TRUE_PEAK_CEILING_DBTP } },
    ],
  };
  const failures = checkSound(tooFewGenerated, {}, sha256Hex);
  assert.ok(failures.some((f) => f.startsWith("variant count:")), "checkSound must surface a generated sound's variant-count failure");
  console.log("PASS checkSound refuses a generated sound with fewer than 3 variants, with a negative test proving it");
}

{
  // checkSound wires the variant-count check in too: a chipvoice sound
  // built with only 2 variants must fail even when every other check
  // passes, and the failure must name itself so a broken build is
  // diagnosable at a glance.
  const tooFewChipvoice = {
    license: "CC0-1.0",
    attribution: null,
    source: { name: "chipvoice", url: "https://chipvoice.dev", author: "Gwendall Esnault" },
    origin: "chipvoice",
    variants: [
      { n: 1, sha256: "a", measure: { lufs: LOUDNESS_TARGET_LUFS, peakDb: TRUE_PEAK_CEILING_DBTP } },
      { n: 2, sha256: "b", measure: { lufs: LOUDNESS_TARGET_LUFS, peakDb: TRUE_PEAK_CEILING_DBTP } },
    ],
  };
  const failures = checkSound(tooFewChipvoice, {}, sha256Hex);
  assert.ok(failures.some((f) => f.startsWith("variant count:")), "checkSound must surface a chipvoice sound's variant-count failure");
  console.log("PASS checkSound refuses a chipvoice sound with fewer than 3 variants, with a negative test proving it");
}

{
  // checkOneCeilingBinds replaces the old derived-floor approach: a
  // correctly leveled variant always lands within epsilon of at least one
  // ceiling (levelToConvention applies whichever of the two gains is
  // smaller, so that metric ends up almost exactly on its own ceiling - see
  // the function's own header). lufs -30 / peak -10 sits well under BOTH
  // ceilings (gap 20, under this build's old derived floor of about -37.5,
  // which the old floor-based check let straight through) - this is exactly
  // the broken-gain-stage case the old derived floor could miss whenever a
  // wider legitimate gap existed elsewhere in the same build.
  const brokenVariant = { lufs: -30, peakDb: -10 };
  const passesTheStaticCeilingsAlone = checkLoudnessBand(brokenVariant).ok;
  assert.equal(passesTheStaticCeilingsAlone, true, "sanity: the two static ceilings alone do not catch this - checkOneCeilingBinds is what has to");
  const result = checkOneCeilingBinds(brokenVariant);
  assert.equal(result.ok, false, "a broken leveling that reaches neither ceiling must fail, proving this gate is strictly stronger than the derived floor it replaces");
  assert.match(result.reason, /neither/, "the failure reason explains that neither ceiling was reached");
  console.log("PASS checkOneCeilingBinds fails lufs -30 / peak -10, which the old derived floor would have passed");
}

{
  // A loudness-bound variant: on-target LUFS, true peak safely under its
  // own ceiling. The loudness ceiling binds, so this passes even though the
  // peak ceiling does not.
  const measure = { lufs: -18, peakDb: -6 };
  const result = checkOneCeilingBinds(measure);
  assert.equal(result.ok, true, "lufs -18 / peak -6 passes: the loudness ceiling binds");
  console.log("PASS checkOneCeilingBinds passes lufs -18 / peak -6 (loudness ceiling binds)");
}

{
  // A peak-bound, high-crest-factor variant (a click, a hit): true peak at
  // its ceiling, LUFS pulled far down by the crest factor. The peak
  // ceiling binds, so this passes even though LUFS is nowhere near -18 -
  // exactly the legitimately quiet, peak-capped case the old derived floor
  // existed to protect, now proven directly from this variant's own two
  // measures instead of a statistic borrowed from the rest of the build.
  const measure = { lufs: -34.5, peakDb: -1 };
  const result = checkOneCeilingBinds(measure);
  assert.equal(result.ok, true, "lufs -34.5 / peak -1 passes: the true-peak ceiling binds");
  console.log("PASS checkOneCeilingBinds passes lufs -34.5 / peak -1 (true-peak ceiling binds)");
}

{
  // checkSound wires checkOneCeilingBinds in too: a sound whose one variant
  // sits under both static ceilings (so checkLoudnessBand alone stays
  // silent) must still fail, with a failure that names the loudness gate
  // specifically so it reads differently from an over-ceiling failure.
  const brokenSound = {
    license: "CC0-1.0",
    attribution: null,
    source: { name: "chipvoice", url: "https://chipvoice.dev", author: "Gwendall Esnault" },
    origin: "generated", // meets the 3-variant floor below, isolating this test from checkGeneratedVariantCount
    variants: [
      { n: 1, sha256: "neitherbinds", measure: { lufs: -30, peakDb: -10 } },
      { n: 2, sha256: "clean2", measure: { lufs: LOUDNESS_TARGET_LUFS, peakDb: TRUE_PEAK_CEILING_DBTP } },
      { n: 3, sha256: "clean3", measure: { lufs: LOUDNESS_TARGET_LUFS, peakDb: TRUE_PEAK_CEILING_DBTP } },
    ],
  };
  const failures = checkSound(brokenSound, {}, sha256Hex);
  assert.ok(!failures.some((f) => f.startsWith("variant 1 loudness:")), "the two static ceilings alone must not fire on this variant");
  assert.ok(failures.some((f) => f.startsWith("variant 1 loudness gate:")), "checkSound must surface the one-ceiling-binds failure under its own label");
  console.log("PASS checkSound refuses a variant that reaches neither ceiling, even though the static ceiling checks alone pass it");
}

{
  // checkSound must also wire in the per-variant clipping and leading-silence
  // checks via `variantData` - not just license/sha256/loudness - since the
  // build's actual gate (scripts/build-catalog.mjs) calls checkSound alone,
  // not the standalone checks directly.
  const clippedLeft = new Float32Array(2000).fill(0.5);
  clippedLeft[100] = 1.0; // a single full-scale sample: clipping
  const sound = {
    license: "CC0-1.0",
    attribution: null,
    source: { name: "chipvoice", url: "https://chipvoice.dev", author: "Gwendall Esnault" },
    variants: [{ n: 1, sha256: "deadbeef", measure: { lufs: LOUDNESS_TARGET_LUFS, peakDb: TRUE_PEAK_CEILING_DBTP } }],
  };
  const variantData = { deadbeef: { peakLinear: 1.0, left: clippedLeft, right: null, sampleRate: 44100 } };
  const failures = checkSound(sound, variantData, sha256Hex);
  assert.ok(failures.some((f) => f.startsWith("variant 1 clipping:")), "checkSound must surface a per-variant clipping failure from variantData");
  console.log("PASS checkSound reports a per-variant clipping failure via variantData");
}

{
  const sampleRate = 44100;
  const silentSamples = Math.round(sampleRate * 0.05);
  const left = new Float32Array(silentSamples + 500);
  for (let i = silentSamples; i < left.length; i++) left[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate);
  const sound = {
    license: "CC0-1.0",
    attribution: null,
    source: { name: "chipvoice", url: "https://chipvoice.dev", author: "Gwendall Esnault" },
    variants: [{ n: 1, sha256: "cafef00d", measure: { lufs: LOUDNESS_TARGET_LUFS, peakDb: TRUE_PEAK_CEILING_DBTP } }],
  };
  const variantData = { cafef00d: { peakLinear: 1, left, right: null, sampleRate } };
  const failures = checkSound(sound, variantData, sha256Hex);
  assert.ok(failures.some((f) => f.startsWith("variant 1 leading silence:")), "checkSound must surface a per-variant leading-silence failure from variantData");
  console.log("PASS checkSound reports a per-variant leading-silence failure via variantData");
}

{
  const goodMeasure = { lufs: LOUDNESS_TARGET_LUFS, peakDb: TRUE_PEAK_CEILING_DBTP };
  const goodSound = {
    license: "CC0-1.0",
    attribution: null,
    source: { name: "chipvoice", url: "https://chipvoice.dev", author: "Gwendall Esnault" },
    origin: "generated",
    variants: [
      { n: 1, sha256: "good1", measure: goodMeasure },
      { n: 2, sha256: "good2", measure: goodMeasure },
      { n: 3, sha256: "good3", measure: goodMeasure },
    ],
  };
  const failures = checkSound(goodSound, {}, sha256Hex);
  assert.deepEqual(failures, [], "a genuinely clean sound must report no failures (sanity check)");
  console.log("PASS checkSound reports no failures for a genuinely clean sound");
}

{
  // checkFormatEnergy is now the whole gate (no aggregate layer) - it must
  // still catch a gross per-file failure that no tolerance should ever
  // admit: a channel that decoded silent even though the wav's own energy on
  // that channel is real.
  const result = checkFormatEnergy(0.49, 0, { format: "ogg", channel: "left" });
  assert.equal(result.ok, false, "a channel that decoded silent must fail regardless of tolerance");
  console.log("PASS checkFormatEnergy fails a channel that decoded silent");
}

{
  // checkFormatEnergies must refuse a stereo source whose shipped format
  // decoded back as mono outright - a channel silently collapsed, never a
  // loudness rounding difference, so no toleranceDb value should admit it.
  const sourceEnergy = { left: 0.49, right: 0.42 };
  const formatEnergy = { ogg: { left: 0.49, right: null }, mp3: { left: 0.49, right: 0.42 } };
  const result = checkFormatEnergies(sourceEnergy, formatEnergy);
  assert.equal(result.ok, false, "a stereo source collapsing to a mono ogg must fail");
  assert.match(result.reason, /silently collapsed/, "the failure must name the collapsed-channel case, not a generic tolerance miss");
  console.log("PASS checkFormatEnergies refuses a stereo source that collapsed to mono in the shipped ogg");
}

{
  // This is the negative test the coordinator's round-2 review asked for,
  // made concrete: the old ogg fallback path's `-ac 2` upmix applies
  // ffmpeg's default -3.0103 dB in the energy domain too
  // (10*log10((1/sqrt(2))**2), the same numeric value as its peak-domain
  // 20*log10(1/sqrt(2)) counterpart, since a uniform amplitude scale
  // produces the same dB delta in either domain). Unlike the old per-variant
  // peak backstop (17 dB, sized to admit legitimate outliers that turned out
  // not to be legitimate), checkFormatEnergy catches this bug DIRECTLY, on a
  // single variant, with no aggregate needed - the exact design change this
  // round of review required.
  const oldAcTwoDeltaDb = 10 * Math.log10(1 / 2);
  const wavEnergy = 0.49;
  const buggyOggEnergy = wavEnergy * Math.pow(10, oldAcTwoDeltaDb / 10);
  const left = checkFormatEnergy(wavEnergy, buggyOggEnergy, { format: "ogg", channel: "left" });
  assert.equal(left.ok, false, `a single -3.0103 dB -ac 2 style delta must fail the +/-${FORMAT_ENERGY_TOLERANCE_DB} dB per-variant energy gate directly`);
  console.log(
    `PASS checkFormatEnergy fails a single old-\`-ac 2\`-sized delta (${oldAcTwoDeltaDb.toFixed(4)} dB) directly, per variant, ` +
      "with no aggregate check required",
  );
}

{
  // The second negative test this round of review required: a HF-dominated
  // signal whose lossy encode loses real energy must fail too - not just the
  // uniform -ac 2 upmix case above. Numbers matched to the measured
  // pickup-key class of defect (13.2 to 18.2 dB of real, sum-based energy
  // lost across its seed ladder) that led to that preset's exclusion
  // (build-catalog.mjs's EXCLUDED_PRESETS).
  const wavEnergy = 0.09; // -20.9 dB RMS-ish source energy, matching pickup-key's own order of magnitude
  const hfLossDeltaDb = -18.2;
  const lossyOggEnergy = wavEnergy * Math.pow(10, hfLossDeltaDb / 10);
  const result = checkFormatEnergy(wavEnergy, lossyOggEnergy, { format: "ogg", channel: "left" });
  assert.equal(result.ok, false, "a HF-dominated signal that loses 18.2 dB of real energy through the lossy encode must fail");
  assert.match(result.reason, /codec passband/, "the failure reason must point at the codec-passband/exclusion explanation, not a generic tolerance miss");
  console.log("PASS checkFormatEnergy fails a HF-dominated signal whose lossy encode loses real energy (the pickup-key class of defect, 18.2 dB)");
}

{
  // The complementary positive case: the real, healthy catalogue's worst
  // remaining delta after the three HF-dominated presets are excluded
  // (footstep-water-puddle, measured at 0.56 dB) must comfortably pass.
  const wavEnergy = 0.09;
  const healthyDeltaDb = -0.56;
  const healthyOggEnergy = wavEnergy * Math.pow(10, healthyDeltaDb / 10);
  const result = checkFormatEnergy(wavEnergy, healthyOggEnergy, { format: "ogg", channel: "left" });
  assert.equal(result.ok, true, "the real catalogue's worst healthy delta (0.56 dB, footstep-water-puddle) must pass the 1.0 dB tolerance");
  console.log("PASS checkFormatEnergy passes the real catalogue's worst healthy delta (0.56 dB) with margin");
}

{
  // collectFormatPeakDeltas is kept, but only as informational build-log
  // data now (never a gate) - prove it still returns one finite dB delta per
  // valid format/channel reading, matching the plain peak-domain dB formula.
  const sourcePeaks = { left: 0.7, right: null };
  const formatPeaks = { ogg: { left: 0.7, right: 0.7 }, mp3: { left: 0.35, right: null } };
  const deltas = collectFormatPeakDeltas(sourcePeaks, formatPeaks);
  assert.equal(deltas.length, 3, "mono source upmixed to stereo ogg (2 readings) plus a mono mp3 (1 reading) = 3 deltas");
  assert.ok(deltas.every((d) => Number.isFinite(d)), "every collected delta must be a finite number");
  const mp3Delta = 20 * Math.log10(0.35 / 0.7);
  assert.ok(deltas.some((d) => Math.abs(d - mp3Delta) < 1e-9), "the mp3 delta must match the plain peak-domain dB formula");
  console.log("PASS collectFormatPeakDeltas returns one finite dB delta per valid format/channel reading (informational only, not a gate)");
}

{
  // collectFormatEnergyDeltas mirrors collectFormatPeakDeltas above, for the
  // metric that actually gates the build now - prove it too returns one
  // finite dB delta per valid format/channel reading, matching the plain
  // energy-domain (10*log10) dB formula, and that it is what this file's own
  // FORMAT_ENERGY_TOLERANCE_DB and build-catalog.mjs's EXCLUDED_PRESETS
  // reasons were derived from (docs/DECISIONS.md decision 54).
  const sourceEnergy = { left: 0.49, right: null };
  const formatEnergy = { ogg: { left: 0.49, right: 0.49 }, mp3: { left: 0.245, right: null } };
  const deltas = collectFormatEnergyDeltas(sourceEnergy, formatEnergy);
  assert.equal(deltas.length, 3, "mono source upmixed to stereo ogg (2 readings) plus a mono mp3 (1 reading) = 3 deltas");
  assert.ok(deltas.every((d) => Number.isFinite(d)), "every collected delta must be a finite number");
  const mp3Delta = 10 * Math.log10(0.245 / 0.49);
  assert.ok(deltas.some((d) => Math.abs(d - mp3Delta) < 1e-9), "the mp3 delta must match the plain energy-domain (10*log10) dB formula");
  console.log("PASS collectFormatEnergyDeltas returns one finite dB delta per valid format/channel reading (the same numbers the gate itself judges)");
}
