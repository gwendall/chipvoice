/**
 * Small builders for graph/types.ts's `GraphNode` shape, shared by every
 * model in presets/*.ts, so a model file reads as "a click is an oscillator
 * times an envelope" rather than repeating object literals.
 *
 * `newIdGen` is a per-call closure, never a module-level counter: a
 * model's `compile()` must build the exact same node ids for the exact same
 * params every time it runs, in any process, in any order relative to other
 * compiles - graph/compile.ts derives each node's PRNG seed from
 * `(masterSeed, node.id)` (rng/prng.ts's deriveSeed), so an id that drifted
 * with global call history would silently break this engine's determinism
 * guarantee. Every model below creates its own id generator at the top of
 * `compile()`.
 */
import type { GraphNode, Ref } from '../graph/types.js';
import { createPrng, deriveSeed } from '../rng/prng.js';

export function newIdGen(prefix = 'n'): () => string {
  let n = 0;
  return () => `${prefix}${n++}`;
}

export function ref(id: string): Ref {
  return { ref: id };
}

export function constNode(id: string, value: number): GraphNode {
  return { id, type: 'const', params: { value } };
}

export function oscNode(id: string, shape: 'sine' | 'triangle' | 'saw' | 'square', freq: number | Ref, extra: Record<string, unknown> = {}): GraphNode {
  return { id, type: 'oscillator', params: { shape, freq, ...extra } };
}

export function noiseNode(id: string, color: 'white' | 'pink' | 'brown' | 'velvet', extra: Record<string, unknown> = {}): GraphNode {
  return { id, type: 'noise', params: { color, ...extra } };
}

export function adsrNode(id: string, params: { attack: number; decay: number; sustain: number; release: number; sustainHold?: number; curve?: 'linear' | 'exponential'; peak?: number }): GraphNode {
  return { id, type: 'envelope', params: { kind: 'adsr', ...params } };
}

export function segmentsNode(id: string, points: Array<{ time: number; value: number; curve?: 'linear' | 'exponential' }>): GraphNode {
  return { id, type: 'envelope', params: { kind: 'segments', points } };
}

export function sweepNode(id: string, from: number, to: number, curve: 'linear' | 'exponential' = 'linear'): GraphNode {
  return { id, type: 'sweep', params: { from, to, curve } };
}

export function mulNode(id: string, inputs: string[]): GraphNode {
  return { id, type: 'multiply', params: {}, inputs };
}

export function svfNode(id: string, input: string, mode: 'lowpass' | 'highpass' | 'bandpass' | 'notch', cutoff: number | Ref, q = 0.8): GraphNode {
  return { id, type: 'filter', params: { kind: 'svf', mode, cutoff, q }, inputs: [input] };
}

export function biquadNode(id: string, input: string, mode: string, cutoff: number, q?: number, gainDb?: number): GraphNode {
  return { id, type: 'filter', params: { kind: 'biquad', mode, cutoff, q, gainDb }, inputs: [input] };
}

export function onePoleNode(id: string, input: string, mode: 'lowpass' | 'highpass', cutoff: number | Ref): GraphNode {
  return { id, type: 'filter', params: { kind: 'onepole', mode, cutoff }, inputs: [input] };
}

export function resonatorNode(id: string, input: string, freq: number, t60: number): GraphNode {
  return { id, type: 'filter', params: { kind: 'resonator', freq, t60 }, inputs: [input] };
}

export function waveshaperNode(id: string, input: string, shape: 'tanh' | 'fold' | 'hardclip', drive = 1): GraphNode {
  return { id, type: 'shaper', params: { kind: 'waveshaper', shape, drive }, inputs: [input] };
}

export function bitcrushNode(id: string, input: string, bits: number): GraphNode {
  return { id, type: 'shaper', params: { kind: 'bitcrush', bits }, inputs: [input] };
}

export function delayNode(id: string, input: string, timeMs: number | Ref, feedback = 0, mix = 0.5, loopFilterCutoff?: number): GraphNode {
  return { id, type: 'delay', params: { timeMs, feedback, mix, loopFilterCutoff }, inputs: [input] };
}

export function reverbNode(id: string, input: string, size = 0.5, damping = 0.5, mix = 0.3): GraphNode {
  return { id, type: 'reverb', params: { size, damping, mix }, inputs: [input] };
}

export interface MixLayerSpec { signal: string; gain?: number; offsetMs?: number }

export function mixNode(id: string, layers: MixLayerSpec[]): GraphNode {
  return { id, type: 'mix', params: { layers: layers.map((l) => ({ signal: ref(l.signal), gain: l.gain, offsetMs: l.offsetMs })) } };
}

export function modalNode(id: string, material: string, extra: Record<string, unknown> = {}): GraphNode {
  return { id, type: 'modal', params: { material, ...extra } };
}

