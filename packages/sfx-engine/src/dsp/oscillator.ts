/**
 * Band-limited oscillators. Naive sine needs no correction (it is a single
 * partial). Saw and square/pulse get a PolyBLEP (polynomial band-limited
 * step) correction at each discontinuity, after Valimaki & Huovilainen,
 * "Antialiasing Oscillators in Subtractive Synthesis" (IEEE Signal
 * Processing Magazine, 2007), and the widely circulated musicdsp.org
 * formulation of the same polynomial. Triangle is obtained by leaky-
 * integrating the band-limited square: integration already attenuates high
 * partials by a further 1/n, which is the standard justification (Valimaki
 * & Huovilainen again) for correcting the square once and integrating,
 * rather than deriving a separate PolyBLAMP correction for the triangle's
 * corner discontinuities.
 *
 * Every generator here returns a fresh `Float64Array` of `length` samples
 * and takes its frequency (and, for square, pulse width) as either a
 * constant or a per-sample `Float64Array` - the mechanism `graph/compile.ts`
 * uses to patch one node's output into another's parameter, which is how
 * this engine gets FM/PM, AM/RM and pitch/filter sweeps without a bespoke
 * node type for each (see `docs/GAMESOUNDS-ENGINE.md`, "Modulation").
 */
import { PI } from './math.js';

export type ModulatableNumber = number | Float64Array;

function at(value: ModulatableNumber, i: number): number {
  return typeof value === 'number' ? value : value[i];
}

/** The classic PolyBLEP correction, `t` the phase in [0,1), `dt` the phase
 * increment per sample (frequency / sampleRate). */
function polyBlep(t: number, dt: number): number {
  if (dt <= 0) return 0;
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

export interface OscillatorParams {
  shape: 'sine' | 'triangle' | 'saw' | 'square';
  freq: ModulatableNumber;
  /** 0..1, square/pulse only; ignored otherwise. Default 0.5. */
  pulseWidth?: ModulatableNumber;
  /** Starting phase, cycles, default 0. */
  phase0?: number;
  /** Per-sample phase offset in cycles (true phase modulation), added after
   * the phase accumulator advances by freq/sampleRate each sample. */
  phaseMod?: Float64Array;
}

import { sin as sinRadians } from './math.js';
/** dsp/math.ts's sin() takes radians; this oscillator's phase accumulator
 * runs in cycles (0..1), so scale once per call. */
function sineSample(phaseCycles: number): number {
  return sinRadians(phaseCycles * 2 * PI);
}

function naiveSaw(phase: number): number {
  return 2 * phase - 1;
}

function naiveSquare(phase: number, pulseWidth: number): number {
  return phase < pulseWidth ? 1 : -1;
}

function wrap01(x: number): number {
  const w = x - Math.floor(x);
  return w < 0 ? w + 1 : w;
}

/** Renders `length` samples of a band-limited oscillator, sample-accurate
 * and deterministic (only dsp/math.ts's own sin, plus +, -, *, /). */
export function renderOscillator(length: number, sampleRate: number, params: OscillatorParams): Float64Array {
  const out = new Float64Array(length);
  let phase = wrap01(params.phase0 ?? 0);
  let triangleIntegrator = 0;
  let triangleDcPrev = 0;
  let triangleYPrev = 0;
  const dcLeak = 0.9995; // one-pole DC blocker inside the triangle integrator

  for (let i = 0; i < length; i++) {
    const freq = at(params.freq, i);
    const dt = freq / sampleRate;
    const modulatedPhase = wrap01(phase + (params.phaseMod ? params.phaseMod[i] : 0));

    switch (params.shape) {
      case 'sine':
        out[i] = sineSample(modulatedPhase);
        break;
      case 'saw': {
        let v = naiveSaw(modulatedPhase);
        v -= polyBlep(modulatedPhase, Math.abs(dt));
        out[i] = v;
        break;
      }
      case 'square': {
        const pw = Math.min(0.98, Math.max(0.02, at(params.pulseWidth ?? 0.5, i)));
        let v = naiveSquare(modulatedPhase, pw);
        const absDt = Math.abs(dt);
        v += polyBlep(modulatedPhase, absDt);
        v -= polyBlep(wrap01(modulatedPhase - pw + 1), absDt);
        out[i] = v;
        break;
      }
      case 'triangle': {
        const pw = 0.5;
        let sq = naiveSquare(modulatedPhase, pw);
        const absDt = Math.abs(dt);
        sq += polyBlep(modulatedPhase, absDt);
        sq -= polyBlep(wrap01(modulatedPhase - pw + 1), absDt);
        triangleIntegrator += 4 * dt * sq;
        const y = triangleIntegrator - triangleDcPrev + dcLeak * triangleYPrev;
        triangleDcPrev = triangleIntegrator;
        triangleYPrev = y;
        out[i] = y;
        break;
      }
    }

    phase = wrap01(phase + dt);
  }
  return out;
}
