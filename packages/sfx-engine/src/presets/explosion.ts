/**
 * Explosions: a filtered noise boom (lowpass cutoff sweeping down fast) plus
 * a sub-oscillator thump for weight, with an optional PhISEM debris tail
 * (models/phisem.ts's `debris` particle profile). "distant" adds algorithmic
 * reverb and extra muffling on top of "big".
 */
import type { GraphNode, GraphRecipeParams } from '../graph/types.js';
import type { ModelMetadata, SfxModel } from './types.js';
import { newIdGen, ref, noiseNode, oscNode, svfNode, onePoleNode, segmentsNode, adsrNode, mulNode, mixNode, phisemNode, reverbNode, seededRange, type MixLayerSpec } from './helpers.js';

export type ExplosionSize = 'small' | 'big' | 'distant';

export interface ExplosionParams {
  size: ExplosionSize;
  debris?: boolean;
}

function compile(rawParams: Record<string, unknown>, seed: number, _sampleRate: number): GraphRecipeParams {
  const p = rawParams as unknown as ExplosionParams;
  const size = p.size;
  const debris = p.debris ?? size !== 'small';
  const big = size !== 'small';

  const id = newIdGen('n');
  const nodes: GraphNode[] = [];
  const durationBase = (size === 'small' ? 0.9 : 2.2) * (1 + seededRange(seed, 'explosion-duration', -0.05, 0.05));

  const noiseId = id(); nodes.push(noiseNode(noiseId, 'white'));
  const cutoffId = id(); nodes.push(segmentsNode(cutoffId, [
    { time: 0, value: big ? 6000 : 4000 },
    { time: durationBase * 0.15, value: big ? 600 : 1200, curve: 'exponential' },
    { time: durationBase, value: 80, curve: 'exponential' },
  ]));
  const filteredId = id(); nodes.push(svfNode(filteredId, noiseId, 'lowpass', ref(cutoffId), 0.7));
  const envId = id(); nodes.push(adsrNode(envId, { attack: 0.002, decay: durationBase * 0.9, sustain: 0, release: 0.05 }));
  const boomId = id(); nodes.push(mulNode(boomId, [filteredId, envId]));

  const subId = id(); nodes.push(oscNode(subId, 'sine', big ? 45 : 70));
  const subEnvId = id(); nodes.push(adsrNode(subEnvId, { attack: 0.005, decay: durationBase * 0.5, sustain: 0, release: 0.05 }));
  const thumpId = id(); nodes.push(mulNode(thumpId, [subId, subEnvId]));

  const layers: MixLayerSpec[] = [{ signal: boomId, gain: 1 }, { signal: thumpId, gain: big ? 0.8 : 0.4 }];
  if (debris) {
    const debrisId = id();
    nodes.push(phisemNode(debrisId, 'debris', { numParticles: big ? 40 : 20, energy: 0.7, envelope: 'burst' }));
    layers.push({ signal: debrisId, gain: 0.5, offsetMs: 120 });
  }
  const mixId = id(); nodes.push(mixNode(mixId, layers));

  let output = mixId;
  let duration = durationBase;
  if (size === 'distant') {
    const reverbId = id(); nodes.push(reverbNode(reverbId, mixId, 0.85, 0.6, 0.55));
    const mufId = id(); nodes.push(onePoleNode(mufId, reverbId, 'lowpass', 900));
    output = mufId;
    duration = durationBase + 0.9;
  }

  return { duration, nodes, output };
}

const metadata: ModelMetadata = {
  id: 'explosion',
  family: 'explosion',
  description: 'An explosion: a fast-lowpassing noise boom plus a sub-oscillator thump, with an optional PhISEM debris tail. "distant" adds algorithmic reverb and extra muffling to the "big" boom.',
  params: {
    size: { type: 'enum', enumValues: ['small', 'big', 'distant'], description: 'small: a compact bang. big: a full, heavy boom. distant: big, but reverberant and muffled (as if heard from far away).', default: 'big' },
    debris: { type: 'boolean', description: 'Adds a falling-debris tail (PhISEM). Defaults to true for big/distant, false for small.' },
  },
  examples: [
    { name: 'grenade', description: 'A small, compact explosion.', params: { size: 'small' }, seed: 1 },
    { name: 'building demolition', description: 'A big explosion with debris.', params: { size: 'big' }, seed: 1 },
    { name: 'distant artillery', description: 'A big explosion heard from far away.', params: { size: 'distant' }, seed: 1 },
  ],
};

export const explosionModel: SfxModel = { metadata, compile };
