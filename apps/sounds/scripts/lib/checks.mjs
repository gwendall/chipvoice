// The catalogue build's signal checks. Every one of these is exercised by a
// negative test in test/checks.test.mjs that feeds it input built to fail,
// so a broken check cannot silently start passing everything.
import { LOUDNESS_TARGET_LUFS, TRUE_PEAK_CEILING_DBTP, firstAboveFloor, peakOf, peakPerChannel } from "./audio.mjs";

// Two different, complementary checks guard the shipped ogg/mp3's own
// decoded loudness against the wav it was encoded from - both derived from
// decoding and measuring every one of the 1092 real variants in this
// catalogue (both origins, both formats) after the two fixes this file
// exists to guard (BITEXACT_ARGS and the fallback ogg path's unity-gain pan
// filter - see audio.mjs's vorbisEncoderArgs and encodeVariant).
//
// A single flat per-variant peak tolerance turns out NOT to be the right
// tool by itself: measured across the real catalogue, a per-channel decoded
// peak can legitimately sit up to ~16 dB under its wav sibling's peak, on a
// handful of presets whose technique is several sharp, fast-decaying
// struck-metal resonances in one short clip (`pickup-key`,
// `footstep-metal` - "modal synthesis") - a textbook case of lossy
// block-transform pre-echo/transient smearing (both libmp3lame and
// ffmpeg's native vorbis encoder spread a very short, sharp transient's
// energy across an entire MDCT block, lowering its peak while roughly
// preserving total energy), not a bug: verified directly by decoding both
// the wav and the shipped mp3/ogg into 20ms-bucket peak envelopes for the
// worst offender (`collect-key-realistic-pickup-key` v4) - the encoded
// formats' peaks are quiet only in the first ~160ms (the sharp attacks),
// converging to match the wav's own envelope almost exactly by the
// decay tail. The bug this whole file exists to catch (the old `-ac 2`
// upmix) has the opposite signature: a near-exact, content-INDEPENDENT
// -3.0103 dB (20*log10(1/sqrt(2))) on every single affected file, never a
// content-dependent outlier - so the two checks below are shaped around
// that difference, not a single number that tries to do both jobs:
//
// FORMAT_PEAK_TOLERANCE_DB is a per-variant, generous backstop (measured
// max |delta| across the real catalogue was 16.23 dB; this rounds up past
// it) - it exists to catch a gross per-file failure (a dropped/silent
// channel, a channel decoding far quieter than even the worst genuine
// transient-smearing case observed), not the systematic multi-dB bug.
export const FORMAT_PEAK_TOLERANCE_DB = 17;

// CATALOG_MEAN_FORMAT_PEAK_TOLERANCE_DB is the check that actually catches
// a systematic bug like the old `-ac 2` upmix: it is not a per-variant
// gate but a whole-build aggregate (checkCatalogFormatPeakMean, called once
// after every sound's checkSound has run - see build-catalog.mjs), over the
// mean of every per-format/per-channel |delta| collected across the whole
// build. Measured on the real, fixed catalogue (3276 format/channel
// readings across all 1092 variants): mean |delta| = 0.44 dB - the
// handful of genuinely peaky outliers above barely move it, since they are
// a small fraction of 3276 readings. A reintroduced `-ac 2` bug would push
// this mean toward -3 dB instead (it applies to EVERY fallback-path ogg
// channel, not a handful of presets), so a bound of 1.5 dB - over 3x the
// measured healthy baseline, and half the systematic bug's own size -
// separates the two cases with real margin in both directions.
export const CATALOG_MEAN_FORMAT_PEAK_TOLERANCE_DB = 1.5;

/** How far a sound's measured LUFS or true peak may sit above its ceiling
 * (never below - both are stated as "at most", not a target to hit exactly;
 * see levelToConvention's own header) before the build refuses it. This is
 * rounding slack only (ebur128's own log rounds to 0.1 dB, and the applied
 * gain is rounded to 0.01 dB before being applied), not a band chosen to
 * make today's catalogue pass: a peak-limited, high-crest-factor sound (a
 * click, a hit, a footstep) is *expected* to land well under the -18 LUFS
 * ceiling once the true-peak cap has capped its gain - see "peak cap takes
 * priority" in levelToConvention's header - so there is deliberately no
 * lower bound here. */
