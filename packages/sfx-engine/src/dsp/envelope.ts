/**
 * Envelopes: ADSR and free-form multi-segment, each segment linear or
 * exponential. An exponential segment never precomputes exponents with a
 * per-sample transcendental call: it computes the per-sample multiplicative
 * ratio once (via dsp/math.ts's own pow/exp/log) and then steps by plain
 * multiplication, which is both exact-by-construction and fast.
 */
import { pow } from './math.js';

export type CurveKind = 'linear' | 'exponential';

export interface AdsrParams {
  kind: 'adsr';
  /** Seconds. */
  attack: number;
  decay: number;
  /** 0..1, the level held between decay and release. */
  sustain: number;
  /** Seconds; how long sustain holds before release starts. Default: fills
   * the rest of the requested length. */
  sustainHold?: number;
  release: number;
  curve?: CurveKind;
  /** Peak level at the end of attack. Default 1. */
  peak?: number;
}

export interface SegmentPoint {
  /** Seconds from the start of the envelope. */
  time: number;
  value: number;
  /** The curve used to reach this point from the previous one. Ignored on
   * the first point. Default 'linear'. */
  curve?: CurveKind;
}

export interface SegmentsParams {
  kind: 'segments';
  points: SegmentPoint[];
}

export type EnvelopeParams = AdsrParams | SegmentsParams;

/** The floor exponential segments approach before reaching a target of 0
 * (true 0 is unreachable by a multiplicative ramp in finite steps). */
const EXP_FLOOR = 0.0005;

function renderSegment(out: Float64Array, startSample: number, endSample: number, fromValue: number, toValue: number, curve: CurveKind): void {
  const n = endSample - startSample;
  if (n <= 0) return;
  if (curve === 'linear' || fromValue === toValue) {
    const step = (toValue - fromValue) / n;
    for (let i = 0; i < n; i++) out[startSample + i] = fromValue + step * i;
    return;
  }
  // Exponential: ramp in log space between floors so a target of exactly 0
  // (very common: decay/release to silence) still produces a smooth,
  // audibly-exponential curve instead of a divide-by-zero.
  const from = fromValue === 0 ? EXP_FLOOR : Math.abs(fromValue);
  const to = toValue === 0 ? EXP_FLOOR : Math.abs(toValue);
  const sign = fromValue < 0 || (fromValue === 0 && toValue < 0) ? -1 : 1;
  const ratio = pow(to / from, 1 / n);
  let value = from;
  for (let i = 0; i < n; i++) {
    out[startSample + i] = sign * value;
    value *= ratio;
  }
  // Land exactly on toValue's sign/zero at the segment's last written sample
  // instead of one ratio-step short of it.
  if (n > 0) out[endSample - 1] = toValue;
}

export function renderAdsr(length: number, sampleRate: number, params: AdsrParams): Float64Array {
  const out = new Float64Array(length);
  const curve = params.curve ?? 'exponential';
  const peak = params.peak ?? 1;
  const attackEnd = Math.min(length, Math.round(params.attack * sampleRate));
  const decayEnd = Math.min(length, attackEnd + Math.round(params.decay * sampleRate));
  const sustainLevel = params.sustain * peak;
  const sustainSamples = params.sustainHold !== undefined ? Math.round(params.sustainHold * sampleRate) : Math.max(0, length - decayEnd - Math.round(params.release * sampleRate));
  const sustainEnd = Math.min(length, decayEnd + sustainSamples);
  const releaseEnd = Math.min(length, sustainEnd + Math.round(params.release * sampleRate));

  renderSegment(out, 0, attackEnd, 0, peak, curve);
  renderSegment(out, attackEnd, decayEnd, peak, sustainLevel, curve);
  for (let i = decayEnd; i < sustainEnd; i++) out[i] = sustainLevel;
  renderSegment(out, sustainEnd, releaseEnd, sustainLevel, 0, curve);
  for (let i = releaseEnd; i < length; i++) out[i] = 0;
  return out;
}

export function renderSegments(length: number, sampleRate: number, params: SegmentsParams): Float64Array {
  const out = new Float64Array(length);
  const points = params.points;
  if (points.length === 0) return out;
  let prevSample = 0;
  let prevValue = points[0].value;
  const firstSample = Math.min(length, Math.max(0, Math.round(points[0].time * sampleRate)));
  for (let i = 0; i < firstSample; i++) out[i] = prevValue;
  prevSample = firstSample;

  for (let p = 1; p < points.length; p++) {
    const point = points[p];
    const sample = Math.min(length, Math.max(prevSample, Math.round(point.time * sampleRate)));
    renderSegment(out, prevSample, sample, prevValue, point.value, point.curve ?? 'linear');
    prevSample = sample;
    prevValue = point.value;
  }
  for (let i = prevSample; i < length; i++) out[i] = prevValue;
  return out;
}

export function renderEnvelope(length: number, sampleRate: number, params: EnvelopeParams): Float64Array {
  return params.kind === 'adsr' ? renderAdsr(length, sampleRate, params) : renderSegments(length, sampleRate, params);
}

/** A linear or exponential ramp between two values over the full render
 * length - the standalone "sweep" primitive used for pitch and filter
 * sweeps (a `sweep` graph node just calls this). */
export interface SweepParams {
  from: number;
  to: number;
  curve?: CurveKind;
}

export function renderSweep(length: number, sampleRate: number, params: SweepParams): Float64Array {
  const out = new Float64Array(length);
  renderSegment(out, 0, length, params.from, params.to, params.curve ?? 'linear');
  return out;
}
