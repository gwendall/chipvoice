import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {engineModules} from '../arrangements/engine.mjs';

// The catalogue's engine is the built package modules generate.mjs actually
// reaches (each chip's core and driver, performance.js for planning/render,
// performance-palette.js for the probe instruments), found the same way
// scores/arrangements/engine.mjs finds evaluate.mjs's and
// scores/mixing/provenance.mjs finds calibrate.mjs's: bundling the entry with
// esbuild and keeping only the modules with bytes in the tree-shaken output,
// restricted to packages/chipvoice/dist. presets.mjs and the measurement code
// in this directory are not part of that dist, so a change to how a preset is
// labelled or how an envelope is measured never moves this hash; a change to
// a chip's core, driver or the performance planner does.
export const CATALOGUE_VERSION = 1;
const root = resolve(import.meta.dirname, '../..'), dist = resolve(root, 'packages/chipvoice/dist');

export async function catalogueEngineModules() {
  return engineModules('scores/instruments/generate.mjs');
}
export async function catalogueEngineHash() {
  // CATALOGUE_VERSION stands in for the measurement method itself: the probe's
  // pitch/duration/velocity and the envelope/spectrum analysis live in this
  // directory, outside dist, so changing them cannot move this hash by their
  // bytes; a deliberate change to how the catalogue measures bumps this
  // constant by hand instead, the same convention as MIX_PROFILE_VERSION.
  const hash = createHash('sha256').update(String(CATALOGUE_VERSION));
  for (const file of await catalogueEngineModules()) hash.update(file).update(await readFile(resolve(dist, file)));
  return hash.digest('hex');
}