export const LOUDNESS_CEILING_EPSILON_LU = 0.2;
export const PEAK_EPSILON_DB = 0.2;

export function checkLicense(sound) {
  if (!sound || typeof sound.license !== "string" || !sound.license.trim()) {
    return { ok: false, reason: "missing license" };
  }
  if (sound.license === "CC0-1.0" && sound.attribution) {
    return { ok: false, reason: "CC0-1.0 sounds must not carry required attribution text" };
  }
  if (sound.license !== "CC0-1.0" && !sound.attribution) {
    return { ok: false, reason: `license "${sound.license}" requires attribution text, none given` };
  }
  if (!sound.source || !sound.source.name || !sound.source.url || !sound.source.author) {
    return { ok: false, reason: "missing source name, url or author" };
  }
  return { ok: true };
}

export function checkSha256(bytes, expectedHex, sha256Hex) {
  const actual = sha256Hex(bytes);
  if (actual !== expectedHex) return { ok: false, reason: `sha256 mismatch: expected ${expectedHex}, got ${actual}` };
  return { ok: true };
}

/** No sample in the shipped file may reach full scale: everything is leveled
 * below the true-peak ceiling, so a full-scale sample means the leveling
 * step was skipped or miscomputed, not a legitimate loud sound. */
export function checkNoClipping(peakLinear) {
  if (!Number.isFinite(peakLinear)) return { ok: false, reason: "peak is not a finite number" };
  if (peakLinear >= 0.999) return { ok: false, reason: `peak ${peakLinear.toFixed(4)} is at or past full scale` };
  return { ok: true };
}

/** The first sample louder than floorDb under the file's own peak must land
 * within maxMs of the start. Onset uses the same short windowed-RMS test as
 * `trimToZeroCrossing`'s own leading-edge trim (`firstAboveFloor`), on
 * purpose: this check audits what actually shipped against the exact
 * definition of "onset" the build used to decide where to cut, so the two
 * can never quietly disagree about what counts as silence (see
 * `firstAboveFloor`'s header for the bug that motivated this). */
export function checkLeadingSilence(left, right, sampleRate, { maxMs = 10, floorDb = -60 } = {}) {
  const peak = peakOf(left, right);
  if (peak === 0) return { ok: false, reason: "silent file" };
  const floor = peak * 10 ** (floorDb / 20);
  const i = firstAboveFloor(left, right, floor, sampleRate);
  const ms = (i / sampleRate) * 1000;
  if (ms > maxMs) return { ok: false, reason: `${ms.toFixed(1)}ms of leading silence, over the ${maxMs}ms limit` };
  return { ok: true };
}

/** Both figures are ceilings, not targets - "at most -18 LUFS momentary,
 * true peak at most -1 dBTP, peak cap takes priority" (the binding
 * requirement this build was given). Exceeding either fails; sitting under
 * either (however far under, for a peak-limited, high-crest-factor sound)
 * does not. The true-peak check runs first only because it is stated as the
 * more important of the two, not because a passing LUFS check would matter
 * once peak has already failed. */
export function checkLoudnessBand(
  measure,
  { targetLufs = LOUDNESS_TARGET_LUFS, lufsEpsilon = LOUDNESS_CEILING_EPSILON_LU, peakCeilingDb = TRUE_PEAK_CEILING_DBTP } = {},
) {
  if (!measure || typeof measure.lufs !== "number" || typeof measure.peakDb !== "number") {
    return { ok: false, reason: "missing measure.lufs or measure.peakDb" };
  }
  if (measure.peakDb > peakCeilingDb + PEAK_EPSILON_DB) {
    return { ok: false, reason: `true peak ${measure.peakDb} dBTP exceeds the ${peakCeilingDb} dBTP ceiling` };
  }
  if (measure.lufs > targetLufs + lufsEpsilon) {
    return { ok: false, reason: `${measure.lufs} LUFS exceeds the ${targetLufs} LUFS ceiling` };
  }
  return { ok: true };
}

