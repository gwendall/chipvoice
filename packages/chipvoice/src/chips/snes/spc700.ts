/**
 * The SPC700: the S-SMP's CPU, every opcode, written from Anomie's SPC700
 * doc (the boot ROM listing, the register table, the opcode table with its
 * cycle counts and the documented DIV algorithm). Not a port of snes_spc's
 * SPC_CPU: decision 41 keeps that file, and every GPL/LGPL reference core,
 * out of this package. `packages/conform` may run the real thing to measure
 * against.
 *
 * The bus below is the only way this class touches memory. It calls
 * `read`/`write` for every access an instruction makes, including the
 * documented "dummy" read most stores also do (Anomie: "Most of the MOV
 * instructions targeting memory actually include a read cycle on the
 * destination address in addition to the expected write cycle"), and calls
 * `tick` once per SPC clock - one for every fetch, every access, every idle
 * cycle an opcode spends - so a caller stepping its own DSP and timers on
 * that same callback sees them fall exactly where the instruction's cycle
 * count says they do. An instruction is executed to completion in one call;
 * cycle interleaving comes from calling `tick` at each sub-step instead of
 * once at the end, not from suspending execution mid-opcode.
 *
 * PSW: N(0x80) V(0x40) P(0x20) B(0x10) H(0x08) I(0x04) Z(0x02) C(0x01).
 * Direct page: $0000-$00FF when P=0, $0100-$01FF when P=1. The stack is
 * always page 1, SP an 8-bit wrapping index.
 */

export interface Spc700Bus {
  read(addr: number): number;
  write(addr: number, value: number): void;
  /** One SPC clock cycle: the caller's DSP and timers advance by one. */
  tick(): void;
}

export const PSW_N = 0x80;
export const PSW_V = 0x40;
export const PSW_P = 0x20;
export const PSW_B = 0x10;
export const PSW_H = 0x08;
export const PSW_I = 0x04;
export const PSW_Z = 0x02;
export const PSW_C = 0x01;

export class Spc700 {
  a = 0;
  x = 0;
  y = 0;
  sp = 0;
  pc = 0;
  psw = 0;
  /** Set by SLEEP/STOP: real hardware halts the CPU until reset. The DSP and
   * timers are not the CPU's business, so a caller keeps ticking them. */
  halted = false;

  /** Cycles and bytes the current `step()` call has spent so far; every
   * private bus-access helper below routes through these to keep them
   * exact, including opcodes whose PC does not land at start+bytes
   * (branches, calls, returns). */
  private instrTicks = 0;
  private instrBytes = 0;

  constructor(private readonly bus: Spc700Bus) {}

  private clockTick() {
    this.bus.tick();
    this.instrTicks++;
  }

  /** The IPL ROM's own documented reset entry values (Anomie's doc). */
  reset() {
    this.a = 0;
    this.x = 0;
    this.y = 0;
    this.sp = 0xef;
    this.psw = 0x02; // P=0, I=0; the boot ROM sets I itself once RAM is up
    this.pc = this.bus.read(0xfffe) | (this.bus.read(0xffff) << 8);
  }

  private fetch(): number {
    const v = this.bus.read(this.pc);
    this.pc = (this.pc + 1) & 0xffff;
    this.instrBytes++;
    this.clockTick();
    return v;
  }
  private fetchSigned(): number {
    const v = this.fetch();
    return v >= 0x80 ? v - 0x100 : v;
  }
  private fetch16(): number {
    const lo = this.fetch();
    const hi = this.fetch();
    return lo | (hi << 8);
  }
  private idle() {
    this.clockTick();
  }
  private readB(addr: number): number {
    const v = this.bus.read(addr & 0xffff);
    this.clockTick();
    return v;
  }
  private writeB(addr: number, value: number) {
    this.bus.write(addr & 0xffff, value & 0xff);
    this.clockTick();
  }
  private dp(offset: number): number {
    return ((this.psw & PSW_P) !== 0 ? 0x100 : 0) + (offset & 0xff);
  }
  private push(value: number) {
    this.writeB(0x100 | this.sp, value);
    this.sp = (this.sp - 1) & 0xff;
  }
  private pop(): number {
    this.sp = (this.sp + 1) & 0xff;
    return this.readB(0x100 | this.sp);
  }
  private setNZ(v: number): number {
    v &= 0xff;
    this.psw = (this.psw & ~(PSW_N | PSW_Z)) | (v & 0x80) | (v === 0 ? PSW_Z : 0);
    return v;
  }
  private branch(taken: boolean) {
    const off = this.fetchSigned();
    if (taken) {
      this.idle();
      this.idle();
      this.pc = (this.pc + off) & 0xffff;
    }
  }
  /** BBS/BBC/CBNE/DBNZ Y,r spend one more "check" cycle than a plain Bcc
   * before they even look at the offset byte (Anomie's cycle counts: 5/7
   * where a comparable Bcc is 2/4 for the same fetch-plus-branch shape). */
  private branchExtra(taken: boolean) {
    this.idle();
    this.branch(taken);
  }

