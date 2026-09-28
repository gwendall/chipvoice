/**
 * Modal synthesis: a struck/scraped object as a bank of damped resonant
 * modes excited by a single impulse or a short noise burst, after van den
 * Doel & Pai, "The Sounds of Physical Shapes" (Presence, 1998) and
 * "Synthesis of Shape Dependent Sounds with Physical Modeling" (1996): a
 * rigid object's free vibration is, to a first approximation, a sum of
 * exponentially-decaying sinusoids (its modes), each with its own
 * frequency, decay time and gain.
 *
 * The per-material mode tables below (frequency ratios relative to the
 * fundamental, T60 decay time, relative gain) are this engine's own,
 * designed from general acoustic principles rather than fitted to a
 * specific measured object: stiffer, lower-internal-damping materials
 * (metal, glass) get more inharmonic, higher, longer-ringing modes; soft or
 * heavily damped materials (flesh, cloth) get few modes and fast decay.
 * `docs/GAMESOUNDS-ENGINE.md` says this plainly as a limitation, not a
 * measured fact.
 */
import type { Prng } from '../rng/prng.js';
import { renderResonator } from '../dsp/filter.js';
import { renderNoise } from '../dsp/noise.js';
import { pow, log, LN2 } from '../dsp/math.js';

export type Material = 'wood' | 'metal' | 'glass' | 'stone' | 'plastic' | 'flesh';

interface ModeTemplate {
  /** Frequency ratio relative to the fundamental. */
  ratio: number;
  /** Linear gain relative to the fundamental's mode, 0..1-ish. */
  gain: number;
  /** Seconds to decay 60 dB. */
  t60: number;
}

const MATERIAL_MODES: Record<Material, { fundamentalHz: number; modes: ModeTemplate[] }> = {
  wood: {
    fundamentalHz: 220,
    modes: [
      { ratio: 1.0, gain: 1.0, t60: 0.18 },
      { ratio: 2.76, gain: 0.55, t60: 0.12 },
      { ratio: 4.1, gain: 0.32, t60: 0.08 },
      { ratio: 6.3, gain: 0.18, t60: 0.05 },
      { ratio: 8.9, gain: 0.1, t60: 0.03 },
    ],
  },
  metal: {
    fundamentalHz: 660,
    modes: [
      { ratio: 1.0, gain: 1.0, t60: 1.6 },
      { ratio: 2.41, gain: 0.7, t60: 1.3 },
      { ratio: 3.87, gain: 0.55, t60: 1.1 },
      { ratio: 5.36, gain: 0.4, t60: 0.9 },
      { ratio: 7.12, gain: 0.28, t60: 0.7 },
      { ratio: 9.85, gain: 0.18, t60: 0.5 },
      { ratio: 13.1, gain: 0.1, t60: 0.35 },
    ],
  },
  glass: {
    fundamentalHz: 1400,
    modes: [
      { ratio: 1.0, gain: 1.0, t60: 1.2 },
      { ratio: 2.98, gain: 0.6, t60: 1.0 },
      { ratio: 5.4, gain: 0.45, t60: 0.85 },
      { ratio: 8.1, gain: 0.3, t60: 0.65 },
      { ratio: 11.6, gain: 0.2, t60: 0.5 },
      { ratio: 15.9, gain: 0.12, t60: 0.35 },
    ],
  },
  stone: {
    fundamentalHz: 180,
    modes: [
      { ratio: 1.0, gain: 1.0, t60: 0.1 },
      { ratio: 2.2, gain: 0.5, t60: 0.07 },
      { ratio: 3.4, gain: 0.3, t60: 0.05 },
      { ratio: 5.1, gain: 0.15, t60: 0.03 },
    ],
  },
  plastic: {
    fundamentalHz: 500,
    modes: [
      { ratio: 1.0, gain: 1.0, t60: 0.25 },
      { ratio: 2.55, gain: 0.5, t60: 0.18 },
      { ratio: 3.9, gain: 0.3, t60: 0.13 },
      { ratio: 5.7, gain: 0.16, t60: 0.09 },
    ],
  },
  flesh: {
    fundamentalHz: 120,
    modes: [
      { ratio: 1.0, gain: 1.0, t60: 0.045 },
      { ratio: 1.9, gain: 0.4, t60: 0.03 },
      { ratio: 2.8, gain: 0.2, t60: 0.02 },
    ],
  },
};

