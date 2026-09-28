/**
 * Magic/fantasy sounds: cast, shimmer, heal, buff, curse. Built from
 * `sparkleLayer` (several randomized short sine pings, helpers.ts) for the
 * "glittery" quality, plus a sweep for cast/buff/curse's gesture and a
 * gentle reverb for warmth (heal) or darker filtering for curse.
 */
import type { GraphNode, GraphRecipeParams } from '../graph/types.js';
import type { ModelMetadata, SfxModel } from './types.js';
import { newIdGen, ref, sparkleLayer, sweepNode, oscNode, segmentsNode, mulNode, mixNode, reverbNode, svfNode, noiseNode, adsrNode } from './helpers.js';

export type MagicKind = 'cast' | 'shimmer' | 'heal' | 'buff' | 'curse';

export interface MagicParams {
  kind: MagicKind;
}

function compile(rawParams: Record<string, unknown>, seed: number, _sampleRate: number): GraphRecipeParams {
  const p = rawParams as unknown as MagicParams;
  const id = newIdGen('n');
  const nodes: GraphNode[] = [];
  let output: string;
  let duration: number;

  switch (p.kind) {
    case 'cast': {
      duration = 0.5;
      const sweepId = id(); nodes.push(sweepNode(sweepId, 260, 900, 'exponential'));
      const oscId = id(); nodes.push(oscNode(oscId, 'triangle', ref(sweepId)));
      const envId = id(); nodes.push(segmentsNode(envId, [{ time: 0, value: 0 }, { time: 0.08, value: 0.7 }, { time: duration, value: 0, curve: 'exponential' }]));
      const mulId = id(); nodes.push(mulNode(mulId, [oscId, envId]));
      const sparkleId = sparkleLayer(id, nodes, { seed, label: 'cast-sparkle', count: 6, duration, baseFreq: 1600 });
      const mixId = id(); nodes.push(mixNode(mixId, [{ signal: mulId, gain: 0.8 }, { signal: sparkleId, gain: 0.7 }]));
      output = mixId;
      break;
    }
    case 'shimmer': {
      duration = 0.7;
      output = sparkleLayer(id, nodes, { seed, label: 'shimmer', count: 12, duration, baseFreq: 1800, freqSpreadRatio: 0.8 });
      break;
    }
    case 'heal': {
      duration = 0.9;
      const a = id(); nodes.push(oscNode(a, 'sine', 440));
      const aEnv = id(); nodes.push(segmentsNode(aEnv, [{ time: 0, value: 0 }, { time: 0.1, value: 0.6 }, { time: duration, value: 0, curve: 'exponential' }]));
      const aMul = id(); nodes.push(mulNode(aMul, [a, aEnv]));
      const b = id(); nodes.push(oscNode(b, 'sine', 440 * 1.5));
      const bEnv = id(); nodes.push(segmentsNode(bEnv, [{ time: 0.12, value: 0 }, { time: 0.24, value: 0.5 }, { time: duration, value: 0, curve: 'exponential' }]));
      const bMul = id(); nodes.push(mulNode(bMul, [b, bEnv]));
      const chordId = id(); nodes.push(mixNode(chordId, [{ signal: aMul }, { signal: bMul }]));
      const sparkleId = sparkleLayer(id, nodes, { seed, label: 'heal-sparkle', count: 8, duration, baseFreq: 1300, freqSpreadRatio: 0.5 });
      const mixId = id(); nodes.push(mixNode(mixId, [{ signal: chordId, gain: 0.8 }, { signal: sparkleId, gain: 0.5 }]));
      const reverbId = id(); nodes.push(reverbNode(reverbId, mixId, 0.6, 0.4, 0.4));
      output = reverbId;
      break;
    }
    case 'buff': {
      duration = 0.45;
      const sweepId = id(); nodes.push(sweepNode(sweepId, 300, 1100, 'exponential'));
      const oscId = id(); nodes.push(oscNode(oscId, 'square', ref(sweepId), { pulseWidth: 0.35 }));
      const envId = id(); nodes.push(segmentsNode(envId, [{ time: 0, value: 0 }, { time: 0.03, value: 0.7 }, { time: duration, value: 0, curve: 'exponential' }]));
      const mulId = id(); nodes.push(mulNode(mulId, [oscId, envId]));
      const sparkleId = sparkleLayer(id, nodes, { seed, label: 'buff-sparkle', count: 5, duration, baseFreq: 2000 });
      const mixId = id(); nodes.push(mixNode(mixId, [{ signal: mulId, gain: 0.85 }, { signal: sparkleId, gain: 0.5 }]));
      output = mixId;
      break;
    }
    case 'curse': {
      duration = 0.6;
      const sweepId = id(); nodes.push(sweepNode(sweepId, 500, 140, 'exponential'));
      const oscId = id(); nodes.push(oscNode(oscId, 'saw', ref(sweepId)));
      const noiseId = id(); nodes.push(noiseNode(noiseId, 'brown'));
      const filteredNoiseId = id(); nodes.push(svfNode(filteredNoiseId, noiseId, 'lowpass', 700, 0.7));
      const mixToneId = id(); nodes.push(mixNode(mixToneId, [{ signal: oscId, gain: 0.7 }, { signal: filteredNoiseId, gain: 0.4 }]));
      const envId = id(); nodes.push(adsrNode(envId, { attack: 0.01, decay: duration * 0.85, sustain: 0, release: 0.02 }));
      const mulId = id(); nodes.push(mulNode(mulId, [mixToneId, envId]));
      output = mulId;
      break;
    }
  }

  return { duration, nodes, output };
}

const metadata: ModelMetadata = {
  id: 'magic',
  family: 'magic',
  description: 'Fantasy magic sounds: cast, shimmer, heal, buff, curse. Most layer a sparkle (several randomized short sine pings, see sparkleLayer in helpers.ts) over a gesture sweep or chord; curse is deliberately dark/noisy instead.',
  params: {
    kind: { type: 'enum', enumValues: ['cast', 'shimmer', 'heal', 'buff', 'curse'], description: 'Which magic moment this is for.', default: 'cast' },
  },
  examples: [
    { name: 'spell cast', description: 'A rising magical cast with sparkle.', params: { kind: 'cast' }, seed: 1 },
    { name: 'healing glow', description: 'A warm, sparkling heal.', params: { kind: 'heal' }, seed: 1 },
    { name: 'curse', description: 'A dark, dissonant curse.', params: { kind: 'curse' }, seed: 1 },
  ],
};

export const magicModel: SfxModel = { metadata, compile };
