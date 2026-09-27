import assert from 'node:assert/strict';
import {Cpu6510, IllegalOpcodeError} from '../dist/index.js';

/**
 * The 6510 alone (`psid-cpu6510.ts`): every documented opcode's result,
 * flags and cycle count, including page-cross penalties; the NMOS decimal
 * (BCD) ADC/SBC algorithm against 6502.org's own worked cases; the stable
 * illegal opcodes real SID tunes are known to use; and a check that every
 * unstable-illegal and JAM/KIL opcode is rejected by name rather than
 * silently guessed at or hung on.
 */
let failures = 0;
const check = (name, ok, extra = '') => { if (!ok) { failures++; console.log(`FAIL  ${name}  ${extra}`); } };

const N = 0x80, V = 0x40, D = 0x08, I = 0x04, Z = 0x02, C = 0x01;

/** Runs `bytes` at $1000 for exactly one instruction (or `steps`), with RAM preloaded from `preset`. */
function run(bytes, {a = 0, x = 0, y = 0, p = 0, s = 0xfd, steps = 1, preset = {}} = {}) {
  const ram = new Uint8Array(0x10000);
  const writes = [];
  const bus = {
    read: (addr) => ram[addr],
    write: (addr, value) => { ram[addr] = value & 0xff; writes.push({addr, value: value & 0xff}); },
  };
  for (const [addr, value] of Object.entries(preset)) ram[Number(addr)] = value;
  ram.set(bytes, 0x1000);
  const cpu = new Cpu6510(bus);
  cpu.pc = 0x1000; cpu.a = a; cpu.x = x; cpu.y = y; cpu.p = p; cpu.s = s;
  let cycles = 0;
  for (let i = 0; i < steps; i++) cycles += cpu.step();
  return {cpu, ram, writes, cycles};
}

// --- Load/store, every addressing mode's documented cycle count.
{ const {cpu, cycles} = run([0xa9, 0x42]); check('LDA #imm: value/cycles', cpu.a === 0x42 && cycles === 2, `a=${cpu.a} c=${cycles}`); }
{ const {cpu, cycles} = run([0xa5, 0x50], {preset: {0x50: 0x99}}); check('LDA zp: value/cycles', cpu.a === 0x99 && cycles === 3); }
{ const {cpu, cycles} = run([0xb5, 0x50], {x: 2, preset: {0x52: 7}}); check('LDA zp,x', cpu.a === 7 && cycles === 4); }
{ const {cpu, cycles} = run([0xad, 0x00, 0x30], {preset: {0x3000: 5}}); check('LDA abs', cpu.a === 5 && cycles === 4); }
{ const {cpu, cycles} = run([0xbd, 0xff, 0x30], {x: 1, preset: {0x3100: 9}}); check('LDA abs,x page-cross costs 5', cpu.a === 9 && cycles === 5); }
{ const {cpu, cycles} = run([0xbd, 0x01, 0x30], {x: 1, preset: {0x3002: 9}}); check('LDA abs,x same page costs 4', cpu.a === 9 && cycles === 4); }
{ const {cpu, cycles} = run([0xb9, 0xff, 0x30], {y: 1, preset: {0x3100: 3}}); check('LDA abs,y page-cross costs 5', cpu.a === 3 && cycles === 5); }
{ const {cpu, cycles} = run([0xa1, 0x10], {x: 4, preset: {0x14: 0x00, 0x15: 0x40, 0x4000: 0x77}}); check('LDA (zp,x)', cpu.a === 0x77 && cycles === 6); }
{ const {cpu, cycles} = run([0xb1, 0x10], {y: 2, preset: {0x10: 0xfe, 0x11: 0x3f, 0x4000: 0x88}}); check('LDA (zp),y page-cross costs 6', cpu.a === 0x88 && cycles === 6); }
{ const {ram, cycles} = run([0x85, 0x50], {a: 0x33}); check('STA zp', ram[0x50] === 0x33 && cycles === 3); }
{ const {ram} = run([0x99, 0xff, 0x30], {a: 1, y: 2}); check('STA abs,y always costs 5 (no early out)', ram[0x3101] === 1); }
{ const {cpu, cycles} = run([0xa2, 9]); check('LDX #imm', cpu.x === 9 && cycles === 2); }
{ const {cpu, cycles} = run([0xa0, 9]); check('LDY #imm', cpu.y === 9 && cycles === 2); }
{ const {ram} = run([0x86, 0x50], {x: 0x22}); check('STX zp', ram[0x50] === 0x22); }
{ const {ram} = run([0x84, 0x50], {y: 0x23}); check('STY zp', ram[0x50] === 0x23); }

