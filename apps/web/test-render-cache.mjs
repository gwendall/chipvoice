import assert from 'node:assert/strict';
import { build } from '../../packages/chipvoice/node_modules/esbuild/lib/main.js';
import { arrange, renderSong, toWav } from '../../packages/chipvoice/dist/index.js';
async function module(path) {
  const output = await build({ entryPoints:[path], bundle:true, platform:'node', format:'esm', write:false, logLevel:'silent' });
  return import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
}
// createRenderCache's own dedup/admission/eviction behavior is web-kit's,
// covered by packages/web-kit/test/audio.test.mjs. This script only proves
// audio-renderer.ts's own glue: hashing the built renderer into the cache
// key, admitting through the caller-supplied gate, and matching a real
// worker's WAV output.
const { renderAudio } = await module('src/lib/audio-renderer.ts');
const score = {chip:'snes',bpm:144,order:[0],patterns:[{lead:'C4 . E4 .',bass:'C2 . . .',chord:'C3 . . .',perc:'K . H .',chordShape:[[0,4,7]]}]};
let admitted=0, finished=false;
const pending=renderAudio({score,seconds:.25,format:'wav',tags:{}},()=>{admitted++;}).then(value=>{finished=true;return value;});
await new Promise(resolve=>setImmediate(resolve)); assert.equal(finished,false,'rendering yields the caller event loop');
const same=renderAudio({score,seconds:.25,format:'wav',tags:{}},()=>{admitted++;});
const asset=await pending; assert.equal(await same,asset); assert.equal(admitted,1);
assert.deepEqual(asset.bytes,toWav(renderSong(arrange(score),{seconds:.25,stereo:true})));
assert.match(asset.etag,/^"[0-9a-f]{64}"$/);
console.log('PASS render admission, dedup keyed by the built renderer, and real worker WAV parity');
