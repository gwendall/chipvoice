/**
 * Executes a low-level graph recipe: topologically sorts its nodes,
 * resolves every `Ref` param to the array it points at, renders each node
 * in order and returns the output node's mono signal. This is the one
 * place every DSP primitive and physically-informed model in the engine is
 * wired together; `presets/*` models never render audio themselves, they
 * only build a `GraphRecipeParams` for this function to run (see
 * `render/renderRecipe.ts`).
 */
import type { GraphNode, GraphRecipeParams } from './types.js';
import { isRef } from './types.js';
import { createPrng, deriveSeed } from '../rng/prng.js';
import { renderOscillator, type OscillatorParams } from '../dsp/oscillator.js';
import { renderNoise, type NoiseParams } from '../dsp/noise.js';
import { renderEnvelope, renderSweep, type EnvelopeParams, type SweepParams } from '../dsp/envelope.js';
import { renderSvf, renderBiquad, renderOnePole, renderComb, renderAllpassDelay, renderResonator, type SvfParams, type BiquadParams, type OnePoleParams, type CombParams, type AllpassParams, type ResonatorParams } from '../dsp/filter.js';
import { renderWaveshaper, renderBitcrush, renderSampleRateReduce, type WaveshaperParams, type BitcrushParams, type SampleRateReduceParams } from '../dsp/shaping.js';
import { renderDelay, type DelayParams } from '../dsp/delay.js';
import { renderReverb, type ReverbParams } from '../dsp/reverb.js';
import { mixLayers } from '../dsp/mix.js';
import { renderModal, type ModalParams } from '../models/modal.js';
import { renderPhisem, type PhisemParams } from '../models/phisem.js';
import { renderKarplus, type KarplusParams } from '../models/karplus.js';
import { renderBubble, type BubbleParams } from '../models/bubble.js';

/** Replaces every `Ref` value found (top-level fields, and one level into
 * plain-object/array fields such as `mix`'s `layers`) with the referenced
 * node's already-rendered output. Typed arrays and other non-plain values
 * pass through untouched. */
function resolveRefs(value: unknown, outputs: Map<string, Float64Array>): unknown {
  if (isRef(value)) {
    const resolved = outputs.get(value.ref);
    if (!resolved) throw new Error(`unresolved node reference: ${value.ref}`);
    return resolved;
  }
  if (Array.isArray(value)) return value.map((v) => resolveRefs(v, outputs));
  if (value !== null && typeof value === 'object' && !(value instanceof Float64Array)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = resolveRefs(v, outputs);
    return out;
  }
  return value;
}

/** Every id a node depends on: its `inputs` plus any `Ref` found anywhere
 * in `params` (recursively, mirroring resolveRefs's own traversal). */
function collectDependencies(node: GraphNode): string[] {
  const deps = new Set(node.inputs ?? []);
  const walk = (value: unknown): void => {
    if (isRef(value)) { deps.add(value.ref); return; }
    if (Array.isArray(value)) { for (const v of value) walk(v); return; }
    if (value !== null && typeof value === 'object' && !(value instanceof Float64Array)) {
      for (const v of Object.values(value as Record<string, unknown>)) walk(v);
    }
  };
  walk(node.params);
  return [...deps];
}

function topologicalSort(nodes: GraphNode[]): GraphNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const order: GraphNode[] = [];

  function visit(id: string): void {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`sfx-engine graph has a cycle at node "${id}"`);
    const node = byId.get(id);
    if (!node) throw new Error(`sfx-engine graph references unknown node id "${id}"`);
    visiting.add(id);
    for (const dep of collectDependencies(node)) visit(dep);
    visiting.delete(id);
    visited.add(id);
    order.push(node);
  }
  for (const node of nodes) visit(node.id);
  return order;
}

