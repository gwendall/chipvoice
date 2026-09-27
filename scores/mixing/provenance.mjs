import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {engineModules} from '../arrangements/engine.mjs';
import {MIX_PROFILE_VERSION} from '../../packages/chipvoice/dist/mix-calibration.js';
// The calibration's engine is the built package modules scores/mixing/calibrate.mjs
// reaches (each chip's core and driver, performance-palette.js for the probe
// instruments, mix-calibration.js for the measurement itself), found the same
// way scores/arrangements/engine.mjs finds evaluate.mjs's engine: bundling the
// entry with esbuild and keeping only the modules with bytes in the tree-shaken
// output. A module nothing calibrate.mjs imports (another chip's file-format
// player, a driver only the browser build reaches) never moves this hash, so
// recalibration is asked for only when it would actually change a measurement.
//
// mix-profiles.js is excluded by name on purpose, defensively: it is
// calibrate.mjs's OWN output (the generated factory profiles), so hashing it
// would be circular, calibrate writes new profiles, a rebuild moves the hash,
// and check-calibration.mjs never passes again. Today nothing calibrate.mjs
// reaches imports mix-profiles.js (confirmed by inspecting engineModules'
// result: it is entirely absent, not merely zero-byte), so this filter is not
// presently removing anything; it stays in place as a guard against a future
// import chain making it reachable.
const root=resolve(import.meta.dirname,'../..'),dist=resolve(root,'packages/chipvoice/dist');
export async function calibrationEngineModules(){
 return (await engineModules('scores/mixing/calibrate.mjs')).filter(file=>file!=='mix-profiles.js');
}
export async function calibrationEngineHash(){
 // MIX_PROFILE_VERSION stands in for the measurement method itself:
 // calibrate.mjs's own pitches/durations/controls grids live outside dist, so
 // changing them cannot move this hash by their bytes; a deliberate change to
 // how calibration measures bumps this constant by hand instead.
 const hash=createHash('sha256').update(String(MIX_PROFILE_VERSION));
 for(const file of await calibrationEngineModules())hash.update(file).update(await readFile(resolve(dist,file)));
 return hash.digest('hex');
}
