// The catalogue build's signal checks. Every one of these is exercised by a
// negative test in test/checks.test.mjs that feeds it input built to fail,
// so a broken check cannot silently start passing everything.
import { LOUDNESS_TARGET_LUFS, TRUE_PEAK_CEILING_DBTP, firstAboveFloor, peakOf, peakPerChannel, energyPerChannel } from "./audio.mjs";

// checkFormatEnergies guards the shipped ogg/mp3's own decoded loudness
// against the wav it was encoded from - built from decoding and measuring
// every real variant in this catalogue (both origins, both formats) after
// the fix this file exists to guard (BITEXACT_ARGS, plus the now-retired
// fallback ogg path's own unity-gain pan filter - see docs/DECISIONS.md,
// decision 54, and audio.mjs's encodeVariant).
//
// This went through two designs, in order, and the first one was wrong in a
// way a round-2 review caught before merge:
//
// Design 1 (replaced): a per-variant PEAK tolerance loose enough (17 dB) to
// admit what looked like legitimate outliers, backstopped by a separate
// whole-build AGGREGATE check on the mean of every peak delta. This was
// built on a misdiagnosis. The outliers it was widened to admit -
// `pickup-key` losing up to 16.23 dB of peak, `impact-glass-light` and
// `footstep-metal` losing smaller but still large amounts - were assumed to
// be lossy-codec transient smearing (a block-transform codec spreading a
// sharp attack's energy across an MDCT block, which lowers peak while
// roughly preserving total energy: a real, harmless artifact on OTHER
// presets in this catalogue). They are not that. Decoding both the wav and
// the shipped ogg/mp3 and measuring actual ENERGY (not peak) showed these
// three presets lose real, substantial energy through the lossy encode -
// `pickup-key` 13.2 to 16.5 dB, `impact-glass-light` up to 6.6 dB,
// `footstep-metal` up to 7.8 dB - and a steep 16 kHz highpass on their own
// source wav shows why: 97.4%, 77.6% and 31.0% of each preset's own energy
// sits above 16 kHz, respectively, well inside the range both ffmpeg's
// native vorbis encoder and libmp3lame simply filter away at this
// catalogue's quality settings (`impact-metal-heavy`, an unaffected
// preset, has 0.0% of its energy up there). Transient smearing preserves
// energy; a codec's own lowpass removing content the source never had a
// chance to keep does not - the wav and the shipped lossy files are
// audibly different sounds for these three, not a measurement artifact.
// They are excluded (`build-catalog.mjs`'s `EXCLUDED_PRESETS`), with a
// follow-up ticket in `docs/BACKLOG.md` to find why sfx-engine's own modal
// synthesis puts their energy there and fix it at the source - tuning the
// engine itself is out of scope for this ticket (decision 52, decision 54).
// A whole-build aggregate mean check also had its own, separate problem
// once framed this way: bugging only the generated half of a build (half
// of ~1092 variants) would move the catalogue-wide mean by roughly 0.4 dB,
// comfortably under even a tight bound - a partial regression could hide in
// the average. Peak itself was also simply the wrong signal for either
// job: it is fragile under a lossy codec in both directions (a legitimate
// sharp attack can lose double-digit dB of peak with no real loudness
// loss; a legitimately quiet signal can occasionally decode a hair louder
// on peak alone), so it is kept below only as informational build-log data
// (`collectFormatPeakDeltas`), never as a gate.
//
// Design 2 (current): a single per-variant, per-channel, per-format ENERGY
// gate, `checkFormatEnergies`/`checkFormatEnergy`. Total energy (the sum of
// each sample squared) is preserved by encoding, so a real, legitimate
// outlier no longer forces the tolerance wide - the three presets above are
// excluded, not admitted through a loosened bound - and a single variant now
// catches a systematic bug directly, with no aggregate needed and no partial
// regression able to hide in a mean.
//
// This design's own metric went through two versions before it ever shipped,
// caught by a round-3 review before merge: the first version measured MEAN-
// square power (a per-sample average), not total energy, on the theory that
// a sum would be biased by a codec's decoded PCM coming back a different
// length than the source wav. That was backwards. See `energyPerChannel` in
// audio.mjs for the full story: this repo's dev-machine ffmpeg lacks
// libvorbis, so its native vorbis encoder pads a decoded ogg with trailing
// silence out to a 1024-sample block boundary; silence cannot move a SUM,
// but it dilutes a MEAN, so the mean-square version flagged 36 real,
// unaffected catalogue variants (33 pre-existing chipvoice sounds plus 3
// more generated presets) as failing on nothing but that padding - as much
// as -3.02 dB of apparent loss with the real (summed) energy unchanged to
// within 0.03 dB. Switching the metric to a plain sum fixed all 36 with no
// change to what the check actually catches: a uniform gain bug still
// produces the same dB delta in a sum as it did in a mean (see
// `energyPerChannel`'s header).
//
// FORMAT_ENERGY_TOLERANCE_DB is derived from the real, healthy catalogue
// (every shipped chipvoice and generated variant, both formats, both
// channels, AFTER the three EXCLUDED_PRESETS above and measured with the
// total-energy metric) - see docs/DECISIONS.md decision 54 for the full
// measured distribution (mean, max, p99, worst five by name) this number was
// set against. The bug this check exists to catch (the old ogg fallback
// path's `-ac 2` upmix) has an exact, content-independent signature of
// -3.0103 dB (`10*log10((1/sqrt(2))**2)`, the same value in the energy
// domain as its peak-domain `20*log10(1/sqrt(2))` counterpart, since a
// uniform amplitude scale produces the same dB delta in either domain) on
// every affected channel.
export const FORMAT_ENERGY_TOLERANCE_DB = 1.0;

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
 * own peak, on one channel - informational only (see `peakPerChannel`'s own
 * header in audio.mjs for why peak is no longer a gate). Returns `null` when
 * there is nothing meaningful to compare: a silent source (peak 0) or an
 * invalid/silent decoded peak. */