export function phisemNode(id: string, kind: string, extra: Record<string, unknown> = {}): GraphNode {
  return { id, type: 'phisem', params: { kind, ...extra } };
}

export function karplusNode(id: string, freq: number, extra: Record<string, unknown> = {}): GraphNode {
  return { id, type: 'karplus', params: { freq, ...extra } };
}

export function bubbleNode(id: string, kind: 'single' | 'stream', extra: Record<string, unknown> = {}): GraphNode {
  return { id, type: 'bubble', params: { kind, ...extra } };
}

/** A short, self-contained "tone blip": an oscillator times an ADSR
 * envelope, the building block behind most UI/pickup/sci-fi sounds. Returns
 * the id of the final (multiplied) node; appends its nodes to `nodes`. */
export function toneBlip(
  idGen: () => string,
  nodes: GraphNode[],
  opts: { shape: 'sine' | 'triangle' | 'saw' | 'square'; freq: number | Ref; attack: number; decay: number; sustain?: number; release?: number; curve?: 'linear' | 'exponential' },
): string {
  const oscId = idGen();
  const envId = idGen();
  const mulId = idGen();
  nodes.push(oscNode(oscId, opts.shape, opts.freq));
  nodes.push(adsrNode(envId, { attack: opts.attack, decay: opts.decay, sustain: opts.sustain ?? 0, release: opts.release ?? 0.001, curve: opts.curve ?? 'exponential' }));
  nodes.push(mulNode(mulId, [oscId, envId]));
  return mulId;
}

/**
 * A "sparkle": several short sine pings at seed-derived random times,
 * pitches and gains within `duration`, summed into one mix node - the
 * building block behind magic.ts's shimmer/cast/heal/buff and any other
 * model that wants a granular, glittery texture without a real granular
 * engine (each grain is just a toneBlip placed by a mix layer's offsetMs).
 * Every grain's time/pitch/gain comes from `seededRange` with its own
 * label, so the whole layer is exactly reproducible per seed.
 */
export function sparkleLayer(
  idGen: () => string,
  nodes: GraphNode[],
  opts: { seed: number; label: string; count: number; duration: number; baseFreq: number; freqSpreadRatio?: number; shape?: 'sine' | 'triangle' },
): string {
  const spread = opts.freqSpreadRatio ?? 0.6;
  const layers: MixLayerSpec[] = [];
  for (let i = 0; i < opts.count; i++) {
    const t = seededRange(opts.seed, `${opts.label}-t${i}`, 0, opts.duration * 0.8);
    const freqMul = 1 + seededRange(opts.seed, `${opts.label}-f${i}`, -spread, spread);
    const gain = 0.3 + seededRange(opts.seed, `${opts.label}-g${i}`, 0, 0.35);
    const blipId = toneBlip(idGen, nodes, { shape: opts.shape ?? 'sine', freq: opts.baseFreq * Math.max(0.3, freqMul), attack: 0.001, decay: 0.11 });
    layers.push({ signal: blipId, gain, offsetMs: t * 1000 });
  }
  const mixId = idGen();
  nodes.push(mixNode(mixId, layers));
  return mixId;
}

/**
 * A deterministic "compile-time" jitter: a value in [min, max) derived from
 * a model's recipe seed and a label, for models built mostly from
 * oscillators (which have no seed/rng of their own - oscillator params are
 * baked into the graph at compile time, not drawn per-render). Distinct
 * from the "render-time" jitter models/modal.ts, phisem.ts, karplus.ts and
 * bubble.ts apply internally via their own node-id-derived PRNG: this is
 * the mechanism for every other model that still wants "same recipe, same
 * seed, same sound; different seed, an audibly different variant" (the
 * recipe format's "a sound is a recipe plus a seed" contract). Each model's
 * metadata documents which params use this and by how much
 * (`ModelParamMeta.seedJitter`).
 */
export function seededRange(seed: number, label: string, min: number, max: number): number {
  return createPrng(deriveSeed(seed, label)).range(min, max);
}

/** A noise burst shaped by an envelope - the building block behind most
 * impact/footstep/explosion transients. Returns the final node id. */
export function noiseBurst(
  idGen: () => string,
  nodes: GraphNode[],
  opts: { color: 'white' | 'pink' | 'brown' | 'velvet'; attack: number; decay: number; sustain?: number; release?: number; curve?: 'linear' | 'exponential' },
): string {
  const noiseId = idGen();
  const envId = idGen();
  const mulId = idGen();
  nodes.push(noiseNode(noiseId, opts.color));
  nodes.push(adsrNode(envId, { attack: opts.attack, decay: opts.decay, sustain: opts.sustain ?? 0, release: opts.release ?? 0.001, curve: opts.curve ?? 'exponential' }));
  nodes.push(mulNode(mulId, [noiseId, envId]));
  return mulId;
}
