import { comparePcm } from '../../packages/conform/src/listening/metrics.mjs';
import { renderInputNode } from './node-render.mjs';
import { renderInBrowser, renderOneInBrowser } from './browser-render.mjs';

/**
 * Renders every input in Node, then in each named Playwright engine, and
 * compares PCM hashes. Shared by `check.mjs` (Chromium only, CI-fast) and
 * `sheet.mjs` (the full local matrix): both want the same comparison, only
 * the engine list differs.
 *
 * A mismatch gets a second pass through `renderOneInBrowser`, so the report
 * carries not just "different" but the first differing sample index and the
 * largest absolute difference between the two PCM buffers - `comparePcm`'s
 * own fields, at zero tolerance, the same self-determinism check
 * `scores/arrangements/evaluate.mjs` already runs against a repeated Node
 * render.
 */
export async function compareEngines(inputs, engineNames) {
  const node = [];
  const selfCheckFailures = [];
  const nodeAudio = new Map();
  for (const input of inputs) {
    const a = renderInputNode(input);
    const b = renderInputNode(input);
    const repeat = comparePcm(a.audio, b.audio, 0);
    if (!repeat.ok) selfCheckFailures.push({ id: input.id, ...repeat });
    node.push({ id: input.id, chip: input.chip, kind: input.kind, title: input.title, seconds: input.plan.seconds, sha256: a.sha256, peak: a.peak });
    nodeAudio.set(input.id, a.audio);
  }

  const engines = {};
  for (const engineName of engineNames) {
    const result = await renderInBrowser(engineName, inputs);
    if (!result.installed) { engines[engineName] = result; continue; }
    const byId = new Map(result.results.map(r => [r.id, r]));
    const rows = [];
    for (const input of inputs) {
      const nodeRow = node.find(r => r.id === input.id);
      const browserRow = byId.get(input.id);
      const match = !!browserRow && browserRow.sha256 === nodeRow.sha256;
      const row = { id: input.id, sha256: browserRow?.sha256 ?? null, peak: browserRow?.peak ?? null, match };
      if (!match && browserRow) {
        const browserAudio = await renderOneInBrowser(engineName, input);
        const diff = comparePcm(nodeAudio.get(input.id), browserAudio, 0);
        row.diagnosis = { firstSample: diff.firstSample, maxDelta: diff.maxDelta, rmsError: diff.rmsError };
      }
      rows.push(row);
    }
    engines[engineName] = { installed: true, version: result.version, rows };
  }

  return { nodeVersion: process.version, node, selfCheckFailures, engines };
}