  // Binary add/subtract. SBC is ADC with the operand's ones' complement and
  // the borrow-as-not-carry identity (A-i-!C === A+~i+C): same N V H Z C.
  private adc(a: number, b: number, c: number): number {
    const half = (a & 0x0f) + (b & 0x0f) + c;
    const sum = a + b + c;
    const result = sum & 0xff;
    this.psw = (this.psw & ~(PSW_N | PSW_V | PSW_H | PSW_Z | PSW_C)) |
      (result & 0x80) |
      ((~(a ^ b) & (a ^ result) & 0x80) !== 0 ? PSW_V : 0) |
      (half > 0x0f ? PSW_H : 0) |
      (result === 0 ? PSW_Z : 0) |
      (sum > 0xff ? PSW_C : 0);
    return result;
  }
  private cmp(a: number, b: number) {
    const diff = a - b;
    this.psw = (this.psw & ~(PSW_N | PSW_Z | PSW_C)) |
      (diff & 0x80) |
      ((diff & 0xff) === 0 ? PSW_Z : 0) |
      (diff >= 0 ? PSW_C : 0);
  }
  private and(a: number, b: number): number { return this.setNZ(a & b); }
  private or(a: number, b: number): number { return this.setNZ(a | b); }
  private eor(a: number, b: number): number { return this.setNZ(a ^ b); }
  private asl(v: number): number {
    const r = (v << 1) & 0xff;
    this.psw = (this.psw & ~PSW_C) | (v & 0x80 ? PSW_C : 0);
    return this.setNZ(r);
  }
  private lsr(v: number): number {
    const r = (v & 0xff) >>> 1;
    this.psw = (this.psw & ~PSW_C) | (v & 1);
    return this.setNZ(r);
  }
  private rol(v: number): number {
    const carry = this.psw & PSW_C;
    const r = ((v << 1) & 0xff) | carry;
    this.psw = (this.psw & ~PSW_C) | (v & 0x80 ? PSW_C : 0);
    return this.setNZ(r);
  }
  private ror(v: number): number {
    const carry = this.psw & PSW_C ? 0x80 : 0;
    const r = ((v & 0xff) >>> 1) | carry;
    this.psw = (this.psw & ~PSW_C) | (v & 1);
    return this.setNZ(r);
  }
  private incWord(v: number): number { return this.setNZWord((v + 1) & 0xffff); }
  private decWord(v: number): number { return this.setNZWord((v - 1) & 0xffff); }
  private setNZWord(v: number): number {
    this.psw = (this.psw & ~(PSW_N | PSW_Z)) | ((v >> 8) & 0x80) | (v === 0 ? PSW_Z : 0);
    return v;
  }

  /** Reads a `d`, `d+X`, `!a`, `!a+X` or `!a+Y` address, spending the ticks
   * the addressing mode costs (the operand fetch is the caller's). */
  private dpXAddr(): number { const d = this.dp(this.fetch()); this.idle(); return (d & 0x100) | ((d + this.x) & 0xff); }
  private dpYAddr(): number { const d = this.dp(this.fetch()); this.idle(); return (d & 0x100) | ((d + this.y) & 0xff); }
  private absAddr(): number { return this.fetch16(); }
  private absXAddr(): number { const a = this.fetch16(); this.idle(); return (a + this.x) & 0xffff; }
  private absYAddr(): number { const a = this.fetch16(); this.idle(); return (a + this.y) & 0xffff; }
  private indDpXAddr(): number { const d = this.dp(this.fetch()); this.idle(); const p = (d & 0x100) | ((d + this.x) & 0xff); const lo = this.readB(p); const hi = this.readB((p & 0x100) | ((p + 1) & 0xff)); return (lo | (hi << 8)) & 0xffff; }
  private indDpYAddr(): number { const d = this.dp(this.fetch()); const lo = this.readB(d); const hi = this.readB((d & 0x100) | ((d + 1) & 0xff)); this.idle(); return ((lo | (hi << 8)) + this.y) & 0xffff; }
  /** `(X)`: an idle setup cycle, then the direct-page address at X. */
  private indX(): number { this.idle(); return this.dp(this.x); }

  /** Executes one instruction and returns the cycles it spent (including the
   * opcode fetch). SLEEP/STOP spend one idle cycle per call once halted. */
  step(): number {
    this.instrTicks = 0;
    this.instrBytes = 0;
    if (this.halted) { this.idle(); return this.instrTicks; }
    const op = this.fetch();
    this.execute(op);
    return this.instrTicks;
  }

  /** Bytes the instruction `step()` just ran actually fetched (its opcode
   * plus operands), for tests that check length independent of cycles. */
  get lastInstructionBytes(): number {
    return this.instrBytes;
  }

