import assert from 'node:assert/strict';
import {Sm83} from '../dist/chips/gb/cpu.js';

/** A flat 64 KiB bus: enough to test the CPU in isolation from any chip,
 * with a software IE/IF pair for the interrupt/HALT tests. */
function machine() {
  const mem = new Uint8Array(0x10000);
  let ie = 0, iff = 0, ticked = 0;
  const bus = {
    read: a => mem[a],
    write: (a, v) => { mem[a] = v & 0xff; },
    tick: t => { ticked += t; },
    interrupts: () => ie & iff & 0x1f,
    acknowledge: bit => { iff &= ~bit; },
  };
  const cpu = new Sm83(bus);
  cpu.pc = 0x100;
  cpu.cycles = 0;
  return {cpu, mem, setIe: v => (ie = v), setIf: v => (iff = v), ticked: () => ticked};
}

function load(mem, pc, bytes) { mem.set(bytes, pc); }

// --- 8-bit ALU flags: half-carry and carry from the operands' own nibble/byte. ---
{
  const {cpu, mem} = machine();
  load(mem, 0x100, [0x3e, 0x2f, 0xc6, 0x01]); // LD A,0x2f ; ADD A,1 -> half-carry (0xf+0x1>0xf), no carry
  cpu.step(); cpu.step();
  assert.equal(cpu.a, 0x30); assert.equal(cpu.f & 0x20, 0x20, 'H set'); assert.equal(cpu.f & 0x10, 0, 'C clear');
  const c2 = machine();
  load(c2.mem, 0x100, [0x3e, 0xff, 0xc6, 0x01]); // 0xff+1 -> zero, half-carry and carry both set
  c2.cpu.step(); c2.cpu.step();
  assert.equal(c2.cpu.a, 0);
  assert.ok(c2.cpu.f & 0x80, 'Z set'); assert.ok(c2.cpu.f & 0x20, 'H set'); assert.ok(c2.cpu.f & 0x10, 'C set');
  const s = machine();
  load(s.mem, 0x100, [0x3e, 0x10, 0xd6, 0x01]); // SUB 1 from 0x10 -> half-borrow (0<1 on low nibble)
  s.cpu.step(); s.cpu.step();
  assert.equal(s.cpu.a, 0x0f); assert.ok(s.cpu.f & 0x40, 'N set'); assert.ok(s.cpu.f & 0x20, 'H set'); assert.equal(s.cpu.f & 0x10, 0, 'no borrow out of the byte');
  console.log('PASS 8-bit ADD/SUB half-carry and carry, from the operands');
}

// --- DAA, after addition and after subtraction, per Pan Docs' table. ---
{
  const {cpu, mem} = machine();
  load(mem, 0x100, [0x3e, 0x45, 0xc6, 0x38, 0x27]); // 0x45 + 0x38 = 0x7d, decimal 45+38=83 -> DAA gives 0x83
  cpu.step(); cpu.step(); cpu.step();
  assert.equal(cpu.a, 0x83); assert.equal(cpu.f & 0x10, 0, 'no carry out');
  const m2 = machine();
  load(m2.mem, 0x100, [0x3e, 0x90, 0xc6, 0x90, 0x27]); // 0x90+0x90=0x120 (carry), decimal 90+90=180 -> 0x80 with carry
  m2.cpu.step(); m2.cpu.step(); m2.cpu.step();
  assert.equal(m2.cpu.a, 0x80); assert.ok(m2.cpu.f & 0x10, 'DAA carries out past 99');
  const m3 = machine();
  load(m3.mem, 0x100, [0x3e, 0x50, 0xd6, 0x15, 0x27]); // 0x50-0x15=0x3b (BCD 50-15=35, no adjust needed since both nibbles valid)
  m3.cpu.step(); m3.cpu.step(); m3.cpu.step();
  assert.equal(m3.cpu.a, 0x35, 'DAA after SUB subtracts 6 when the low nibble overflowed borrow');
  console.log('PASS DAA after addition and after subtraction');
}

