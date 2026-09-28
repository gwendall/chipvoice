/**
 * Magic/fantasy sounds: cast, shimmer, heal, buff, curse. Built from
 * `sparkleLayer` (several randomized short sine pings, helpers.ts) for the
 * "glittery" quality, plus a sweep for cast/buff/curse's gesture and a
 * gentle reverb for warmth (heal) or darker filtering for curse.
 */
import type { GraphNode, GraphRecipeParams } from '../graph/types.js';
import type { ModelMetadata, SfxModel } from './types.js';
import { newIdGen, ref, sparkleLayer, sweepNode, oscNode, segmentsNode, mulNode, mixNode, reverbNode, svfNode, noiseNode, adsrNode, semitoneMultiplier, applyBrightness } from './helpers.js';

export type MagicKind = 'cast' | 'shimmer' | 'heal' | 'buff' | 'curse';

export interface MagicParams {
  kind: MagicKind;
  /** Transpose every base frequency (gesture tones and sparkle centre
   * frequency alike) by this many semitones. 0 (the default) is an exact
   * no-op. */
  pitch?: number;
  /** Multiplies every kind's base duration. 1 (the default) is an exact
   * no-op. */
  duration?: number;
  /** 0..1; below 1, a one-pole lowpass is added after the whole cue
   * (see helpers.ts's applyBrightness). 1 (the default) adds no filter. */
  brightness?: number;
}