// --- Flags, LDA sets N/Z; NOP.
{ const {cpu} = run([0xa9, 0x00]); check('LDA #0 sets Z', (cpu.p & Z) !== 0); }
{ const {cpu} = run([0xa9, 0x80]); check('LDA #$80 sets N', (cpu.p & N) !== 0); }
{ const {cpu, cycles} = run([0x18], {p: C}); check('CLC', !(cpu.p & C) && cycles === 2); }
{ const {cpu} = run([0x38]); check('SEC', !!(cpu.p & C)); }
{ const {cpu} = run([0x58], {p: I}); check('CLI', !(cpu.p & I)); }
{ const {cpu} = run([0x78]); check('SEI', !!(cpu.p & I)); }
{ const {cpu} = run([0xb8], {p: V}); check('CLV', !(cpu.p & V)); }
{ const {cpu} = run([0xd8], {p: D}); check('CLD', !(cpu.p & D)); }
{ const {cpu} = run([0xf8]); check('SED', !!(cpu.p & D)); }
{ const {cycles} = run([0xea]); check('NOP costs 2 and does nothing', cycles === 2); }

// --- Registers and stack.
{ const {cpu} = run([0xaa], {a: 5}); check('TAX', cpu.x === 5); }
{ const {cpu} = run([0x8a], {x: 6}); check('TXA', cpu.a === 6); }
{ const {cpu} = run([0xa8], {a: 7}); check('TAY', cpu.y === 7); }
{ const {cpu} = run([0x98], {y: 8}); check('TYA', cpu.a === 8); }
{ const {cpu} = run([0xba], {s: 0xf0}); check('TSX', cpu.x === 0xf0); }
{ const {cpu} = run([0x9a], {x: 0xe0}); check('TXS does not touch flags', cpu.s === 0xe0); }
{ const {cpu} = run([0xe8], {x: 0xff}); check('INX wraps and sets Z', cpu.x === 0 && (cpu.p & Z)); }
{ const {cpu} = run([0xca], {x: 0}); check('DEX wraps to $FF and sets N', cpu.x === 0xff && (cpu.p & N)); }
{ const {cpu} = run([0xc8], {y: 5}); check('INY', cpu.y === 6); }
{ const {cpu} = run([0x88], {y: 5}); check('DEY', cpu.y === 4); }
{ const {ram, cpu, cycles} = run([0x48], {a: 0x42, s: 0xfd}); check('PHA', ram[0x1fd] === 0x42 && cpu.s === 0xfc && cycles === 3); }
{ const {cpu} = run([0x68], {s: 0xfc, preset: {0x1fd: 0x77}}); check('PLA', cpu.a === 0x77 && cpu.s === 0xfd); }
{ const {ram} = run([0x08], {p: N | C, s: 0xfd}); check('PHP sets bits 4 and 5 on the pushed copy', (ram[0x1fd] & 0x30) === 0x30 && (ram[0x1fd] & (N | C)) === (N | C)); }
{ const {cpu} = run([0x28], {s: 0xfc, preset: {0x1fd: N | V}}); check('PLP', (cpu.p & (N | V)) === (N | V) && !(cpu.p & 0x10)); }

