/**
 * Footstep sounds: one step on a surface, light or heavy. Concrete/wood/
 * metal lean on modal.ts (a short, dull strike); gravel/snow lean on
 * phisem.ts (a particle-collision crunch); grass is filtered noise (a soft
 * rustle, not a good fit for either physical model); water-puddle layers
 * bubble.ts's stream mode with a short noise splash.
 */
import type { GraphNode, GraphRecipeParams } from '../graph/types.js';
import type { ModelMetadata, SfxModel } from './types.js';
import { newIdGen, modalNode, phisemNode, bubbleNode, noiseBurst, svfNode, mixNode, seededRange, lerpExact, semitoneMultiplier } from './helpers.js';

export type Surface = 'concrete' | 'wood' | 'grass' | 'gravel' | 'snow' | 'metal' | 'water-puddle';
export type Weight = 'light' | 'heavy';

export interface FootstepParams {
  surface: Surface;
  weight?: Weight;
  /** 0..1, continuous version of `weight`: every quantity that used to
   * switch on `weight` (`heavy ? A : B`) now interpolates via
   * `lerpExact(lightValue, heavyValue, intensity)`. Defaults to 0 for
   * `weight: 'light'` and 1 for `weight: 'heavy'` (or 0 if `weight` is
   * also omitted), which reproduces the old enum's two renders
   * bit-exactly - `lerpExact` returns its `lo`/`hi` argument directly,
   * with no floating-point arithmetic, at t=0/t=1. An explicit
   * `intensity` takes priority over `weight`. */
  intensity?: number;
  /** Transposes concrete/wood/metal's modal `size` (inversely, since
   * modal.ts's `freqScale = 1/size` - see models/modal.ts) by this many
   * semitones. Has NO effect on gravel/snow (phisem.ts's PROFILES have no
   * frequency-override parameter), grass (filtered noise, no pitched
   * component) or water-puddle (splash noise + bubble.ts, neither
   * pitched); documented here rather than silently ignored. 0 (the
   * default) is an exact no-op. */
  pitch?: number;
}

function compile(rawParams: Record<string, unknown>, seed: number, _sampleRate: number): GraphRecipeParams {
  const p = rawParams as unknown as FootstepParams;
  const weight = p.weight ?? 'light';
  const heavy = weight === 'heavy';
  const intensity = p.intensity ?? (heavy ? 1 : 0);
  // modal.ts's freqScale = 1/size, so raising pitch by N semitones means
  // *dividing* size by the same multiplier that raises a direct frequency.
  const sizePitchMul = semitoneMultiplier(-(p.pitch ?? 0));
  const id = newIdGen('n');
  const nodes: GraphNode[] = [];
  let output: string;
  let duration = lerpExact(0.22, 0.35, intensity);

  switch (p.surface) {
    case 'concrete': {
      const strikeId = id();
      nodes.push(modalNode(strikeId, 'stone', { size: lerpExact(0.6, 1.1, intensity) * sizePitchMul, strength: lerpExact(0.55, 0.9, intensity), brightness: 0.3, excitation: 'noise-burst' }));
      output = strikeId;
      break;
    }
    case 'wood': {
      const strikeId = id();
      nodes.push(modalNode(strikeId, 'wood', { size: lerpExact(0.7, 1.2, intensity) * sizePitchMul, strength: lerpExact(0.5, 0.85, intensity), brightness: 0.35, excitation: 'noise-burst' }));
      output = strikeId;
      break;
    }
    case 'metal': {
      const strikeId = id();
      nodes.push(modalNode(strikeId, 'metal', { size: lerpExact(0.35, 0.6, intensity) * sizePitchMul, strength: lerpExact(0.5, 0.8, intensity), brightness: 0.6, excitation: 'noise-burst' }));
      output = strikeId;
      duration = lerpExact(0.4, 0.7, intensity);
      break;
    }
    case 'gravel': {
      const phisemId = id();
      nodes.push(phisemNode(phisemId, 'gravel', { numParticles: lerpExact(30, 55, intensity), energy: lerpExact(0.55, 0.9, intensity), envelope: 'burst' }));
      output = phisemId;
      break;
    }
    case 'snow': {
      const phisemId = id();
      nodes.push(phisemNode(phisemId, 'snow', { numParticles: lerpExact(40, 70, intensity), energy: lerpExact(0.5, 0.85, intensity), envelope: 'burst' }));
      output = phisemId;
      duration = lerpExact(0.26, 0.4, intensity);
      break;
    }
    case 'grass': {
      const burstId = noiseBurst(id, nodes, { color: 'pink', attack: 0.002, decay: lerpExact(0.09, 0.16, intensity) });
      const filteredId = id();
      nodes.push(svfNode(filteredId, burstId, 'bandpass', lerpExact(3200, 2200, intensity), 0.9));
      output = filteredId;
      break;
    }
    case 'water-puddle': {
      const splashId = noiseBurst(id, nodes, { color: 'white', attack: 0.001, decay: lerpExact(0.03, 0.05, intensity) });
      const splashFilteredId = id();
      nodes.push(svfNode(splashFilteredId, splashId, 'highpass', 900, 0.7));
      const bubbleId = id();
      nodes.push(bubbleNode(bubbleId, 'stream', { radiusRangeMm: [2, 7], rate: lerpExact(25, 45, intensity), damping: 0.4 }));
      const mixId = id();
      nodes.push(mixNode(mixId, [{ signal: splashFilteredId, gain: lerpExact(0.8, 1, intensity) }, { signal: bubbleId, gain: 0.6, offsetMs: 5 }]));
      output = mixId;
      duration = lerpExact(0.25, 0.35, intensity);
      break;
    }
  }

  // A touch of per-seed size jitter on the render length keeps a run of
  // footsteps from all reading as exactly the same duration.
  duration *= 1 + seededRange(seed, 'footstep-duration', -0.05, 0.05);
  return { duration, nodes, output };
}

