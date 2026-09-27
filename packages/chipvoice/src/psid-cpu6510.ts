/**
 * A MOS 6510, cycle-stepped, written to run a PSID/RSID tune's own machine
 * code (`psid-import.ts`), not to be a general 2A03/6502 harness - that is
 * `packages/conform/src/roms/cpu6502.mjs`, a different, private file this
 * one is not derived from.
 *
 * Every documented opcode and addressing mode is here, with NMOS decimal
 * (BCD) mode for ADC and SBC: the algorithm and the flag table are Bruce
 * Clark's "Decimal Mode" (6502.org/tutorials/decimal_mode.html), Appendix A,
 * Sequence 1 (ADC) and Sequence 3 (SBC). That document states plainly that
 * on a real NMOS 6502, decimal ADC's N, V and Z are whatever the *binary*
 * addition would have set (undocumented but deterministic, since nothing
 * decimal-corrects them on the die), and decimal SBC's C, N, V and Z are all
 * the binary subtraction's; only the accumulator's decimal digits and ADC's
 * carry are the corrected sequence. That is what is implemented below.
 *
 * The stable illegal (undocumented) opcodes real music occasionally uses -
 * SLO, RLA, SRE, RRA, SAX, LAX, DCP, ISC, ANC, ALR, ARR, SBX, the NOP
 * variants and LAS - are implemented, cited to the classification the 6502
 * community (6502.org's forums, the nesdev wiki's "CPU unofficial opcodes"
 * page and oxyron.net's "no more secrets" opcode matrix all agree on) has
 * converged on for which illegal opcodes are chip-deterministic and which
 * depend on unmodeled analog bus behaviour. ARR's further BCD post-
 * correction in decimal mode is a real, well-known quirk on top of the
 * ROR-with-carry this implements, but it is a corner of a corner - an
 * already-rare opcode, in the one mode a music player has no reason to be
 * in - and is not implemented; ARR here always uses its binary-mode formula,
 * which is exact whenever D=0.
 *
 * ANE/XAA, LXA/LAX#imm, SHA/AHX, SHX/SXA, SHY/SYA and TAS/SHS depend on an
 * internal bus/analog "magic constant" that differs by chip and by
 * temperature; no document gives a value worth reproducing, so they are
 * rejected by name (`IllegalOpcodeError`, kind `"unstable"`) rather than
 * silently guessed at. So are the twelve JAM/KIL/HLT opcodes, which lock a
 * real 6502's bus solid until reset - there is nothing to emulate but the
 * lockup, so this throws instead of hanging.
 */

export interface Cpu6510Bus {
  read(addr: number): number;
  write(addr: number, value: number): void;
}

/** An unstable-illegal or JAM/KIL opcode: named, not silently NOPed or guessed. */
export class IllegalOpcodeError extends Error {
  constructor(
    public readonly opcode: number,
    public readonly mnemonic: string,
    public readonly kind: "unstable" | "jam",
  ) {
    super(
      kind === "jam"
        ? `0x${opcode.toString(16).padStart(2, "0")} (${mnemonic}) locks the bus on real silicon; refusing to emulate a hang`
        : `0x${opcode.toString(16).padStart(2, "0")} (${mnemonic}) depends on unmodeled analog bus behaviour with no reliable documented value`,
    );
  }
}

const N = 0x80, V = 0x40, U = 0x20, B = 0x10, D = 0x08, I = 0x04, Z = 0x02, C = 0x01;

/** JAM/KIL/HLT: halts the bus. Twelve opcodes, none of them documented. */
const JAM = new Set([0x02, 0x12, 0x22, 0x32, 0x42, 0x52, 0x62, 0x72, 0x92, 0xb2, 0xd2, 0xf2]);
/** Depends on the CPU's internal bus/analog state; no document gives a value. */
const UNSTABLE: Record<number, string> = {
  0x8b: "ANE", 0xab: "LXA", 0x93: "SHA", 0x9f: "SHA", 0x9e: "SHX", 0x9c: "SHY", 0x9b: "TAS",
};

export class Cpu6510 {
  a = 0; x = 0; y = 0; s = 0xfd; p = U | I; pc = 0;
  /** Total cycles run since construction or the last `reset()`. */
  cycle = 0;

  constructor(private readonly bus: Cpu6510Bus) {}