/**
 * `levelToConvention` applies exactly one linear gain to a render: whichever
 * of the two is quieter, the gain that brings momentary LUFS to
 * `targetLufs` or the gain that brings true peak to `peakCeilingDb` (its own
 * header - "peak cap takes priority" when the two disagree). That means a
 * CORRECTLY leveled variant always lands within epsilon of at least one of
 * the two ceilings: whichever gain was the binding (smaller) one puts that
 * metric almost exactly on its ceiling, not merely under it. A variant that
 * sits under BOTH ceilings by more than rounding slack was never leveled by
 * this function at all - a skipped gain stage, a wrong target, a stray
 * scale factor - and `checkLoudnessBand`'s two ceiling checks alone cannot
 * catch it, since "quieter than the ceiling" is exactly what a passing
 * sound looks like too. Unlike the derived-floor approach this replaces,
 * this needs no cross-variant statistics (no widest observed gap, no
 * margin) - it is an exact, per-variant consequence of how the gain was
 * computed, so it cannot be fooled by a broken variant whose own gap
 * happens to fall inside another variant's legitimate range. See
 * `test/checks.test.mjs` for the negative test this replaces: a lufs -30 /
 * peak -10 variant, which the old derived floor let through.
 */
export function checkOneCeilingBinds(
  measure,
  { targetLufs = LOUDNESS_TARGET_LUFS, peakCeilingDb = TRUE_PEAK_CEILING_DBTP, lufsEpsilon = LOUDNESS_CEILING_EPSILON_LU, peakEpsilon = PEAK_EPSILON_DB } = {},
) {
  if (!measure || typeof measure.lufs !== "number" || typeof measure.peakDb !== "number") {
    return { ok: false, reason: "missing measure.lufs or measure.peakDb" };
  }
  const lufsBinds = measure.lufs >= targetLufs - lufsEpsilon;
  const peakBinds = measure.peakDb >= peakCeilingDb - peakEpsilon;
  if (!lufsBinds && !peakBinds) {
    return {
      ok: false,
      reason: `${measure.lufs} LUFS / ${measure.peakDb} dBTP true peak: neither the ${targetLufs} LUFS ceiling nor the ${peakCeilingDb} dBTP true-peak ceiling was reached (within ${lufsEpsilon} dB) - levelToConvention always binds one of the two, so this looks like a broken leveling, not a legitimately quiet, peak-capped sound`,
    };
  }
  return { ok: true };
}

/**
 * Every Phase 1 sound is chipvoice-origin: generated from a recipe
 * (catalog/chipvoice-recipes.mjs), not sourced from a fixed pack, so it has
 * no excuse to ship fewer variants than the brief's own 3-to-5 range
 * (docs/GAMESOUNDS.md). The origin gate stays in place (rather than checking
 * every sound unconditionally) so a future non-chipvoice origin - the
 * procedural synthesis engine tracked as GS-02 in docs/BACKLOG.md - can
 * define its own variant-count rule instead of inheriting this one by
 * accident.
 */
export function checkChipvoiceVariantCount(sound, { min = 3 } = {}) {
  if (sound.origin !== "chipvoice") return { ok: true };
  const count = sound.variants?.length ?? 0;
  if (count < min) return { ok: false, reason: `chipvoice sound has ${count} variant(s), fewer than the required ${min}` };
  return { ok: true };
}

/**
 * The generated-origin analogue of checkChipvoiceVariantCount (GS-03): a
 * generated sound is rendered from a seed ladder, not sourced, so it has the
 * same lack of excuse to ship fewer than the minimum - see
 * catalog/generated-recipes.mjs's own header for why a plain seed ladder is
 * expected to reach VARIANTS_PER_GROUP (4) for every preset. The floor here
 * matches chipvoice's own (3) on purpose: "the same survival rule as the
 * chipvoice half" (the brief's own words), not a coincidence of both
 * starting from the same constant.
 */
export function checkGeneratedVariantCount(sound, { min = 3 } = {}) {
  if (sound.origin !== "generated") return { ok: true };
  const count = sound.variants?.length ?? 0;
  if (count < min) return { ok: false, reason: `generated sound has ${count} variant(s), fewer than the required ${min}` };
  return { ok: true };
}

/** The raw dB delta between one shipped format's decoded peak and the wav's
 * own peak, on one channel - the number `checkFormatPeak` judges against
 * `toleranceDb` below, and the same number `checkCatalogFormatPeakMean`
 * collects across the whole build (see `collectFormatPeakDeltas`). Returns
 * `null` when there is nothing meaningful to compare: a silent source (peak
 * 0 - `checkNoClipping`/`checkLeadingSilence` already refuse a genuinely
 * silent variant, and dividing by a zero source peak would only ever
 * produce a useless +/-Infinity dB reading) or an invalid/silent decoded
 * peak (`checkFormatPeak` itself reports that case as an outright failure,
 * not a delta - it does not belong in an aggregate mean, which measures
 * "how loud", not "how broken"). */
