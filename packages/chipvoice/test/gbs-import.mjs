import assert from 'node:assert/strict';
import {importGbs, parseGbsHeader} from '../dist/index.js';

/** Builds a minimal, well-formed GBS file: a 112-byte header plus a program
 * assembled by hand from raw SM83 opcodes (this package's CPU is exercised
 * opcode by opcode in cpu-gb.mjs; here it only needs to prove the GBS
 * environment - header decoding, relocation, bank switching, scheduling -
 * around a CPU already trusted to run it). */
function gbs({loadAddress = 0x400, songCount = 1, firstSong = 1, stackPointer = 0xfffe, timerModulo = 0, timerControl = 0, program, initOffset = 0, playOffset, extra = {}} = {}) {
  const header = new Uint8Array(112);
  header.set([0x47, 0x42, 0x53, 1], 0); // "GBS", version 1
  header[4] = songCount; header[5] = firstSong;
  const u16 = (offset, value) => { header[offset] = value & 0xff; header[offset + 1] = (value >> 8) & 0xff; };
  u16(6, loadAddress); u16(8, loadAddress + initOffset); u16(10, loadAddress + (playOffset ?? program.initLength)); u16(12, stackPointer);
  header[14] = timerModulo; header[15] = timerControl;
  for (const [offset, value] of Object.entries(extra)) header[Number(offset)] = value;
  const bytes = new Uint8Array(112 + program.bytes.length);
  bytes.set(header, 0); bytes.set(program.bytes, 112);
  return bytes;
}

// INIT: NR52=0x80, NR10=0x80, NR11=0xC0, NR12=0xF0, NR13=0x00, NR14=0x87; RET.
const INIT = [0x3e, 0x80, 0xe0, 0x26, 0x3e, 0x80, 0xe0, 0x10, 0x3e, 0xc0, 0xe0, 0x11, 0x3e, 0xf0, 0xe0, 0x12, 0x3e, 0x00, 0xe0, 0x13, 0x3e, 0x87, 0xe0, 0x14, 0xc9];
// PLAY: increments HRAM $FF80 and writes it to NR13 each call, then retriggers; RET.
const PLAY = [0xf0, 0x80, 0x3c, 0xe0, 0x80, 0xe0, 0x13, 0x3e, 0x87, 0xe0, 0x14, 0xc9];
const program = {bytes: new Uint8Array([...INIT, ...PLAY]), initLength: INIT.length};

// --- Header parsing. ---
{
  const bytes = gbs({program});
  const h = parseGbsHeader(bytes);
  assert.equal(h.version, 1); assert.equal(h.songCount, 1); assert.equal(h.firstSong, 1);
  assert.equal(h.loadAddress, 0x400); assert.equal(h.initAddress, 0x400); assert.equal(h.playAddress, 0x400 + INIT.length);
  assert.equal(h.stackPointer, 0xfffe); assert.equal(h.timerModulo, 0); assert.equal(h.timerControl, 0);
  console.log('PASS GBS header decodes load/init/play addresses, stack pointer, timer fields');
}

// --- Rejections, each by name. ---
{
  const bad = gbs({program}).slice(); bad[3] = 2;
  assert.throws(() => parseGbsHeader(bad), /version/i);
  const badMagic = gbs({program}).slice(); badMagic[0] = 0;
  assert.throws(() => parseGbsHeader(badMagic), /GBS/);
  assert.throws(() => parseGbsHeader(gbs({program, loadAddress: 0x200})), /load address/i);
  assert.throws(() => parseGbsHeader(gbs({program, loadAddress: 0x8000})), /load address/i);
  assert.throws(() => parseGbsHeader(gbs({program, timerControl: 0x80})), /double-speed/i);
  assert.throws(() => parseGbsHeader(gbs({program, timerControl: 0x08})), /reserved/i);
  assert.throws(() => importGbs(gbs({program, songCount: 2, firstSong: 1}), {track: 3}), /track/i);
  console.log('PASS GBS rejects an unsupported version, bad magic, an out-of-range load address, the CGB double-speed timer bit, reserved timer bits, and an out-of-range track');
}

