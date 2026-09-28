/**
 * Builds the "degraded engine" control for the CLAP semantic eval
 * (docs/GAMESOUNDS-ENGINE.md, quality evidence): the brief requires a
 * control that strips a preset's compiled graph down to "raw oscillators
 * or noise only" and must score clearly worse than the real engine. This
 * is local eval-only tooling (like parity/ and the ffmpeg cross-check), not
 * part of the shipped package - it is not imported by src/.
 *
 * Rules, applied uniformly to any compiled GraphRecipeParams so no preset
 * needs special-casing:
 *  - `filter`, `shaper`, `delay`, `reverb` nodes (secondary signal shaping)
 *    are removed; anything that referenced one (an `inputs` entry or a
 *    `{ref}` param, including nested inside `mix`'s layers) is rewired to
 *    that node's own first input instead - a straight passthrough.
 *  - `envelope` and `sweep` nodes (control-rate shaping curves) become a
 *    flat `const` at value 1: any `multiply` that used one as its
 *    amplitude envelope now passes its other input through unshaped, and
 *    any `{ref}` modulation (a filter cutoff sweep, a pitch sweep) becomes
 *    a constant instead of moving - removed in practice since the node it
 *    fed is usually a filter/oscillator's modulatable field, but kept as a
 *    generic rule rather than assuming which.
 *  - `modal`, `phisem`, `karplus` and `bubble` (this engine's
 *    physically-informed generators - resonance-shaped noise or impulse
 *    responses, not literally "raw") become plain white `noise`: several
 *    presets (all 12 impact presets, for one) are a single modal node with
 *    no filter or envelope at all, so stopping at "just remove
 *    filters/envelopes" would leave those presets completely undegraded.
 *    Replacing the physically-informed generator itself is what makes
 *    "raw oscillators or noise only" true for every preset, not just the
 *    ones built from a filter+envelope chain.
 *  - `oscillator`, `noise`, `const`, `mix` and `multiply` pass through
 *    unchanged (mix/multiply are structural combinators, not shaping).
 *
 * Duration, output and pan are preserved, so the degraded render has the
 * same length and timing as the real one - only the sound-shaping content
 * changes.
 */

const STRIPPED_TYPES = new Set(['filter', 'shaper', 'delay', 'reverb']);
const FLATTENED_TYPES = new Set(['envelope', 'sweep']);
const RAW_GENERATOR_TYPES = new Set(['modal', 'phisem', 'karplus', 'bubble']);

function isRef(value) {
  return typeof value === 'object' && value !== null && typeof value.ref === 'string' && Object.keys(value).length === 1;
}

function resolveAlias(id, aliasMap) {
  const seen = new Set();
  let current = id;
  while (aliasMap.has(current)) {
    if (seen.has(current)) throw new Error(`clap-degrade-graph: alias cycle at "${current}"`);
    seen.add(current);
    current = aliasMap.get(current);
  }
  return current;
}

function rewriteRefs(value, aliasMap) {
  if (isRef(value)) return { ref: resolveAlias(value.ref, aliasMap) };
  if (Array.isArray(value)) return value.map((v) => rewriteRefs(v, aliasMap));
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = rewriteRefs(v, aliasMap);
    return out;
  }
  return value;
}

/** @param {import('../dist/graph/types.js').GraphRecipeParams} graph */
export function degradeGraph(graph) {
  const aliasMap = new Map();
  for (const node of graph.nodes) {
    if (STRIPPED_TYPES.has(node.type)) {
      const firstInput = node.inputs && node.inputs[0];
      if (!firstInput) throw new Error(`clap-degrade-graph: "${node.id}" (${node.type}) has no input to alias to`);
      aliasMap.set(node.id, firstInput);
    }
  }

  const degradedNodes = [];
  for (const node of graph.nodes) {
    if (STRIPPED_TYPES.has(node.type)) continue;

    if (FLATTENED_TYPES.has(node.type)) {
      degradedNodes.push({ id: node.id, type: 'const', params: { value: 1 } });
      continue;
    }
    if (RAW_GENERATOR_TYPES.has(node.type)) {
      degradedNodes.push({ id: node.id, type: 'noise', params: { color: 'white' } });
      continue;
    }

    const rewritten = { id: node.id, type: node.type, params: rewriteRefs(node.params, aliasMap) };
    if (node.inputs) rewritten.inputs = node.inputs.map((i) => resolveAlias(i, aliasMap));
    degradedNodes.push(rewritten);
  }

  return {
    duration: graph.duration,
    nodes: degradedNodes,
    output: resolveAlias(graph.output, aliasMap),
    ...(graph.pan !== undefined ? { pan: graph.pan } : {}),
  };
}