// --- Branches: not taken, taken same page, taken crossing a page.
{ const {cycles} = run([0xd0, 0x10], {p: Z}); check('BNE not taken costs 2', cycles === 2); }
{ const {cpu, cycles} = run([0xd0, 0x05], {p: 0}); check('BNE taken same page costs 3', cpu.pc === 0x1007 && cycles === 3); }
{ const {cpu, cycles} = run([0xf0, 0x02], {p: Z}); check('BEQ taken costs 3', cpu.pc === 0x1004 && cycles === 3); }
{
  // BPL at $10FC: the next instruction's address ($10FE) is still page $10,
  // but a +5 offset lands at $1103, page $11: a genuine page cross.
  const ram = new Uint8Array(0x10000); ram[0x10fc] = 0x10; ram[0x10fd] = 0x05;
  const bus = {read: (a) => ram[a], write: () => {}};
  const cpu = new Cpu6510(bus); cpu.pc = 0x10fc; cpu.p = 0;
  const c = cpu.step();
  check('BPL taken across a page costs 4', cpu.pc === 0x1103 && c === 4, `pc=${cpu.pc.toString(16)} c=${c}`);
}

// --- JMP, JMP (ind) page-wrap bug, JSR/RTS, BRK/RTI.
{ const {cpu, cycles} = run([0x4c, 0x00, 0x40]); check('JMP abs', cpu.pc === 0x4000 && cycles === 3); }
{
  const ram = new Uint8Array(0x10000);
  ram[0x1000] = 0x6c; ram[0x1001] = 0xff; ram[0x1002] = 0x20; // JMP ($20FF)
  ram[0x20ff] = 0x34; ram[0x2000] = 0x12; ram[0x2100] = 0x99; // the byte a *correct* wrap would never read
  const bus = {read: (a) => ram[a], write: () => {}};
  const cpu = new Cpu6510(bus); cpu.pc = 0x1000;
  const cyc = cpu.step();
  check("JMP (ind) wraps the high-byte fetch within the low byte's page", cpu.pc === 0x1234 && cyc === 5, `pc=${cpu.pc.toString(16)}`);
}
{ const {ram, cpu, cycles} = run([0x20, 0x00, 0x40], {s: 0xfd}); check('JSR pushes return-1 (high byte first) and jumps', cpu.pc === 0x4000 && ram[0x1fd] === 0x10 && ram[0x1fc] === 0x02 && cycles === 6); }
{ const {cpu} = run([0x60], {s: 0xfb, preset: {0x1fc: 0x02, 0x1fd: 0x10}}); check('RTS returns to pushed+1', cpu.pc === 0x1003); }
{
  const rb = new Uint8Array(0x10000);
  rb[0x1000] = 0x00; rb[0xfffe] = 0x00; rb[0xffff] = 0x50; // BRK, vector -> $5000
  const busb = {read: (a) => rb[a], write: (a, v) => { rb[a] = v; }};
  const cpub = new Cpu6510(busb); cpub.pc = 0x1000; cpub.s = 0xfd; cpub.p = 0;
  const cycb = cpub.step();
  check('BRK: 7 cycles, PC+2 pushed, B set on the pushed copy, jumps via $FFFE, I set', cpub.pc === 0x5000 && cycb === 7 && (cpub.p & I) && (rb[0x1fd] & 0x10), `pc=${cpub.pc.toString(16)}`);
  rb[0x5000] = 0x40; // RTI
  const cyci = cpub.step();
  check('RTI restores PC and P (without the pushed B)', cpub.pc === 0x1002 && !(cpub.p & 0x10) && cyci === 6, `pc=${cpub.pc.toString(16)} p=${cpub.p.toString(16)}`);
}