  private read(addr: number): number { return this.bus.read(addr & 0xffff) & 0xff; }
  private write(addr: number, value: number): void { this.bus.write(addr & 0xffff, value & 0xff); }
  private read16(addr: number): number { return this.read(addr) | (this.read((addr + 1) & 0xffff) << 8); }
  /** Zero-page indirect addresses wrap within the page, never into page 1. */
  private read16zp(zp: number): number { return this.read(zp & 0xff) | (this.read((zp + 1) & 0xff) << 8); }

  private push(v: number) { this.write(0x100 + this.s, v); this.s = (this.s - 1) & 0xff; }
  private pop(): number { this.s = (this.s + 1) & 0xff; return this.read(0x100 + this.s); }

  private setNZ(v: number) { this.p = (v & 0x80) ? (this.p | N) : (this.p & ~N); this.p = (v & 0xff) === 0 ? (this.p | Z) : (this.p & ~Z); }
  private setFlag(mask: number, on: boolean) { this.p = on ? (this.p | mask) : (this.p & ~mask); }

  /** 7 cycles: three dummy stack accesses (no push, since /RESET forces read), then the vector. */
  reset() {
    this.s = (this.s - 3) & 0xff;
    this.p |= I;
    this.pc = this.read16(0xfffc);
    this.cycle += 7;
  }

  /** A level IRQ, honoured only when I is clear. Callers re-assert every cycle it should still fire. */
  irq() {
    if (this.p & I) return;
    this.dispatch(0xfffe, false);
  }

  /** Edge-triggered, unlike IRQ: always taken. PSID/RSID tunes essentially never use it. */
  nmi() { this.dispatch(0xfffa, false); }

  private dispatch(vector: number, breakFlag: boolean) {
    this.push(this.pc >> 8);
    this.push(this.pc & 0xff);
    this.push((this.p | U | (breakFlag ? B : 0)) & ~0);
    this.p |= I;
    this.pc = this.read16(vector);
    this.cycle += 7;
  }

  /** Runs one instruction; returns the cycles it cost. Throws `IllegalOpcodeError` for JAM or unstable opcodes. */
  step(): number {
    const start = this.cycle;
    const op = this.read(this.pc++);
    if (JAM.has(op)) throw new IllegalOpcodeError(op, "JAM", "jam");
    if (UNSTABLE[op]) throw new IllegalOpcodeError(op, UNSTABLE[op], "unstable");
    this.execute(op);
    return this.cycle - start;
  }

  // --- Addressing: each returns the effective address, and (for the
  // indexed absolute/indirect modes) whether that crossed a page, which
  // both the read cost and the illegal RMW opcodes' fixed extra cycle need.
  private imm(): number { return this.pc++; }
  private zp(): number { return this.read(this.pc++); }
  private zpx(): number { return (this.read(this.pc++) + this.x) & 0xff; }
  private zpy(): number { return (this.read(this.pc++) + this.y) & 0xff; }
  private abs(): number { const a = this.read16(this.pc); this.pc += 2; return a; }
  private absIndexed(reg: number): { addr: number; crossed: boolean } {
    const base = this.read16(this.pc); this.pc += 2;
    const addr = (base + reg) & 0xffff;
    return { addr, crossed: (base & 0xff00) !== (addr & 0xff00) };
  }
  private indX(): number { const zp = (this.read(this.pc++) + this.x) & 0xff; return this.read16zp(zp); }
  private indY(): { addr: number; crossed: boolean } {
    const zp = this.read(this.pc++);
    const base = this.read16zp(zp);
    const addr = (base + this.y) & 0xffff;
    return { addr, crossed: (base & 0xff00) !== (addr & 0xff00) };
  }

  private adc(m: number) {
    const carryIn = this.p & C ? 1 : 0;
    const bin = (this.a + m + carryIn) & 0xff;
    const binCarry = this.a + m + carryIn > 0xff;
    const binOverflow = ((this.a ^ bin) & (m ^ bin) & 0x80) !== 0;
    if (this.p & D) {
      let al = (this.a & 0x0f) + (m & 0x0f) + carryIn;
      if (al >= 0x0a) al = ((al + 0x06) & 0x0f) + 0x10;
      let full = (this.a & 0xf0) + (m & 0xf0) + al;
      if (full >= 0xa0) full += 0x60;
      this.setFlag(C, full >= 0x100);
      this.a = full & 0xff;
    } else {
      this.setFlag(C, binCarry);
      this.a = bin;
    }
    // N, V and Z always follow the binary sum: documented for decimal SBC's
    // flags, undocumented-but-deterministic for decimal ADC's N and V (see
    // the file header); in binary mode this is simply the ordinary result.
    this.setFlag(N, (bin & 0x80) !== 0);
    this.setFlag(V, binOverflow);
    this.setFlag(Z, bin === 0);
  }

