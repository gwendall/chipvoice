/**
 * Explosions: a filtered noise boom (lowpass cutoff sweeping down fast) plus
 * a sub-oscillator thump for weight, with an optional PhISEM debris tail
 * (models/phisem.ts's `debris` particle profile). "distant" adds algorithmic
 * reverb and extra muffling on top of "big".
 */
import type { GraphNode, GraphRecipeParams } from '../graph/types.js';
import type { ModelMetadata, SfxModel } from './types.js';
import { newIdGen, ref, noiseNode, oscNode, svfNode, onePoleNode, segmentsNode, adsrNode, mulNode, mixNode, phisemNode, reverbNode, seededRange, lerpExact, type MixLayerSpec } from './helpers.js';

export type ExplosionSize = 'small' | 'big' | 'distant';

export interface ExplosionParams {
  size: ExplosionSize;
  debris?: boolean;
  /** 0..1, continuous version of `debris`: 0 omits the debris tail
   * entirely (no node inserted, bit-exact match for `debris: false`); at
   * 1 it exactly reproduces the old `debris: true` tail (`lerpExact`
   * returns its `hi` argument directly at t=1). Between, both the debris
   * layer's particle count and its mix gain scale down together. Defaults
   * to 1 if `debris` is true (or omitted with size other than 'small'),
   * else 0. An explicit `debrisAmount` takes priority over `debris`. */
  debrisAmount?: number;
  /** 0..1, continuous version of "distant": 0 omits the reverb+muffle
   * block entirely (bit-exact match for size 'small'/'big'); 1 exactly
   * reproduces the old size:'distant' reverb, muffle cutoff and duration
   * bonus. Defaults to 1 if `size === 'distant'`, else 0. An explicit
   * `distance` takes priority over `size === 'distant'`. */
  distance?: number;
  /** Multiplies the boom/thump/debris base duration (before any distance
   * reverb tail is added). 1 (the default) is an exact no-op. */
  duration?: number;
}

function compile(rawParams: Record<string, unknown>, seed: number, _sampleRate: number): GraphRecipeParams {
  const p = rawParams as unknown as ExplosionParams;
  const size = p.size;
  const debris = p.debris ?? size !== 'small';
  const big = size !== 'small';
  const debrisAmount = p.debrisAmount ?? (debris ? 1 : 0);
  const distance = p.distance ?? (size === 'distant' ? 1 : 0);
  const durationScale = p.duration ?? 1;

  const id = newIdGen('n');
  const nodes: GraphNode[] = [];
  const durationBase = (size === 'small' ? 0.9 : 2.2) * durationScale * (1 + seededRange(seed, 'explosion-duration', -0.05, 0.05));

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
  if (debrisAmount > 0) {
    const baseNumParticles = big ? 40 : 20;
    const debrisId = id();
    nodes.push(phisemNode(debrisId, 'debris', { numParticles: lerpExact(0, baseNumParticles, debrisAmount), energy: 0.7, envelope: 'burst' }));
    layers.push({ signal: debrisId, gain: lerpExact(0, 0.5, debrisAmount), offsetMs: 120 });
  }
  const mixId = id(); nodes.push(mixNode(mixId, layers));

  let output = mixId;
  let duration = durationBase;
  if (distance > 0) {
    const reverbSize = lerpExact(0.5, 0.85, distance);
    const reverbDamping = lerpExact(0.5, 0.6, distance);
    const reverbMix = lerpExact(0.2, 0.55, distance);
    const muffleCutoff = lerpExact(4000, 900, distance);
    const reverbId = id(); nodes.push(reverbNode(reverbId, mixId, reverbSize, reverbDamping, reverbMix));
    const mufId = id(); nodes.push(onePoleNode(mufId, reverbId, 'lowpass', muffleCutoff));
    output = mufId;
    duration = durationBase + lerpExact(0, 0.9, distance);
  }

  return { duration, nodes, output };
}

const metadata: ModelMetadata = {
  id: 'explosion',
  family: 'explosion',
  description: 'An explosion: a fast-lowpassing noise boom plus a sub-oscillator thump, with an optional PhISEM debris tail. "distant" adds algorithmic reverb and extra muffling to the "big" boom.',
  params: {
    size: { type: 'enum', enumValues: ['small', 'big', 'distant'], description: 'small: a compact bang. big: a full, heavy boom. distant: big, but reverberant and muffled (as if heard from far away). Shorthand for `distance: 0` / `distance: 1`; an explicit `distance` takes priority.', default: 'big' },
    debris: { type: 'boolean', description: 'Adds a falling-debris tail (PhISEM). Defaults to true for big/distant, false for small. Shorthand for `debrisAmount: 0` / `debrisAmount: 1`; an explicit `debrisAmount` takes priority.' },
    debrisAmount: { type: 'number', min: 0, max: 1, default: 0, description: 'Continuous version of `debris`: scales the debris tail\'s particle count and mix gain together, 0 = no tail (matches `debris: false` bit-exactly), 1 = the full tail (matches `debris: true` bit-exactly).' },
    distance: { type: 'number', min: 0, max: 1, default: 0, description: 'Continuous version of "distant": scales the reverb size/damping/mix, the post-reverb muffle cutoff, and the duration bonus together. 0 = no reverb/muffle block at all (matches size \'small\'/\'big\' bit-exactly), 1 = the full distant treatment (matches size \'distant\' bit-exactly).' },
    duration: { type: 'number', unit: 'x', min: 0.4, max: 2.5, default: 1, description: 'Scales the boom/thump/debris base duration. 1 leaves the size\'s reference duration unchanged; the distance reverb-tail bonus (if any) is added on top, unscaled.' },
  },
  examples: [
    { name: 'grenade', description: 'A small, compact explosion.', params: { size: 'small' }, seed: 1 },
    { name: 'building demolition', description: 'A big explosion with debris.', params: { size: 'big' }, seed: 1 },
    { name: 'distant artillery', description: 'A big explosion heard from far away.', params: { size: 'distant' }, seed: 1 },
    { name: 'half-distant rumble', description: 'A big explosion halfway between close and distant, with a light debris tail.', params: { size: 'big', distance: 0.5, debrisAmount: 0.3 }, seed: 1 },
  ],
  seedJitter: [{ label: 'explosion-duration', affects: 'explosion duration', min: -0.05, max: 0.05 }],
};

export const explosionModel: SfxModel = { metadata, compile };