function formatPeakDeltaDb(sourcePeakLinear, formatPeakLinear) {
  if (!(sourcePeakLinear > 0)) return null;
  if (!Number.isFinite(formatPeakLinear) || formatPeakLinear <= 0) return null;
  return 20 * Math.log10(formatPeakLinear / sourcePeakLinear);
}

/** Every valid per-format/per-channel peak dB delta for one variant, as
 * plain numbers - reported data for the build log only (`build-catalog.mjs`
 * logs summary statistics from this across the whole build), never a gate.
 * See audio.mjs's `peakPerChannel` header and this file's own header for why
 * peak was retired as a check in favor of `checkFormatEnergies` below. */
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

/** The raw dB delta between one shipped format's decoded ENERGY (total
 * energy, the sum of each sample squared - see `energyPerChannel` in
 * audio.mjs for why a sum and not a mean) and the wav's own energy, on
 * one channel - the number `checkFormatEnergy` judges against `toleranceDb`
 * below. Returns `null` when there is nothing meaningful to compare: a
 * silent source (energy 0 - `checkNoClipping`/`checkLeadingSilence` already
 * refuse a genuinely silent variant) or an invalid/silent decoded energy
 * (`checkFormatEnergy` itself reports that case as an outright failure, not
 * a delta). */
function energyDeltaDb(sourceEnergyLinear, formatEnergyLinear) {
  if (!(sourceEnergyLinear > 0)) return null;
  if (!Number.isFinite(formatEnergyLinear) || formatEnergyLinear <= 0) return null;
  return 10 * Math.log10(formatEnergyLinear / sourceEnergyLinear);
}

/** Every valid per-format/per-channel energy dB delta for one variant, as
 * plain numbers - mirrors `collectFormatPeakDeltas` above, but for the metric
 * that actually gates the build. Used two ways: `checkSound` below appends
 * every variant's own reading into a build-wide array purely as informational
 * build-log data (`build-catalog.mjs` logs summary statistics from it,
 * alongside the pass/fail gate itself, exactly as it already does for peak);
 * and it is also how this file's own FORMAT_ENERGY_TOLERANCE_DB and
 * EXCLUDED_PRESETS reasons were derived - run once over the whole real
 * catalogue with no tolerance applied yet, then look at the resulting
 * distribution (see docs/DECISIONS.md decision 54). */
