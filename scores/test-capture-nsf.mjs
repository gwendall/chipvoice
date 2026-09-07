import assert from 'node:assert/strict';
import {captureNsf} from './capture-nsf.mjs';
const file=new Uint8Array(128+3*4096),v=new DataView(file.buffer);file.set([78,69,83,77,26,1,1,1]);v.setUint16(8,0x8000,true);v.setUint16(10,0x8000,true);v.setUint16(12,0x8010,true);file[113]=1;
// INIT switches $9000 from bank 1 to bank 2. PLAY reads its first byte.
file.set([0xa9,2,0x8d,0xf9,0x5f,0x60],128);file.set([0xad,0,0x90,0x8d,0,0x40,0x60],128+16);file[128+4096]=12;file[128+8192]=45;
const capture=captureNsf(file,{frames:3});assert.deepEqual(capture.events.filter(e=>e.value===45).map(e=>e.addr),[0x4000,0x4000,0x4000]);
const expansion=file.slice();expansion[123]=1;assert.throws(()=>captureNsf(expansion),/2A03/);
console.log('PASS banked NSF maps headers and runtime bank writes; expansion hardware is rejected');
