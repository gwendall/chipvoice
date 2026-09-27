import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {relative,resolve} from 'node:path';
// "The engine" a hash covers is the built package modules a given entry point
// actually reaches, found by bundling that entry as a tree-shaking bundler
// would: only the modules whose code ends up in the bundle, not merely
// importable ones. A module nothing on the path imports (another chip's file
// player, a driver only the browser build uses) never moves a hash built this
// way, so unrelated engine work does not force a recheck.
// The recordings' engine is what scores/arrangements/evaluate.mjs reaches. A
// change to the chip cores, the drivers or the mixer changes the hash and
// needs a new evaluation; a change to playback, the editor or the project API
// cannot change the recordings, and no longer asks for one.
// scores/mixing/provenance.mjs shares this same walk for the calibration hash,
// with its own entry point (scores/mixing/calibrate.mjs).
const root=resolve(import.meta.dirname,'../..'),dist=resolve(root,'packages/chipvoice/dist');
export async function engineModules(entry){
 const {build}=createRequire(resolve(root,'packages/chipvoice/package.json'))('esbuild');
 const {metafile}=await build({absWorkingDir:root,entryPoints:[entry],bundle:true,write:false,metafile:true,platform:'node',format:'esm',packages:'external',logLevel:'silent',outfile:'engine.js'});
 const [output]=Object.values(metafile.outputs);
 return Object.entries(output.inputs).filter(([,input])=>input.bytesInOutput>0).map(([file])=>relative(dist,resolve(root,file))).filter(file=>!file.startsWith('..')).sort();
}
export async function engineSha256(){
 const engine=createHash('sha256');
 for(const file of await engineModules('scores/arrangements/evaluate.mjs'))engine.update(file).update(await readFile(resolve(dist,file)));
 return engine.digest('hex');
}