export function collectFormatEnergyDeltas(sourceEnergy, formatEnergy) {
  const deltas = [];
  if (!sourceEnergy || !formatEnergy) return deltas;
  for (const format of ["ogg", "mp3"]) {
    const decoded = formatEnergy[format];
    if (!decoded) continue;
    const left = energyDeltaDb(sourceEnergy.left, decoded.left);
    if (left !== null) deltas.push(left);
    if (decoded.right !== null) {
      const sourceRight = sourceEnergy.right ?? sourceEnergy.left;
      const right = energyDeltaDb(sourceRight, decoded.right);
      if (right !== null) deltas.push(right);
    }
  }
  return deltas;
}

/** One format, one channel: does the shipped file's own decoded energy sit
 * within `toleranceDb` of the wav's own energy on that channel? A silent
 * source (energy 0) is skipped rather than compared, for the same reason as
 * `checkFormatPeak` used to. `toleranceDb` defaults to
 * `FORMAT_ENERGY_TOLERANCE_DB` - see its own comment above for the
 * derivation. This single per-variant check is now the whole gate: no
 * separate aggregate exists, because energy (unlike peak) does not need one
 * - a real content-driven outlier is excluded at the preset level
 * (`build-catalog.mjs`'s `EXCLUDED_PRESETS`) instead of forcing the
 * tolerance wide enough to hide a systematic bug behind it. */
export function checkFormatEnergy(sourceEnergyLinear, formatEnergyLinear, { format, channel, toleranceDb = FORMAT_ENERGY_TOLERANCE_DB } = {}) {
  if (!(sourceEnergyLinear > 0)) return { ok: true };
  if (!Number.isFinite(formatEnergyLinear) || formatEnergyLinear < 0) {
    return { ok: false, reason: `${format} ${channel} channel energy is not a valid number (${formatEnergyLinear})` };
  }
  if (formatEnergyLinear === 0) {
    return { ok: false, reason: `${format} ${channel} channel decoded silent, but the wav's own ${channel} energy is ${sourceEnergyLinear.toExponential(4)}` };
  }
  const deltaDb = energyDeltaDb(sourceEnergyLinear, formatEnergyLinear);
  if (Math.abs(deltaDb) > toleranceDb) {
    return {
      ok: false,
      reason:
        `${format} ${channel} channel energy is ${deltaDb.toFixed(2)} dB from the wav's own ${channel} energy, ` +
        `outside the +/-${toleranceDb} dB tolerance (FORMAT_ENERGY_TOLERANCE_DB) - either a systematic loudness bug ` +
        `(like the old fallback ogg path's -ac 2 upmix, an exact -3.01 dB) or a preset whose real content sits mostly ` +
        `above the codec passband (like the three named in EXCLUDED_PRESETS) and needs excluding, not a wider tolerance`,
    };
  }
  return { ok: true };
}

/** GS-07: every shipped ogg/mp3 must decode to AT LEAST as many sample
 * frames as the source wav it was encoded from, per ffmpeg's own CLI decode -
 * zero tolerance on the short side. `decodedFrames` is `encodeVariant`'s own
 * `formatFrames.ogg` / `formatFrames.mp3` (scripts/lib/audio.mjs): the actual
 * decoded PCM's `left.length`, measured on the exact bytes that ship, never
 * assumed.
 *
 * Unlike `checkFormatEnergy`, this has no per-channel variant to name: a
 * single decoded file's frame count is the same for every one of its
 * channels by construction (`decodeToRender` de-interleaves one
 * fixed-length buffer into equal-length `left`/`right` arrays), so there is
 * no channel-specific length to report separately the way there is for
 * energy or peak (a channel CAN be quieter than another; it cannot be
 * shorter). Longer than the source is fine and expected - the ogg's own
 * `OGG_TAIL_GUARD_FRAMES` pad, and mp3's few extra gapless-trim samples
 * (`docs/GAMESOUNDS.md`), both do this routinely - only SHORTER is ever a
 * defect: a lossy codec may pad silence onto the end, it must never drop
 * real content from it.
 *
 * This exists because `checkFormatEnergies` alone could not see the defect
 * it was built to catch: decoders - not encoders - were found to trim real,
 * quiet content off the end of an otherwise-complete ogg. GS-07's own
 * investigation (see the amendment to Decision 54 in `docs/DECISIONS.md`,
 * and the comment above `OGG_TAIL_GUARD_FRAMES` in audio.mjs for the full
 * measured mechanism and numbers) found this was never the encoder's fault -
 * a native-encoder ogg's own granule position, and a libvorbis ogg decoded
 * through the reference libvorbis decoder, both prove the encoded stream is
 * complete. ffmpeg's own CLI decoder (what feeds this very gate) drops up to
 * 128 frames off the end regardless, and real browsers (Chromium especially)
 * cut differently again - see `scripts/check-browser-decode.mjs`, the gate
 * that actually verifies what ships decodes whole in a real browser, since
 * this ffmpeg-CLI-based gate structurally cannot see that gap. Every one of
 * the original 56 (of 1080) affected live catalogue oggs passed
 * `checkFormatEnergies` outright, because the lost tail was, in every case,
 * a quiet decay contributing almost nothing to total energy either way. A
 * length gate catches exactly the class of loss an energy gate structurally
 * cannot: real samples removed from a signal that was already quiet there.
 */