function formatPeakDeltaDb(sourcePeakLinear, formatPeakLinear) {
  if (!(sourcePeakLinear > 0)) return null;
  if (!Number.isFinite(formatPeakLinear) || formatPeakLinear <= 0) return null;
  return 20 * Math.log10(formatPeakLinear / sourcePeakLinear);
}

/** One format, one channel: does the shipped file's own decoded peak sit
 * within `toleranceDb` of the wav's own peak on that channel? A silent
 * source (peak 0) is skipped rather than compared - `checkNoClipping`/
 * `checkLeadingSilence` already refuse a genuinely silent variant, and
 * dividing by a zero source peak here would only ever produce a useless
 * +/-Infinity dB reading, not a meaningful pass or fail.
 *
 * `toleranceDb` defaults to `FORMAT_PEAK_TOLERANCE_DB`, the generous
 * per-variant backstop - see its own comment above for why this check alone
 * is not what catches a systematic bug like the old `-ac 2` upmix
 * (`checkCatalogFormatPeakMean` does that). This function's job is narrower:
 * catch a gross per-file failure (a dropped/silent channel, a channel
 * decoding far quieter than even the worst genuine transient-smearing case
 * observed on this catalogue), not a multi-dB systematic drift. */
export function checkFormatPeak(sourcePeakLinear, formatPeakLinear, { format, channel, toleranceDb = FORMAT_PEAK_TOLERANCE_DB } = {}) {
  if (!(sourcePeakLinear > 0)) return { ok: true };
  if (!Number.isFinite(formatPeakLinear) || formatPeakLinear < 0) {
    return { ok: false, reason: `${format} ${channel} channel peak is not a valid number (${formatPeakLinear})` };
  }
  if (formatPeakLinear === 0) {
    return { ok: false, reason: `${format} ${channel} channel decoded silent, but the wav's own ${channel} peak is ${sourcePeakLinear.toFixed(4)}` };
  }
  const deltaDb = formatPeakDeltaDb(sourcePeakLinear, formatPeakLinear);
  if (Math.abs(deltaDb) > toleranceDb) {
    return {
      ok: false,
      reason:
        `${format} ${channel} channel peak is ${deltaDb.toFixed(2)} dB from the wav's own ${channel} peak ` +
        `(wav ${sourcePeakLinear.toFixed(4)}, ${format} ${formatPeakLinear.toFixed(4)}), outside the +/-${toleranceDb} dB tolerance`,
    };
  }
  return { ok: true };
}

/**
 * Every shipped ogg and mp3 must sound as loud as the wav it was encoded
 * from, per channel - not just "some channel is loud enough somewhere",
 * which the old `-ac 2` mono-to-stereo upmix bug would have passed (it made
 * BOTH channels uniformly quiet, never silent or clipped). `formatPeaks` is
 * `encodeVariant`'s own record of decoding the shipped ogg/mp3 bytes back to
 * PCM and measuring each one's peak per channel (scripts/lib/audio.mjs) -
 * this function never re-decodes anything itself, it only judges numbers
 * `encodeVariant` already measured on the exact bytes that ship.
 *
 * A mono source (`sourcePeaks.right === null`) upmixed to a stereo file
 * (the ogg fallback path) must land BOTH shipped channels within tolerance
 * of the source's one (left) peak - that upmix is supposed to be a unity
 * copy, so the right channel has no excuse to differ from the left. A
 * stereo source's shipped format decoding back as mono is refused outright:
 * that is a channel silently collapsed, not a loudness rounding difference,
 * and no tolerance value makes that acceptable.
 *
 * This is the generous per-variant backstop, not the primary regression
 * detector for a systematic bug - see `toleranceDb`'s default
 * (`FORMAT_PEAK_TOLERANCE_DB`) and `checkCatalogFormatPeakMean` below for
 * why: a single file can legitimately land far under its wav's peak
 * (lossy-codec transient smearing on a handful of multi-attack presets,
 * measured up to 16.23 dB on this catalogue), so this function alone would
 * have to be loose enough to admit that and would then be too loose to
 * catch the old `-ac 2` bug's ~3 dB, catalogue-wide drift on its own. It
 * still catches what no tolerance should ever admit: a dropped/silent
 * channel, or a stereo source collapsing to mono on the way out.
 */
