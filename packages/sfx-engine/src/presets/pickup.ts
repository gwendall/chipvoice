/**
 * Pickup/reward sounds (non-retro - no chiptune square-wave arpeggio
 * cliche, warmer tones instead): coin, gem, key, powerup, level-up chime.
 * key is the one physically-informed model here (a short metallic modal
 * jingle, three quick strikes); the rest are tuned oscillator arpeggios,
 * gem adding helpers.ts's sparkleLayer.
 */
import type { GraphNode, GraphRecipeParams } from '../graph/types.js';
import type { ModelMetadata, SfxModel } from './types.js';
import { newIdGen, toneBlip, sparkleLayer, mixNode, modalNode, seededRange } from './helpers.js';

export type PickupKind = 'coin' | 'gem' | 'key' | 'powerup' | 'level-up';

export interface PickupParams {
  kind: PickupKind;
}

function compile(rawParams: Record<string, unknown>, seed: number, _sampleRate: number): GraphRecipeParams {
  const p = rawParams as unknown as PickupParams;
  const id = newIdGen('n');
  const nodes: GraphNode[] = [];
  let output: string;
  let duration: number;

  switch (p.kind) {
    case 'coin': {
      duration = 0.22;
      const pitchJitter = 1 + seededRange(seed, 'coin-pitch', -0.02, 0.02);
      const a = toneBlip(id, nodes, { shape: 'triangle', freq: 880 * pitchJitter, attack: 0.001, decay: 0.05 });
      const b = toneBlip(id, nodes, { shape: 'triangle', freq: 1320 * pitchJitter, attack: 0.001, decay: 0.16 });
      const mixId = id(); nodes.push(mixNode(mixId, [{ signal: a }, { signal: b, offsetMs: 45 }]));
      output = mixId;
      break;
    }
    case 'gem': {
      duration = 0.5;
      const a = toneBlip(id, nodes, { shape: 'sine', freq: 1300, attack: 0.001, decay: 0.12 });
      const b = toneBlip(id, nodes, { shape: 'sine', freq: 1950, attack: 0.001, decay: 0.2 });
      const ringId = id(); nodes.push(mixNode(ringId, [{ signal: a }, { signal: b, offsetMs: 35 }]));
      const sparkleId = sparkleLayer(id, nodes, { seed, label: 'gem-sparkle', count: 7, duration, baseFreq: 2400, freqSpreadRatio: 0.5 });
      const mixId = id(); nodes.push(mixNode(mixId, [{ signal: ringId, gain: 0.8 }, { signal: sparkleId, gain: 0.6 }]));
      output = mixId;
      break;
    }
    case 'key': {
      duration = 0.5;
      const sizeJitter = 1 + seededRange(seed, 'key-size', -0.1, 0.1);
      const a = id(); nodes.push(modalNode(a, 'metal', { size: 0.22 * sizeJitter, strength: 0.6, brightness: 0.7, excitation: 'noise-burst' }));
      const b = id(); nodes.push(modalNode(b, 'metal', { size: 0.26 * sizeJitter, strength: 0.55, brightness: 0.7, excitation: 'noise-burst' }));
      const c = id(); nodes.push(modalNode(c, 'metal', { size: 0.2 * sizeJitter, strength: 0.5, brightness: 0.7, excitation: 'noise-burst' }));
      const mixId = id(); nodes.push(mixNode(mixId, [{ signal: a, offsetMs: 0 }, { signal: b, offsetMs: 60 }, { signal: c, offsetMs: 130 }]));
      output = mixId;
      break;
    }
    case 'powerup': {
      duration = 0.4;
      const pitchJitter = 1 + seededRange(seed, 'powerup-pitch', -0.02, 0.02);
      const a = toneBlip(id, nodes, { shape: 'triangle', freq: 400 * pitchJitter, attack: 0.001, decay: 0.09 });
      const b = toneBlip(id, nodes, { shape: 'triangle', freq: 500 * pitchJitter, attack: 0.001, decay: 0.09 });
      const c = toneBlip(id, nodes, { shape: 'triangle', freq: 660 * pitchJitter, attack: 0.001, decay: 0.16 });
      const mixId = id(); nodes.push(mixNode(mixId, [{ signal: a, offsetMs: 0 }, { signal: b, offsetMs: 60 }, { signal: c, offsetMs: 120 }]));
      output = mixId;
      break;
    }
    case 'level-up': {
      duration = 0.75;
      const freqs = [523, 659, 784, 1047];
      const layerIds: string[] = [];
      for (let i = 0; i < freqs.length; i++) layerIds.push(toneBlip(id, nodes, { shape: 'sine', freq: freqs[i], attack: 0.001, decay: 0.22 }));
      const arpId = id();
      nodes.push(mixNode(arpId, layerIds.map((sig, i) => ({ signal: sig, offsetMs: i * 90 }))));
      const sparkleId = sparkleLayer(id, nodes, { seed, label: 'levelup-sparkle', count: 8, duration, baseFreq: 2100, freqSpreadRatio: 0.5 });
      const mixId = id(); nodes.push(mixNode(mixId, [{ signal: arpId, gain: 0.85 }, { signal: sparkleId, gain: 0.5 }]));
      output = mixId;
      break;
    }
  }

  return { duration, nodes, output };
}

const metadata: ModelMetadata = {
  id: 'pickup',
  family: 'pickup',
  description: 'Pickup/reward sounds: coin, gem, key, powerup, level-up chime. Warm tuned-oscillator arpeggios (deliberately not an 8-bit square-wave cliche); key is a short metallic modal jingle (three quick struck rings).',
  params: {
    kind: { type: 'enum', enumValues: ['coin', 'gem', 'key', 'powerup', 'level-up'], description: 'Which reward this is for.', default: 'coin' },
  },
  examples: [
    { name: 'coin pickup', description: 'A quick two-note coin pickup.', params: { kind: 'coin' }, seed: 1 },
    { name: 'key jingle', description: 'A small metallic key pickup.', params: { kind: 'key' }, seed: 1 },
    { name: 'level up', description: 'A triumphant four-note level-up chime.', params: { kind: 'level-up' }, seed: 1 },
  ],
};

export const pickupModel: SfxModel = { metadata, compile };