// --- ADC/SBC, binary mode.
{ const {cpu} = run([0x69, 0x10], {a: 0x20, p: 0}); check('ADC binary: sum, no carry/overflow', cpu.a === 0x30 && !(cpu.p & C) && !(cpu.p & V)); }
{ const {cpu} = run([0x69, 0x01], {a: 0xff, p: 0}); check('ADC binary: carry out, Z set', cpu.a === 0x00 && (cpu.p & C) && (cpu.p & Z)); }
{ const {cpu} = run([0x69, 0x10], {a: 0x70, p: 0}); check('ADC binary: signed overflow (0x70+0x10)', cpu.a === 0x80 && (cpu.p & V) && (cpu.p & N)); }
{ const {cpu} = run([0xe9, 0x01], {a: 0x00, p: C}); check('SBC binary: borrow clears carry', cpu.a === 0xff && !(cpu.p & C) && (cpu.p & N)); }
{ const {cpu} = run([0xe9, 0x10], {a: 0x30, p: C}); check('SBC binary: no borrow', cpu.a === 0x20 && (cpu.p & C)); }

// --- ADC/SBC, decimal mode: 6502.org's decimal_mode.html Appendix A worked cases.
{ const {cpu} = run([0x69, 0x46], {a: 0x58, p: D}); check('ADC decimal 58+46=104: result 04, carry set', cpu.a === 0x04 && (cpu.p & C), `a=${cpu.a.toString(16)}`); }
{ const {cpu} = run([0x69, 0x93], {a: 0x58, p: D | C}); check('ADC decimal 58+93+1=152: result 52, carry set', cpu.a === 0x52 && (cpu.p & C), `a=${cpu.a.toString(16)}`); }
{ const {cpu} = run([0xe9, 0x12], {a: 0x46, p: D | C}); check('SBC decimal 46-12=34, no borrow', cpu.a === 0x34 && (cpu.p & C), `a=${cpu.a.toString(16)}`); }
{ const {cpu} = run([0xe9, 0x60], {a: 0x40, p: D | C}); check('SBC decimal 40-60 borrows: result 80, carry clear (binary-rule carry)', cpu.a === 0x80 && !(cpu.p & C), `a=${cpu.a.toString(16)} c=${!!(cpu.p & C)}`); }
{
  // N/V/Z on decimal ADC/SBC follow the binary sum, per the file's header comment.
  const {cpu} = run([0x69, 0x01], {a: 0x99, p: D}); // binary 0x99+0x01=0x9A -> N set, Z clear, decimal result should be 00.
  check('ADC decimal: N/Z follow the binary sum, not the corrected result', cpu.a === 0x00 && (cpu.p & N) && !(cpu.p & Z), `a=${cpu.a.toString(16)} p=${cpu.p.toString(16)}`);
}

// --- Compare family.
{ const {cpu} = run([0xc9, 0x10], {a: 0x10}); check('CMP equal sets Z and C', (cpu.p & Z) && (cpu.p & C)); }
{ const {cpu} = run([0xc9, 0x20], {a: 0x10}); check('CMP a<m clears C, sets N', !(cpu.p & C) && (cpu.p & N)); }
{ const {cpu} = run([0xe0, 0x05], {x: 0x05}); check('CPX equal', (cpu.p & Z)); }
{ const {cpu} = run([0xc0, 0x05], {y: 0x06}); check('CPY a>m', (cpu.p & C) && !(cpu.p & Z)); }

