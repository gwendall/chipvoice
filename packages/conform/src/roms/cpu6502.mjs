/**
 * A 6502, official opcodes, cycle-exact at the instruction level.
 *
 * A test fixture, not a product: the only reason it exists is to run blargg's
 * APU test ROMs against the chip, which check what the CPU can see of the APU
 * - length counters, the frame IRQ flag, the DMC - to the cycle. So the one
 * thing it has to get right is *when* a store or a load reaches the APU. On
 * the 6502 that is the instruction's last cycle, for every instruction that
 * reaches memory at all: the bus is ticked for every cycle before it, the
 * access is made, and the bus is ticked once more for the cycle it happened
 * on. Read-modify-write instructions read on their fourth cycle and write on
 * their last; nothing in these tests does that to a register.
 *
 * The bus is `{ read(addr), write(addr, value), tick(cycles) }`, and `tick`
 * is where the chip advances. Unofficial opcodes are treated as NOPs of the
 * documented length; the tests do not use them.
 */

const C = 0x01;
const Z = 0x02;
const I = 0x04;
const D = 0x08;
const B = 0x10;
const U = 0x20;
const V = 0x40;
const N = 0x80;

// Addressing modes: how many operand bytes, and how the effective address is
// found. `x` in a name means a page crossing costs a cycle on a read.
const IMP = 0, IMM = 1, ZP = 2, ZPX = 3, ZPY = 4, ABS = 5, ABX = 6, ABY = 7, IND = 8, IZX = 9, IZY = 10, REL = 11, ACC = 12;

/**
 * The opcode table, from the datasheet: [mnemonic, mode, base cycles].
 * Base cycles are for the read form; stores and RMW forms are fixed up in
 * `step`, and page-crossing penalties are added where the mode says so.
 */
const OPS = new Array(256).fill(null);
const def = (op, name, mode, cycles) => { OPS[op] = [name, mode, cycles]; };

