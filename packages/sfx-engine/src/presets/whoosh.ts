/**
 * Whoosh/swing sounds: filtered noise whose bandpass centre frequency
 * sweeps over time (a moving band of noise reads as air movement), shaped
 * by its own amplitude envelope. sword/punch are a single up (then slight
 * down) sweep; fast-pass-by is an up-then-down sweep with the amplitude
 * swelling in the middle (an object approaching then receding); cloth is
 * narrower-band and softer.
 */
import type { GraphNode, GraphRecipeParams } from '../graph/types.js';
import type { ModelMetadata, SfxModel } from './types.js';
import { newIdGen, ref, noiseNode, svfNode, segmentsNode, adsrNode, mulNode, seededRange } from './helpers.js';

export type WhooshKind = 'sword' | 'punch' | 'fast-pass-by' | 'cloth';

export interface WhooshParams {
  kind: WhooshKind;
  /** 0..1, overall gesture speed/intensity; higher = shorter and sharper. */
  intensity?: number;
}

function compile(rawParams: Record<string, unknown>, seed: number, _sampleRate: number): GraphRecipeParams {
  const p = rawParams as unknown as WhooshParams;
  const intensity = Math.max(0, Math.min(1, p.intensity ?? 0.6));
  const speedJitter = 1 + seededRange(seed, 'whoosh-speed', -0.08, 0.08);
  const id = newIdGen('n');
  const nodes: GraphNode[] = [];
  let output: string;
  let duration: number;

  switch (p.kind) {
    case 'sword': {
      duration = (0.32 - 0.1 * intensity) * speedJitter;
      const noiseId = id(); nodes.push(noiseNode(noiseId, 'white'));
      const cutoffId = id(); nodes.push(segmentsNode(cutoffId, [{ time: 0, value: 700 }, { time: duration * 0.55, value: 3400, curve: 'exponential' }, { time: duration, value: 1400, curve: 'exponential' }]));
      const filteredId = id(); nodes.push(svfNode(filteredId, noiseId, 'bandpass', ref(cutoffId), 1.4));
      const envId = id(); nodes.push(segmentsNode(envId, [{ time: 0, value: 0 }, { time: duration * 0.4, value: 1 }, { time: duration, value: 0, curve: 'exponential' }]));
      const mulId = id(); nodes.push(mulNode(mulId, [filteredId, envId]));
      output = mulId;
      break;
    }
    case 'punch': {
      duration = (0.24 - 0.06 * intensity) * speedJitter;
      const noiseId = id(); nodes.push(noiseNode(noiseId, 'white'));
      const cutoffId = id(); nodes.push(segmentsNode(cutoffId, [{ time: 0, value: 300 }, { time: duration * 0.5, value: 1200, curve: 'exponential' }, { time: duration, value: 500, curve: 'exponential' }]));
      const filteredId = id(); nodes.push(svfNode(filteredId, noiseId, 'bandpass', ref(cutoffId), 1.1));
      const envId = id(); nodes.push(adsrNode(envId, { attack: 0.01, decay: duration * 0.7, sustain: 0, release: 0.01 }));
      const mulId = id(); nodes.push(mulNode(mulId, [filteredId, envId]));
      output = mulId;
      break;
    }
    case 'fast-pass-by': {
      duration = (0.7 - 0.15 * intensity) * speedJitter;
      const noiseId = id(); nodes.push(noiseNode(noiseId, 'pink'));
      const cutoffId = id(); nodes.push(segmentsNode(cutoffId, [{ time: 0, value: 180 }, { time: duration * 0.5, value: 4200, curve: 'exponential' }, { time: duration, value: 160, curve: 'exponential' }]));
      const filteredId = id(); nodes.push(svfNode(filteredId, noiseId, 'bandpass', ref(cutoffId), 2.2));
      const envId = id(); nodes.push(segmentsNode(envId, [{ time: 0, value: 0 }, { time: duration * 0.5, value: 1 }, { time: duration, value: 0, curve: 'exponential' }]));
      const mulId = id(); nodes.push(mulNode(mulId, [filteredId, envId]));
      output = mulId;
      break;
    }
    case 'cloth': {
      duration = (0.36 - 0.08 * intensity) * speedJitter;
      const noiseId = id(); nodes.push(noiseNode(noiseId, 'pink'));
      const cutoffId = id(); nodes.push(segmentsNode(cutoffId, [{ time: 0, value: 1200 }, { time: duration * 0.5, value: 2600, curve: 'exponential' }, { time: duration, value: 1000, curve: 'exponential' }]));
      const filteredId = id(); nodes.push(svfNode(filteredId, noiseId, 'bandpass', ref(cutoffId), 0.9));
      const envId = id(); nodes.push(segmentsNode(envId, [{ time: 0, value: 0 }, { time: duration * 0.35, value: 0.8 }, { time: duration, value: 0, curve: 'exponential' }]));
      const mulId = id(); nodes.push(mulNode(mulId, [filteredId, envId]));
      output = mulId;
      break;
    }
  }

  return { duration, nodes, output };
}

const metadata: ModelMetadata = {
  id: 'whoosh',
  family: 'whoosh',
  description: 'Air-movement sounds: filtered noise whose bandpass centre frequency sweeps over time, amplitude-shaped. sword/punch/cloth are a single swell; fast-pass-by sweeps up then down with amplitude peaking in the middle (an approach-then-recede).',
  params: {
    kind: { type: 'enum', enumValues: ['sword', 'punch', 'fast-pass-by', 'cloth'], description: 'The gesture this whoosh is for.', default: 'sword' },
    intensity: { type: 'number', min: 0, max: 1, default: 0.6, description: 'Higher = shorter and sharper (a faster swing/pass reads as a shorter, tighter whoosh).' },
  },
  examples: [
    { name: 'sword swing', description: 'A quick sword swing through the air.', params: { kind: 'sword' }, seed: 1 },
    { name: 'car pass-by', description: 'A fast object passing close by.', params: { kind: 'fast-pass-by' }, seed: 1 },
    { name: 'cloth flutter', description: 'A cloak or cloth swinging softly.', params: { kind: 'cloth' }, seed: 1 },
  ],
};

export const whooshModel: SfxModel = { metadata, compile };