const metadata: ModelMetadata = {
  id: 'footstep',
  family: 'footstep',
  description: 'A single footstep on a surface, light or heavy. Concrete/wood/metal use modal synthesis; gravel/snow use PhISEM particle collisions; grass is filtered noise; water-puddle layers a splash with bubble.ts\'s stream mode.',
  params: {
    surface: { type: 'enum', enumValues: ['concrete', 'wood', 'grass', 'gravel', 'snow', 'metal', 'water-puddle'], description: 'The surface being walked on.', default: 'concrete' },
    weight: { type: 'enum', enumValues: ['light', 'heavy'], description: 'Heavier: louder, longer, more energetic collision/strike. Shorthand for `intensity: 0` / `intensity: 1`; an explicit `intensity` takes priority.', default: 'light' },
    intensity: { type: 'number', min: 0, max: 1, default: 0, description: 'Continuous version of `weight`: 0 matches `weight: \'light\'`, 1 matches `weight: \'heavy\'` exactly (bit-for-bit), values between interpolate every surface\'s size/strength/energy/duration quantities.' },
    pitch: { type: 'number', unit: 'semitones', min: -12, max: 12, default: 0, description: 'Transposes concrete/wood/metal\'s modal strike only (via size, inversely). No audible effect on gravel, snow, grass or water-puddle - see the param\'s own doc comment in footstep.ts for why (phisem.ts has no frequency-override input; grass/water-puddle are unpitched noise).' },
  },
  examples: [
    { name: 'gravel step', description: 'A light step on gravel.', params: { surface: 'gravel', weight: 'light' }, seed: 1 },
    { name: 'heavy concrete step', description: 'A heavy boot on concrete.', params: { surface: 'concrete', weight: 'heavy' }, seed: 1 },
    { name: 'puddle splash step', description: 'A step in a shallow puddle.', params: { surface: 'water-puddle', weight: 'light' }, seed: 1 },
    { name: 'medium wood step, deep', description: 'A half-intensity wood step transposed down an octave.', params: { surface: 'wood', intensity: 0.5, pitch: -12 }, seed: 1 },
  ],
  seedJitter: [{ label: 'footstep-duration', affects: 'footstep duration', min: -0.05, max: 0.05 }],
};

export const footstepModel: SfxModel = { metadata, compile };