// Loads and stores
def(0xa9, 'LDA', IMM, 2); def(0xa5, 'LDA', ZP, 3); def(0xb5, 'LDA', ZPX, 4); def(0xad, 'LDA', ABS, 4); def(0xbd, 'LDA', ABX, 4); def(0xb9, 'LDA', ABY, 4); def(0xa1, 'LDA', IZX, 6); def(0xb1, 'LDA', IZY, 5);
def(0xa2, 'LDX', IMM, 2); def(0xa6, 'LDX', ZP, 3); def(0xb6, 'LDX', ZPY, 4); def(0xae, 'LDX', ABS, 4); def(0xbe, 'LDX', ABY, 4);
def(0xa0, 'LDY', IMM, 2); def(0xa4, 'LDY', ZP, 3); def(0xb4, 'LDY', ZPX, 4); def(0xac, 'LDY', ABS, 4); def(0xbc, 'LDY', ABX, 4);
def(0x85, 'STA', ZP, 3); def(0x95, 'STA', ZPX, 4); def(0x8d, 'STA', ABS, 4); def(0x9d, 'STA', ABX, 5); def(0x99, 'STA', ABY, 5); def(0x81, 'STA', IZX, 6); def(0x91, 'STA', IZY, 6);
def(0x86, 'STX', ZP, 3); def(0x96, 'STX', ZPY, 4); def(0x8e, 'STX', ABS, 4);
def(0x84, 'STY', ZP, 3); def(0x94, 'STY', ZPX, 4); def(0x8c, 'STY', ABS, 4);
// Transfers and stack
def(0xaa, 'TAX', IMP, 2); def(0xa8, 'TAY', IMP, 2); def(0xba, 'TSX', IMP, 2); def(0x8a, 'TXA', IMP, 2); def(0x9a, 'TXS', IMP, 2); def(0x98, 'TYA', IMP, 2);
def(0x48, 'PHA', IMP, 3); def(0x08, 'PHP', IMP, 3); def(0x68, 'PLA', IMP, 4); def(0x28, 'PLP', IMP, 4);
// Arithmetic and logic
def(0x69, 'ADC', IMM, 2); def(0x65, 'ADC', ZP, 3); def(0x75, 'ADC', ZPX, 4); def(0x6d, 'ADC', ABS, 4); def(0x7d, 'ADC', ABX, 4); def(0x79, 'ADC', ABY, 4); def(0x61, 'ADC', IZX, 6); def(0x71, 'ADC', IZY, 5);
def(0xe9, 'SBC', IMM, 2); def(0xe5, 'SBC', ZP, 3); def(0xf5, 'SBC', ZPX, 4); def(0xed, 'SBC', ABS, 4); def(0xfd, 'SBC', ABX, 4); def(0xf9, 'SBC', ABY, 4); def(0xe1, 'SBC', IZX, 6); def(0xf1, 'SBC', IZY, 5);
def(0x29, 'AND', IMM, 2); def(0x25, 'AND', ZP, 3); def(0x35, 'AND', ZPX, 4); def(0x2d, 'AND', ABS, 4); def(0x3d, 'AND', ABX, 4); def(0x39, 'AND', ABY, 4); def(0x21, 'AND', IZX, 6); def(0x31, 'AND', IZY, 5);
def(0x09, 'ORA', IMM, 2); def(0x05, 'ORA', ZP, 3); def(0x15, 'ORA', ZPX, 4); def(0x0d, 'ORA', ABS, 4); def(0x1d, 'ORA', ABX, 4); def(0x19, 'ORA', ABY, 4); def(0x01, 'ORA', IZX, 6); def(0x11, 'ORA', IZY, 5);
def(0x49, 'EOR', IMM, 2); def(0x45, 'EOR', ZP, 3); def(0x55, 'EOR', ZPX, 4); def(0x4d, 'EOR', ABS, 4); def(0x5d, 'EOR', ABX, 4); def(0x59, 'EOR', ABY, 4); def(0x41, 'EOR', IZX, 6); def(0x51, 'EOR', IZY, 5);
def(0xc9, 'CMP', IMM, 2); def(0xc5, 'CMP', ZP, 3); def(0xd5, 'CMP', ZPX, 4); def(0xcd, 'CMP', ABS, 4); def(0xdd, 'CMP', ABX, 4); def(0xd9, 'CMP', ABY, 4); def(0xc1, 'CMP', IZX, 6); def(0xd1, 'CMP', IZY, 5);
def(0xe0, 'CPX', IMM, 2); def(0xe4, 'CPX', ZP, 3); def(0xec, 'CPX', ABS, 4);
def(0xc0, 'CPY', IMM, 2); def(0xc4, 'CPY', ZP, 3); def(0xcc, 'CPY', ABS, 4);
def(0x24, 'BIT', ZP, 3); def(0x2c, 'BIT', ABS, 4);
// Read-modify-write
def(0x0a, 'ASL', ACC, 2); def(0x06, 'ASL', ZP, 5); def(0x16, 'ASL', ZPX, 6); def(0x0e, 'ASL', ABS, 6); def(0x1e, 'ASL', ABX, 7);
def(0x4a, 'LSR', ACC, 2); def(0x46, 'LSR', ZP, 5); def(0x56, 'LSR', ZPX, 6); def(0x4e, 'LSR', ABS, 6); def(0x5e, 'LSR', ABX, 7);
def(0x2a, 'ROL', ACC, 2); def(0x26, 'ROL', ZP, 5); def(0x36, 'ROL', ZPX, 6); def(0x2e, 'ROL', ABS, 6); def(0x3e, 'ROL', ABX, 7);
def(0x6a, 'ROR', ACC, 2); def(0x66, 'ROR', ZP, 5); def(0x76, 'ROR', ZPX, 6); def(0x6e, 'ROR', ABS, 6); def(0x7e, 'ROR', ABX, 7);
def(0xe6, 'INC', ZP, 5); def(0xf6, 'INC', ZPX, 6); def(0xee, 'INC', ABS, 6); def(0xfe, 'INC', ABX, 7);
def(0xc6, 'DEC', ZP, 5); def(0xd6, 'DEC', ZPX, 6); def(0xce, 'DEC', ABS, 6); def(0xde, 'DEC', ABX, 7);
def(0xe8, 'INX', IMP, 2); def(0xc8, 'INY', IMP, 2); def(0xca, 'DEX', IMP, 2); def(0x88, 'DEY', IMP, 2);
// Flow
def(0x4c, 'JMP', ABS, 3); def(0x6c, 'JMP', IND, 5); def(0x20, 'JSR', ABS, 6); def(0x60, 'RTS', IMP, 6); def(0x40, 'RTI', IMP, 6); def(0x00, 'BRK', IMP, 7);
def(0x10, 'BPL', REL, 2); def(0x30, 'BMI', REL, 2); def(0x50, 'BVC', REL, 2); def(0x70, 'BVS', REL, 2); def(0x90, 'BCC', REL, 2); def(0xb0, 'BCS', REL, 2); def(0xd0, 'BNE', REL, 2); def(0xf0, 'BEQ', REL, 2);
// Flags and nothing
def(0x18, 'CLC', IMP, 2); def(0x38, 'SEC', IMP, 2); def(0x58, 'CLI', IMP, 2); def(0x78, 'SEI', IMP, 2); def(0xb8, 'CLV', IMP, 2); def(0xd8, 'CLD', IMP, 2); def(0xf8, 'SED', IMP, 2);
def(0xea, 'NOP', IMP, 2);