export function checkFormatPeaks(sourcePeaks, formatPeaks, { toleranceDb = FORMAT_PEAK_TOLERANCE_DB } = {}) {
  if (!sourcePeaks || !formatPeaks) return { ok: true };
  const failures = [];
  for (const format of ["ogg", "mp3"]) {
    const decoded = formatPeaks[format];
    if (!decoded) {
      failures.push(`${format}: no decoded peak data to check`);
      continue;
    }
    const left = checkFormatPeak(sourcePeaks.left, decoded.left, { format, channel: "left", toleranceDb });
    if (!left.ok) failures.push(left.reason);
    if (decoded.right !== null) {
      const sourceRight = sourcePeaks.right ?? sourcePeaks.left;
      const right = checkFormatPeak(sourceRight, decoded.right, { format, channel: "right", toleranceDb });
      if (!right.ok) failures.push(right.reason);
    } else if (sourcePeaks.right !== null) {
      failures.push(`${format}: the wav is stereo but the shipped ${format} decoded as mono - a channel was silently collapsed`);
    }
  }
  return failures.length ? { ok: false, reason: failures.join("; ") } : { ok: true };
}

/** Every valid per-format/per-channel dB delta `checkFormatPeaks` would
 * judge for this one variant, as plain numbers - the raw material
 * `checkCatalogFormatPeakMean` needs. `build-catalog.mjs` calls this once
 * per variant (alongside `checkFormatPeaks` itself) and appends the results
 * into one flat array across the whole build. Skips exactly what
 * `formatPeakDeltaDb` skips (a silent source or an invalid/silent decoded
 * peak) - the latter is already reported as an outright failure by
 * `checkFormatPeaks` itself, so it does not belong in a mean that measures
 * "how loud", not "how broken". */
export function collectFormatPeakDeltas(sourcePeaks, formatPeaks) {
  const deltas = [];
  if (!sourcePeaks || !formatPeaks) return deltas;
  for (const format of ["ogg", "mp3"]) {
    const decoded = formatPeaks[format];
    if (!decoded) continue;
    const left = formatPeakDeltaDb(sourcePeaks.left, decoded.left);
    if (left !== null) deltas.push(left);
    if (decoded.right !== null) {
      const sourceRight = sourcePeaks.right ?? sourcePeaks.left;
      const right = formatPeakDeltaDb(sourceRight, decoded.right);
      if (right !== null) deltas.push(right);
    }
  }
  return deltas;
}

/**
 * The whole-build aggregate check that actually catches a systematic
 * per-file bug like the old `-ac 2` upmix - see
 * `CATALOG_MEAN_FORMAT_PEAK_TOLERANCE_DB`'s own comment above for the full
 * reasoning and the measured numbers (healthy baseline mean 0.44 dB across
 * 3276 readings over 1092 variants; a reintroduced `-ac 2` bug would push
 * this toward -3 dB, since it would apply to nearly every fallback-path ogg
 * reading rather than a handful of outliers).
 *
 * Takes every delta `collectFormatPeakDeltas` produced across every variant
 * in the build (`build-catalog.mjs` collects them into one flat array as it
 * runs `checkSound` over every sound) and asserts their mean absolute value
 * stays under `maxMeanAbsDeltaDb`. An empty array (nothing to check - e.g. a
 * build with no `formatPeaks` data at all) passes rather than divides by
 * zero; every other check already ran on whatever data existed.
 */
export function checkCatalogFormatPeakMean(deltasDb, { maxMeanAbsDeltaDb = CATALOG_MEAN_FORMAT_PEAK_TOLERANCE_DB } = {}) {
  if (!deltasDb || deltasDb.length === 0) return { ok: true };
  const meanAbsDb = deltasDb.reduce((sum, d) => sum + Math.abs(d), 0) / deltasDb.length;
  if (meanAbsDb > maxMeanAbsDeltaDb) {
    return {
      ok: false,
      reason:
        `catalogue-wide mean |format peak delta| is ${meanAbsDb.toFixed(4)} dB across ${deltasDb.length} reading(s), ` +
        `outside the ${maxMeanAbsDeltaDb} dB bound (CATALOG_MEAN_FORMAT_PEAK_TOLERANCE_DB) - a systematic per-file bug ` +
        `(like the old fallback ogg path's -ac 2 upmix) would show up here even though FORMAT_PEAK_TOLERANCE_DB's ` +
        `per-variant backstop is too loose to catch it alone`,
    };
  }
  return { ok: true };
}

