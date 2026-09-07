import assert from 'node:assert/strict';
import {extractDacPercussion} from './extract-dac-percussion.mjs';
const kick=Array.from({length:256},(_,i)=>Math.round(128+60*Math.sin(2*Math.PI*220*i/(44100/4))));
let seed=7;const snare=Array.from({length:256},()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return 68+seed%120;});
const samples=[...kick,...snare],body=[0x67,0x66,0,0,2,0,0,...samples,0x52,0x2b,128];
const seek=offset=>body.push(0xe0,offset&255,offset>>8,0,0);
seek(0);body.push(...Array(512).fill(0x84));seek(256);body.push(...Array(256).fill(0x84));seek(0);body.push(...Array(256).fill(0x84));body.push(0x66);
const bytes=new Uint8Array(64+body.length),v=new DataView(bytes.buffer);bytes.set([86,103,109,32]);v.setUint32(4,bytes.length-4,true);v.setUint32(8,0x150,true);v.setUint32(12,3579545,true);v.setUint32(0x2c,7670453,true);v.setUint16(0x28,9,true);bytes[0x2a]=16;v.setUint32(0x34,12,true);v.setUint32(0x18,4096,true);bytes.set(body,64);
const result=extractDacPercussion(bytes);
assert.deepEqual(result.notes.map(n=>n.tick),[0,1024,2048,3072],'a repeated attack splits concatenated samples even without another seek');
assert.deepEqual(result.notes.map(n=>n.drum),[36,38,38,36],'tonal kick and broadband snare stay distinct');
assert.deepEqual(extractDacPercussion(bytes),result,'deterministic analysis');
console.log('PASS DAC concatenated attacks, timing, kick/snare distinction and determinism');

const disabled=bytes.slice();const enableIndex=64+7+samples.length+2;disabled[enableIndex]=0;assert.deepEqual(extractDacPercussion(disabled).notes,[],'disabled DAC writes cannot invent drums');
const noSeek=Uint8Array.from([...bytes.slice(0,64+7+samples.length+3),...bytes.slice(64+7+samples.length+8)]);new DataView(noSeek.buffer).setUint32(4,noSeek.length-4,true);assert.deepEqual(extractDacPercussion(noSeek).notes.map(n=>n.tick),[0,1024,2048,3072],'implicit PCM cursor zero retains the first hit');
console.log('PASS disabled DAC and implicit initial stream cursor');

const bodyStart=64+7+samples.length+3+5;
const insert=(at,values)=>{const b=Uint8Array.from([...bytes.slice(0,at),...values,...bytes.slice(at)]);new DataView(b.buffer).setUint32(4,b.length-4,true);return b;};
const redundant=insert(bodyStart+128,[0x52,0x2b,128]);assert.deepEqual(extractDacPercussion(redundant).notes,result.notes,'redundant enable writes cannot split an attack');
const point=bodyStart+128,interrupted=Uint8Array.from([...bytes.slice(0,point),0x52,0x2b,0,bytes[point],0x52,0x2b,128,...bytes.slice(point+1)]);new DataView(interrupted.buffer).setUint32(4,interrupted.length-4,true);
assert.ok(extractDacPercussion(interrupted).notes.some(n=>n.tick===516),'a real reenable starts a new audible segment');
console.log('PASS redundant enable and disable/re-enable boundaries');
