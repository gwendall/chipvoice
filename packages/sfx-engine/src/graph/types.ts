/**
 * The low-level graph recipe: nodes, parameters and connections, expressive
 * enough that an agent (or a high-level model in `presets/*`) can build any
 * sound this engine can render. Every node renders a mono `Float64Array` of
 * exactly the recipe's `duration * sampleRate` samples (offline, buffer-
 * based - no streaming, since every sound here is a few hundred milliseconds
 * to a few seconds). Panning happens once, at the very end (`GraphRecipe.pan`),
 * not per node - see dsp/mix.ts's module doc for why.
 *
 * Two kinds of connection:
 * - `inputs`: audio-rate signal(s) a node processes (a filter's or shaper's
 *   single signal to process, multiply's operands - the things that read
 *   naturally as "this node's input").
 * - a `{ ref: "nodeId" }` value (a `Ref`) inside `params`: a control-rate
 *   connection, patching one node's output into another's parameter (an
 *   envelope into an oscillator's `freq` for vibrato/FM, a sweep into a
 *   filter's `cutoff`, ...). A `mix` node's layers are the one place a
 *   `Ref` carries an audio-rate signal rather than a parameter (each layer
 *   is `{ signal: Ref, gain?, offsetMs? }`), since a layer also needs its
 *   own gain and time offset alongside the signal it names.
 *   `graph/compile.ts` resolves every `Ref` (recursively, anywhere inside
 *   `params`) before calling a node's renderer, so renderer code
 *   (dsp/*.ts) only ever sees a plain `number | Float64Array`
 *   (`dsp/oscillator.ts`'s `ModulatableNumber`).
 */

export interface Ref {
  ref: string;
}

export function isRef(value: unknown): value is Ref {
  return typeof value === 'object' && value !== null && typeof (value as { ref?: unknown }).ref === 'string' && Object.keys(value as object).length === 1;
}

export type NodeType =
  | 'const'
  | 'oscillator'
  | 'noise'
  | 'envelope'
  | 'sweep'
  | 'filter'
  | 'shaper'
  | 'delay'
  | 'reverb'
  | 'mix'
  | 'multiply'
  | 'modal'
  | 'phisem'
  | 'karplus'
  | 'bubble';

export interface GraphNode {
  id: string;
  type: NodeType;
  /** Node-specific configuration. Any field may be a plain number/string
   * (documented per node type) or a `Ref` to another node's output, for the
   * fields explicitly documented as modulatable. */
  params: Record<string, unknown>;
  /** Audio-rate inputs: which other nodes' outputs this node reads as
   * signal(s), not parameters. Empty or omitted for generator nodes
   * (oscillator, noise, envelope, sweep, const, modal, phisem, karplus,
   * bubble - none of which process an incoming signal). */
  inputs?: string[];
}

export interface GraphRecipeParams {
  /** Seconds. */
  duration: number;
  nodes: GraphNode[];
  /** The node id whose output becomes the recipe's mono signal. */
  output: string;
  /** -1 (hard left) .. 1 (hard right), applied once at the end. Default 0
   * (centre; the render stays effectively mono, replicated to both
   * channels). */
  pan?: number;
}