const STORES = new Set(['STA', 'STX', 'STY']);
const RMW = new Set(['ASL', 'LSR', 'ROL', 'ROR', 'INC', 'DEC']);

export class Cpu6502 {
  constructor(bus) {
    this.bus = bus;
    this.a = 0;
    this.x = 0;
    this.y = 0;
    this.s = 0xfd;
    this.p = I | U;
    this.pc = 0;
    /** Total cycles executed. */
    this.cycles = 0;
  }

  /** The reset sequence: seven cycles, then the vector. */
  reset() {
    this.s = 0xfd;
    this.p |= I;
    this.pc = this.read16(0xfffc);
    this.tick(7);
  }

  tick(n) {
    this.cycles += n;
    this.bus.tick(n);
  }

  read16(addr) {
    return this.bus.read(addr) | (this.bus.read((addr + 1) & 0xffff) << 8);
  }

  push(v) {
    this.bus.write(0x100 + this.s, v & 0xff);
    this.s = (this.s - 1) & 0xff;
  }

  pull() {
    this.s = (this.s + 1) & 0xff;
    return this.bus.read(0x100 + this.s);
  }

  setZN(v) {
    this.p = (this.p & ~(Z | N)) | (v === 0 ? Z : 0) | (v & N);
    return v;
  }

  /** An interrupt, taken between instructions when the I flag allows. */
  irq() {
    if (this.p & I) return false;
    this.push(this.pc >> 8);
    this.push(this.pc & 0xff);
    this.push((this.p | U) & ~B);
    this.p |= I;
    this.pc = this.read16(0xfffe);
    this.tick(7);
    return true;
  }

