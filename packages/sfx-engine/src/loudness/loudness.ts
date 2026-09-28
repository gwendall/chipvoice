/**
 * ITU-R BS.1770-4 / EBU R128 loudness measurement: K-weight the signal
 * (kweight.ts), then measure momentary loudness (400 ms blocks) and
 * integrated (gated) loudness over the whole render. Mono only (this
 * engine's internal graph is mono end-to-end, see dsp/mix.ts) - the
 * multi-channel weighted sum BS.1770 defines for stereo/surround collapses
 * to a single channel with weight 1.0, so it is left out rather than
 * built and never exercised.
 *
 * `test/loudness.test.mjs` implements EBU Tech 3341 v4 (Geneva, November
 * 2023), Table 1's minimum-requirements test cases 1-5 (case numbers and
 * expected values cited verbatim from that table) - cases 1 and 2 pin
 * momentary and integrated loudness for a steady 1kHz tone at -23.0 and
 * -33.0 dBFS, cases 3-5 pin integrated loudness for signals designed to
 * exercise the two-stage gate. Table 1's cases are stereo; this engine is
 * mono, so each expected value is the table's stereo figure shifted by the
 * exact -10*log10(2) = -3.0103 LU that two identical channels at weight 1.0
 * contribute over one (see the test file's own comment). Two negative tests
 * prove the K-weighting and relative-gate stages are actually exercised by
 * reimplementing each with that one stage skipped and showing the case then
 * misses its tolerance. `scripts/ffmpeg-loudness-check.mjs` cross-checks
 * every rendered preset against ffmpeg's own `ebur128` filter.
 */
import { log10, pow } from '../dsp/math.js';
import { kWeight } from './kweight.js';

const BLOCK_SECONDS = 0.4;
const HOP_SECONDS = 0.1; // 400 ms blocks, 75% overlap, per BS.1770-4.
const ABSOLUTE_GATE_LUFS = -70;
const RELATIVE_GATE_OFFSET_LU = -10;

function meanSquare(signal: Float64Array, start: number, length: number): number {
  let sum = 0;
  for (let i = 0; i < length; i++) { const v = signal[start + i]; sum += v * v; }
  return sum / length;
}

/** -0.691 + 10*log10(meanSquare), BS.1770-4's loudness-from-power formula
 * (mono, so the channel weighting sum is just this one term). -Infinity for
 * true silence, matching the spec's own treatment (excluded by the absolute
 * gate downstream). */
function loudnessFromMeanSquare(ms: number): number {
  if (ms <= 0) return -Infinity;
  return -0.691 + 10 * log10(ms);
}

export interface LoudnessBlock { timeSeconds: number; lufs: number }

/** Every 400 ms/75%-overlap block's loudness, K-weighted first. If the
 * signal is shorter than one block, a single block over the whole signal is
 * used instead (a documented, deliberate deviation from BS.1770's block
 * grid, needed because this engine's sounds are often under 400 ms - a
 * momentary reading still needs to mean something for a 150 ms UI blip). */
export function measureBlocks(signal: Float64Array, sampleRate: number): LoudnessBlock[] {
  const weighted = kWeight(signal, sampleRate);
  const blockLen = Math.round(BLOCK_SECONDS * sampleRate);
  const hopLen = Math.round(HOP_SECONDS * sampleRate);
  const blocks: LoudnessBlock[] = [];

  if (weighted.length <= blockLen) {
    if (weighted.length > 0) blocks.push({ timeSeconds: 0, lufs: loudnessFromMeanSquare(meanSquare(weighted, 0, weighted.length)) });
    return blocks;
  }
  for (let start = 0; start + blockLen <= weighted.length; start += hopLen) {
    blocks.push({ timeSeconds: start / sampleRate, lufs: loudnessFromMeanSquare(meanSquare(weighted, start, blockLen)) });
  }
  return blocks;
}

/** The loudest momentary (400 ms) block in the signal - what the house
 * convention's "-18 LUFS momentary" budget is measured against. -Infinity
 * for a silent (or all-zero) signal. */
export function momentaryLoudnessMax(signal: Float64Array, sampleRate: number): number {
  const blocks = measureBlocks(signal, sampleRate);
  let max = -Infinity;
  for (const b of blocks) if (b.lufs > max) max = b.lufs;
  return max;
}

/** BS.1770-4's two-stage gated integrated loudness: drop blocks below an
 * absolute -70 LUFS gate, average what remains, drop blocks below
 * (that average - 10 LU), average what remains again. -Infinity if nothing
 * survives the absolute gate (effective silence). */
export function integratedLoudness(signal: Float64Array, sampleRate: number): number {
  const blocks = measureBlocks(signal, sampleRate).filter((b) => Number.isFinite(b.lufs));
  const passAbsolute = blocks.filter((b) => b.lufs > ABSOLUTE_GATE_LUFS);
  if (passAbsolute.length === 0) return -Infinity;

  const meanPowerOf = (bs: LoudnessBlock[]): number => {
    let sum = 0;
    for (const b of bs) sum += pow(10, (b.lufs + 0.691) / 10);
    return sum / bs.length;
  };
  const relativeThreshold = loudnessFromMeanSquare(meanPowerOf(passAbsolute)) + RELATIVE_GATE_OFFSET_LU;
  const passRelative = passAbsolute.filter((b) => b.lufs > relativeThreshold);
  const gated = passRelative.length > 0 ? passRelative : passAbsolute;
  return loudnessFromMeanSquare(meanPowerOf(gated));
}
