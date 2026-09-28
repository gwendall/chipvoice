import assert from 'node:assert/strict';
import {captureNsf} from './capture-nsf.mjs';
const file=new Uint8Array(128+3*4096),v=new DataView(file.buffer);file.set([78,69,83,77,26,1,1,1]);v.setUint16(8,0x8000,true);v.setUint16(10,0x8000,true);v.setUint16(12,0x8010,true);file[113]=1;
// INIT switches $9000 from bank 1 to bank 2. PLAY reads its first byte.
file.set([0xa9,2,0x8d,0xf9,0x5f,0x60],128);file.set([0xad,0,0x90,0x8d,0,0x40,0x60],128+16);file[128+4096]=12;file[128+8192]=45;
const capture=captureNsf(file,{frames:3});assert.deepEqual(capture.events.filter(e=>e.value===45).map(e=>e.addr),[0x4000,0x4000,0x4000]);
// Bit 0 (VRC6) is the one expansion-audio bit this capture models -
// `nsf.ts`'s own exporter never sets any other - so it alone must not be
// rejected, and every other bit still is.
const vrc6Bit=file.slice();vrc6Bit[123]=1;
assert.deepEqual(captureNsf(vrc6Bit,{frames:3}).events.filter(e=>e.value===45).map(e=>e.addr),[0x4000,0x4000,0x4000]);
const expansion=file.slice();expansion[123]=2;assert.throws(()=>captureNsf(expansion),/2A03/);
console.log('PASS banked NSF maps headers and runtime bank writes; VRC6 alone is accepted, other expansion hardware is rejected');

// A write to one of VRC6's ten registers ($9000-$9003/$A000-$A002/
// $B000-$B002) is routed as an event, the same as any 2A03 register, once
// the header's VRC6 bit says to expect it. Real VRC6 hardware decodes
// reads and writes to this range independently (a write latches a
// register; a read still returns whatever PRG-ROM bank is mapped there),
// so this never conflicts with `nsf.ts`'s own data-window reads through
// the same addresses.
const vrc6=new Uint8Array(128+4096),vv=new DataView(vrc6.buffer);
vrc6.set([78,69,83,77,26,1,1,1]);vv.setUint16(8,0x8000,true);vv.setUint16(10,0x8000,true);vv.setUint16(12,0x8001,true);vrc6[123]=1;
vrc6.set([0x60],128); // INIT: RTS
vrc6.set([0xa9,0x0f,0x8d,0,0x90,0x60],128+1); // PLAY: LDA #$0f; STA $9000; RTS
assert.deepEqual(captureNsf(vrc6,{frames:1}).events.filter(e=>e.addr===0x9000).map(e=>e.value),[15]);
console.log('PASS a VRC6 register write is routed as an event when the header declares VRC6');

// Game_Music_Emu's own player (Nsf_Emu::start_track_ sets play_ready = 4)
// gives INIT up to four frame periods before the first PLAY call, not one;
// a driver that spends a couple of frames clearing memory or building a
// lookup table on startup is normal, not a hang. PLAY keeps the tight
// one-frame budget: on real hardware the next frame calls it again regardless.
const slowLen=20007,slowInit=new Uint8Array(128+slowLen),sv=new DataView(slowInit.buffer);
slowInit.set([78,69,83,77,26,1,1,1]);sv.setUint16(8,0x8000,true);sv.setUint16(10,0x8000,true);sv.setUint16(12,0x8000+20006,true);
slowInit.fill(0xea,128,128+20000);slowInit.set([0xa9,0x0f,0x8d,0,0x40,0x60],128+20000);slowInit.set([0x60],128+20006);
assert.ok(captureNsf(slowInit,{frames:1}).events.some(e=>e.addr===0x4000&&e.value===15),'a two-frame INIT still completes');

const stuckInit=new Uint8Array(131),tv=new DataView(stuckInit.buffer);
stuckInit.set([78,69,83,77,26,1,1,1]);tv.setUint16(8,0x8000,true);tv.setUint16(10,0x8000,true);tv.setUint16(12,0x8000,true);
stuckInit.set([0x4c,0,0x80],128);
assert.throws(()=>captureNsf(stuckInit),/budget/,'an INIT that never returns still fails capture');
console.log('PASS a multi-frame INIT is tolerated, matching Game_Music_Emu; an INIT that never returns still fails capture');

// NSF2 (version 2) keeps v1's code layout and adds an optional metadata
// chunk after a 24-bit program-data length at $7D-$7F; real NSF2 exporters
// (Pently's, for one) use the version bump purely to carry track titles,
// with every feature bit at $7C left clear. That must play identically to a
// v1 file, and the trailing metadata bytes (arbitrary text, not 6502 code)
// must never be loaded into the emulated address space.
const nsf2Code=[0xa9,7,0x8d,0,0x40,0x60],nsf2Meta=[0xff,0xff,0xff,0xff],nsf2=new Uint8Array(128+nsf2Code.length+nsf2Meta.length),n2v=new DataView(nsf2.buffer);
nsf2.set([78,69,83,77,26,2,1,1]);n2v.setUint16(8,0x8000,true);n2v.setUint16(10,0x8000,true);n2v.setUint16(12,0x8000,true);
nsf2[125]=nsf2Code.length;nsf2[126]=0;nsf2[127]=0;nsf2.set(nsf2Code,128);nsf2.set(nsf2Meta,128+nsf2Code.length);
assert.ok(captureNsf(nsf2,{frames:1}).events.some(e=>e.addr===0x4000&&e.value===7),'an NSF2 file with no feature bits set plays like v1, ignoring its trailing metadata');

const nsf2Irq=nsf2.slice();nsf2Irq[124]=0x10;
assert.throws(()=>captureNsf(nsf2Irq,{frames:1}),/NSF2/,'an NSF2 feature bit this capture does not implement is rejected, not silently misplayed');
console.log('PASS NSF2 metadata-only files play like v1; unimplemented NSF2 feature bits are rejected');

// Game_Music_Emu (`Nsf_Emu::set_tempo_`) only uses the header's custom-rate
// field for a rate other than $411a (16666), and truncates
// `rate * 1789772.72727 / 1e6` to a plain integer; Pently's demo NSF sets
// 16639, which floors to 29780, not the ~29780.03 a floating-point period
// would keep drifting by every frame.
const customRate=new Uint8Array(134),crv=new DataView(customRate.buffer);
customRate.set([78,69,83,77,26,1,1,1]);crv.setUint16(8,0x8000,true);crv.setUint16(10,0x8000,true);crv.setUint16(12,0x8000,true);crv.setUint16(110,16639,true);
customRate.set([0x60],128);
const customCapture=captureNsf(customRate,{frames:2});
assert.equal(customCapture.period,29780);
// Comparing Pently's own demo NSF (the corpus's one custom-rate file) against
// Game_Music_Emu frame by frame shows every PLAY call, not just the first,
// starting exactly one cycle later than a plain `ceil(initEnd/period)*period`
// gives; the standard rate's own half-cycle rounding already lands on the
// right cycle by coincidence (see `origin` in capture-nsf.mjs), so this
// one-cycle correction applies only to a custom rate.
assert.deepEqual(customCapture.calls.map(c=>c.at),[29781,59561]);
console.log('PASS a custom NTSC rate uses Game_Music_Emu\'s own truncated-integer period, not a floating-point one, and starts its PLAY schedule one cycle later than a plain ceil would');