export interface ModalParams {
  material: Material;
  /** Relative size vs. the material's reference object; < 1 smaller
   * (higher-pitched, shorter-ringing), > 1 larger. Default 1. */
  size?: number;
  /** 0..1, tilts energy towards (1) or away from (0) the higher modes.
   * Default 0.5. */
  brightness?: number;
  /** 0..1, struck harder scales excitation energy and decay time
   * slightly (a harder strike drives an object's damping a little
   * nonlinearly in real materials; this is a deliberately mild nod to
   * that, not a physical model of nonlinear damping). Default 0.7. */
  strength?: number;
  excitation?: 'impulse' | 'noise-burst';
}

export function renderModal(length: number, sampleRate: number, params: ModalParams, rng: Prng): Float64Array {
  const table = MATERIAL_MODES[params.material];
  const size = Math.max(0.1, params.size ?? 1);
  const brightness = Math.max(0, Math.min(1, params.brightness ?? 0.5));
  const strength = Math.max(0, Math.min(1, params.strength ?? 0.7));

  // Size scaling: van den Doel & Pai note that, for a broad class of
  // objects, larger instances ring lower and somewhat longer. Frequency
  // scales inversely with size; T60 scales mildly with it (sqrt, so a 4x
  // larger object rings twice as long, not four times).
  const freqScale = 1 / size;
  const t60Scale = Math.sqrt(size);

  const excitation = new Float64Array(length);
  if ((params.excitation ?? 'impulse') === 'impulse') {
    excitation[0] = strength;
  } else {
    const burstSamples = Math.min(length, Math.round(0.003 * sampleRate));
    const noise = renderNoise(burstSamples, sampleRate, { color: 'white' }, rng);
    for (let i = 0; i < burstSamples; i++) excitation[i] = noise[i] * strength;
  }

  const out = new Float64Array(length);
  for (const mode of table.modes) {
    // Brightness reshapes gain-vs-mode-index: at brightness 0, only low
    // modes survive; at 1, high modes are boosted towards the low modes'
    // level.
    const brightnessTilt = 0.35 + brightness * 1.3;
    const gain = mode.gain * pow01(brightnessTilt, indexWeight(mode.ratio));
    // Each mode's frequency and decay jitter a few percent per seed, so
    // repeated strikes of "the same" object do not sound machine-identical
    // - the recipe format's "seed jitters params" contract (see
    // presets/*'s metadata.seedJitter).
    const freqJitter = 1 + rng.range(-0.015, 0.015);
    const t60Jitter = 1 + rng.range(-0.08, 0.08);
    const freq = table.fundamentalHz * mode.ratio * freqScale * freqJitter;
    const t60 = Math.max(0.005, mode.t60 * t60Scale * t60Jitter);
    const modeOut = renderResonator(excitation, sampleRate, { kind: 'resonator', freq, t60 });
    for (let i = 0; i < length; i++) out[i] += modeOut[i] * gain;
  }

  // Normalize so a single strike peaks near 0.9 regardless of how many
  // modes happened to line up in phase.
  let peak = 0;
  for (let i = 0; i < length; i++) { const a = Math.abs(out[i]); if (a > peak) peak = a; }
  if (peak > 1e-9) { const g = 0.9 / peak; for (let i = 0; i < length; i++) out[i] *= g; }
  return out;
}

/** log2(ratio), via the engine's own `log` (never `Math.log2`): grows
 * slowly with mode index, giving brightnessTilt a gentle per-mode falloff
 * rather than a cliff. */
function indexWeight(ratio: number): number {
  return log(Math.max(1, ratio)) / LN2;
}
/** brightnessTilt^indexWeight, via the engine's own `pow` (never
 * `Math.pow`): this is a once-per-mode call (a handful of modes per
 * render), not a per-sample one, so going through the transcendental path
 * costs nothing measurable. */
function pow01(base: number, exponent: number): number {
  return pow(base, exponent);
}