function renderNode(node: GraphNode, length: number, sampleRate: number, masterSeed: number, outputs: Map<string, Float64Array>): Float64Array {
  const params = resolveRefs(node.params, outputs) as Record<string, unknown>;
  const rng = createPrng(deriveSeed(masterSeed, node.id));
  const inputs = (node.inputs ?? []).map((id) => {
    const buf = outputs.get(id);
    if (!buf) throw new Error(`node "${node.id}" needs input "${id}" before it is rendered`);
    return buf;
  });

  switch (node.type) {
    case 'const': {
      const value = params.value as number;
      const out = new Float64Array(length);
      out.fill(value);
      return out;
    }
    case 'oscillator':
      return renderOscillator(length, sampleRate, params as unknown as OscillatorParams);
    case 'noise':
      return renderNoise(length, sampleRate, params as unknown as NoiseParams, rng);
    case 'envelope':
      return renderEnvelope(length, sampleRate, params as unknown as EnvelopeParams);
    case 'sweep':
      return renderSweep(length, sampleRate, params as unknown as SweepParams);
    case 'filter': {
      const kind = params.kind as string;
      const input = inputs[0];
      if (!input) throw new Error(`filter node "${node.id}" needs one input`);
      if (kind === 'svf') return renderSvf(input, sampleRate, params as unknown as SvfParams);
      if (kind === 'biquad') return renderBiquad(input, sampleRate, params as unknown as BiquadParams);
      if (kind === 'onepole') return renderOnePole(input, sampleRate, params as unknown as OnePoleParams);
      if (kind === 'comb') return renderComb(input, sampleRate, params as unknown as CombParams);
      if (kind === 'allpass-delay') return renderAllpassDelay(input, sampleRate, params as unknown as AllpassParams);
      if (kind === 'resonator') return renderResonator(input, sampleRate, params as unknown as ResonatorParams);
      throw new Error(`unknown filter kind "${kind}" on node "${node.id}"`);
    }
    case 'shaper': {
      const kind = params.kind as string;
      const input = inputs[0];
      if (!input) throw new Error(`shaper node "${node.id}" needs one input`);
      if (kind === 'waveshaper') return renderWaveshaper(input, params as unknown as WaveshaperParams);
      if (kind === 'bitcrush') return renderBitcrush(input, params as unknown as BitcrushParams);
      if (kind === 'srr') return renderSampleRateReduce(input, params as unknown as SampleRateReduceParams);
      throw new Error(`unknown shaper kind "${kind}" on node "${node.id}"`);
    }
    case 'delay': {
      const input = inputs[0];
      if (!input) throw new Error(`delay node "${node.id}" needs one input`);
      return renderDelay(input, sampleRate, params as unknown as DelayParams);
    }
    case 'reverb': {
      const input = inputs[0];
      if (!input) throw new Error(`reverb node "${node.id}" needs one input`);
      return renderReverb(input, sampleRate, params as unknown as ReverbParams);
    }
    case 'mix': {
      // Each layer's `signal` is a `Ref` (`{ ref: "nodeId" }`); resolveRefs
      // has already replaced it with the referenced node's Float64Array by
      // the time this switch runs.
      const layers = params.layers as Array<{ signal: Float64Array; gain?: number; offsetMs?: number }>;
      return mixLayers(length, layers.map((layer) => ({
        buffer: layer.signal,
        gain: layer.gain,
        offsetSamples: layer.offsetMs !== undefined ? Math.round((layer.offsetMs / 1000) * sampleRate) : undefined,
      })));
    }
    case 'multiply': {
      if (inputs.length < 2) throw new Error(`multiply node "${node.id}" needs at least two inputs`);
      const out = new Float64Array(length);
      out.fill(1);
      for (const input of inputs) for (let i = 0; i < length; i++) out[i] *= input[i] ?? 0;
      return out;
    }
    case 'modal':
      return renderModal(length, sampleRate, params as unknown as ModalParams, rng);
    case 'phisem':
      return renderPhisem(length, sampleRate, params as unknown as PhisemParams, rng);
    case 'karplus':
      return renderKarplus(length, sampleRate, params as unknown as KarplusParams, rng);
    case 'bubble':
      return renderBubble(length, sampleRate, params as unknown as BubbleParams, rng);
  }
}

/** Renders a graph recipe to a mono `Float64Array` of exactly
 * `round(duration * sampleRate)` samples. Panning to stereo happens in
 * `render/renderRecipe.ts`, which calls this function and then
 * `dsp/mix.ts`'s `panToStereo`. */
export function renderGraph(recipe: GraphRecipeParams, sampleRate: number, seed: number): Float64Array {
  const length = Math.max(1, Math.round(recipe.duration * sampleRate));
  const order = topologicalSort(recipe.nodes);
  const outputs = new Map<string, Float64Array>();
  for (const node of order) outputs.set(node.id, renderNode(node, length, sampleRate, seed, outputs));
  const result = outputs.get(recipe.output);
  if (!result) throw new Error(`recipe output node "${recipe.output}" was never rendered`);
  return result;
}