export function checkFormatLength(sourceFrames, decodedFrames, { format } = {}) {
  if (!(sourceFrames > 0)) return { ok: true };
  if (!Number.isFinite(decodedFrames) || decodedFrames < 0) {
    return { ok: false, reason: `${format} decoded frame count is not a valid number (${decodedFrames})` };
  }
  if (decodedFrames < sourceFrames) {
    return {
      ok: false,
      reason:
        `${format} decoded ${decodedFrames} sample frame(s), ${sourceFrames - decodedFrames} short of the source wav's ` +
        `${sourceFrames} frame(s) - a lossy codec may pad the end with silence, it must never drop real content from it`,
    };
  }
  return { ok: true };
}

/** Runs `checkFormatLength` for both shipped formats against one variant's
 * own source frame count - the length-gate analogue of `checkFormatEnergies`
 * above, wired into `checkSound` next to it. `formatFrames` is
 * `encodeVariant`'s own record (`{source, ogg, mp3}`, scripts/lib/audio.mjs);
 * only `ogg` and `mp3` are checked here, `source` is read directly off the
 * variant's own PCM by the caller (`checkSound`, mirroring how
 * `checkFormatEnergies` is called with a freshly computed `sourceEnergy`
 * rather than trusting `formatEnergy.source`). */
export function checkFormatLengths(sourceFrames, formatFrames) {
  if (!(sourceFrames > 0) || !formatFrames) return { ok: true };
  const failures = [];
  for (const format of ["ogg", "mp3"]) {
    const decodedFrames = formatFrames[format];
    if (decodedFrames === undefined) {
      failures.push(`${format}: no decoded frame count to check`);
      continue;
    }
    const check = checkFormatLength(sourceFrames, decodedFrames, { format });
    if (!check.ok) failures.push(check.reason);
  }
  return failures.length ? { ok: false, reason: failures.join("; ") } : { ok: true };
}

/**
 * Every shipped ogg and mp3 must carry as much real energy as the wav it was
 * encoded from, per channel - not just "some channel is loud enough
 * somewhere", which the old `-ac 2` mono-to-stereo upmix bug would have
 * passed (it made BOTH channels uniformly quiet, never silent or clipped).
 * `formatEnergy` is `encodeVariant`'s own record of decoding the shipped
 * ogg/mp3 bytes back to PCM and measuring each one's total energy (the sum
 * of each sample squared) per channel (scripts/lib/audio.mjs) - this function never re-decodes anything
 * itself, it only judges numbers `encodeVariant` already measured on the
 * exact bytes that ship.
 *
 * A mono source (`sourceEnergy.right === null`) upmixed to a stereo file
 * (the ogg fallback path) must land BOTH shipped channels within tolerance
 * of the source's one (left) energy - that upmix is supposed to be a unity
 * copy, so the right channel has no excuse to differ from the left. A
 * stereo source's shipped format decoding back as mono is refused outright:
 * that is a channel silently collapsed, not a loudness rounding difference,
 * and no tolerance value makes that acceptable.
 *
 * This is now the build's only format-loudness gate - see this file's own
 * header for why the two-layer peak-based design it replaces (a loose
 * per-variant backstop plus a separate whole-build aggregate mean) was
 * wrong, not just less elegant.
 */