// --- Shifts and INC/DEC, accumulator and memory forms.
{ const {cpu} = run([0x0a], {a: 0x81}); check('ASL A: carry out, result shifted', cpu.a === 0x02 && (cpu.p & C)); }
{ const {cpu} = run([0x4a], {a: 0x01}); check('LSR A: carry out, Z set', cpu.a === 0x00 && (cpu.p & C) && (cpu.p & Z)); }
{ const {cpu} = run([0x2a], {a: 0x80, p: C}); check('ROL A: carry in becomes bit 0, carry out from bit 7', cpu.a === 0x01 && (cpu.p & C)); }
{ const {cpu} = run([0x6a], {a: 0x01, p: C}); check('ROR A: carry in becomes bit 7', cpu.a === 0x80 && (cpu.p & C)); }
{ const {ram, cycles} = run([0xe6, 0x50], {preset: {0x50: 0x7f}}); check('INC zp', ram[0x50] === 0x80 && cycles === 5); }
{ const {ram} = run([0xc6, 0x50], {preset: {0x50: 0x00}}); check('DEC zp wraps', ram[0x50] === 0xff); }
{ const {ram, cycles} = run([0xfe, 0xff, 0x30], {x: 1, preset: {0x3100: 5}}); check('INC abs,x always costs 7', ram[0x3100] === 6 && cycles === 7); }

// --- BIT.
{ const {cpu} = run([0x24, 0x50], {a: 0x0f, preset: {0x50: 0xc0}}); check('BIT: N/V from memory, Z from AND', (cpu.p & N) && (cpu.p & V) && (cpu.p & Z)); }

// --- Stable illegal opcodes.
{ const {cpu, ram, cycles} = run([0x07, 0x50], {a: 0x0f, preset: {0x50: 0x81}}); check('SLO zp: ASL memory then ORA A, costs 5', ram[0x50] === 0x02 && cpu.a === 0x0f && cycles === 5, `a=${cpu.a.toString(16)}`); }
{ const {cpu, ram} = run([0x27, 0x50], {a: 0xff, p: C, preset: {0x50: 0x40}}); check('RLA zp: ROL memory then AND A', ram[0x50] === 0x81 && cpu.a === 0x81); }
{ const {cpu, ram} = run([0x47, 0x50], {a: 0x0f, preset: {0x50: 0x03}}); check('SRE zp: LSR memory then EOR A', ram[0x50] === 0x01 && cpu.a === 0x0e); }
{ const {cpu, ram} = run([0x67, 0x50], {a: 0x10, p: C, preset: {0x50: 0x02}}); check('RRA zp: ROR memory then ADC A', ram[0x50] === 0x81 && cpu.a === (0x10 + 0x81) & 0xff, `a=${cpu.a.toString(16)} m=${ram[0x50].toString(16)}`); }
{ const {ram, cycles} = run([0x87, 0x50], {a: 0x0f, x: 0xf0}); check('SAX zp: store A & X, costs 3', ram[0x50] === 0x00 && cycles === 3); }
{ const {cpu} = run([0xa7, 0x50], {preset: {0x50: 0x42}}); check('LAX zp: loads A and X together', cpu.a === 0x42 && cpu.x === 0x42); }
{ const {ram, cpu} = run([0xc7, 0x50], {a: 0x10, preset: {0x50: 0x11}}); check('DCP zp: DEC memory then CMP A', ram[0x50] === 0x10 && (cpu.p & Z)); }
{ const {ram, cpu} = run([0xe7, 0x50], {a: 0x10, p: C, preset: {0x50: 0x0f}}); check('ISC zp: INC memory then SBC A', ram[0x50] === 0x10 && cpu.a === 0x00 && (cpu.p & Z)); }
{ const {cpu} = run([0x0b, 0xf0], {a: 0xff}); check('ANC: AND then C=N=bit7', cpu.a === 0xf0 && (cpu.p & C) && (cpu.p & N)); }
{ const {cpu} = run([0x4b, 0x03], {a: 0x03}); check('ALR: AND then LSR', cpu.a === 0x01 && (cpu.p & C)); }
{ const {cpu} = run([0x6b, 0xff], {a: 0xff, p: C}); check('ARR: AND then ROR with carry-in', cpu.a === 0xff, `a=${cpu.a.toString(16)}`); }
{ const {cpu} = run([0xcb, 0x05], {a: 0x0f, x: 0x0f}); check('SBX: X=(A&X)-imm', cpu.x === 0x0a && (cpu.p & C)); }
{ const {cpu} = run([0xbb, 0x30, 0x00], {y: 0, s: 0xff, preset: {0x30: 0xf0}}); check('LAS: A=X=S=memory&S', cpu.a === 0xf0 && cpu.x === 0xf0 && cpu.s === 0xf0); }
{ const {cpu, cycles} = run([0xeb, 0x01], {a: 0x00, p: C}); check('SBC$EB duplicates $E9, costs 2', cpu.a === 0xff && cycles === 2); }
{ const {cycles} = run([0x1a]); check('NOP $1A (implied illegal) costs 2', cycles === 2); }
{ const {cycles} = run([0x80, 0x00]); check('NOP $80 (immediate illegal) costs 2', cycles === 2); }
{ const {cycles} = run([0x04, 0x50]); check('NOP $04 (zp illegal) costs 3', cycles === 3); }
{ const {cycles} = run([0x0c, 0x00, 0x30]); check('NOP $0C (abs illegal) costs 4', cycles === 4); }
{ const {cycles} = run([0xdc, 0xff, 0x30], {x: 1}); check('NOP $DC (abs,x illegal) page-cross costs 5', cycles === 5); }