  private sbc(m: number) {
    const carryIn = this.p & C ? 1 : 0;
    const compl = m ^ 0xff;
    const bin = (this.a + compl + carryIn) & 0xff;
    const binCarry = this.a + compl + carryIn > 0xff;
    const binOverflow = ((this.a ^ bin) & (compl ^ bin) & 0x80) !== 0;
    this.setFlag(C, binCarry);
    this.setFlag(N, (bin & 0x80) !== 0);
    this.setFlag(V, binOverflow);
    this.setFlag(Z, bin === 0);
    if (this.p & D) {
      let al = (this.a & 0x0f) - (m & 0x0f) + carryIn - 1;
      if (al < 0) al = ((al - 0x06) & 0x0f) - 0x10;
      let full = (this.a & 0xf0) - (m & 0xf0) + al;
      if (full < 0) full -= 0x60;
      this.a = full & 0xff;
    } else {
      this.a = bin;
    }
  }

  private cmp(reg: number, m: number) {
    const d = (reg - m) & 0x1ff;
    this.setFlag(C, reg >= m);
    this.setNZ(d & 0xff);
  }

  private branch(taken: boolean) {
    const offset = this.read(this.pc++);
    this.cycle += 2;
    if (!taken) return;
    const signed = offset & 0x80 ? offset - 0x100 : offset;
    const from = this.pc;
    this.pc = (this.pc + signed) & 0xffff;
    this.cycle += (from & 0xff00) !== (this.pc & 0xff00) ? 2 : 1;
  }