export function checkFormatEnergies(sourceEnergy, formatEnergy, { toleranceDb = FORMAT_ENERGY_TOLERANCE_DB } = {}) {
  if (!sourceEnergy || !formatEnergy) return { ok: true };
  const failures = [];
  for (const format of ["ogg", "mp3"]) {
    const decoded = formatEnergy[format];
    if (!decoded) {
      failures.push(`${format}: no decoded energy data to check`);
      continue;
    }
    const left = checkFormatEnergy(sourceEnergy.left, decoded.left, { format, channel: "left", toleranceDb });
    if (!left.ok) failures.push(left.reason);
    if (decoded.right !== null) {
      const sourceRight = sourceEnergy.right ?? sourceEnergy.left;
      const right = checkFormatEnergy(sourceRight, decoded.right, { format, channel: "right", toleranceDb });
      if (!right.ok) failures.push(right.reason);
    } else if (sourceEnergy.right !== null) {
      failures.push(`${format}: the wav is stereo but the shipped ${format} decoded as mono - a channel was silently collapsed`);
    }
  }
  return failures.length ? { ok: false, reason: failures.join("; ") } : { ok: true };
}

/** Runs every per-sound check and returns the failures, if any. Used by the
 * build (to refuse a bad sound) and by the negative tests (to prove each
 * check fires on the input built to break it).
 *
 * `variantData` is keyed by each variant's own sha256 (content-addressed, so
 * one key never collides across sounds): `{ bytes, peakLinear, left, right,
 * sampleRate, formatPeaks, formatEnergy, formatFrames }` (`formatPeaks`,
 * `formatEnergy` and `formatFrames`: `encodeVariant`'s own record of
 * decoding the shipped ogg/mp3 back to PCM - see checkFormatEnergies for the
 * loudness gate, checkFormatLengths (GS-07) for the length gate, and
 * `collectFormatPeakDeltas` for the informational-only peak report). Any
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
 * second value, which would force every existing caller to change) - purely
 * informational build-log data (`build-catalog.mjs` logs summary statistics
 * from it), never a gate. `formatEnergyDeltasOut` is the same idea for
 * `collectFormatEnergyDeltas` - energy IS the gate (`checkFormatEnergies`,
 * which always runs below regardless of this param), so this collector is
 * purely a second, informational view of the same numbers: every variant's
 * reading, not just the ones that failed, so the build log (and, once, this
 * file's own tolerance derivation) can see the whole distribution, not only
 * the outliers a failure message would print. */
export function checkSound(sound, variantData, sha256Hex, loudnessOptions = {}, formatPeakDeltasOut = null, formatEnergyDeltasOut = null) {
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
    if (data?.left && data.formatEnergy) {
      const sourceEnergy = energyPerChannel(data.left, data.right ?? null);
      const energyCheck = checkFormatEnergies(sourceEnergy, data.formatEnergy);
      if (!energyCheck.ok) failures.push(`variant ${variant.n} format energy: ${energyCheck.reason}`);
      if (formatEnergyDeltasOut) formatEnergyDeltasOut.push(...collectFormatEnergyDeltas(sourceEnergy, data.formatEnergy));
    }
    if (data?.left && data.formatFrames) {
      const lengthCheck = checkFormatLengths(data.left.length, data.formatFrames);
      if (!lengthCheck.ok) failures.push(`variant ${variant.n} format length: ${lengthCheck.reason}`);
    }
    if (data?.left && data.formatPeaks && formatPeakDeltasOut) {
      const sourcePeaks = peakPerChannel(data.left, data.right ?? null);
      formatPeakDeltasOut.push(...collectFormatPeakDeltas(sourcePeaks, data.formatPeaks));
    }
    const loudness = checkLoudnessBand(variant.measure, loudnessOptions);
    if (!loudness.ok) failures.push(`variant ${variant.n} loudness: ${loudness.reason}`);
    const oneCeilingBinds = checkOneCeilingBinds(variant.measure, loudnessOptions);
    if (!oneCeilingBinds.ok) failures.push(`variant ${variant.n} loudness gate: ${oneCeilingBinds.reason}`);
  }
  return failures;
}
