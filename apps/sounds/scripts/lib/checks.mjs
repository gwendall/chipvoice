// The catalogue build's signal checks. Every one of these is exercised by a
// negative test in test/checks.test.mjs that feeds it input built to fail,
// so a broken check cannot silently start passing everything.
import { LOUDNESS_TARGET_LUFS, TRUE_PEAK_CEILING_DBTP, firstAboveFloor, peakOf } from "./audio.mjs";

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
export function checkLoudnessBand(measure, { targetLufs = LOUDNESS_TARGET_LUFS, lufsEpsilon = LOUDNESS_CEILING_EPSILON_LU, peakCeilingDb = TRUE_PEAK_CEILING_DBTP } = {}) {
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

/** Runs every per-sound check and returns the failures, if any. Used by the
 * build (to refuse a bad sound) and by the negative tests (to prove each
 * check fires on the input built to break it).
 *
 * `variantData` is keyed by each variant's own sha256 (content-addressed, so
 * one key never collides across sounds): `{ bytes, peakLinear, left, right,
 * sampleRate }`. Any field a caller does not have is simply skipped - the
 * negative tests exercise each check directly, so `checkSound`'s own tests
 * only need to prove it wires every check together, not repeat them. */
export function checkSound(sound, variantData, sha256Hex) {
  const failures = [];
  const license = checkLicense(sound);
  if (!license.ok) failures.push(`license: ${license.reason}`);
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
  }
  const loudness = checkLoudnessBand(sound.measure);
  if (!loudness.ok) failures.push(`loudness: ${loudness.reason}`);
  return failures;
}