function compile(rawParams: Record<string, unknown>, seed: number, _sampleRate: number): GraphRecipeParams {
  const p = rawParams as unknown as MagicParams;
  const pitchMul = semitoneMultiplier(p.pitch ?? 0);
  const durationScale = p.duration ?? 1;
  const brightness = p.brightness ?? 1;
  const id = newIdGen('n');
  const nodes: GraphNode[] = [];
  let output: string;
  let duration: number;

  switch (p.kind) {
    case 'cast': {
      duration = 0.5 * durationScale;
      const sweepId = id(); nodes.push(sweepNode(sweepId, 260 * pitchMul, 900 * pitchMul, 'exponential'));
      const oscId = id(); nodes.push(oscNode(oscId, 'triangle', ref(sweepId)));
      const envId = id(); nodes.push(segmentsNode(envId, [{ time: 0, value: 0 }, { time: 0.08, value: 0.7 }, { time: duration, value: 0, curve: 'exponential' }]));
      const mulId = id(); nodes.push(mulNode(mulId, [oscId, envId]));
      const sparkleId = sparkleLayer(id, nodes, { seed, label: 'cast-sparkle', count: 6, duration, baseFreq: 1600 * pitchMul });
      const mixId = id(); nodes.push(mixNode(mixId, [{ signal: mulId, gain: 0.8 }, { signal: sparkleId, gain: 0.7 }]));
      output = mixId;
      break;
    }
    case 'shimmer': {
      duration = 0.7 * durationScale;
      output = sparkleLayer(id, nodes, { seed, label: 'shimmer', count: 12, duration, baseFreq: 1800 * pitchMul, freqSpreadRatio: 0.8 });
      break;
    }
    case 'heal': {
      duration = 0.9 * durationScale;
      const a = id(); nodes.push(oscNode(a, 'sine', 440 * pitchMul));
      const aEnv = id(); nodes.push(segmentsNode(aEnv, [{ time: 0, value: 0 }, { time: 0.1, value: 0.6 }, { time: duration, value: 0, curve: 'exponential' }]));
      const aMul = id(); nodes.push(mulNode(aMul, [a, aEnv]));
      const b = id(); nodes.push(oscNode(b, 'sine', 440 * pitchMul * 1.5));
      const bEnv = id(); nodes.push(segmentsNode(bEnv, [{ time: 0.12, value: 0 }, { time: 0.24, value: 0.5 }, { time: duration, value: 0, curve: 'exponential' }]));
      const bMul = id(); nodes.push(mulNode(bMul, [b, bEnv]));
      const chordId = id(); nodes.push(mixNode(chordId, [{ signal: aMul }, { signal: bMul }]));
      const sparkleId = sparkleLayer(id, nodes, { seed, label: 'heal-sparkle', count: 8, duration, baseFreq: 1300 * pitchMul, freqSpreadRatio: 0.5 });
      const mixId = id(); nodes.push(mixNode(mixId, [{ signal: chordId, gain: 0.8 }, { signal: sparkleId, gain: 0.5 }]));
      const reverbId = id(); nodes.push(reverbNode(reverbId, mixId, 0.6, 0.4, 0.4));
      output = reverbId;
      break;
    }
    case 'buff': {
      duration = 0.45 * durationScale;
      const sweepId = id(); nodes.push(sweepNode(sweepId, 300 * pitchMul, 1100 * pitchMul, 'exponential'));
      const oscId = id(); nodes.push(oscNode(oscId, 'square', ref(sweepId), { pulseWidth: 0.35 }));
      const envId = id(); nodes.push(segmentsNode(envId, [{ time: 0, value: 0 }, { time: 0.03, value: 0.7 }, { time: duration, value: 0, curve: 'exponential' }]));
      const mulId = id(); nodes.push(mulNode(mulId, [oscId, envId]));
      const sparkleId = sparkleLayer(id, nodes, { seed, label: 'buff-sparkle', count: 5, duration, baseFreq: 2000 * pitchMul });
      const mixId = id(); nodes.push(mixNode(mixId, [{ signal: mulId, gain: 0.85 }, { signal: sparkleId, gain: 0.5 }]));
      output = mixId;
      break;
    }
    case 'curse': {
      duration = 0.6 * durationScale;
      const sweepId = id(); nodes.push(sweepNode(sweepId, 500 * pitchMul, 140 * pitchMul, 'exponential'));
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

  output = applyBrightness(id, nodes, output, brightness);
  return { duration, nodes, output };
}

const metadata: ModelMetadata = {
  id: 'magic',
  family: 'magic',
  description: 'Fantasy magic sounds: cast, shimmer, heal, buff, curse. Most layer a sparkle (several randomized short sine pings, see sparkleLayer in helpers.ts) over a gesture sweep or chord; curse is deliberately dark/noisy instead.',
  params: {
    kind: { type: 'enum', enumValues: ['cast', 'shimmer', 'heal', 'buff', 'curse'], description: 'Which magic moment this is for.', default: 'cast' },
    pitch: { type: 'number', unit: 'semitones', min: -12, max: 12, default: 0, description: 'Transposes every gesture tone and sparkle centre frequency (e.g. "a cast, but lower/deeper"). 0 leaves the kind\'s reference pitch unchanged.' },
    duration: { type: 'number', unit: 'x', min: 0.4, max: 2.5, default: 1, description: 'Scales the whole cue\'s length. 1 leaves the kind\'s reference duration unchanged.' },
    brightness: { type: 'number', min: 0, max: 1, default: 1, description: 'Below 1, adds a lowpass after the whole cue (darker/more muffled magic); 1 leaves the kind\'s natural brightness untouched.' },
  },
  examples: [
    { name: 'spell cast', description: 'A rising magical cast with sparkle.', params: { kind: 'cast' }, seed: 1 },
    { name: 'healing glow', description: 'A warm, sparkling heal.', params: { kind: 'heal' }, seed: 1 },
    { name: 'curse', description: 'A dark, dissonant curse.', params: { kind: 'curse' }, seed: 1 },
    { name: 'deep slow cast', description: 'A cast transposed down an octave and stretched to twice the length.', params: { kind: 'cast', pitch: -12, duration: 2 }, seed: 1 },
  ],
  seedJitterLabels: ['cast-sparkle', 'shimmer', 'heal-sparkle', 'buff-sparkle'],
};

export const magicModel: SfxModel = { metadata, compile };
