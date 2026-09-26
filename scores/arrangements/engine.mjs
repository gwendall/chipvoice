import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {relative,resolve} from 'node:path';
// The recordings' engine is every module of the built package that the
// evaluation can reach, found by bundling evaluate.mjs as a tree-shaking
// bundler would. A change to the chip cores, the drivers or the mixer changes
// the hash and needs a new evaluation; a change to playback, the editor or the
// project API cannot change the recordings, and no longer asks for one.
const root=resolve(import.meta.dirname,'../..'),dist=resolve(root,'packages/chipvoice/dist');
export async function engineModules(){
 const {build}=createRequire(resolve(root,'packages/chipvoice/package.json'))('esbuild');
 const {metafile}=await build({absWorkingDir:root,entryPoints:['scores/arrangements/evaluate.mjs'],bundle:true,write:false,metafile:true,platform:'node',format:'esm',packages:'external',logLevel:'silent',outfile:'engine.js'});
 const [output]=Object.values(metafile.outputs);
 return Object.entries(output.inputs).filter(([,input])=>input.bytesInOutput>0).map(([file])=>relative(dist,resolve(root,file))).filter(file=>!file.startsWith('..')).sort();
}
export async function engineSha256(){
 const engine=createHash('sha256');
 for(const file of await engineModules())engine.update(file).update(await readFile(resolve(dist,file)));
 return engine.digest('hex');
}
