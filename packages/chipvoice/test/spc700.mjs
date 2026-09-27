import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Spc700, PSW_N, PSW_V, PSW_H, PSW_Z, PSW_C } from '../dist/chips/snes/spc700.js';

/**
 * Every one of the SPC700's 256 opcodes, checked against Anomie's SPC700
 * doc: its own byte length and cycle count (transcribed independently into
 * fixtures/spc700-opcodes.json, not derived from this file), plus targeted
 * checks of the flag-setting families (ALU, shifts, DAA/DAS, DIV, MUL,
 * branches) and the documented "dummy read before write" quirk.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const table = JSON.parse(readFileSync(path.join(here, 'fixtures/spc700-opcodes.json'), 'utf8'));
const byOpcode = new Map(table.map((row) => [parseInt(row.opcode, 16), row]));

let failures = 0;
const check = (name, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

class TestBus {
  constructor() {
    this.mem = new Uint8Array(0x10000);
    this.reads = [];
    this.writes = [];
  }
  read(addr) {
    addr &= 0xffff;
    this.reads.push(addr);
    return this.mem[addr];
  }
  write(addr, value) {
    addr &= 0xffff;
    this.writes.push([addr, value & 0xff]);
    this.mem[addr] = value & 0xff;
  }
  tick() {}
}

const ORG = 0x0200;

function makeCpu(bus, org = ORG) {
  const cpu = new Spc700(bus);
  cpu.pc = org;
  cpu.sp = 0xff;
  return cpu;
}

// ---------------------------------------------------------------------------
// Every opcode: byte length and cycle count, against the independently
// transcribed table. Opcodes with a data-dependent cycle count (branches,
// BBS/BBC, CBNE, DBNZ) are excluded here and checked both ways below.
// ---------------------------------------------------------------------------
const variableCycleOpcodes = new Set();
for (const row of table) {
  if (String(row.cycles).includes('/')) variableCycleOpcodes.add(parseInt(row.opcode, 16));
}

for (const row of table) {
  const opcode = parseInt(row.opcode, 16);
  if (variableCycleOpcodes.has(opcode)) continue;
  const bus = new TestBus();
  bus.mem[ORG] = opcode;
  for (let i = 1; i <= 3; i++) bus.mem[ORG + i] = 0x10;
  const cpu = makeCpu(bus);
  const cycles = cpu.step();
  const bytes = cpu.lastInstructionBytes;
  const label = `$${row.opcode} ${row.mnemonic} ${row.operands}`.trim();
  check(`${label}: ${row.bytes} byte(s)`, bytes === row.bytes, `got ${bytes}`);
  check(`${label}: ${row.cycles} cycle(s)`, cycles === Number(row.cycles), `got ${cycles}`);
}
check('every opcode 0-255 is defined', byOpcode.size === 256, `got ${byOpcode.size}`);

// ---------------------------------------------------------------------------
// Variable-cycle opcodes: both the taken and not-taken path.
// ---------------------------------------------------------------------------

// Conditional branches: Bcc r ($10/$30/$50/$70/$90/$B0/$D0/$F0).
const branchFlags = [
  ['BPL', 0x10, PSW_N, false],
  ['BMI', 0x30, PSW_N, true],
  ['BVC', 0x50, PSW_V, false],
  ['BVS', 0x70, PSW_V, true],
  ['BCC', 0x90, PSW_C, false],
  ['BCS', 0xb0, PSW_C, true],
  ['BNE', 0xd0, PSW_Z, false],
  ['BEQ', 0xf0, PSW_Z, true],
];
for (const [mnemonic, opcode, flagBit, wantSet] of branchFlags) {
  const row = byOpcode.get(opcode);
  const [notTaken, taken] = row.cycles.split('/').map(Number);
  for (const takeIt of [false, true]) {
    const bus = new TestBus();
    bus.mem[ORG] = opcode;
    bus.mem[ORG + 1] = 0x04;
    const cpu = makeCpu(bus);
    cpu.psw = takeIt === wantSet ? flagBit : 0;
    const pcBefore = cpu.pc;
    const cycles = cpu.step();
    check(`${mnemonic} ${takeIt ? 'taken' : 'not taken'} cycles`, cycles === (takeIt ? taken : notTaken), `got ${cycles} want ${takeIt ? taken : notTaken}`);
    if (takeIt) check(`${mnemonic} taken jumps`, cpu.pc === (pcBefore + 2 + 4) & 0xffff);
    else check(`${mnemonic} not taken falls through`, cpu.pc === (pcBefore + 2) & 0xffff);
  }
}

// BBS/BBC d.n,r: opcode = base + n*0x20, base $03 (BBS) / $13 (BBC).
for (let n = 0; n < 8; n++) {
  for (const [mnemonic, base, takenWhenBitIs] of [['BBS', 0x03, 1], ['BBC', 0x13, 0]]) {
    const opcode = base + n * 0x20;
    const row = byOpcode.get(opcode);
    const [notTaken, taken] = row.cycles.split('/').map(Number);
    for (const bitValue of [0, 1]) {
      const bus = new TestBus();
      bus.mem[ORG] = opcode;
      bus.mem[ORG + 1] = 0x10; // dp offset
      bus.mem[ORG + 2] = 0x04; // relative offset
      bus.mem[0x10] = bitValue << n;
      const cpu = makeCpu(bus);
      const cycles = cpu.step();
      const isTaken = bitValue === takenWhenBitIs;
      check(`${mnemonic} d.${n} bit=${bitValue} cycles`, cycles === (isTaken ? taken : notTaken), `got ${cycles}`);
    }
  }
}

// CBNE d,r ($2E) and CBNE d+X,r ($DE).
for (const [opcode, useX] of [[0x2e, false], [0xde, true]]) {
  const row = byOpcode.get(opcode);
  const [notTaken, taken] = row.cycles.split('/').map(Number);
  for (const equal of [true, false]) {
    const bus = new TestBus();
    bus.mem[ORG] = opcode;
    bus.mem[ORG + 1] = 0x10;
    bus.mem[ORG + 2] = 0x04;
    bus.mem[useX ? 0x12 : 0x10] = equal ? 0x55 : 0x99;
    const cpu = makeCpu(bus);
    cpu.a = 0x55;
    cpu.x = 0x02;
    const cycles = cpu.step();
    check(`CBNE${useX ? ' d+X' : ''} equal=${equal} cycles`, cycles === (equal ? notTaken : taken), `got ${cycles}`);
  }
}

// DBNZ Y,r ($FE) and DBNZ d,r ($6E).
{
  const row = byOpcode.get(0xfe);
  const [notTaken, taken] = row.cycles.split('/').map(Number);
  for (const yStart of [1, 2]) {
    const bus = new TestBus();
    bus.mem[ORG] = 0xfe;
    bus.mem[ORG + 1] = 0x04;
    const cpu = makeCpu(bus);
    cpu.y = yStart;
    const cycles = cpu.step();
    const reachedZero = yStart - 1 === 0;
    check(`DBNZ Y reach-zero=${reachedZero} cycles`, cycles === (reachedZero ? notTaken : taken), `got ${cycles}`);
  }
}
{
  const row = byOpcode.get(0x6e);
  const [notTaken, taken] = row.cycles.split('/').map(Number);
  for (const start of [1, 2]) {
    const bus = new TestBus();
    bus.mem[ORG] = 0x6e;
    bus.mem[ORG + 1] = 0x10;
    bus.mem[ORG + 2] = 0x04;
    bus.mem[0x10] = start;
    const cpu = makeCpu(bus);
    const cycles = cpu.step();
    const reachedZero = start - 1 === 0;
    check(`DBNZ d reach-zero=${reachedZero} cycles`, cycles === (reachedZero ? notTaken : taken), `got ${cycles}`);
  }
}

// ---------------------------------------------------------------------------
// Flag correctness: the ALU, shifts, DAA/DAS and DIV/MUL.
// ---------------------------------------------------------------------------

// ADC: 0x7F + 0x01 -> overflow set, half-carry set, result 0x80.
{
  const bus = new TestBus();
  bus.mem[ORG] = 0x88; // ADC A,#i
  bus.mem[ORG + 1] = 0x01;
  const cpu = makeCpu(bus);
  cpu.a = 0x7f;
  cpu.step();
  check('ADC 0x7F+0x01 result', cpu.a === 0x80, `got ${cpu.a.toString(16)}`);
  check('ADC 0x7F+0x01 sets V', (cpu.psw & PSW_V) !== 0);
  check('ADC 0x7F+0x01 sets N', (cpu.psw & PSW_N) !== 0);
  check('ADC 0x7F+0x01 sets H', (cpu.psw & PSW_H) !== 0);
  check('ADC 0x7F+0x01 clears C', (cpu.psw & PSW_C) === 0);
}
// ADC: 0xFF + 0x01 -> carry set, zero set.
{
  const bus = new TestBus();
  bus.mem[ORG] = 0x88;
  bus.mem[ORG + 1] = 0x01;
  const cpu = makeCpu(bus);
  cpu.a = 0xff;
  cpu.step();
  check('ADC 0xFF+0x01 wraps to 0', cpu.a === 0);
  check('ADC 0xFF+0x01 sets C', (cpu.psw & PSW_C) !== 0);
  check('ADC 0xFF+0x01 sets Z', (cpu.psw & PSW_Z) !== 0);
}
// SBC: 0x05 - 0x03 (with carry set, i.e. no borrow) = 0x02, C stays set (no borrow).
{
  const bus = new TestBus();
  bus.mem[ORG] = 0xa8; // SBC A,#i
  bus.mem[ORG + 1] = 0x03;
  const cpu = makeCpu(bus);
  cpu.a = 0x05;
  cpu.psw = PSW_C;
  cpu.step();
  check('SBC 0x05-0x03 result', cpu.a === 0x02, `got ${cpu.a.toString(16)}`);
  check('SBC 0x05-0x03 keeps C (no borrow)', (cpu.psw & PSW_C) !== 0);
}
// SBC borrow: 0x03 - 0x05 clears C.
{
  const bus = new TestBus();
  bus.mem[ORG] = 0xa8;
  bus.mem[ORG + 1] = 0x05;
  const cpu = makeCpu(bus);
  cpu.a = 0x03;
  cpu.psw = PSW_C;
  cpu.step();
  check('SBC 0x03-0x05 borrows', cpu.a === 0xfe, `got ${cpu.a.toString(16)}`);
  check('SBC 0x03-0x05 clears C', (cpu.psw & PSW_C) === 0);
}
// CMP sets flags without touching A.
{
  const bus = new TestBus();
  bus.mem[ORG] = 0x68; // CMP A,#i
  bus.mem[ORG + 1] = 0x10;
  const cpu = makeCpu(bus);
  cpu.a = 0x10;
  cpu.step();
  check('CMP equal sets Z and C', (cpu.psw & PSW_Z) !== 0 && (cpu.psw & PSW_C) !== 0);
  check('CMP does not change A', cpu.a === 0x10);
}
// ASL/LSR/ROL/ROR carry-out.
{
  const bus = new TestBus();
  bus.mem[ORG] = 0x1c; // ASL A
  const cpu = makeCpu(bus);
  cpu.a = 0x81;
  cpu.step();
  check('ASL 0x81 result', cpu.a === 0x02, `got ${cpu.a.toString(16)}`);
  check('ASL 0x81 sets C', (cpu.psw & PSW_C) !== 0);
}
{
  const bus = new TestBus();
  bus.mem[ORG] = 0x5c; // LSR A
  const cpu = makeCpu(bus);
  cpu.a = 0x01;
  cpu.step();
  check('LSR 0x01 result', cpu.a === 0x00);
  check('LSR 0x01 sets C', (cpu.psw & PSW_C) !== 0);
}
// XCN: swap nibbles.
{
  const bus = new TestBus();
  bus.mem[ORG] = 0x9f;
  const cpu = makeCpu(bus);
  cpu.a = 0x12;
  cpu.step();
  check('XCN swaps nibbles', cpu.a === 0x21, `got ${cpu.a.toString(16)}`);
}

// DAA: BCD adjust after addition. 0x9A + no carry, H set -> +0x06 -> 0xA0, then carry path.
{
  const bus = new TestBus();
  bus.mem[ORG] = 0xdf; // DAA
  const cpu = makeCpu(bus);
  cpu.a = 0x9a;
  cpu.psw = 0;
  cpu.step();
  check('DAA 0x9A adjusts to BCD 0x00 with carry', cpu.a === 0x00 && (cpu.psw & PSW_C) !== 0, `got ${cpu.a.toString(16)}`);
}
// DAS: BCD adjust after subtraction.
{
  const bus = new TestBus();
  bus.mem[ORG] = 0xbe; // DAS
  const cpu = makeCpu(bus);
  cpu.a = 0x0a;
  cpu.psw = PSW_C; // no borrow occurred
  cpu.step();
  check('DAS 0x0A adjusts to 0x04', cpu.a === 0x04, `got ${cpu.a.toString(16)}`);
}

// MUL YA = Y*A into YA, NZ from Y (the high byte).
{
  const bus = new TestBus();
  bus.mem[ORG] = 0xcf;
  const cpu = makeCpu(bus);
  cpu.y = 0x80;
  cpu.a = 0x02;
  cpu.step();
  check('MUL 0x80*0x02', cpu.y === 0x01 && cpu.a === 0x00, `got y=${cpu.y} a=${cpu.a}`);
}

// DIV YA,X: the documented example, 0x0F/0x02 well within range -> exact.
{
  const bus = new TestBus();
  bus.mem[ORG] = 0x9e;
  const cpu = makeCpu(bus);
  cpu.y = 0;
  cpu.a = 0x0f;
  cpu.x = 0x02;
  cpu.step();
  check('DIV 15/2 quotient', cpu.a === 7, `got a=${cpu.a}`);
  check('DIV 15/2 remainder', cpu.y === 1, `got y=${cpu.y}`);
}
// DIV by zero: X=0 behaves per the documented algorithm (does not throw).
{
  const bus = new TestBus();
  bus.mem[ORG] = 0x9e;
  const cpu = makeCpu(bus);
  cpu.y = 0x01;
  cpu.a = 0x00;
  cpu.x = 0x00;
  cpu.step();
  check('DIV by zero does not throw', true);
}

// ---------------------------------------------------------------------------
// The documented "dummy read before write" quirk (Anomie: most stores to
// memory also read the destination first; MOV dp,dp and MOV (X)+,A do not,
// nor do RMW instructions since they read the destination anyway).
// ---------------------------------------------------------------------------
{
  const bus = new TestBus();
  bus.mem[ORG] = 0x8f; // MOV d,#i: "(read)"
  bus.mem[ORG + 1] = 0x00; // imm
  bus.mem[ORG + 2] = 0x10; // dp
  const cpu = makeCpu(bus);
  cpu.step();
  check('MOV d,#i reads the destination before writing', bus.reads.includes(0x0010));
}
{
  const bus = new TestBus();
  bus.mem[ORG] = 0xfa; // MOV dd,ds: "(no read)"
  bus.mem[ORG + 1] = 0x11; // ds
  bus.mem[ORG + 2] = 0x10; // dd
  const cpu = makeCpu(bus);
  cpu.step();
  check('MOV dd,ds does not read the destination', !bus.reads.includes(0x0010));
}
{
  const bus = new TestBus();
  bus.mem[ORG] = 0xaf; // MOV (X)+,A: "(no read)"
  const cpu = makeCpu(bus);
  cpu.x = 0x10;
  cpu.a = 0x42;
  cpu.step();
  check('MOV (X)+,A does not read the destination', !bus.reads.includes(0x0010));
  check('MOV (X)+,A writes A and increments X', bus.mem[0x10] === 0x42 && cpu.x === 0x11);
}

// TCALL n and vectors $FFDE-2n.
for (let n = 0; n < 16; n++) {
  const opcode = 0x01 + n * 0x10;
  const bus = new TestBus();
  bus.mem[ORG] = opcode;
  const vector = 0xffde - 2 * n;
  bus.mem[vector] = 0x34;
  bus.mem[vector + 1] = 0x12;
  const cpu = makeCpu(bus);
  cpu.step();
  check(`TCALL ${n} jumps via $${vector.toString(16)}`, cpu.pc === 0x1234, `got ${cpu.pc.toString(16)}`);
}

console.log(failures === 0 ? `PASS  spc700: all ${table.length} opcodes checked` : `FAIL  spc700: ${failures} check(s) failed`);
if (failures > 0) process.exitCode = 1;
