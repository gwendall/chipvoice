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
  checkChipvoiceVariantCount,
  checkSound,
  deriveLoudnessFloor,
  loudnessGap,
  LOUDNESS_CEILING_EPSILON_LU,
  LOUDNESS_FLOOR_MARGIN_DB,
  PEAK_EPSILON_DB,
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
  const badSound = {
    license: "CC0-1.0",
    attribution: "should not be here",
    source: { name: "chipvoice", url: "https://chipvoice.dev", author: "Gwendall Esnault" },
    origin: "generated", // not "chipvoice": isolates this test from the variant-count check below
    variants: [{ n: 1, sha256: "badloud", measure: { lufs: -5, peakDb: -10 } }], // over the LUFS ceiling, independent of the license failure above
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
    origin: "generated", // not "chipvoice": isolates this test from the variant-count check below
    variants: [
      { n: 1, sha256: "clean1", measure: { lufs: LOUDNESS_TARGET_LUFS, peakDb: TRUE_PEAK_CEILING_DBTP } },
      { n: 2, sha256: "broken2", measure: { lufs: -3, peakDb: -2 } },
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

  // A non-chipvoice origin (the procedural engine, GS-02, reserved as
  // "generated") is not held to this floor by this check - it would define
  // its own rule when it exists, not inherit chipvoice's by accident.
  const generatedWithOne = { origin: "generated", variants: [{ n: 1 }] };
  assert.equal(checkChipvoiceVariantCount(generatedWithOne).ok, true, "a non-chipvoice origin is not held to the chipvoice minimum");
  console.log("PASS checkChipvoiceVariantCount only binds chipvoice-origin sounds");
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
  // loudnessGap and deriveLoudnessFloor: the floor is derived from the
  // widest measured peak-to-loudness gap plus a stated margin, not picked
  // to pass. A legitimately peak-capped, high-crest-factor variant (peak at
  // the ceiling, LUFS pulled down by a wide gap) must sit AT or above its
  // own build's derived floor - it IS the widest gap the floor is derived
  // from, so it can never itself be refused by the very floor it set.
  const measures = [
    { lufs: LOUDNESS_TARGET_LUFS, peakDb: TRUE_PEAK_CEILING_DBTP }, // an ordinary, loudness-bound variant: gap 17
    { lufs: -35, peakDb: TRUE_PEAK_CEILING_DBTP }, // a peak-bound click: gap 34, the widest in this build
  ];
  assert.equal(loudnessGap(measures[1]), 34, "loudnessGap is exactly peakDb - lufs");
  const floor = deriveLoudnessFloor(measures);
  assert.equal(floor, TRUE_PEAK_CEILING_DBTP - 34 - LOUDNESS_FLOOR_MARGIN_DB, "the floor is the ceiling minus the widest measured gap minus the stated margin");
  for (const measure of measures) {
    assert.equal(checkLoudnessBand(measure, { floorLufs: floor }).ok, true, "no variant this build actually shipped can fail the floor it was itself used to derive");
  }
  console.log(`PASS deriveLoudnessFloor derives ${floor} LUFS from the widest measured gap (34) plus a ${LOUDNESS_FLOOR_MARGIN_DB} dB margin, and never rejects the variant that set it`);
}

{
  // The floor's whole point: a broken leveling (a wrong target LUFS, a
  // skipped gain stage) ships audio far quieter than anything the build's
  // real content actually produced, and its own peak does NOT sit near the
  // ceiling either (a linear gain shifts both figures by the same amount -
  // see loudnessGap's header) - so it cannot be explained as "just another
  // peak-capped click" and must fail, even though a static -18 LUFS ceiling
  // alone would happily let it through (it is well under -18, not over it).
  const normalCatalogMeasures = [
    { lufs: LOUDNESS_TARGET_LUFS, peakDb: TRUE_PEAK_CEILING_DBTP - 6 },
    { lufs: -28, peakDb: TRUE_PEAK_CEILING_DBTP }, // the widest legitimate gap this build produced: 27
  ];
  const floor = deriveLoudnessFloor(normalCatalogMeasures);
  const brokenVariant = { lufs: -40, peakDb: -29 }; // gap 11: an ordinary crest factor, not an extreme peak-capped one
  const passesTheStaticCeilingAlone = checkLoudnessBand(brokenVariant).ok;
  assert.equal(passesTheStaticCeilingAlone, true, "sanity: a static ceiling alone does not catch this - the floor is what has to");
  const result = checkLoudnessBand(brokenVariant, { floorLufs: floor });
  assert.equal(result.ok, false, "a broken -40 LUFS leveling must fail the derived floor even though it passes the static ceiling alone");
  assert.match(result.reason, /floor/, "the failure reason names the floor, not a ceiling");
  console.log("PASS the derived floor fails a broken -40 LUFS leveling that a static ceiling alone would miss");
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
  const goodSound = {
    license: "CC0-1.0",
    attribution: null,
    source: { name: "chipvoice", url: "https://chipvoice.dev", author: "Gwendall Esnault" },
    origin: "generated", // not "chipvoice": a 1-variant sound is otherwise clean, this only isolates it from the variant-count floor
    variants: [{ n: 1, sha256: "good1", measure: { lufs: LOUDNESS_TARGET_LUFS, peakDb: TRUE_PEAK_CEILING_DBTP } }],
  };
  const failures = checkSound(goodSound, {}, sha256Hex);
  assert.deepEqual(failures, [], "a genuinely clean sound must report no failures (sanity check)");
  console.log("PASS checkSound reports no failures for a genuinely clean sound");
}
