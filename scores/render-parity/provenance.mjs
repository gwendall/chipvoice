import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { engineModules } from '../arrangements/engine.mjs';

/**
 * The render-parity engine is the built package modules `inputs.mjs` and
 * `renderPerformance` actually reach: every chip's core and driver, the
 * performance planner, and the native-source loaders. Found the same way
 * `scores/arrangements/engine.mjs` finds `evaluate.mjs`'s reachable modules
 * and `scores/instruments/provenance.mjs` finds `generate.mjs`'s: bundle the
 * entry with esbuild and keep only the dist modules with bytes in the
 * tree-shaken output. A change to an unrelated chip file nothing on this
 * path imports never moves this hash.
 */
export const RENDER_PARITY_VERSION = 1;
const root = resolve(import.meta.dirname, '../..'), dist = resolve(root, 'packages/chipvoice/dist');

export async function renderParityEngineModules() {
  return engineModules('scores/render-parity/inputs.mjs');
}

export async function renderParityEngineHash() {
  // RENDER_PARITY_VERSION stands in for the measurement method itself (the
  // excerpt length, which presets are probed): none of that lives in dist,
  // so it cannot move this hash by its own bytes; a deliberate change to the
  // fixed input set bumps this constant by hand, the same convention as
  // CATALOGUE_VERSION and MIX_PROFILE_VERSION.
  const hash = createHash('sha256').update(String(RENDER_PARITY_VERSION));
  for (const file of await renderParityEngineModules()) hash.update(file).update(await readFile(resolve(dist, file)));
  return hash.digest('hex');
}
