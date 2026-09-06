import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {decodeBrr} from '../dist/chips/snes/brr.js';
const built=await build({entryPoints:[new URL('../scripts/snes-bank-source.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'esm',write:false});
const {compileFactoryBank}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const {entries,encoded}=compileFactoryBank();
function seamError(entry,bytes){
  const loopByte=entry.loopSampleOffset/16*9;
  const stream=new Uint8Array(bytes.length+2*(bytes.length-loopByte));
  stream.set(bytes);stream.set(bytes.subarray(loopByte),bytes.length);stream.set(bytes.subarray(loopByte),2*bytes.length-loopByte);
  const pcm=decodeBrr(stream),original=entry.pcm;
  let peak=0;for(const value of original)peak=Math.max(peak,Math.abs(value));
  const errors=[];
  const seams=[entry.loopSampleOffset,original.length,original.length*2-entry.loopSampleOffset];
  for(const seam of seams){
    const before=seam===entry.loopSampleOffset?entry.loopSampleOffset-1:original.length-1;
    const expected=original[entry.loopSampleOffset]-original[before];
    errors.push(Math.abs((pcm[seam]-pcm[seam-1])-expected)/peak);
  }
  return errors;
}
const measurements=[];
for(let i=0;i<entries.length;i++){
  const entry=entries[i];if(!entry.loopSampleOffset)continue;
  const error=Math.max(...seamError(entry,encoded[i]));
  assert.ok(error<.01,`${entry.name}: BRR boundary adds a discontinuity above 1% of sample peak (${error})`);
  // A periodic stream can still click. Deliberately break the loop-entry slope;
  // the same check must reject both initial entry and repeated wrap artifacts.
  const broken=encoded[i].slice(),loopByte=entry.loopSampleOffset/16*9;
  broken[loopByte]=0xc0;broken[loopByte+1]=0x70;
  assert.ok(seamError(entry,broken).every(error=>error>.5),`${entry.name}: seam detector missed the broken control`);
  measurements.push({sample:entry.name,boundaryErrorFraction:error});
}
console.log('PASS attack/sustain and repeated BRR seam slopes; discontinuous controls fail:',JSON.stringify(measurements));