// --- 16-bit ADD HL,rr: half-carry/carry from bit 11/15 of the operands. ---
{
  const {cpu, mem} = machine();
  cpu.hl = 0x0fff; cpu.bc = 0x0001;
  load(mem, 0x100, [0x09]); // ADD HL,BC
  cpu.step();
  assert.equal(cpu.hl, 0x1000); assert.ok(cpu.f & 0x20, 'H from bit 11'); assert.equal(cpu.f & 0x10, 0);
  cpu.hl = 0xffff; cpu.bc = 0x0001; cpu.pc = 0x100; load(mem, 0x100, [0x09]);
  cpu.step();
  assert.equal(cpu.hl, 0); assert.ok(cpu.f & 0x10, 'C from bit 15'); assert.ok(cpu.f & 0x20);
  console.log('PASS ADD HL,rr half-carry/carry from bit 11/15');
}

// --- INC/DEC (r) and (HL): Z/H update, N set only by DEC, C untouched. ---
{
  const {cpu, mem} = machine();
  cpu.f = 0x10; cpu.b = 0x0f;
  load(mem, 0x100, [0x04]); // INC B
  cpu.step();
  assert.equal(cpu.b, 0x10); assert.ok(cpu.f & 0x20, 'H on nibble overflow'); assert.equal(cpu.f & 0x40, 0); assert.ok(cpu.f & 0x10, 'C preserved');
  cpu.hl = 0x8000; mem[0x8000] = 0x00; cpu.pc = 0x100; load(mem, 0x100, [0x35]); // DEC (HL): 0 -> 0xff
  cpu.step();
  assert.equal(mem[0x8000], 0xff); assert.ok(cpu.f & 0x40, 'N set'); assert.ok(cpu.f & 0x20, 'H on nibble borrow');
  console.log('PASS INC/DEC flags on registers and (HL)');
}

// --- Rotates: RLCA/RRCA/RLA/RRA clear Z always; CB rotates set Z normally. ---
{
  const {cpu, mem} = machine();
  cpu.a = 0x85; cpu.f = 0;
  load(mem, 0x100, [0x07]); // RLCA
  cpu.step();
  assert.equal(cpu.a, 0x0b); assert.ok(cpu.f & 0x10, 'carry out of bit 7'); assert.equal(cpu.f & 0x80, 0, 'RLCA never sets Z');
  const {cpu: c2, mem: m2} = machine();
  c2.b = 0x00; c2.f = 0;
  load(m2, 0x100, [0xcb, 0x00]); // RLC B
  c2.step();
  assert.equal(c2.b, 0); assert.ok(c2.f & 0x80, 'CB RLC sets Z on a zero result');
  console.log('PASS RLCA/RLC: accumulator rotates never set Z, CB rotates do');
}

// --- CB BIT/RES/SET, including the (HL) form (BIT costs 12T, RES/SET 16T). ---
{
  const {cpu, mem} = machine();
  cpu.a = 0x40;
  load(mem, 0x100, [0xcb, 0x47]); // BIT 0,A -> Z set (bit clear), H always set, C untouched
  cpu.f = 0x10;
  const t = cpu.step();
  assert.equal(t, 8); assert.ok(cpu.f & 0x80); assert.ok(cpu.f & 0x20); assert.ok(cpu.f & 0x10, 'C untouched by BIT');
  cpu.hl = 0x8000; mem[0x8000] = 0; cpu.pc = 0x100;
  load(mem, 0x100, [0xcb, 0xc6]); // SET 0,(HL)
  const t2 = cpu.step();
  assert.equal(t2, 16); assert.equal(mem[0x8000], 1);
  load(mem, 0x100, [0xcb, 0x86]); cpu.pc = 0x100; // RES 0,(HL)
  const t3 = cpu.step();
  assert.equal(t3, 16); assert.equal(mem[0x8000], 0);
  console.log('PASS CB BIT/RES/SET on a register and on (HL), with correct cycle counts');
}

// --- Calls, returns, RST, and conditional branch cycle counts. ---
{
  const {cpu, mem} = machine();
  cpu.sp = 0xfffe;
  load(mem, 0x100, [0xcd, 0x00, 0x02]); // CALL 0x0200
  const callT = cpu.step();
  assert.equal(callT, 24); assert.equal(cpu.pc, 0x0200); assert.equal(cpu.sp, 0xfffc);
  assert.equal(mem[0xfffc] | (mem[0xfffd] << 8), 0x0103, 'return address pushed');
  load(mem, 0x0200, [0xc9]); // RET
  const retT = cpu.step();
  assert.equal(retT, 16); assert.equal(cpu.pc, 0x0103); assert.equal(cpu.sp, 0xfffe);
  cpu.f = 0; cpu.pc = 0x100; load(mem, 0x100, [0xc4, 0x00, 0x02, 0x00, 0x00]); // CALL NZ, taken (Z clear)
  assert.equal(cpu.step(), 24);
  cpu.pc = 0x100; cpu.f = 0x80; load(mem, 0x100, [0xc4, 0x00, 0x02]); // CALL NZ, not taken (Z set)
  assert.equal(cpu.step(), 12);
  cpu.pc = 0x100; cpu.sp = 0xfffe; load(mem, 0x100, [0xd7]); // RST 10H
  const rstT = cpu.step();
  assert.equal(rstT, 16); assert.equal(cpu.pc, 0x10);
  console.log('PASS CALL/RET/RST addressing, stack effect and conditional cycle counts');
}