// --- INIT then PLAY: the power-on ceremony lands at cycle 0, INIT's writes
// follow it in order, and PLAY fires at the VBlank rate (70224 cycles) with
// its own counter audible in NR13. ---
{
  const bytes = gbs({program});
  const plan = importGbs(bytes, {seconds: 70224 * 2.2 / 4194304});
  assert.equal(plan.chip, 'dmg');
  assert.deepEqual(plan.memory, []);
  const ceremony = plan.events.filter(e => e.at === 0);
  assert.equal(ceremony.length, 12, 'the boot ROM power-on ceremony writes twelve registers at cycle 0');
  const rest = plan.events.filter(e => e.at !== 0);
  // INIT's own six writes, in program order, each on a later cycle than the last.
  assert.deepEqual(rest.slice(0, 6).map(e => e.addr), [0xff26, 0xff10, 0xff11, 0xff12, 0xff13, 0xff14]);
  for (let i = 1; i < 6; i++) assert.ok(rest[i].at > rest[i - 1].at, 'INIT writes land on strictly increasing cycles');
  // Two PLAY calls follow (2.5 VBlank periods of budget): each writes NR13 then NR14.
  const plays = rest.slice(6);
  assert.equal(plays.length, 4);
  assert.deepEqual(plays.map(e => e.addr), [0xff13, 0xff14, 0xff13, 0xff14]);
  assert.deepEqual([plays[0].value, plays[2].value], [1, 2], 'PLAY\'s own counter, visible in NR13, advances each call');
  assert.ok(plays[0].at >= 70224 && plays[0].at < 70224 + 100, 'first PLAY lands at the VBlank boundary');
  assert.ok(Math.abs(plays[2].at - plays[0].at - 70224) < 4, 'PLAY is paced by whole VBlank periods');
  console.log('PASS importGbs captures the power-on ceremony, INIT\'s writes and VBlank-paced PLAY calls in order');
}

// --- The timer, not VBlank, paces PLAY when the header's timer is enabled. ---
{
  // TAC=0x05 (enabled, select=1 -> shift 4), TMA=0xf0: period = (256-240)<<4 = 256 cycles.
  const bytes = gbs({program, timerModulo: 0xf0, timerControl: 0x05});
  const plan = importGbs(bytes, {seconds: 256 * 3.5 / 4194304});
  // Skip index 0: INIT writes NR13 too (its own setup, at cycle ~96), before
  // any PLAY call. The PLAY calls proper follow it, each 256 cycles apart.
  const plays = plan.events.filter(e => e.at > 200 && e.addr === 0xff13);
  assert.ok(plays.length >= 3, 'the 256-cycle timer rate calls PLAY far more often than VBlank would');
  assert.ok(Math.abs(plays[1].at - plays[0].at - 256) < 4, 'consecutive PLAY calls are 256 cycles apart');
  console.log('PASS importGbs paces PLAY by the header\'s own timer rate when its timer is enabled');
}

// --- RST vectors relocated to the load address: RST 08H reaches a handler
// placed at loadAddress+0x08, proving the relocation stub - not the CPU -
// is what makes RST usable in a GBS's own address space. A real file's own
// INIT/PLAY code has to start after the vector area for the same reason
// this test does: loadAddress+0x08 must be free for the handler, not code. ---
{
  const loadAddress = 0x400;
  const handler = [0x3e, 0x11, 0xe0, 0x12, 0xc9]; // NR12=0x11 ; RET, at loadAddress+8
  const rstPlay = [0xcf, 0xc9]; // RST 08H ; RET
  const codeStart = 0x68; // past every RST and interrupt vector's own slot
  const bytes = new Uint8Array(112 + codeStart + INIT.length + rstPlay.length);
  const h = new Uint8Array(112);
  h.set([0x47, 0x42, 0x53, 1], 0); h[4] = 1; h[5] = 1;
  const u16 = (offset, value) => { h[offset] = value & 0xff; h[offset + 1] = (value >> 8) & 0xff; };
  u16(6, loadAddress); u16(8, loadAddress + codeStart); u16(10, loadAddress + codeStart + INIT.length); u16(12, 0xfffe);
  bytes.set(h, 0);
  bytes.set(handler, 112 + 0x08);
  bytes.set(INIT, 112 + codeStart);
  bytes.set(rstPlay, 112 + codeStart + INIT.length);
  const plan = importGbs(bytes, {seconds: 70224 * 1.5 / 4194304});
  const nr12 = plan.events.find(e => e.addr === 0xff12 && e.value === 0x11);
  assert.ok(nr12, 'RST 08H, relocated to loadAddress+8, reaches the handler placed there');
  console.log('PASS a relocated RST vector reaches a handler placed at loadAddress+offset');
}

