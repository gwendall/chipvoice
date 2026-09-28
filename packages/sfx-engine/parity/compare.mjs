import { renderInputNode } from './node-render.mjs';
import { renderInBrowser, renderOneInBrowser } from './browser-render.mjs';

/**
 * A local, dependency-free re-implementation of "compare two PCM buffers":
 * first differing sample index, largest absolute difference, RMS error.
 * Diagnostic-only tooling (this is not part of the deterministic engine
 * itself, just a human-readable report on a mismatch that should not
 * happen), so plain `Math.abs`/`Math.sqrt` is fine here even though the
 * engine's own DSP core never uses native `Math.*` transcendentals - see
 * src/dsp/math.ts's doc comment for why the engine itself has that rule.
 */
function comparePcm(aLeft, aRight, bLeft, bRight) {
  const len = Math.max(aLeft.length, bLeft.length);
  let firstSample = -1;
  let maxDelta = 0;
  let sumSq = 0;
  let n = 0;
  for (let i = 0; i < len; i++) {
    const dl = Math.abs((aLeft[i] ?? 0) - (bLeft[i] ?? 0));
    const dr = Math.abs((aRight[i] ?? 0) - (bRight[i] ?? 0));
    const d = Math.max(dl, dr);
    if (d > 0 && firstSample === -1) firstSample = i;
    if (d > maxDelta) maxDelta = d;
    sumSq += dl * dl + dr * dr;
    n += 2;
  }
  return { firstSample, maxDelta, rmsError: n > 0 ? Math.sqrt(sumSq / n) : 0 };
}

/**
 * Renders every input in Node, then in each named Playwright engine, and
 * compares PCM hashes. A mismatch gets a second pass through
 * `renderOneInBrowser`, so the report carries not just "different" but the
 * first differing sample index and the largest absolute/RMS difference
 * between the two PCM buffers - the same self-determinism check
 * `test/presets.test.mjs`'s "rendering the same preset id and seed twice is
 * bit-identical" test already runs, just against every input in this fixed
 * set and across real browser engines rather than only Node.
 *
 * `options.perturb` is `self-test.mjs`'s hook only: forwarded to every
 * browser call unchanged, it never fires in a normal `check.mjs` run
 * (nothing here ever sets it on its own). Mirrors
 * scores/render-parity/compare.mjs's shape.
 */
export async function compareEngines(inputs, engineNames, options = {}) {
  const { perturb } = options;
  const node = [];
  const selfCheckFailures = [];
  const nodeAudio = new Map();
  for (const input of inputs) {
    const a = renderInputNode(input);
    const b = renderInputNode(input);
    if (a.sha256 !== b.sha256) {
      const repeat = comparePcm(a.left, a.right, b.left, b.right);
      selfCheckFailures.push({ id: input.id, ...repeat });
    }
    node.push({ id: input.id, sha256: a.sha256 });
    nodeAudio.set(input.id, { left: a.left, right: a.right });
  }

  const engines = {};
  for (const engineName of engineNames) {
    const result = await renderInBrowser(engineName, inputs, { perturb });
    if (!result.installed) { engines[engineName] = result; continue; }
    const byId = new Map(result.results.map((r) => [r.id, r]));
    const rows = [];
    for (const input of inputs) {
      const nodeRow = node.find((r) => r.id === input.id);
      const browserRow = byId.get(input.id);
      const match = !!browserRow && browserRow.sha256 === nodeRow.sha256;
      const row = { id: input.id, sha256: browserRow?.sha256 ?? null, match };
      if (!match && browserRow) {
        const browserAudio = await renderOneInBrowser(engineName, input, { perturb });
        const audio = nodeAudio.get(input.id);
        row.diagnosis = comparePcm(audio.left, audio.right, browserAudio.left, browserAudio.right);
      }
      rows.push(row);
    }
    engines[engineName] = { installed: true, version: result.version, rows };
  }

  return { nodeVersion: process.version, node, selfCheckFailures, engines };
}