  private execute(op: number) {
    switch (op) {
      // --- Control
      case 0x00: { this.pc = (this.pc + 1) & 0xffff; this.dispatch(0xfffe, true); return; } // BRK
      case 0x40: { this.p = (this.pop() & ~B) | U; this.pc = this.pop() | (this.pop() << 8); this.cycle += 6; return; } // RTI
      case 0x4c: { this.pc = this.abs(); this.cycle += 3; return; } // JMP abs
      case 0x6c: { // JMP (ind): the famous page-wrap bug - the high byte is fetched from the low byte's page.
        const ptr = this.abs();
        const lo = this.read(ptr);
        const hi = this.read((ptr & 0xff00) | ((ptr + 1) & 0xff));
        this.pc = lo | (hi << 8);
        this.cycle += 5; return;
      }
      case 0x20: { const target = this.abs(); const ret = (this.pc - 1) & 0xffff; this.push(ret >> 8); this.push(ret & 0xff); this.pc = target; this.cycle += 6; return; } // JSR
      case 0x60: { this.pc = (this.pop() | (this.pop() << 8)) + 1; this.pc &= 0xffff; this.cycle += 6; return; } // RTS

      // --- Branches
      case 0x10: this.branch(!(this.p & N)); return; // BPL
      case 0x30: this.branch(!!(this.p & N)); return; // BMI
      case 0x50: this.branch(!(this.p & V)); return; // BVC
      case 0x70: this.branch(!!(this.p & V)); return; // BVS
      case 0x90: this.branch(!(this.p & C)); return; // BCC
      case 0xb0: this.branch(!!(this.p & C)); return; // BCS
      case 0xd0: this.branch(!(this.p & Z)); return; // BNE
      case 0xf0: this.branch(!!(this.p & Z)); return; // BEQ

      // --- Flags
      case 0x18: this.setFlag(C, false); this.cycle += 2; return; // CLC
      case 0x38: this.setFlag(C, true); this.cycle += 2; return; // SEC
      case 0x58: this.setFlag(I, false); this.cycle += 2; return; // CLI
      case 0x78: this.setFlag(I, true); this.cycle += 2; return; // SEI
      case 0xb8: this.setFlag(V, false); this.cycle += 2; return; // CLV
      case 0xd8: this.setFlag(D, false); this.cycle += 2; return; // CLD
      case 0xf8: this.setFlag(D, true); this.cycle += 2; return; // SED

      // --- Stack/registers
      case 0x08: this.push(this.p | U | B); this.cycle += 3; return; // PHP
      case 0x28: this.p = (this.pop() & ~B) | U; this.cycle += 4; return; // PLP
      case 0x48: this.push(this.a); this.cycle += 3; return; // PHA
      case 0x68: this.a = this.pop(); this.setNZ(this.a); this.cycle += 4; return; // PLA
      case 0xaa: this.x = this.a; this.setNZ(this.x); this.cycle += 2; return; // TAX
      case 0x8a: this.a = this.x; this.setNZ(this.a); this.cycle += 2; return; // TXA
      case 0xa8: this.y = this.a; this.setNZ(this.y); this.cycle += 2; return; // TAY
      case 0x98: this.a = this.y; this.setNZ(this.a); this.cycle += 2; return; // TYA
      case 0xba: this.x = this.s; this.setNZ(this.x); this.cycle += 2; return; // TSX
      case 0x9a: this.s = this.x; this.cycle += 2; return; // TXS (does not touch flags)
      case 0xc8: this.y = (this.y + 1) & 0xff; this.setNZ(this.y); this.cycle += 2; return; // INY
      case 0x88: this.y = (this.y - 1) & 0xff; this.setNZ(this.y); this.cycle += 2; return; // DEY
      case 0xe8: this.x = (this.x + 1) & 0xff; this.setNZ(this.x); this.cycle += 2; return; // INX
      case 0xca: this.x = (this.x - 1) & 0xff; this.setNZ(this.x); this.cycle += 2; return; // DEX
      case 0xea: this.cycle += 2; return; // NOP
    }

    // --- Everything with an addressing mode: grouped by column (bits 4-0,
    // i.e. the addressing-mode bits "bbb" plus the group selector "cc",
    // fix the mode across every row of the opcode matrix). A plain low
    // nibble (op & 0x0f) cannot tell col 0x01 (indX) from 0x11 (indY), or
    // 0x05 (zp) from 0x15 (zpx), since bit 4 is part of the mode, not the
    // column's identity - hence the wider 0x1f mask.
    const col = op & 0x1f;
    const load = (addr: number) => this.read(addr);
    // A "family" is one of the 8 opcode-matrix columns that repeats the same
    // eight base operations (ORA,AND,EOR,ADC,STA,LDA,CMP,SBC or the ASL-row
    // shift/illegal-RMW ones) across every addressing mode. `row` is which
    // of the eight (0-7) this opcode's high nibble selects, as an even
    // value (0,2,4,...,e); bit 4 (part of the addressing mode, not the
    // operation) is masked off so it does not perturb the row.
    const row = (op >> 4) & 0xe;

    switch (col) {
      case 0x01: { // (zp,x) / (zp),y depending on row parity; rows 0,2,4,6 use (zp,x) at col1 and (zp),y at col1 only for... actually columns 1 and 0x11 differ
        const addr = this.indX();
        this.groupOrLogical(row, addr, load(addr), false);
        this.cycle += 6;
        return;
      }
      case 0x11: {
        const { addr, crossed } = this.indY();
        const write = row === 0x8; // STA (zp),y never early-outs and costs a fixed 6
        this.groupOrLogical(row, addr, load(addr), true);
        this.cycle += write ? 6 : (5 + (crossed ? 1 : 0));
        return;
      }
      case 0x05: { const addr = this.zp(); this.groupOrLogical(row, addr, load(addr), false); this.cycle += 3; return; }
      case 0x15: { const addr = this.zpx(); this.groupOrLogical(row, addr, load(addr), false); this.cycle += 4; return; }
      case 0x09: { if (row === 0x8) throw new Error("STA has no immediate form"); const addr = this.imm(); this.groupOrLogical(row, addr, load(addr), false); this.cycle += 2; return; }
      case 0x0d: { const addr = this.abs(); this.groupOrLogical(row, addr, load(addr), false); this.cycle += 4; return; }
      case 0x19: {
        const { addr, crossed } = this.absIndexed(this.y);
        this.groupOrLogical(row, addr, load(addr), true);
        this.cycle += row === 0x8 ? 5 : (4 + (crossed ? 1 : 0));
        return;
      }
      case 0x1d: {
        const { addr, crossed } = this.absIndexed(this.x);
        this.groupOrLogical(row, addr, load(addr), true);
        this.cycle += row === 0x8 ? 5 : (4 + (crossed ? 1 : 0));
        return;
      }
    }

    this.executeRest(op);
  }