// --- Unstable illegal opcodes and JAM/KIL: rejected by name.
for (const op of [0x8b, 0xab, 0x93, 0x9f, 0x9e, 0x9c, 0x9b]) {
  let threw = null;
  try { run([op, 0x00]); } catch (e) { threw = e; }
  check(`0x${op.toString(16)} is an unstable illegal opcode, rejected by name`, threw instanceof IllegalOpcodeError && threw.kind === 'unstable', threw?.message);
}
for (const op of [0x02, 0x12, 0x22, 0x32, 0x42, 0x52, 0x62, 0x72, 0x92, 0xb2, 0xd2, 0xf2]) {
  let threw = null;
  try { run([op]); } catch (e) { threw = e; }
  check(`0x${op.toString(16)} is a JAM opcode, rejected rather than hung on`, threw instanceof IllegalOpcodeError && threw.kind === 'jam', threw?.message);
}

// --- reset/irq/nmi.
{
  const ram = new Uint8Array(0x10000);
  ram[0xfffc] = 0x00; ram[0xfffd] = 0x40;
  const bus = {read: (a) => ram[a], write: (a, v) => { ram[a] = v; }};
  const cpu = new Cpu6510(bus); cpu.reset();
  check('reset: 7 cycles, PC from $FFFC/$FFFD, I set', cpu.pc === 0x4000 && cpu.cycle === 7 && (cpu.p & I));
}
{
  const ram = new Uint8Array(0x10000); ram[0xfffe] = 0x00; ram[0xffff] = 0x60;
  const bus = {read: (a) => ram[a], write: (a, v) => { ram[a] = v; }};
  const cpu = new Cpu6510(bus); cpu.pc = 0x1234; cpu.s = 0xfd; cpu.p = 0;
  cpu.irq();
  check('irq honoured when I clear: jumps via $FFFE, I set, 7 cycles', cpu.pc === 0x6000 && (cpu.p & I) && cpu.cycle === 7);
  cpu.p |= I; const pcBefore = cpu.pc;
  cpu.irq();
  check('irq ignored while I is set', cpu.pc === pcBefore);
}
{
  const ram = new Uint8Array(0x10000); ram[0xfffa] = 0x00; ram[0xfffb] = 0x70;
  const bus = {read: (a) => ram[a], write: (a, v) => { ram[a] = v; }};
  const cpu = new Cpu6510(bus); cpu.pc = 0x1234; cpu.s = 0xfd; cpu.p = I;
  cpu.nmi();
  check('nmi always dispatches, even with I set', cpu.pc === 0x7000);
}

if (failures) { console.log(`${failures} FAILURES`); process.exit(1); }
console.log('PASS 6510: documented opcodes, decimal ADC/SBC, stable illegal opcodes, and named rejection of unstable/JAM opcodes');