// --- LDH, (HL+)/(HL-), LD (nn),SP and ADD SP,e / LD HL,SP+e flag rules. ---
{
  const {cpu, mem} = machine();
  cpu.a = 0x5a;
  load(mem, 0x100, [0xe0, 0x80]); // LDH ($FF80),A
  cpu.step();
  assert.equal(mem[0xff80], 0x5a);
  cpu.hl = 0xc000; cpu.a = 0x11; cpu.pc = 0x100; load(mem, 0x100, [0x22]); // LD (HL+),A
  cpu.step();
  assert.equal(mem[0xc000], 0x11); assert.equal(cpu.hl, 0xc001);
  cpu.sp = 0x1000; cpu.pc = 0x100; load(mem, 0x100, [0x08, 0x00, 0x90]); // LD ($9000),SP
  cpu.step();
  assert.equal(mem[0x9000] | (mem[0x9001] << 8), 0x1000);
  cpu.sp = 0x1000; cpu.pc = 0x100; load(mem, 0x100, [0xe8, 0x08]); // ADD SP,8: neither nibble nor byte boundary overflows
  cpu.step();
  assert.equal(cpu.sp, 0x1008); assert.equal(cpu.f & 0x30, 0, 'no half-carry/carry from the unsigned operand byte');
  cpu.sp = 0x0ff8; cpu.pc = 0x100; load(mem, 0x100, [0xe8, 0x08]); // ADD SP,8: 0xf8+8 overflows both the nibble and the byte
  cpu.step();
  assert.equal(cpu.sp, 0x1000); assert.ok(cpu.f & 0x20, 'H'); assert.ok(cpu.f & 0x10, 'C');
  console.log('PASS LDH, (HL+/-), LD (nn),SP and ADD SP,e addressing');
}

// --- HALT wakes on a pending, IE-enabled interrupt; serviced only if IME is
// set. step() never polls this itself (see cpu.ts's class doc): the driving
// loop calls interrupt() at each instruction boundary, exactly as
// gbs-import.ts's call() does. ---
{
  const {cpu, mem, setIe, setIf} = machine();
  cpu.ime = false; load(mem, 0x100, [0x76]); // HALT
  cpu.step();
  assert.ok(cpu.halted);
  setIe(0x01); setIf(0x01); // VBlank pending, IME still off: HALT exits without taking the vector.
  const before = cpu.pc;
  const took = cpu.interrupt();
  assert.equal(took, false, 'not serviced (IME=0)'); assert.equal(cpu.halted, false, 'but HALT still wakes'); assert.equal(cpu.pc, before, 'IME=0 resumes after HALT without jumping to the vector');
  const m2 = machine();
  m2.cpu.ime = true; load(m2.mem, 0x100, [0x76]);
  m2.cpu.step();
  m2.setIe(0x01); m2.setIf(0x01);
  const took2 = m2.cpu.interrupt();
  assert.ok(took2); assert.equal(m2.cpu.pc, 0x40, 'IME=1 services the pending VBlank vector');
  console.log('PASS HALT wakes on a pending interrupt, serviced only when IME is set');
}

// --- EI takes effect after the following instruction, not immediately. ---
{
  const {cpu, mem} = machine();
  cpu.ime = false;
  load(mem, 0x100, [0xfb, 0x00]); // EI ; NOP
  cpu.step(); // EI: imePending set, ime still false during this instruction
  assert.equal(cpu.ime, false);
  cpu.step(); // NOP: ime becomes true at the start of this step
  assert.equal(cpu.ime, true);
  console.log('PASS EI\'s one-instruction delay before IME actually takes effect');
}

console.log('All SM83 CPU tests passed.');
