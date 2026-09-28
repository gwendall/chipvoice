/**
 * PhISEM: Physically Informed Stochastic Event Modeling, after Perry R.
 * Cook, "Physically Informed Sonic Modeling (PhISM): Synthesis of
 * Percussive Sounds" (Computer Music Journal, 1997). A handful of gravel,
 * a snow crunch, a shaker and falling debris are all, in Cook's model, many
 * small particles colliding: each collision is a brief resonant "tick",
 * and the collisions themselves arrive as a Poisson-ish random process
 * whose rate tracks the system's overall energy (decaying for a thrown
 * handful, roughly constant for a continuously shaken instrument).
 *
 * This is an independent implementation from Cook's description (the
 * "particles colliding as a Poisson process of resonant ticks" idea, not
 * a port of his or anyone else's code - see the brief's "never copy code
 * from GPL projects").
 */
import type { Prng } from '../rng/prng.js';
import { exp, log, cos, PI } from '../dsp/math.js';

export type ParticleKind = 'gravel' | 'snow' | 'shaker' | 'debris';

export interface PhisemParams {
  kind: ParticleKind;
  /** How many particles are notionally colliding; more particles raise the
   * average collision rate and smooth the texture. */
  numParticles?: number;
  /** 0..1 overall loudness/energy of the gesture. */
  energy?: number;
  /** 'burst': energy (and so collision rate) decays across the render - a
   * thrown handful, a footstep's single crunch, falling debris. 'sustain':
   * energy stays roughly constant - a held shaker. */
  envelope?: 'burst' | 'sustain';
}

interface KindProfile {
  numParticles: number;
  freqLowHz: number;
  freqHighHz: number;
  tickMs: number;
  tickT60Ms: number;
  /** Average collisions per second per particle at full energy. */
  ratePerParticle: number;
}

const PROFILES: Record<ParticleKind, KindProfile> = {
  gravel: { numParticles: 40, freqLowHz: 900, freqHighHz: 3200, tickMs: 4, tickT60Ms: 10, ratePerParticle: 14 },
  snow: { numParticles: 55, freqLowHz: 500, freqHighHz: 1800, tickMs: 6, tickT60Ms: 14, ratePerParticle: 10 },
  shaker: { numParticles: 70, freqLowHz: 2500, freqHighHz: 7000, tickMs: 2.5, tickT60Ms: 6, ratePerParticle: 22 },
  debris: { numParticles: 30, freqLowHz: 250, freqHighHz: 1100, tickMs: 10, tickT60Ms: 30, ratePerParticle: 6 },
};

/** Renders one short resonant "tick" (a particle collision) directly into
 * `out` starting at `startSample`, clipped to the buffer's bounds. A local,
 * self-contained two-pole resonator driven by a single impulse - the same
 * pole-from-T60 construction as dsp/filter.ts's renderResonator, inlined
 * here so a tick never allocates a length-N array of its own. */
function addTick(out: Float64Array, sampleRate: number, startSample: number, freqHz: number, t60Seconds: number, amplitude: number, durationSamples: number): void {
  const omega = (2 * PI * freqHz) / sampleRate;
  const r = exp(log(0.001) / (t60Seconds * sampleRate));
  const a1 = -2 * r * cos(omega);
  const a2 = r * r;
  const gain = (1 - r * r) * amplitude;
  let y1 = 0, y2 = 0;
  for (let i = 0; i < durationSamples; i++) {
    const idx = startSample + i;
    if (idx >= out.length) break;
    if (idx < 0) continue;
    const x = i === 0 ? gain : 0;
    const y0 = x - a1 * y1 - a2 * y2;
    out[idx] += y0;
    y2 = y1; y1 = y0;
  }
}

export function renderPhisem(length: number, sampleRate: number, params: PhisemParams, rng: Prng): Float64Array {
  const profile = PROFILES[params.kind];
  const numParticles = Math.max(1, Math.round(params.numParticles ?? profile.numParticles));
  const energy = Math.max(0, Math.min(1, params.energy ?? 0.7));
  const envelope = params.envelope ?? (params.kind === 'shaker' ? 'sustain' : 'burst');
  const durationSeconds = length / sampleRate;
  const out = new Float64Array(length);

  // The collision process: walk sample-by-sample in coarse steps (1 ms),
  // drawing a Poisson-ish number of collisions for that step from the
  // current rate, each collision an independent particle tick.
  const stepSamples = Math.max(1, Math.round(sampleRate * 0.001));
  for (let s = 0; s < length; s += stepSamples) {
    const t = s / sampleRate;
    const envGain = envelope === 'burst' ? Math.max(0, 1 - t / Math.max(1e-6, durationSeconds)) : 1;
    const rate = numParticles * profile.ratePerParticle * energy * envGain; // collisions/sec, system-wide
    const expected = rate * (stepSamples / sampleRate);
    // A Poisson-ish draw good enough for this purpose: expected collisions
    // this step, rounded probabilistically.
    const whole = Math.floor(expected);
    const frac = expected - whole;
    const count = whole + (rng.next() < frac ? 1 : 0);
    for (let c = 0; c < count; c++) {
      const freq = rng.range(profile.freqLowHz, profile.freqHighHz);
      const amp = 0.3 + rng.next() * 0.7;
      const jitterSamples = Math.round(rng.next() * stepSamples);
      const tickSamples = Math.max(2, Math.round((profile.tickMs / 1000) * sampleRate));
      addTick(out, sampleRate, s + jitterSamples, freq, profile.tickT60Ms / 1000, amp, tickSamples);
    }
  }

  let peak = 0;
  for (let i = 0; i < length; i++) { const a = Math.abs(out[i]); if (a > peak) peak = a; }
  if (peak > 1e-9) { const g = 0.9 / peak; for (let i = 0; i < length; i++) out[i] *= g; }
  return out;
}