  /** One instruction. Returns the cycles it took. */
  step() {
    const bus = this.bus;
    const opcode = bus.read(this.pc);
    const entry = OPS[opcode];
    this.pc = (this.pc + 1) & 0xffff;
    if (!entry) {
      if (this.strict) throw new Error(`Unsupported 6502 opcode $${opcode.toString(16)} at $${((this.pc - 1) & 0xffff).toString(16)}`);
      // Unofficial: a NOP of the length its column implies. Rare here.
      const size = [1, 2, 2, 2, 1, 3, 3, 3][opcode & 7] ?? 1;
      this.pc = (this.pc + size - 1) & 0xffff;
      this.tick(2);
      return 2;
    }
    const [name, mode, base] = entry;
    let cycles = base;
    let addr = 0;
    let crossed = false;

    // The effective address. Operand fetches are plain memory reads of the
    // program, which never touch the APU, so they are not timed one by one.
    switch (mode) {
      case IMM: addr = this.pc; this.pc = (this.pc + 1) & 0xffff; break;
      case ZP: addr = bus.read(this.pc); this.pc = (this.pc + 1) & 0xffff; break;
      case ZPX: addr = (bus.read(this.pc) + this.x) & 0xff; this.pc = (this.pc + 1) & 0xffff; break;
      case ZPY: addr = (bus.read(this.pc) + this.y) & 0xff; this.pc = (this.pc + 1) & 0xffff; break;
      case ABS: addr = this.read16(this.pc); this.pc = (this.pc + 2) & 0xffff; break;
      case ABX: {
        const b = this.read16(this.pc); this.pc = (this.pc + 2) & 0xffff;
        addr = (b + this.x) & 0xffff; crossed = (b & 0xff00) !== (addr & 0xff00); break;
      }
      case ABY: {
        const b = this.read16(this.pc); this.pc = (this.pc + 2) & 0xffff;
        addr = (b + this.y) & 0xffff; crossed = (b & 0xff00) !== (addr & 0xff00); break;
      }
      case IND: {
        const p = this.read16(this.pc); this.pc = (this.pc + 2) & 0xffff;
        // The 6502's page-wrap bug on an indirect jump.
        const lo = bus.read(p);
        const hi = bus.read((p & 0xff00) | ((p + 1) & 0xff));
        addr = lo | (hi << 8); break;
      }
      case IZX: {
        const z = (bus.read(this.pc) + this.x) & 0xff; this.pc = (this.pc + 1) & 0xffff;
        addr = bus.read(z) | (bus.read((z + 1) & 0xff) << 8); break;
      }
      case IZY: {
        const z = bus.read(this.pc); this.pc = (this.pc + 1) & 0xffff;
        const b = bus.read(z) | (bus.read((z + 1) & 0xff) << 8);
        addr = (b + this.y) & 0xffff; crossed = (b & 0xff00) !== (addr & 0xff00); break;
      }
      case REL: {
        const off = bus.read(this.pc); this.pc = (this.pc + 1) & 0xffff;
        addr = (this.pc + (off < 0x80 ? off : off - 0x100)) & 0xffff; break;
      }
      default: break;
    }
    // A read across a page boundary costs a cycle; a store or RMW already
    // counts it in its base.
    if (crossed && !STORES.has(name) && !RMW.has(name)) cycles++;

    const load = () => {
      this.tick(cycles - 1);
      const v = bus.read(addr);
      this.tick(1);
      return v;
    };
    const store = (v) => {
      this.tick(cycles - 1);
      bus.write(addr, v & 0xff);
      this.tick(1);
    };
    const modify = (fn) => {
      if (mode === ACC) {
        this.a = fn(this.a);
        this.tick(cycles);
        return;
      }
      this.tick(cycles - 3);
      const v = bus.read(addr);
      this.tick(2);
      bus.write(addr, fn(v));
      this.tick(1);
    };
    const branch = (taken) => {
      if (!taken) { this.tick(2); return; }
      const cross = (this.pc & 0xff00) !== (addr & 0xff00);
      this.pc = addr;
      this.tick(cross ? 4 : 3);
    };
    const compare = (reg, v) => {
      const r = (reg - v) & 0x1ff;
      this.p = (this.p & ~C) | (reg >= v ? C : 0);
      this.setZN(r & 0xff);
    };

    switch (name) {
      case 'LDA': this.a = this.setZN(load()); break;
      case 'LDX': this.x = this.setZN(load()); break;
      case 'LDY': this.y = this.setZN(load()); break;
      case 'STA': store(this.a); break;
      case 'STX': store(this.x); break;
      case 'STY': store(this.y); break;
      case 'TAX': this.x = this.setZN(this.a); this.tick(2); break;
      case 'TAY': this.y = this.setZN(this.a); this.tick(2); break;
      case 'TSX': this.x = this.setZN(this.s); this.tick(2); break;
      case 'TXA': this.a = this.setZN(this.x); this.tick(2); break;
      case 'TXS': this.s = this.x; this.tick(2); break;
      case 'TYA': this.a = this.setZN(this.y); this.tick(2); break;
      case 'PHA': this.tick(2); this.push(this.a); this.tick(1); break;
      case 'PHP': this.tick(2); this.push(this.p | B | U); this.tick(1); break;
      case 'PLA': this.tick(3); this.a = this.setZN(this.pull()); this.tick(1); break;
      case 'PLP': this.tick(3); this.p = (this.pull() | U) & ~B; this.tick(1); break;
      case 'ADC': this.adc(load()); break;
      case 'SBC': this.adc(load() ^ 0xff); break;
      case 'AND': this.a = this.setZN(this.a & load()); break;
      case 'ORA': this.a = this.setZN(this.a | load()); break;
      case 'EOR': this.a = this.setZN(this.a ^ load()); break;
      case 'CMP': compare(this.a, load()); break;
      case 'CPX': compare(this.x, load()); break;
      case 'CPY': compare(this.y, load()); break;
      case 'BIT': {
        const v = load();
        this.p = (this.p & ~(Z | V | N)) | ((this.a & v) === 0 ? Z : 0) | (v & (V | N));
        break;
      }
      case 'ASL': modify((v) => { this.p = (this.p & ~C) | (v >> 7); return this.setZN((v << 1) & 0xff); }); break;
      case 'LSR': modify((v) => { this.p = (this.p & ~C) | (v & 1); return this.setZN(v >> 1); }); break;
      case 'ROL': modify((v) => { const c = this.p & C; this.p = (this.p & ~C) | (v >> 7); return this.setZN(((v << 1) | c) & 0xff); }); break;
      case 'ROR': modify((v) => { const c = this.p & C; this.p = (this.p & ~C) | (v & 1); return this.setZN((v >> 1) | (c << 7)); }); break;
      case 'INC': modify((v) => this.setZN((v + 1) & 0xff)); break;
      case 'DEC': modify((v) => this.setZN((v - 1) & 0xff)); break;
      case 'INX': this.x = this.setZN((this.x + 1) & 0xff); this.tick(2); break;
      case 'INY': this.y = this.setZN((this.y + 1) & 0xff); this.tick(2); break;
      case 'DEX': this.x = this.setZN((this.x - 1) & 0xff); this.tick(2); break;
      case 'DEY': this.y = this.setZN((this.y - 1) & 0xff); this.tick(2); break;
      case 'JMP': this.pc = addr; this.tick(cycles); break;
      case 'JSR': {
        const ret = (this.pc - 1) & 0xffff;
        this.tick(3);
        this.push(ret >> 8);
        this.push(ret & 0xff);
        this.pc = addr;
        this.tick(3);
        break;
      }
      case 'RTS': {
        this.tick(4);
        const lo = this.pull();
        const hi = this.pull();
        this.pc = ((lo | (hi << 8)) + 1) & 0xffff;
        this.tick(2);
        break;
      }
      case 'RTI': {
        this.tick(3);
        this.p = (this.pull() | U) & ~B;
        const lo = this.pull();
        const hi = this.pull();
        this.pc = lo | (hi << 8);
        this.tick(3);
        break;
      }
      case 'BRK': {
        const ret = (this.pc + 1) & 0xffff;
        this.tick(3);
        this.push(ret >> 8);
        this.push(ret & 0xff);
        this.push(this.p | B | U);
        this.p |= I;
        this.pc = this.read16(0xfffe);
        this.tick(4);
        break;
      }
      case 'BPL': branch(!(this.p & N)); break;
      case 'BMI': branch(!!(this.p & N)); break;
      case 'BVC': branch(!(this.p & V)); break;
      case 'BVS': branch(!!(this.p & V)); break;
      case 'BCC': branch(!(this.p & C)); break;
      case 'BCS': branch(!!(this.p & C)); break;
      case 'BNE': branch(!(this.p & Z)); break;
      case 'BEQ': branch(!!(this.p & Z)); break;
      case 'CLC': this.p &= ~C; this.tick(2); break;
      case 'SEC': this.p |= C; this.tick(2); break;
      case 'CLI': this.p &= ~I; this.tick(2); break;
      case 'SEI': this.p |= I; this.tick(2); break;
      case 'CLV': this.p &= ~V; this.tick(2); break;
      case 'CLD': this.p &= ~D; this.tick(2); break;
      case 'SED': this.p |= D; this.tick(2); break;
      case 'NOP': this.tick(2); break;
      default: this.tick(cycles); break;
    }
    return cycles;
  }

  /** Binary only: the 2A03 has no decimal mode. */
  adc(v) {
    const sum = this.a + v + (this.p & C);
    const r = sum & 0xff;
    this.p = (this.p & ~(C | V)) | (sum > 0xff ? C : 0) | (~(this.a ^ v) & (this.a ^ r) & 0x80 ? V : 0);
    this.a = this.setZN(r);
  }
}
