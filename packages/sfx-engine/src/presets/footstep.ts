/**
 * Footstep sounds: one step on a surface, light or heavy. Concrete/wood/
 * metal lean on modal.ts (a short, dull strike); gravel/snow lean on
 * phisem.ts (a particle-collision crunch); grass is filtered noise (a soft
 * rustle, not a good fit for either physical model); water-puddle layers
 * bubble.ts's stream mode with a short noise splash.
 */
import type { GraphNode, GraphRecipeParams } from '../graph/types.js';
import type { ModelMetadata, SfxModel } from './types.js';
import { newIdGen, modalNode, phisemNode, bubbleNode, noiseBurst, svfNode, mixNode, seededRange } from './helpers.js';

export type Surface = 'concrete' | 'wood' | 'grass' | 'gravel' | 'snow' | 'metal' | 'water-puddle';
export type Weight = 'light' | 'heavy';

export interface FootstepParams {
  surface: Surface;
  weight?: Weight;
}

function compile(rawParams: Record<string, unknown>, seed: number, _sampleRate: number): GraphRecipeParams {
  const p = rawParams as unknown as FootstepParams;
  const weight = p.weight ?? 'light';
  const heavy = weight === 'heavy';
  const id = newIdGen('n');
  const nodes: GraphNode[] = [];
  let output: string;
  let duration = heavy ? 0.35 : 0.22;

  switch (p.surface) {
    case 'concrete': {
      const strikeId = id();
      nodes.push(modalNode(strikeId, 'stone', { size: heavy ? 1.1 : 0.6, strength: heavy ? 0.9 : 0.55, brightness: 0.3, excitation: 'noise-burst' }));
      output = strikeId;
      break;
    }
    case 'wood': {
      const strikeId = id();
      nodes.push(modalNode(strikeId, 'wood', { size: heavy ? 1.2 : 0.7, strength: heavy ? 0.85 : 0.5, brightness: 0.35, excitation: 'noise-burst' }));
      output = strikeId;
      break;
    }
    case 'metal': {
      const strikeId = id();
      nodes.push(modalNode(strikeId, 'metal', { size: heavy ? 0.6 : 0.35, strength: heavy ? 0.8 : 0.5, brightness: 0.6, excitation: 'noise-burst' }));
      output = strikeId;
      duration = heavy ? 0.7 : 0.4;
      break;
    }
    case 'gravel': {
      const phisemId = id();
      nodes.push(phisemNode(phisemId, 'gravel', { numParticles: heavy ? 55 : 30, energy: heavy ? 0.9 : 0.55, envelope: 'burst' }));
      output = phisemId;
      break;
    }
    case 'snow': {
      const phisemId = id();
      nodes.push(phisemNode(phisemId, 'snow', { numParticles: heavy ? 70 : 40, energy: heavy ? 0.85 : 0.5, envelope: 'burst' }));
      output = phisemId;
      duration = heavy ? 0.4 : 0.26;
      break;
    }
    case 'grass': {
      const burstId = noiseBurst(id, nodes, { color: 'pink', attack: 0.002, decay: heavy ? 0.16 : 0.09 });
      const filteredId = id();
      nodes.push(svfNode(filteredId, burstId, 'bandpass', heavy ? 2200 : 3200, 0.9));
      output = filteredId;
      break;
    }
    case 'water-puddle': {
      const splashId = noiseBurst(id, nodes, { color: 'white', attack: 0.001, decay: heavy ? 0.05 : 0.03 });
      const splashFilteredId = id();
      nodes.push(svfNode(splashFilteredId, splashId, 'highpass', 900, 0.7));
      const bubbleId = id();
      nodes.push(bubbleNode(bubbleId, 'stream', { radiusRangeMm: [2, 7], rate: heavy ? 45 : 25, damping: 0.4 }));
      const mixId = id();
      nodes.push(mixNode(mixId, [{ signal: splashFilteredId, gain: heavy ? 1 : 0.8 }, { signal: bubbleId, gain: 0.6, offsetMs: 5 }]));
      output = mixId;
      duration = heavy ? 0.35 : 0.25;
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
    weight: { type: 'enum', enumValues: ['light', 'heavy'], description: 'Heavier: louder, longer, more energetic collision/strike.', default: 'light' },
  },
  examples: [
    { name: 'gravel step', description: 'A light step on gravel.', params: { surface: 'gravel', weight: 'light' }, seed: 1 },
    { name: 'heavy concrete step', description: 'A heavy boot on concrete.', params: { surface: 'concrete', weight: 'heavy' }, seed: 1 },
    { name: 'puddle splash step', description: 'A step in a shallow puddle.', params: { surface: 'water-puddle', weight: 'light' }, seed: 1 },
  ],
};

export const footstepModel: SfxModel = { metadata, compile };