  /**
   * ORA/AND/EOR/ADC/STA/LDA/CMP/SBC (rows 0-7 of the opcode matrix's low
   * columns): the eight base operations every addressing-mode column repeats.
   * `write` marks the indexed/indirect-indexed forms, where STA's cost never
   * varies with a page cross (only loads early out).
   */
  private groupOrLogical(row: number, addr: number, value: number, _indexed: boolean) {
    switch (row) {
      case 0x0: this.a |= value; this.setNZ(this.a); return; // ORA
      case 0x2: this.a &= value; this.setNZ(this.a); return; // AND
      case 0x4: this.a ^= value; this.setNZ(this.a); return; // EOR
      case 0x6: this.adc(value); return; // ADC
      case 0x8: this.write(addr, this.a); return; // STA
      case 0xa: this.a = value; this.setNZ(this.a); return; // LDA
      case 0xc: this.cmp(this.a, value); return; // CMP
      case 0xe: this.sbc(value); return; // SBC
      default: throw new Error(`unreachable opcode row ${row.toString(16)}`);
    }
  }

  /** Everything not on the ORA..SBC columns: shifts, illegal RMW, loads/stores of X/Y, and the remaining illegals. */
  private executeRest(op: number) {
    switch (op) {
      // BIT
      case 0x24: { const addr = this.zp(); this.bit(this.read(addr)); this.cycle += 3; return; }
      case 0x2c: { const addr = this.abs(); this.bit(this.read(addr)); this.cycle += 4; return; }

      // ASL/ROL/LSR/ROR, accumulator and memory forms
      case 0x0a: this.a = this.shift("ASL", this.a); this.cycle += 2; return;
      case 0x2a: this.a = this.shift("ROL", this.a); this.cycle += 2; return;
      case 0x4a: this.a = this.shift("LSR", this.a); this.cycle += 2; return;
      case 0x6a: this.a = this.shift("ROR", this.a); this.cycle += 2; return;
      case 0x06: this.rmw(this.zp(), "ASL"); this.cycle += 5; return;
      case 0x26: this.rmw(this.zp(), "ROL"); this.cycle += 5; return;
      case 0x46: this.rmw(this.zp(), "LSR"); this.cycle += 5; return;
      case 0x66: this.rmw(this.zp(), "ROR"); this.cycle += 5; return;
      case 0x16: this.rmw(this.zpx(), "ASL"); this.cycle += 6; return;
      case 0x36: this.rmw(this.zpx(), "ROL"); this.cycle += 6; return;
      case 0x56: this.rmw(this.zpx(), "LSR"); this.cycle += 6; return;
      case 0x76: this.rmw(this.zpx(), "ROR"); this.cycle += 6; return;
      case 0x0e: this.rmw(this.abs(), "ASL"); this.cycle += 6; return;
      case 0x2e: this.rmw(this.abs(), "ROL"); this.cycle += 6; return;
      case 0x4e: this.rmw(this.abs(), "LSR"); this.cycle += 6; return;
      case 0x6e: this.rmw(this.abs(), "ROR"); this.cycle += 6; return;
      case 0x1e: this.rmw(this.absIndexed(this.x).addr, "ASL"); this.cycle += 7; return;
      case 0x3e: this.rmw(this.absIndexed(this.x).addr, "ROL"); this.cycle += 7; return;
      case 0x5e: this.rmw(this.absIndexed(this.x).addr, "LSR"); this.cycle += 7; return;
      case 0x7e: this.rmw(this.absIndexed(this.x).addr, "ROR"); this.cycle += 7; return;

      // INC/DEC
      case 0xe6: this.rmw(this.zp(), "INC"); this.cycle += 5; return;
      case 0xc6: this.rmw(this.zp(), "DEC"); this.cycle += 5; return;
      case 0xf6: this.rmw(this.zpx(), "INC"); this.cycle += 6; return;
      case 0xd6: this.rmw(this.zpx(), "DEC"); this.cycle += 6; return;
      case 0xee: this.rmw(this.abs(), "INC"); this.cycle += 6; return;
      case 0xce: this.rmw(this.abs(), "DEC"); this.cycle += 6; return;
      case 0xfe: this.rmw(this.absIndexed(this.x).addr, "INC"); this.cycle += 7; return;
      case 0xde: this.rmw(this.absIndexed(this.x).addr, "DEC"); this.cycle += 7; return;

      // LDX/STX
      case 0xa2: this.x = this.read(this.imm()); this.setNZ(this.x); this.cycle += 2; return;
      case 0xa6: this.x = this.read(this.zp()); this.setNZ(this.x); this.cycle += 3; return;
      case 0xb6: this.x = this.read(this.zpy()); this.setNZ(this.x); this.cycle += 4; return;
      case 0xae: this.x = this.read(this.abs()); this.setNZ(this.x); this.cycle += 4; return;
      case 0xbe: { const { addr, crossed } = this.absIndexed(this.y); this.x = this.read(addr); this.setNZ(this.x); this.cycle += 4 + (crossed ? 1 : 0); return; }
      case 0x86: this.write(this.zp(), this.x); this.cycle += 3; return;
      case 0x96: this.write(this.zpy(), this.x); this.cycle += 4; return;
      case 0x8e: this.write(this.abs(), this.x); this.cycle += 4; return;

      // LDY/STY
      case 0xa0: this.y = this.read(this.imm()); this.setNZ(this.y); this.cycle += 2; return;
      case 0xa4: this.y = this.read(this.zp()); this.setNZ(this.y); this.cycle += 3; return;
      case 0xb4: this.y = this.read(this.zpx()); this.setNZ(this.y); this.cycle += 4; return;
      case 0xac: this.y = this.read(this.abs()); this.setNZ(this.y); this.cycle += 4; return;
      case 0xbc: { const { addr, crossed } = this.absIndexed(this.x); this.y = this.read(addr); this.setNZ(this.y); this.cycle += 4 + (crossed ? 1 : 0); return; }
      case 0x84: this.write(this.zp(), this.y); this.cycle += 3; return;
      case 0x94: this.write(this.zpx(), this.y); this.cycle += 4; return;
      case 0x8c: this.write(this.abs(), this.y); this.cycle += 4; return;

      // CPX/CPY
      case 0xe0: this.cmp(this.x, this.read(this.imm())); this.cycle += 2; return;
      case 0xe4: this.cmp(this.x, this.read(this.zp())); this.cycle += 3; return;
      case 0xec: this.cmp(this.x, this.read(this.abs())); this.cycle += 4; return;
      case 0xc0: this.cmp(this.y, this.read(this.imm())); this.cycle += 2; return;
      case 0xc4: this.cmp(this.y, this.read(this.zp())); this.cycle += 3; return;
      case 0xcc: this.cmp(this.y, this.read(this.abs())); this.cycle += 4; return;

      default: this.executeIllegal(op);
    }
  }