/** Runs every per-sound check and returns the failures, if any. Used by the
 * build (to refuse a bad sound) and by the negative tests (to prove each
 * check fires on the input built to break it).
 *
 * `variantData` is keyed by each variant's own sha256 (content-addressed, so
 * one key never collides across sounds): `{ bytes, peakLinear, left, right,
 * sampleRate, formatPeaks }` (`formatPeaks`: `encodeVariant`'s own record of
 * decoding the shipped ogg/mp3 back to PCM - see checkFormatPeaks). Any
 * field a caller does not have is simply skipped - the negative tests
 * exercise each check directly, so `checkSound`'s own tests only need to
 * prove it wires every check together, not repeat them.
 *
 * `loudnessOptions` is forwarded to every variant's own `checkLoudnessBand`
 * and `checkOneCeilingBinds` calls - every variant is checked on its OWN
 * measure, not just the sound-level summary (`sound.measure`, which mirrors
 * variant 1 only): a broken leveling on variant 2 or later used to ship
 * unnoticed, since only `sound.measure` was ever checked.
 *
 * `formatPeakDeltasOut`, if given, is an array this function appends every
 * variant's `collectFormatPeakDeltas` output into (rather than returning a
 * second value, which would force every existing caller to change) - the
 * build collects one shared array across every sound and, once the whole
 * catalogue has run, checks it with `checkCatalogFormatPeakMean` (see that
 * function's own comment). Omitted by default: only the whole-build caller
 * needs it, and the negative tests exercise `checkCatalogFormatPeakMean`
 * directly rather than through `checkSound`. */
export function checkSound(sound, variantData, sha256Hex, loudnessOptions = {}, formatPeakDeltasOut = null) {
  const failures = [];
  const license = checkLicense(sound);
  if (!license.ok) failures.push(`license: ${license.reason}`);
  const variantCount = checkChipvoiceVariantCount(sound);
  if (!variantCount.ok) failures.push(`variant count: ${variantCount.reason}`);
  const generatedVariantCount = checkGeneratedVariantCount(sound);
  if (!generatedVariantCount.ok) failures.push(`variant count: ${generatedVariantCount.reason}`);
  for (const variant of sound.variants ?? []) {
    const data = variantData?.[variant.sha256];
    if (data?.bytes) {
      const shaCheck = checkSha256(data.bytes, variant.sha256, sha256Hex);
      if (!shaCheck.ok) failures.push(`variant ${variant.n} sha256: ${shaCheck.reason}`);
    }
    if (data && typeof data.peakLinear === "number") {
      const clip = checkNoClipping(data.peakLinear);
      if (!clip.ok) failures.push(`variant ${variant.n} clipping: ${clip.reason}`);
    }
    if (data?.left) {
      const silence = checkLeadingSilence(data.left, data.right ?? null, data.sampleRate);
      if (!silence.ok) failures.push(`variant ${variant.n} leading silence: ${silence.reason}`);
    }
    if (data?.left && data.formatPeaks) {
      const sourcePeaks = peakPerChannel(data.left, data.right ?? null);
      const formatCheck = checkFormatPeaks(sourcePeaks, data.formatPeaks);
      if (!formatCheck.ok) failures.push(`variant ${variant.n} format peaks: ${formatCheck.reason}`);
      if (formatPeakDeltasOut) formatPeakDeltasOut.push(...collectFormatPeakDeltas(sourcePeaks, data.formatPeaks));
    }
    const loudness = checkLoudnessBand(variant.measure, loudnessOptions);
    if (!loudness.ok) failures.push(`variant ${variant.n} loudness: ${loudness.reason}`);
    const oneCeilingBinds = checkOneCeilingBinds(variant.measure, loudnessOptions);
    if (!oneCeilingBinds.ok) failures.push(`variant ${variant.n} loudness gate: ${oneCeilingBinds.reason}`);
  }
  return failures;
}