// --- Bank switching: a write to $2000-$3FFF selects the page the switchable
// window ($4000-$7FFF) reads from, aligned relative to the load address. ---
{
  const loadAddress = 0x400;
  const pageSize = 0x4000;
  // INIT (in the fixed low bank) selects page 2, then runs its usual writes;
  // PLAY is placed only in page 2's copy of the switchable window, so it can
  // only run at all if the bank-register write actually took effect.
  const select = [0x3e, 0x02, 0xea, 0x00, 0x20]; // LD A,2 ; LD ($2000),A
  const initBytes = [...select, ...INIT];

  const h = new Uint8Array(112);
  h.set([0x47, 0x42, 0x53, 1], 0); h[4] = 1; h[5] = 1;
  const u16 = (offset, value) => { h[offset] = value & 0xff; h[offset + 1] = (value >> 8) & 0xff; };
  u16(6, loadAddress); u16(8, loadAddress); u16(10, 0x4000); u16(12, 0xfffe);

  const bytes = new Uint8Array(112 + pageSize * 3);
  bytes.set(h, 0);
  bytes.set(initBytes, 112); // file offset 0 -> virtual loadAddress, in the fixed page 0
  bytes.set(PLAY, 112 + pageSize * 2 - loadAddress); // virtual $8000 (page 2, offset 0) -> $4000 once page 2 is selected

  const plan = importGbs(bytes, {seconds: 70224 * 1.5 / 4194304});
  const nr13 = plan.events.filter(e => e.addr === 0xff13 && e.at !== 0);
  assert.ok(nr13.some(e => e.value === 1), 'PLAY, placed in the page the bank register selected, actually ran');
  console.log('PASS a $2000-$3FFF bank-register write selects the page the switchable window reads');
}

// --- The unsupported layout is rejected explicitly, not guessed at. ---
{
  const loadAddress = 0x4000;
  const bigProgram = new Uint8Array(0x4001); // needs a second page while living in the banked window
  assert.throws(() => importGbs(gbs({program: {bytes: bigProgram, initLength: 0}, loadAddress})), /memory layout/i);
  console.log('PASS a load address in the banked window needing more than one page is rejected');
}

// --- A serial transfer start is rejected; harmless serial writes are not. ---
{
  // PLAY: LD A,0 ; LDH ($FF02),A ; RET (harmless), vs LD A,0x81 ; LDH ($FF02),A ; RET (starts a transfer).
  const harmless = [0x3e, 0x00, 0xe0, 0x02, 0xc9];
  const transfer = [0x3e, 0x81, 0xe0, 0x02, 0xc9];
  const ok = gbs({program: {bytes: new Uint8Array([...INIT, ...harmless]), initLength: INIT.length}});
  importGbs(ok, {seconds: 70224 * 1.5 / 4194304}); // does not throw
  const bad = gbs({program: {bytes: new Uint8Array([...INIT, ...transfer]), initLength: INIT.length}});
  assert.throws(() => importGbs(bad, {seconds: 70224 * 1.5 / 4194304}), /serial/i);
  console.log('PASS a serial transfer start is rejected; writing $FF01/$FF02 without one is not');
}

// --- A routine that never returns is rejected loud, not left to hang. ---
{
  const spin = [0x18, 0xfe]; // JR -2: an infinite loop, never reaches RET
  const bytes = gbs({program: {bytes: new Uint8Array([...spin]), initLength: 0}});
  assert.throws(() => importGbs(bytes, {seconds: 70224 * 1.5 / 4194304}), /budget/i);
  console.log('PASS a routine that never returns is rejected as exceeding its cycle budget, not left to hang');
}

console.log('All GBS import tests passed.');