  private bit(value: number) {
    this.setFlag(N, (value & 0x80) !== 0);
    this.setFlag(V, (value & 0x40) !== 0);
    this.setFlag(Z, (this.a & value) === 0);
  }

  private shift(kind: "ASL" | "ROL" | "LSR" | "ROR", value: number): number {
    let carryOut: boolean, result: number;
    switch (kind) {
      case "ASL": carryOut = (value & 0x80) !== 0; result = (value << 1) & 0xff; break;
      case "ROL": carryOut = (value & 0x80) !== 0; result = ((value << 1) | (this.p & C ? 1 : 0)) & 0xff; break;
      case "LSR": carryOut = (value & 0x01) !== 0; result = value >> 1; break;
      case "ROR": carryOut = (value & 0x01) !== 0; result = (value >> 1) | (this.p & C ? 0x80 : 0); break;
    }
    this.setFlag(C, carryOut);
    this.setNZ(result);
    return result;
  }

  /** Read-modify-write at a memory address: the shifts, INC/DEC, and the illegal SLO/RLA/SRE/RRA/DCP/ISC combine into this too. */
  private rmw(addr: number, op: "ASL" | "ROL" | "LSR" | "ROR" | "INC" | "DEC") {
    const value = this.read(addr);
    let result: number;
    if (op === "INC") result = (value + 1) & 0xff;
    else if (op === "DEC") result = (value - 1) & 0xff;
    else result = this.shift(op, value);
    this.write(addr, result);
    if (op === "INC" || op === "DEC") this.setNZ(result);
  }