  private execute(op: number) {
    switch (op) {
      // ---- MOV: memory/register to A/X/Y ----
      case 0xe8: this.a = this.setNZ(this.fetch()); break; // MOV A,#i
      case 0xe6: this.a = this.setNZ(this.readB(this.indX())); break; // MOV A,(X)
      case 0xbf: { this.idle(); const addr = this.dp(this.x); const v = this.readB(addr); this.x = (this.x + 1) & 0xff; this.idle(); this.a = this.setNZ(v); break; } // MOV A,(X)+
      case 0xe4: this.a = this.setNZ(this.readB(this.dp(this.fetch()))); break; // MOV A,d
      case 0xf4: this.a = this.setNZ(this.readB(this.dpXAddr())); break; // MOV A,d+X
      case 0xe5: this.a = this.setNZ(this.readB(this.absAddr())); break; // MOV A,!a
      case 0xf5: this.a = this.setNZ(this.readB(this.absXAddr())); break; // MOV A,!a+X
      case 0xf6: this.a = this.setNZ(this.readB(this.absYAddr())); break; // MOV A,!a+Y
      case 0xe7: this.a = this.setNZ(this.readB(this.indDpXAddr())); break; // MOV A,[d+X]
      case 0xf7: this.a = this.setNZ(this.readB(this.indDpYAddr())); break; // MOV A,[d]+Y
      case 0xcd: this.x = this.setNZ(this.fetch()); break; // MOV X,#i
      case 0xf8: this.x = this.setNZ(this.readB(this.dp(this.fetch()))); break; // MOV X,d
      case 0xf9: this.x = this.setNZ(this.readB(this.dpYAddr())); break; // MOV X,d+Y
      case 0xe9: this.x = this.setNZ(this.readB(this.absAddr())); break; // MOV X,!a
      case 0x8d: this.y = this.setNZ(this.fetch()); break; // MOV Y,#i
      case 0xeb: this.y = this.setNZ(this.readB(this.dp(this.fetch()))); break; // MOV Y,d
      case 0xfb: this.y = this.setNZ(this.readB(this.dpXAddr())); break; // MOV Y,d+X
      case 0xec: this.y = this.setNZ(this.readB(this.absAddr())); break; // MOV Y,!a

      // ---- MOV: register to register/memory ----
      case 0x7d: this.a = this.setNZ(this.x); this.idle(); break; // MOV A,X
      case 0xdd: this.a = this.setNZ(this.y); this.idle(); break; // MOV A,Y
      case 0x5d: this.x = this.setNZ(this.a); this.idle(); break; // MOV X,A
      case 0xfd: this.y = this.setNZ(this.a); this.idle(); break; // MOV Y,A
      case 0x9d: this.x = this.setNZ(this.sp); this.idle(); break; // MOV X,SP
      case 0xbd: this.sp = this.a; this.idle(); break; // MOV SP,X (unaffected flags per table, but this is X->SP; no NZ)
      case 0xc6: { const addr = this.indX(); this.readB(addr); this.writeB(addr, this.a); break; } // MOV (X),A
      case 0xaf: { this.idle(); const addr = this.dp(this.x); this.writeB(addr, this.a); this.x = (this.x + 1) & 0xff; this.idle(); break; } // MOV (X)+,A
      case 0xc4: { const d = this.dp(this.fetch()); this.readB(d); this.writeB(d, this.a); break; } // MOV d,A
      case 0xd4: { const addr = this.dpXAddr(); this.readB(addr); this.writeB(addr, this.a); break; } // MOV d+X,A
      case 0xc5: { const a2 = this.absAddr(); this.readB(a2); this.writeB(a2, this.a); break; } // MOV !a,A
      case 0xd5: { const a2 = this.absXAddr(); this.readB(a2); this.writeB(a2, this.a); break; } // MOV !a+X,A
      case 0xd6: { const a2 = this.absYAddr(); this.readB(a2); this.writeB(a2, this.a); break; } // MOV !a+Y,A
      case 0xc7: { const a2 = this.indDpXAddr(); this.readB(a2); this.writeB(a2, this.a); break; } // MOV [d+X],A
      case 0xd7: { const a2 = this.indDpYAddr(); this.readB(a2); this.writeB(a2, this.a); break; } // MOV [d]+Y,A
      case 0xd8: { const d = this.dp(this.fetch()); this.readB(d); this.writeB(d, this.x); break; } // MOV d,X
      case 0xd9: { const addr = this.dpYAddr(); this.readB(addr); this.writeB(addr, this.x); break; } // MOV d+Y,X
      case 0xc9: { const a2 = this.absAddr(); this.readB(a2); this.writeB(a2, this.x); break; } // MOV !a,X
      case 0xcb: { const d = this.dp(this.fetch()); this.readB(d); this.writeB(d, this.y); break; } // MOV d,Y
      case 0xdb: { const addr = this.dpXAddr(); this.readB(addr); this.writeB(addr, this.y); break; } // MOV d+X,Y
      case 0xcc: { const a2 = this.absAddr(); this.readB(a2); this.writeB(a2, this.y); break; } // MOV !a,Y
      case 0xfa: { const src = this.dp(this.fetch()); const dst = this.dp(this.fetch()); const v = this.readB(src); this.writeB(dst, v); break; } // MOV dd,ds (no dest read)
      case 0x8f: { const imm = this.fetch(); const d = this.dp(this.fetch()); this.readB(d); this.writeB(d, imm); break; } // MOV d,#i

      // ---- ALU: OR/AND/EOR/CMP/ADC/SBC, A forms ----
      case 0x08: this.a = this.or(this.a, this.fetch()); break;
      case 0x06: this.a = this.or(this.a, this.readB(this.indX())); break;
      case 0x04: this.a = this.or(this.a, this.readB(this.dp(this.fetch()))); break;
      case 0x14: this.a = this.or(this.a, this.readB(this.dpXAddr())); break;
      case 0x05: this.a = this.or(this.a, this.readB(this.absAddr())); break;
      case 0x15: this.a = this.or(this.a, this.readB(this.absXAddr())); break;
      case 0x16: this.a = this.or(this.a, this.readB(this.absYAddr())); break;
      case 0x07: this.a = this.or(this.a, this.readB(this.indDpXAddr())); break;
      case 0x17: this.a = this.or(this.a, this.readB(this.indDpYAddr())); break;
      case 0x19: { this.idle(); const dx = this.dp(this.x); const dy = this.dp(this.y); const v = this.or(this.readB(dx), this.readB(dy)); this.writeB(dx, v); break; }
      case 0x09: { const ds = this.dp(this.fetch()); const dd = this.dp(this.fetch()); const v = this.or(this.readB(dd), this.readB(ds)); this.writeB(dd, v); break; }
      case 0x18: { const imm = this.fetch(); const d = this.dp(this.fetch()); const v = this.or(this.readB(d), imm); this.writeB(d, v); break; }

      case 0x28: this.a = this.and(this.a, this.fetch()); break;
      case 0x26: this.a = this.and(this.a, this.readB(this.indX())); break;
      case 0x24: this.a = this.and(this.a, this.readB(this.dp(this.fetch()))); break;
      case 0x34: this.a = this.and(this.a, this.readB(this.dpXAddr())); break;
      case 0x25: this.a = this.and(this.a, this.readB(this.absAddr())); break;
      case 0x35: this.a = this.and(this.a, this.readB(this.absXAddr())); break;
      case 0x36: this.a = this.and(this.a, this.readB(this.absYAddr())); break;
      case 0x27: this.a = this.and(this.a, this.readB(this.indDpXAddr())); break;
      case 0x37: this.a = this.and(this.a, this.readB(this.indDpYAddr())); break;
      case 0x39: { this.idle(); const dx = this.dp(this.x); const dy = this.dp(this.y); const v = this.and(this.readB(dx), this.readB(dy)); this.writeB(dx, v); break; }
      case 0x29: { const ds = this.dp(this.fetch()); const dd = this.dp(this.fetch()); const v = this.and(this.readB(dd), this.readB(ds)); this.writeB(dd, v); break; }
      case 0x38: { const imm = this.fetch(); const d = this.dp(this.fetch()); const v = this.and(this.readB(d), imm); this.writeB(d, v); break; }

      case 0x48: this.a = this.eor(this.a, this.fetch()); break;
      case 0x46: this.a = this.eor(this.a, this.readB(this.indX())); break;
      case 0x44: this.a = this.eor(this.a, this.readB(this.dp(this.fetch()))); break;
      case 0x54: this.a = this.eor(this.a, this.readB(this.dpXAddr())); break;
      case 0x45: this.a = this.eor(this.a, this.readB(this.absAddr())); break;
      case 0x55: this.a = this.eor(this.a, this.readB(this.absXAddr())); break;
      case 0x56: this.a = this.eor(this.a, this.readB(this.absYAddr())); break;
      case 0x47: this.a = this.eor(this.a, this.readB(this.indDpXAddr())); break;
      case 0x57: this.a = this.eor(this.a, this.readB(this.indDpYAddr())); break;
      case 0x59: { this.idle(); const dx = this.dp(this.x); const dy = this.dp(this.y); const v = this.eor(this.readB(dx), this.readB(dy)); this.writeB(dx, v); break; }
      case 0x49: { const ds = this.dp(this.fetch()); const dd = this.dp(this.fetch()); const v = this.eor(this.readB(dd), this.readB(ds)); this.writeB(dd, v); break; }
      case 0x58: { const imm = this.fetch(); const d = this.dp(this.fetch()); const v = this.eor(this.readB(d), imm); this.writeB(d, v); break; }

      case 0x68: this.cmp(this.a, this.fetch()); break;
      case 0x66: this.cmp(this.a, this.readB(this.indX())); break;
      case 0x64: this.cmp(this.a, this.readB(this.dp(this.fetch()))); break;
      case 0x74: this.cmp(this.a, this.readB(this.dpXAddr())); break;
      case 0x65: this.cmp(this.a, this.readB(this.absAddr())); break;
      case 0x75: this.cmp(this.a, this.readB(this.absXAddr())); break;
      case 0x76: this.cmp(this.a, this.readB(this.absYAddr())); break;
      case 0x67: this.cmp(this.a, this.readB(this.indDpXAddr())); break;
      case 0x77: this.cmp(this.a, this.readB(this.indDpYAddr())); break;
      case 0x79: { this.idle(); const dx = this.dp(this.x); const dy = this.dp(this.y); this.cmp(this.readB(dx), this.readB(dy)); this.idle(); break; } // CMP (X),(Y): 5 cycles, same as the RMW forms though nothing is written back
      case 0x69: { const ds = this.dp(this.fetch()); const dd = this.dp(this.fetch()); this.cmp(this.readB(dd), this.readB(ds)); this.idle(); break; } // CMP dd,ds: 6 cycles
      case 0x78: { const imm = this.fetch(); const d = this.dp(this.fetch()); this.cmp(this.readB(d), imm); this.idle(); break; } // CMP d,#i: 5 cycles
      case 0xc8: this.cmp(this.x, this.fetch()); break;
      case 0x3e: this.cmp(this.x, this.readB(this.dp(this.fetch()))); break;
      case 0x1e: this.cmp(this.x, this.readB(this.absAddr())); break;
      case 0xad: this.cmp(this.y, this.fetch()); break;
      case 0x7e: this.cmp(this.y, this.readB(this.dp(this.fetch()))); break;
      case 0x5e: this.cmp(this.y, this.readB(this.absAddr())); break;

      case 0x88: this.a = this.adc(this.a, this.fetch(), this.psw & PSW_C); break;
      case 0x86: this.a = this.adc(this.a, this.readB(this.indX()), this.psw & PSW_C); break;
      case 0x84: this.a = this.adc(this.a, this.readB(this.dp(this.fetch())), this.psw & PSW_C); break;
      case 0x94: this.a = this.adc(this.a, this.readB(this.dpXAddr()), this.psw & PSW_C); break;
      case 0x85: this.a = this.adc(this.a, this.readB(this.absAddr()), this.psw & PSW_C); break;
      case 0x95: this.a = this.adc(this.a, this.readB(this.absXAddr()), this.psw & PSW_C); break;
      case 0x96: this.a = this.adc(this.a, this.readB(this.absYAddr()), this.psw & PSW_C); break;
      case 0x87: this.a = this.adc(this.a, this.readB(this.indDpXAddr()), this.psw & PSW_C); break;
      case 0x97: this.a = this.adc(this.a, this.readB(this.indDpYAddr()), this.psw & PSW_C); break;
      case 0x99: { this.idle(); const dx = this.dp(this.x); const dy = this.dp(this.y); const v = this.adc(this.readB(dx), this.readB(dy), this.psw & PSW_C); this.writeB(dx, v); break; }
      case 0x89: { const ds = this.dp(this.fetch()); const dd = this.dp(this.fetch()); const v = this.adc(this.readB(dd), this.readB(ds), this.psw & PSW_C); this.writeB(dd, v); break; }
      case 0x98: { const imm = this.fetch(); const d = this.dp(this.fetch()); const v = this.adc(this.readB(d), imm, this.psw & PSW_C); this.writeB(d, v); break; }

      case 0xa8: this.a = this.adc(this.a, this.fetch() ^ 0xff, this.psw & PSW_C); break;
      case 0xa6: this.a = this.adc(this.a, this.readB(this.indX()) ^ 0xff, this.psw & PSW_C); break;
      case 0xa4: this.a = this.adc(this.a, this.readB(this.dp(this.fetch())) ^ 0xff, this.psw & PSW_C); break;
      case 0xb4: this.a = this.adc(this.a, this.readB(this.dpXAddr()) ^ 0xff, this.psw & PSW_C); break;
      case 0xa5: this.a = this.adc(this.a, this.readB(this.absAddr()) ^ 0xff, this.psw & PSW_C); break;
      case 0xb5: this.a = this.adc(this.a, this.readB(this.absXAddr()) ^ 0xff, this.psw & PSW_C); break;
      case 0xb6: this.a = this.adc(this.a, this.readB(this.absYAddr()) ^ 0xff, this.psw & PSW_C); break;
      case 0xa7: this.a = this.adc(this.a, this.readB(this.indDpXAddr()) ^ 0xff, this.psw & PSW_C); break;
      case 0xb7: this.a = this.adc(this.a, this.readB(this.indDpYAddr()) ^ 0xff, this.psw & PSW_C); break;
      case 0xb9: { this.idle(); const dx = this.dp(this.x); const dy = this.dp(this.y); const v = this.adc(this.readB(dx), this.readB(dy) ^ 0xff, this.psw & PSW_C); this.writeB(dx, v); break; }
      case 0xa9: { const ds = this.dp(this.fetch()); const dd = this.dp(this.fetch()); const v = this.adc(this.readB(dd), this.readB(ds) ^ 0xff, this.psw & PSW_C); this.writeB(dd, v); break; }
      case 0xb8: { const imm = this.fetch(); const d = this.dp(this.fetch()); const v = this.adc(this.readB(d), imm ^ 0xff, this.psw & PSW_C); this.writeB(d, v); break; }

      // ---- INC/DEC/shifts, A/X/Y and memory ----
      case 0xbc: this.a = this.setNZ(this.a + 1); this.idle(); break;
      case 0x3d: this.x = this.setNZ(this.x + 1); this.idle(); break;
      case 0xfc: this.y = this.setNZ(this.y + 1); this.idle(); break;
      case 0x9c: this.a = this.setNZ(this.a - 1); this.idle(); break;
      case 0x1d: this.x = this.setNZ(this.x - 1); this.idle(); break;
      case 0xdc: this.y = this.setNZ(this.y - 1); this.idle(); break;
      case 0xab: { const d = this.dp(this.fetch()); this.writeB(d, this.setNZ(this.readB(d) + 1)); break; }
      case 0xbb: { const d = this.dpXAddr(); this.writeB(d, this.setNZ(this.readB(d) + 1)); break; }
      case 0xac: { const d = this.absAddr(); this.writeB(d, this.setNZ(this.readB(d) + 1)); break; }
      case 0x8b: { const d = this.dp(this.fetch()); this.writeB(d, this.setNZ(this.readB(d) - 1)); break; }
      case 0x9b: { const d = this.dpXAddr(); this.writeB(d, this.setNZ(this.readB(d) - 1)); break; }
      case 0x8c: { const d = this.absAddr(); this.writeB(d, this.setNZ(this.readB(d) - 1)); break; }

      case 0x1c: this.a = this.asl(this.a); this.idle(); break;
      case 0x0b: { const d = this.dp(this.fetch()); this.writeB(d, this.asl(this.readB(d))); break; }
      case 0x1b: { const d = this.dpXAddr(); this.writeB(d, this.asl(this.readB(d))); break; }
      case 0x0c: { const d = this.absAddr(); this.writeB(d, this.asl(this.readB(d))); break; }
      case 0x5c: this.a = this.lsr(this.a); this.idle(); break;
      case 0x4b: { const d = this.dp(this.fetch()); this.writeB(d, this.lsr(this.readB(d))); break; }
      case 0x5b: { const d = this.dpXAddr(); this.writeB(d, this.lsr(this.readB(d))); break; }
      case 0x4c: { const d = this.absAddr(); this.writeB(d, this.lsr(this.readB(d))); break; }
      case 0x3c: this.a = this.rol(this.a); this.idle(); break;
      case 0x2b: { const d = this.dp(this.fetch()); this.writeB(d, this.rol(this.readB(d))); break; }
      case 0x3b: { const d = this.dpXAddr(); this.writeB(d, this.rol(this.readB(d))); break; }
      case 0x2c: { const d = this.absAddr(); this.writeB(d, this.rol(this.readB(d))); break; }
      case 0x7c: this.a = this.ror(this.a); this.idle(); break;
      case 0x6b: { const d = this.dp(this.fetch()); this.writeB(d, this.ror(this.readB(d))); break; }
      case 0x7b: { const d = this.dpXAddr(); this.writeB(d, this.ror(this.readB(d))); break; }
      case 0x6c: { const d = this.absAddr(); this.writeB(d, this.ror(this.readB(d))); break; }
      case 0x9f: this.a = this.setNZ(((this.a >> 4) | (this.a << 4)) & 0xff); this.idle(); this.idle(); this.idle(); this.idle(); break; // XCN, 5 cycles

      // ---- 16-bit: MOVW/INCW/DECW/ADDW/SUBW/CMPW/MUL/DIV/DAA/DAS ----
      case 0xba: { const d = this.dp(this.fetch()); const lo = this.readB(d); const hi = this.readB((d & 0x100) | ((d + 1) & 0xff)); this.idle(); this.y = hi; this.a = lo; this.setNZWord((hi << 8) | lo); break; } // MOVW YA,d
      case 0xda: { const d = this.dp(this.fetch()); this.readB(d); this.writeB(d, this.a); this.writeB((d & 0x100) | ((d + 1) & 0xff), this.y); break; } // MOVW d,YA (dummy read low only)
      case 0x3a: { const d = this.dp(this.fetch()); const hiAddr = (d & 0x100) | ((d + 1) & 0xff); const lo = this.readB(d); const hi = this.readB(hiAddr); const w = this.incWord((lo | (hi << 8)) as number); this.writeB(d, w & 0xff); this.writeB(hiAddr, (w >> 8) & 0xff); break; }
      case 0x1a: { const d = this.dp(this.fetch()); const hiAddr = (d & 0x100) | ((d + 1) & 0xff); const lo = this.readB(d); const hi = this.readB(hiAddr); const w = this.decWord((lo | (hi << 8)) as number); this.writeB(d, w & 0xff); this.writeB(hiAddr, (w >> 8) & 0xff); break; }
      case 0x7a: { // ADDW YA,d
        const d = this.dp(this.fetch());
        const lo = this.readB(d);
        const hi = this.readB((d & 0x100) | ((d + 1) & 0xff));
        this.idle();
        const ya = (this.y << 8) | this.a;
        const operand = (hi << 8) | lo;
        const rlo = this.adc(ya & 0xff, operand & 0xff, 0);
        const carry = this.psw & PSW_C ? 1 : 0;
        const halfLo = this.psw & PSW_H ? 1 : 0;
        const rhi = this.adc((ya >> 8) & 0xff, (operand >> 8) & 0xff, carry);
        this.psw = halfLo ? this.psw : this.psw; // H already reflects the high byte's own carry from adc()
        this.a = rlo; this.y = rhi;
        this.setNZWord((rhi << 8) | rlo);
        break;
      }
      case 0x9a: { // SUBW YA,d
        const d = this.dp(this.fetch());
        const lo = this.readB(d);
        const hi = this.readB((d & 0x100) | ((d + 1) & 0xff));
        this.idle();
        const ya = (this.y << 8) | this.a;
        const operand = ((hi << 8) | lo) ^ 0xffff;
        const rlo = this.adc(ya & 0xff, operand & 0xff, 1);
        const carry = this.psw & PSW_C ? 1 : 0;
        const rhi = this.adc((ya >> 8) & 0xff, (operand >> 8) & 0xff, carry);
        this.a = rlo; this.y = rhi;
        this.setNZWord((rhi << 8) | rlo);
        break;
      }
      case 0x5a: { const d = this.dp(this.fetch()); const lo = this.readB(d); const hi = this.readB((d & 0x100) | ((d + 1) & 0xff)); const ya = (this.y << 8) | this.a; const operand = (hi << 8) | lo; const diff = ya - operand; this.psw = (this.psw & ~(PSW_N | PSW_Z | PSW_C)) | ((diff >> 8) & 0x80) | ((diff & 0xffff) === 0 ? PSW_Z : 0) | (diff >= 0 ? PSW_C : 0); break; } // CMPW YA,d
      case 0xcf: { // MUL YA = Y*A, NZ on Y (the high byte)
        const product = (this.y * this.a) & 0xffff;
        this.y = (product >> 8) & 0xff;
        this.a = product & 0xff;
        this.setNZ(this.y);
        for (let i = 0; i < 8; i++) this.idle();
        break;
      }
      case 0x9e: { // DIV YA,X: Anomie's documented restoring-division algorithm
        const yIn = this.y, xIn = this.x;
        let ya = ((this.y << 8) | this.a) & 0x1ffff;
        const xShifted = (xIn << 9) & 0x1ffff;
        for (let i = 0; i < 9; i++) {
          ya = (ya << 1) & 0x1ffff;
          if (ya >= xShifted) ya ^= 1;
          if (ya & 1) ya = (ya - xShifted) & 0x1ffff;
        }
        const a2 = ya & 0xff;
        const y2 = (ya >> 9) & 0xff;
        const v = ya & 0x100 ? 1 : 0;
        this.a = a2; this.y = y2;
        this.psw = (this.psw & ~(PSW_N | PSW_V | PSW_H | PSW_Z)) |
          (a2 & 0x80) | (a2 === 0 ? PSW_Z : 0) | (v ? PSW_V : 0) |
          ((xIn & 0x0f) <= (yIn & 0x0f) ? PSW_H : 0);
        for (let i = 0; i < 11; i++) this.idle();
        break;
      }
      case 0xdf: { // DAA
        let v = this.a;
        if (this.psw & PSW_C || v > 0x99) { v += 0x60; this.psw |= PSW_C; } else this.psw &= ~PSW_C;
        if (this.psw & PSW_H || (v & 0x0f) > 0x09) v += 0x06;
        this.a = this.setNZ(v & 0xff);
        this.idle(); this.idle();
        break;
      }
      case 0xbe: { // DAS
        let v = this.a;
        if (!(this.psw & PSW_C) || v > 0x99) { v -= 0x60; this.psw &= ~PSW_C; } else this.psw |= PSW_C;
        if (!(this.psw & PSW_H) || (v & 0x0f) > 0x09) v -= 0x06;
        this.a = this.setNZ(v & 0xff);
        this.idle(); this.idle();
        break;
      }

      // ---- Branches, JMP, CALL family ----
      case 0x2f: this.branch(true); break; // BRA (always taken)
      case 0x90: this.branch(!(this.psw & PSW_C)); break; // BCC
      case 0xb0: this.branch(!!(this.psw & PSW_C)); break; // BCS
      case 0xf0: this.branch(!!(this.psw & PSW_Z)); break; // BEQ
      case 0x30: this.branch(!!(this.psw & PSW_N)); break; // BMI
      case 0xd0: this.branch(!(this.psw & PSW_Z)); break; // BNE
      case 0x10: this.branch(!(this.psw & PSW_N)); break; // BPL
      case 0x50: this.branch(!(this.psw & PSW_V)); break; // BVC
      case 0x70: this.branch(!!(this.psw & PSW_V)); break; // BVS
      case 0x5f: this.pc = this.absAddr(); break; // JMP !a
      case 0x1f: { const base = this.absAddr(); this.idle(); const p = (base + this.x) & 0xffff; const lo = this.readB(p); const hi = this.readB((p + 1) & 0xffff); this.pc = lo | (hi << 8); break; } // JMP [!a+X]

      case 0x3f: { const target = this.absAddr(); this.idle(); this.idle(); this.push((this.pc >> 8) & 0xff); this.push(this.pc & 0xff); this.idle(); this.pc = target; break; } // CALL !a
      case 0x4f: { const low = this.fetch(); this.idle(); this.idle(); this.push((this.pc >> 8) & 0xff); this.push(this.pc & 0xff); this.pc = 0xff00 | low; break; } // PCALL u
      case 0x6f: { this.idle(); const lo = this.pop(); const hi = this.pop(); this.idle(); this.pc = lo | (hi << 8); break; } // RET
      case 0x7f: { this.idle(); this.psw = this.pop(); const lo = this.pop(); const hi = this.pop(); this.idle(); this.pc = lo | (hi << 8); break; } // RETI (RET1)
      case 0x0f: { // BRK
        this.idle();
        this.push((this.pc >> 8) & 0xff);
        this.push(this.pc & 0xff);
        this.push(this.psw);
        this.psw = (this.psw | PSW_B) & ~PSW_I;
        this.idle();
        const lo = this.readB(0xffde);
        const hi = this.readB(0xffdf);
        this.pc = lo | (hi << 8);
        break;
      }

      // ---- Stack ----
      case 0x2d: this.idle(); this.idle(); this.push(this.a); break;
      case 0x4d: this.idle(); this.idle(); this.push(this.x); break;
      case 0x6d: this.idle(); this.idle(); this.push(this.y); break;
      case 0x0d: this.idle(); this.idle(); this.push(this.psw); break;
      case 0xae: this.idle(); this.idle(); this.a = this.pop(); break;
      case 0xce: this.idle(); this.idle(); this.x = this.pop(); break;
      case 0xee: this.idle(); this.idle(); this.y = this.pop(); break;
      case 0x8e: this.idle(); this.idle(); this.psw = this.pop(); break;

      // ---- Flags ----
      case 0x60: this.psw &= ~PSW_C; this.idle(); break;
      case 0x80: this.psw |= PSW_C; this.idle(); break;
      case 0xed: this.psw ^= PSW_C; this.idle(); this.idle(); break;
      case 0xe0: this.psw &= ~(PSW_V | PSW_H); this.idle(); break;
      case 0x20: this.psw &= ~PSW_P; this.idle(); break;
      case 0x40: this.psw |= PSW_P; this.idle(); break;
      case 0xa0: this.psw |= PSW_I; this.idle(); this.idle(); break;
      case 0xc0: this.psw &= ~PSW_I; this.idle(); this.idle(); break;

      // ---- TCALL/BBS/BBC/CBNE/DBNZ/SET1/CLR1/1-bit ops ----
      case 0x01: case 0x11: case 0x21: case 0x31: case 0x41: case 0x51: case 0x61: case 0x71:
      case 0x81: case 0x91: case 0xa1: case 0xb1: case 0xc1: case 0xd1: case 0xe1: case 0xf1: {
        const n = op >> 4;
        const vector = 0xffde - 2 * n;
        this.idle(); this.idle(); this.idle();
        this.push((this.pc >> 8) & 0xff);
        this.push(this.pc & 0xff);
        const lo = this.readB(vector);
        const hi = this.readB(vector + 1);
        this.pc = lo | (hi << 8);
        break;
      }
      case 0x2e: { const d = this.dp(this.fetch()); const v = this.readB(d); this.branchExtra(this.a !== v); break; } // CBNE d,r
      case 0xde: { const addr = this.dpXAddr(); const v = this.readB(addr); this.branchExtra(this.a !== v); break; } // CBNE d+X,r (dpXAddr already spends the +X idle)
      case 0xfe: { this.idle(); this.y = (this.y - 1) & 0xff; this.branchExtra(this.y !== 0); break; } // DBNZ Y,r
      case 0x6e: { const d = this.dp(this.fetch()); const v = (this.readB(d) - 1) & 0xff; this.writeB(d, v); this.branch(v !== 0); break; } // DBNZ d,r

      case 0x0e: { const a2 = this.absAddr(); const v = this.readB(a2); this.setNZ(this.a - v); this.idle(); this.writeB(a2, v | this.a); break; } // TSET1
      case 0x4e: { const a2 = this.absAddr(); const v = this.readB(a2); this.setNZ(this.a - v); this.idle(); this.writeB(a2, v & ~this.a); break; } // TCLR1

      case 0xaa: { const w = this.fetch16(); const bit = (w >> 13) & 7; const addr = w & 0x1fff; const v = this.readB(addr); this.psw = (this.psw & ~PSW_C) | ((v >> bit) & 1); break; } // MOV1 C,m.b
      case 0xca: { const w = this.fetch16(); const bit = (w >> 13) & 7; const addr = w & 0x1fff; const v = this.readB(addr); this.idle(); const nv = this.psw & PSW_C ? v | (1 << bit) : v & ~(1 << bit); this.writeB(addr, nv); break; } // MOV1 m.b,C
      case 0x4a: { const w = this.fetch16(); const bit = (w >> 13) & 7; const addr = w & 0x1fff; const v = this.readB(addr); this.psw = (this.psw & PSW_C) && ((v >> bit) & 1) ? this.psw : (this.psw & ~PSW_C); break; } // AND1 C,m.b
      case 0x6a: { const w = this.fetch16(); const bit = (w >> 13) & 7; const addr = w & 0x1fff; const v = this.readB(addr); this.psw = (this.psw & PSW_C) && !((v >> bit) & 1) ? this.psw : (this.psw & ~PSW_C); break; } // AND1 C,/m.b
      case 0x0a: { const w = this.fetch16(); const bit = (w >> 13) & 7; const addr = w & 0x1fff; const v = this.readB(addr); this.idle(); if ((v >> bit) & 1) this.psw |= PSW_C; break; } // OR1 C,m.b
      case 0x2a: { const w = this.fetch16(); const bit = (w >> 13) & 7; const addr = w & 0x1fff; const v = this.readB(addr); this.idle(); if (!((v >> bit) & 1)) this.psw |= PSW_C; break; } // OR1 C,/m.b
      case 0x8a: { const w = this.fetch16(); const bit = (w >> 13) & 7; const addr = w & 0x1fff; const v = this.readB(addr); this.idle(); this.psw ^= ((v >> bit) & 1) << 0; break; } // EOR1 C,m.b (toggles C when the bit is 1)
      case 0xea: { const w = this.fetch16(); const bit = (w >> 13) & 7; const addr = w & 0x1fff; const v = this.readB(addr); this.writeB(addr, v ^ (1 << bit)); break; } // NOT1 m.b

      default: {
        if ((op & 0x0f) === 0x02) { // SET1/CLR1: base $02/$12, bit = op>>5 (Anomie: "+bit*0x20")
          const bit = (op >> 5) & 7;
          const isClr = (op & 0x10) !== 0;
          const d = this.dp(this.fetch());
          const v = this.readB(d);
          this.writeB(d, isClr ? v & ~(1 << bit) : v | (1 << bit));
          break;
        }
        if ((op & 0x0f) === 0x03) { // BBS/BBC: base $03/$13, bit = op>>5
          const bit = (op >> 5) & 7;
          const isBbc = (op & 0x10) !== 0;
          const d = this.dp(this.fetch());
          const v = this.readB(d);
          const set = ((v >> bit) & 1) !== 0;
          this.branchExtra(isBbc ? !set : set);
          break;
        }
        if (op === 0xef || op === 0xff) { this.halted = true; this.idle(); break; } // SLEEP, STOP
        if (op === 0x00) { this.idle(); break; } // NOP
        throw new Error(`Unimplemented SPC700 opcode $${op.toString(16)}`);
      }
    }
  }
}
