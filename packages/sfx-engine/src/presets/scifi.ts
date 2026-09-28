/**
 * Sci-fi sounds: laser, zap, teleport, shield up/down, power up/down,
 * computer beeps. All synthetic (oscillators, sweeps, ring modulation via
 * the graph's `multiply` node) - nothing physically-informed here, these
 * have no real-world object to model.
 */
import type { GraphNode, GraphRecipeParams } from '../graph/types.js';
import type { ModelMetadata, SfxModel } from './types.js';
import { newIdGen, ref, oscNode, sweepNode, segmentsNode, adsrNode, mulNode, mixNode, noiseNode, svfNode, reverbNode, seededRange } from './helpers.js';

export type ScifiKind = 'laser' | 'zap' | 'teleport' | 'shield-up' | 'shield-down' | 'power-up' | 'power-down' | 'computer-beep';

export interface ScifiParams {
  kind: ScifiKind;
}

function compile(rawParams: Record<string, unknown>, seed: number, _sampleRate: number): GraphRecipeParams {
  const p = rawParams as unknown as ScifiParams;
  const id = newIdGen('n');
  const nodes: GraphNode[] = [];
  let output: string;
  let duration: number;
  const jitter = (label: string, min: number, max: number): number => seededRange(seed, label, min, max);

  switch (p.kind) {
    case 'laser': {
      duration = 0.22;
      const sweepId = id(); nodes.push(sweepNode(sweepId, 2200 * (1 + jitter('laser-pitch', -0.1, 0.1)), 220, 'exponential'));
      const oscId = id(); nodes.push(oscNode(oscId, 'saw', ref(sweepId)));
      const envId = id(); nodes.push(adsrNode(envId, { attack: 0.001, decay: 0.19, sustain: 0, release: 0.01 }));
      const mulId = id(); nodes.push(mulNode(mulId, [oscId, envId]));
      output = mulId;
      break;
    }
    case 'zap': {
      duration = 0.28;
      const sweepId = id(); nodes.push(sweepNode(sweepId, 1800, 150, 'exponential'));
      const carrierId = id(); nodes.push(oscNode(carrierId, 'saw', ref(sweepId)));
      const modId = id(); nodes.push(oscNode(modId, 'sine', 90 * (1 + jitter('zap-mod', -0.15, 0.15))));
      const ringId = id(); nodes.push(mulNode(ringId, [carrierId, modId]));
      const envId = id(); nodes.push(adsrNode(envId, { attack: 0.001, decay: 0.24, sustain: 0, release: 0.02 }));
      const mulId = id(); nodes.push(mulNode(mulId, [ringId, envId]));
      output = mulId;
      break;
    }
    case 'teleport': {
      duration = 0.65;
      const sweepFrom = 280 * (1 + jitter('teleport-from', -0.08, 0.08));
      const sweepTo = 1900 * (1 + jitter('teleport-to', -0.08, 0.08));
      const vibratoRate = 22 * (1 + jitter('teleport-vibrato', -0.1, 0.1));
      const sweepId = id(); nodes.push(sweepNode(sweepId, sweepFrom, sweepTo, 'exponential'));
      const vibratoId = id(); nodes.push(oscNode(vibratoId, 'sine', vibratoRate));
      const freqId = id(); nodes.push(mixNode(freqId, [{ signal: sweepId, gain: 1 }, { signal: vibratoId, gain: 60 }]));
      const oscId = id(); nodes.push(oscNode(oscId, 'sine', ref(freqId)));
      const envId = id(); nodes.push(segmentsNode(envId, [{ time: 0, value: 0 }, { time: 0.006, value: 0.12 }, { time: duration * 0.5, value: 0.9 }, { time: duration, value: 0, curve: 'exponential' }]));
      const mulId = id(); nodes.push(mulNode(mulId, [oscId, envId]));
      const reverbId = id(); nodes.push(reverbNode(reverbId, mulId, 0.6, 0.4, 0.35));
      output = reverbId;
      break;
    }
    case 'shield-up':
    case 'shield-down': {
      const up = p.kind === 'shield-up';
      duration = 0.4;
      const sweepId = id(); nodes.push(sweepNode(sweepId, up ? 200 : 1600, up ? 1600 : 200, 'exponential'));
      const oscId = id(); nodes.push(oscNode(oscId, 'square', ref(sweepId), { pulseWidth: 0.3 }));
      const noiseId = id(); nodes.push(noiseNode(noiseId, 'white'));
      const filteredNoiseId = id(); nodes.push(svfNode(filteredNoiseId, noiseId, 'bandpass', ref(sweepId), 1.5));
      const mixId = id(); nodes.push(mixNode(mixId, [{ signal: oscId, gain: 0.7 }, { signal: filteredNoiseId, gain: 0.4 }]));
      const envId = id(); nodes.push(adsrNode(envId, { attack: 0.01, decay: 0.35, sustain: 0, release: 0.02 }));
      const mulId = id(); nodes.push(mulNode(mulId, [mixId, envId]));
      output = mulId;
      break;
    }
    case 'power-up':
    case 'power-down': {
      const up = p.kind === 'power-up';
      duration = 0.55;
      const rangeJitter = 1 + jitter('power-range', -0.06, 0.06);
      const sweepFrom = (up ? 180 : 1400) * rangeJitter;
      const sweepTo = (up ? 1400 : 180) * rangeJitter;
      const sweepId = id(); nodes.push(sweepNode(sweepId, sweepFrom, sweepTo, 'exponential'));
      const oscId = id(); nodes.push(oscNode(oscId, 'square', ref(sweepId), { pulseWidth: 0.4 }));
      const envId = id(); nodes.push(segmentsNode(envId, [{ time: 0, value: 0 }, { time: 0.02, value: 0.9 }, { time: duration, value: 0, curve: 'exponential' }]));
      const mulId = id(); nodes.push(mulNode(mulId, [oscId, envId]));
      output = mulId;
      break;
    }
    case 'computer-beep': {
      duration = 0.3;
      const base = 1100 * (1 + jitter('beep-pitch', -0.08, 0.08));
      const a = id(); nodes.push(oscNode(a, 'square', base));
      const aEnv = id(); nodes.push(adsrNode(aEnv, { attack: 0.001, decay: 0.05, sustain: 0, release: 0.005 }));
      const aMul = id(); nodes.push(mulNode(aMul, [a, aEnv]));
      const b = id(); nodes.push(oscNode(b, 'square', base * 1.33));
      const bEnv = id(); nodes.push(adsrNode(bEnv, { attack: 0.001, decay: 0.05, sustain: 0, release: 0.005 }));
      const bMul = id(); nodes.push(mulNode(bMul, [b, bEnv]));
      const mixId = id(); nodes.push(mixNode(mixId, [{ signal: aMul, offsetMs: 0 }, { signal: bMul, offsetMs: 110 }]));
      output = mixId;
      break;
    }
  }

  return { duration, nodes, output };
}

const metadata: ModelMetadata = {
  id: 'scifi',
  family: 'scifi',
  description: 'Synthetic sci-fi sounds: laser, zap (ring-modulated), teleport (a vibrato-swept shimmer with reverb), shield/power up and down (filtered sweeps), and a two-note computer beep.',
  params: {
    kind: { type: 'enum', enumValues: ['laser', 'zap', 'teleport', 'shield-up', 'shield-down', 'power-up', 'power-down', 'computer-beep'], description: 'Which sci-fi cue this is.', default: 'laser' },
  },
  examples: [
    { name: 'blaster laser', description: 'A classic descending laser zap.', params: { kind: 'laser' }, seed: 1 },
    { name: 'teleport shimmer', description: 'A rising, vibrating teleport-in sound.', params: { kind: 'teleport' }, seed: 1 },
    { name: 'shield up', description: 'A shield activating.', params: { kind: 'shield-up' }, seed: 1 },
    { name: 'computer beep', description: 'A two-tone computer acknowledgement beep.', params: { kind: 'computer-beep' }, seed: 1 },
  ],
};

export const scifiModel: SfxModel = { metadata, compile };