  private executeIllegal(op: number) {
    // NOP variants: implied, immediate (reads and discards a byte) and the
    // zero-page/absolute forms (read and discard, at the addressed cost).
    const impliedNop = new Set([0x1a, 0x3a, 0x5a, 0x7a, 0xda, 0xfa]);
    const immNop = new Set([0x80, 0x82, 0x89, 0xc2, 0xe2]);
    const zpNop = new Set([0x04, 0x44, 0x64]);
    const zpxNop = new Set([0x14, 0x34, 0x54, 0x74, 0xd4, 0xf4]);
    const absxNop = new Set([0x1c, 0x3c, 0x5c, 0x7c, 0xdc, 0xfc]);
    if (impliedNop.has(op)) { this.cycle += 2; return; }
    if (immNop.has(op)) { this.imm(); this.cycle += 2; return; }
    if (op === 0x0c) { this.abs(); this.cycle += 4; return; }
    if (zpNop.has(op)) { this.zp(); this.cycle += 3; return; }
    if (zpxNop.has(op)) { this.zpx(); this.cycle += 4; return; }
    if (absxNop.has(op)) { const { crossed } = this.absIndexed(this.x); this.cycle += 4 + (crossed ? 1 : 0); return; }

    // SBC$EB: an exact duplicate of the documented 0xE9.
    if (op === 0xeb) { this.sbc(this.read(this.imm())); this.cycle += 2; return; }

    // ANC/AAC: AND #imm, then C and N both take bit 7 of the result (as if
    // the AND result were also latched onto the carry-out of an ASL it
    // never performs).
    if (op === 0x0b || op === 0x2b) { this.a &= this.read(this.imm()); this.setNZ(this.a); this.setFlag(C, (this.a & 0x80) !== 0); this.cycle += 2; return; }

    // ALR/ASR: AND #imm, then LSR the accumulator.
    if (op === 0x4b) { this.a &= this.read(this.imm()); this.a = this.shift("LSR", this.a); this.cycle += 2; return; }

    // ARR: AND #imm, then ROR with the carry-in feeding bit 7 (binary-mode
    // formula always; see the file header for the decimal-mode caveat).
    if (op === 0x6b) {
      const t = this.a & this.read(this.imm());
      this.a = (t >> 1) | (this.p & C ? 0x80 : 0);
      this.setNZ(this.a);
      this.setFlag(C, (t & 0x40) !== 0);
      this.setFlag(V, ((t >> 6) ^ (t >> 5)) & 1 ? true : false);
      this.cycle += 2;
      return;
    }

    // SBX/AXS: X = (A & X) - #imm, CMP-style flags, no decimal mode ever.
    if (op === 0xcb) {
      const m = this.read(this.imm());
      const t = this.a & this.x;
      this.setFlag(C, t >= m);
      this.x = (t - m) & 0xff;
      this.setNZ(this.x);
      this.cycle += 2;
      return;
    }

    // SAX/AXS: store A & X.
    if (op === 0x87) { this.write(this.zp(), this.a & this.x); this.cycle += 3; return; }
    if (op === 0x97) { this.write(this.zpy(), this.a & this.x); this.cycle += 4; return; }
    if (op === 0x8f) { this.write(this.abs(), this.a & this.x); this.cycle += 4; return; }
    if (op === 0x83) { this.write(this.indX(), this.a & this.x); this.cycle += 6; return; }

    // LAX: load A and X from memory together.
    if (op === 0xa7) { this.a = this.x = this.read(this.zp()); this.setNZ(this.a); this.cycle += 3; return; }
    if (op === 0xb7) { this.a = this.x = this.read(this.zpy()); this.setNZ(this.a); this.cycle += 4; return; }
    if (op === 0xaf) { this.a = this.x = this.read(this.abs()); this.setNZ(this.a); this.cycle += 4; return; }
    if (op === 0xa3) { this.a = this.x = this.read(this.indX()); this.setNZ(this.a); this.cycle += 6; return; }
    if (op === 0xb3) { const { addr, crossed } = this.indY(); this.a = this.x = this.read(addr); this.setNZ(this.a); this.cycle += 5 + (crossed ? 1 : 0); return; }
    if (op === 0xbf) { const { addr, crossed } = this.absIndexed(this.y); this.a = this.x = this.read(addr); this.setNZ(this.a); this.cycle += 4 + (crossed ? 1 : 0); return; }

    // LAS/LAR: A = X = S = memory & S. Deterministic (a plain AND), unlike
    // the bus-latch "unstable" family, so classified stable.
    if (op === 0xbb) { const { addr, crossed } = this.absIndexed(this.y); this.a = this.x = this.s = this.read(addr) & this.s; this.setNZ(this.a); this.cycle += 4 + (crossed ? 1 : 0); return; }

    // SLO/ASO, RLA, SRE/LSE, RRA: shift-or-rotate the memory operand, then
    // fold it into A with the matching logical/arithmetic op.
    const slo = (addr: number) => { const r = this.shift("ASL", this.read(addr)); this.write(addr, r); this.a |= r; this.setNZ(this.a); };
    const rla = (addr: number) => { const r = this.shift("ROL", this.read(addr)); this.write(addr, r); this.a &= r; this.setNZ(this.a); };
    const sre = (addr: number) => { const r = this.shift("LSR", this.read(addr)); this.write(addr, r); this.a ^= r; this.setNZ(this.a); };
    const rra = (addr: number) => { const r = this.shift("ROR", this.read(addr)); this.write(addr, r); this.adc(r); };
    const dcp = (addr: number) => { const r = (this.read(addr) - 1) & 0xff; this.write(addr, r); this.cmp(this.a, r); };
    const isc = (addr: number) => { const r = (this.read(addr) + 1) & 0xff; this.write(addr, r); this.sbc(r); };
    const forms: [Set<number>, (a: number) => void, number[]][] = [
      [new Set([0x07]), slo, [5]], [new Set([0x17]), slo, [6]], [new Set([0x0f]), slo, [6]],
      [new Set([0x1f]), slo, [7]], [new Set([0x03]), slo, [8]], [new Set([0x13]), slo, [8]], [new Set([0x1b]), slo, [7]],
      [new Set([0x27]), rla, [5]], [new Set([0x37]), rla, [6]], [new Set([0x2f]), rla, [6]],
      [new Set([0x3f]), rla, [7]], [new Set([0x23]), rla, [8]], [new Set([0x33]), rla, [8]], [new Set([0x3b]), rla, [7]],
      [new Set([0x47]), sre, [5]], [new Set([0x57]), sre, [6]], [new Set([0x4f]), sre, [6]],
      [new Set([0x5f]), sre, [7]], [new Set([0x43]), sre, [8]], [new Set([0x53]), sre, [8]], [new Set([0x5b]), sre, [7]],
      [new Set([0x67]), rra, [5]], [new Set([0x77]), rra, [6]], [new Set([0x6f]), rra, [6]],
      [new Set([0x7f]), rra, [7]], [new Set([0x63]), rra, [8]], [new Set([0x73]), rra, [8]], [new Set([0x7b]), rra, [7]],
      [new Set([0xc7]), dcp, [5]], [new Set([0xd7]), dcp, [6]], [new Set([0xcf]), dcp, [6]],
      [new Set([0xdf]), dcp, [7]], [new Set([0xc3]), dcp, [8]], [new Set([0xd3]), dcp, [8]], [new Set([0xdb]), dcp, [7]],
      [new Set([0xe7]), isc, [5]], [new Set([0xf7]), isc, [6]], [new Set([0xef]), isc, [6]],
      [new Set([0xff]), isc, [7]], [new Set([0xe3]), isc, [8]], [new Set([0xf3]), isc, [8]], [new Set([0xfb]), isc, [7]],
    ];
    for (const [ops, fn, [cost]] of forms) {
      if (!ops.has(op)) continue;
      const addr = this.addrForIllegalRmw(op);
      fn(addr);
      this.cycle += cost;
      return;
    }
    throw new Error(`Unimplemented opcode 0x${op.toString(16).padStart(2, "0")} at PC-1=0x${((this.pc - 1) & 0xffff).toString(16)}`);
  }

  /** The addressing mode an illegal RMW opcode's low nibble selects - the same shape SLO/RLA/SRE/RRA/DCP/ISC all share. */
  private addrForIllegalRmw(op: number): number {
    switch (op & 0x1f) {
      case 0x07: return this.zp();
      case 0x17: return this.zpx();
      case 0x0f: return this.abs();
      case 0x1f: return this.absIndexed(this.x).addr;
      case 0x1b: return this.absIndexed(this.y).addr;
      case 0x03: return this.indX();
      case 0x13: return this.indY().addr;
      default: throw new Error(`unreachable illegal RMW opcode 0x${op.toString(16)}`);
    }
  }
}
