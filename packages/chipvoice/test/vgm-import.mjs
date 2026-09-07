import assert from 'node:assert/strict';
import {importVgm,isolateNativePerformance} from '../dist/index.js';
const fixture=(body)=>{const b=new Uint8Array(64+body.length);const v=new DataView(b.buffer);b.set([86,103,109,32]);v.setUint32(4,b.length-4,true);v.setUint32(8,0x150,true);v.setUint32(12,3579545,true);v.setUint32(0x2c,7670453,true);v.setUint16(0x28,9,true);b[0x2a]=16;v.setUint32(0x34,12,true);v.setUint32(0x18,10,true);b.set(body,64);return b;};
const bytes=fixture([0x67,0x66,0,2,0,0,0,24,200,0x52,0x2b,0x80,0xe0,0,0,0,0,0x81,0x82,0x50,0x9f,0x76,0x66]);
const p=importVgm(bytes);assert.equal(p.chip,'md');assert.equal(p.seconds,10/44100);assert.deepEqual(p.events.map(e=>[e.addr,e.value]),[[0xa04000,0x2b],[0xa04001,128],[0xa04000,0x2a],[0xa04001,24],[0xa04000,0x2a],[0xa04001,200],[0xc00011,159]]);assert.ok(p.events[4].at>=Math.round(53693175/44100));assert.ok(p.events[5].at-p.events[4].at>=42*15);
for(const body of [[0x81,0x66],[0x67,0x66,0,255,0,0,0],[0x51,0,0,0x66],[0x4f,0,0x66],[0x61,3,0],[0x62,0x66]])assert.throws(()=>importVgm(fixture(body)));
const truncated=bytes.slice(0,-1);assert.throws(()=>importVgm(truncated));
const loop=bytes.slice();new DataView(loop.buffer).setUint32(0x1c,64+18-0x1c,true);new DataView(loop.buffer).setUint32(0x20,9,true);assert.equal(importVgm(loop).loopStartSeconds,1/44100);
const invalidLoop=loop.slice();new DataView(invalidLoop.buffer).setUint32(0x1c,65-0x1c,true);assert.throws(()=>importVgm(invalidLoop));
console.log('PASS native VGM FM/PSG/DAC bytes, sample timing, loop offsets, malformed input and unsupported chips');

const dac=isolateNativePerformance(p,['fm6']);assert.deepEqual(dac.events.slice(0,-1),p.events.slice(0,-1));
const fm=isolateNativePerformance(p,['fm1']);assert.equal(fm.events[1].value,0);assert.equal(p.events[1].value,128,'solo never mutates the native source');assert.deepEqual(fm.events.map(e=>e.at),p.events.map(e=>e.at));
const psg={...p,events:[{at:0,addr:0xc00011,value:0xc1},{at:1,addr:0xc00011,value:0x20},{at:2,addr:0xc00011,value:0xd0},{at:3,addr:0xc00011,value:3}]};assert.deepEqual(isolateNativePerformance(psg,['noise']).events.map(e=>e.value),[0xc1,0x20,0xdf,15],'tone 3 noise clock survives tone muting, including continuation bytes');assert.throws(()=>isolateNativePerformance(p,['typo']));
console.log('PASS native solo retains timing, DAC data, shared PSG clocks and immutable input');

// VGM batches registers at one sample. The YM's write pipeline must have time
// to commit each operator and frequency byte before the next bus write.
const batched=fixture([0x52,0x30,7,0x52,0x50,31,0x52,0xa4,0x24,0x52,0xa0,0xd2,0x52,0xb4,0xc0,0x52,0x28,0xf0,0x61,0xdf,2,0x66]);new DataView(batched.buffer).setUint32(0x18,735,true);
const {mdChip}=await import('../dist/index.js');const bus=mdChip.digital();bus.schedule(importVgm(batched).events);while(bus.cycle<50000)bus.run(bus.untilNext());assert.equal(bus.ym.multi[0],14,'batched FM operator multiplier reaches the chip');assert.equal(bus.ym.ar[0],31,'batched envelope reaches the chip');assert.equal(bus.ym.fnum[0],1234,'batched pitch reaches the chip');assert.equal(bus.ym.block[0],4);
console.log('PASS VGM sample-coincident commands commit every FM setting in the actual core');

const impossible=fixture([0x52,0x30,7,0x52,0x50,31,0x52,0xa4,0x24,0x52,0xa0,0xd2,0x70,0x66]);new DataView(impossible.buffer).setUint32(0x18,1,true);assert.throws(()=>importVgm(impossible),/bus.*duration/,'reject rather than truncate pending writes');
const delivered=mdChip.digital();delivered.schedule(p.events);const end=Math.floor(p.seconds*53693175);while(delivered.cycle<end)delivered.run(Math.min(delivered.untilNext(),end-delivered.cycle));assert.equal(delivered.ym.dacdata,(200^128)<<1,'last DAC byte is applied before the render ends');
const csm={...p,events:[{at:0,addr:0xa04000,value:0x27},{at:630,addr:0xa04001,value:0x81}]};assert.equal(isolateNativePerformance(csm,['fm1']).events[1].value,0x01,'unselected FM3 cannot self-trigger through CSM');assert.equal(isolateNativePerformance(csm,['fm3']).events[1].value,0x81,'selected FM3 retains its CSM program');
console.log('PASS serialized VGM deadline, last-byte delivery and CSM solo isolation');

for(const [voice,expected] of [['fm1',0],['fm3',1]]){const c=mdChip.digital();c.schedule(isolateNativePerformance(csm,[voice]).events);while(c.cycle<5000)c.run(c.untilNext());assert.equal(c.ym.mode_csm,expected,'CSM mode is masked in the actual core only when FM3 is excluded');}
