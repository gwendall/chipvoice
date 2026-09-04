/**
 * The Game Boy's CPU, the Sharp SM83, cycle-exact at the instruction level.
 *
 * A test fixture, like the 6502 next to it: it exists to run blargg's
 * dmg_sound ROMs against the chip, and the one thing it has to get right is
 * when a load or a store reaches the APU. That is the instruction's last
 * machine cycle, four T-cycles; the bus is ticked for the cycles before it,
 * the access is made, and the bus is ticked once more. Read-modify-write on
 * (HL) reads on the second-to-last and writes on the last.
 *
 * The bus is `{ read(addr), write(addr, value), tick(tCycles), interrupts() }`,
 * where `interrupts()` returns the pending, enabled interrupt bits. Every
 * opcode is here, including the CB prefix; there are no unofficial ones.
 */

const Z = 0x80;
const N = 0x40;
const H = 0x20;
const C = 0x10;

export class Sm83 {
  constructor(bus) {
    this.bus = bus;
    // After the boot ROM, on a DMG.
    this.a = 0x01;
    this.f = 0xb0;
    this.b = 0x00;
    this.c = 0x13;
    this.d = 0x00;
    this.e = 0xd8;
    this.h = 0x01;
    this.l = 0x4d;
    this.sp = 0xfffe;
    this.pc = 0x0100;
    this.ime = false;
    this.imePending = false;
    this.halted = false;
    /** T-cycles executed. */
    this.cycles = 0;
  }

  tick(t) {
    this.cycles += t;
    this.bus.tick(t);
  }

  get bc() { return (this.b << 8) | this.c; }
  set bc(v) { this.b = (v >> 8) & 0xff; this.c = v & 0xff; }
  get de() { return (this.d << 8) | this.e; }
  set de(v) { this.d = (v >> 8) & 0xff; this.e = v & 0xff; }
  get hl() { return (this.h << 8) | this.l; }
  set hl(v) { this.h = (v >> 8) & 0xff; this.l = v & 0xff; }
  get af() { return (this.a << 8) | this.f; }
  set af(v) { this.a = (v >> 8) & 0xff; this.f = v & 0xf0; }

  flags(z, n, h, c) {
    this.f = (z ? Z : 0) | (n ? N : 0) | (h ? H : 0) | (c ? C : 0);
  }

  fetch() {
    const v = this.bus.read(this.pc);
    this.pc = (this.pc + 1) & 0xffff;
    return v;
  }

  fetch16() {
    const lo = this.fetch();
    return lo | (this.fetch() << 8);
  }

  push16(v) {
    this.sp = (this.sp - 1) & 0xffff;
    this.bus.write(this.sp, (v >> 8) & 0xff);
    this.sp = (this.sp - 1) & 0xffff;
    this.bus.write(this.sp, v & 0xff);
  }

  pop16() {
    const lo = this.bus.read(this.sp);
    this.sp = (this.sp + 1) & 0xffff;
    const hi = this.bus.read(this.sp);
    this.sp = (this.sp + 1) & 0xffff;
    return lo | (hi << 8);
  }

  /** r[z] of the decoding tables: B C D E H L (HL) A. */
  getR(i) {
    switch (i) {
      case 0: return this.b;
      case 1: return this.c;
      case 2: return this.d;
      case 3: return this.e;
      case 4: return this.h;
      case 5: return this.l;
      case 6: return this.bus.read(this.hl);
      default: return this.a;
    }
  }

  setR(i, v) {
    v &= 0xff;
    switch (i) {
      case 0: this.b = v; break;
      case 1: this.c = v; break;
      case 2: this.d = v; break;
      case 3: this.e = v; break;
      case 4: this.h = v; break;
      case 5: this.l = v; break;
      case 6: this.bus.write(this.hl, v); break;
      default: this.a = v; break;
    }
  }

  getRp(p) {
    return [this.bc, this.de, this.hl, this.sp][p];
  }

  setRp(p, v) {
    v &= 0xffff;
    if (p === 0) this.bc = v;
    else if (p === 1) this.de = v;
    else if (p === 2) this.hl = v;
    else this.sp = v;
  }

  cc(y) {
    switch (y & 3) {
      case 0: return !(this.f & Z);
      case 1: return !!(this.f & Z);
      case 2: return !(this.f & C);
      default: return !!(this.f & C);
    }
  }

  alu(op, v) {
    const a = this.a;
    const c = this.f & C ? 1 : 0;
    switch (op) {
      case 0: { const r = a + v; this.flags((r & 0xff) === 0, 0, (a & 15) + (v & 15) > 15, r > 0xff); this.a = r & 0xff; break; }
      case 1: { const r = a + v + c; this.flags((r & 0xff) === 0, 0, (a & 15) + (v & 15) + c > 15, r > 0xff); this.a = r & 0xff; break; }
      case 2: { const r = a - v; this.flags((r & 0xff) === 0, 1, (a & 15) < (v & 15), r < 0); this.a = r & 0xff; break; }
      case 3: { const r = a - v - c; this.flags((r & 0xff) === 0, 1, (a & 15) < (v & 15) + c, r < 0); this.a = r & 0xff; break; }
      case 4: this.a = a & v; this.flags(this.a === 0, 0, 1, 0); break;
      case 5: this.a = a ^ v; this.flags(this.a === 0, 0, 0, 0); break;
      case 6: this.a = a | v; this.flags(this.a === 0, 0, 0, 0); break;
      default: { const r = a - v; this.flags((r & 0xff) === 0, 1, (a & 15) < (v & 15), r < 0); break; }
    }
  }

  rot(op, v) {
    const c = this.f & C ? 1 : 0;
    let r;
    let carry;
    switch (op) {
      case 0: carry = v >> 7; r = ((v << 1) | carry) & 0xff; break;
      case 1: carry = v & 1; r = (v >> 1) | (carry << 7); break;
      case 2: carry = v >> 7; r = ((v << 1) | c) & 0xff; break;
      case 3: carry = v & 1; r = (v >> 1) | (c << 7); break;
      case 4: carry = v >> 7; r = (v << 1) & 0xff; break;
      case 5: carry = v & 1; r = (v >> 1) | (v & 0x80); break;
      case 6: carry = 0; r = ((v << 4) | (v >> 4)) & 0xff; break;
      default: carry = v & 1; r = v >> 1; break;
    }
    this.flags(r === 0, 0, 0, carry);
    return r;
  }

  /** Takes an interrupt if one is pending and enabled: five machine cycles. */
  interrupt() {
    const pending = this.bus.interrupts();
    if (pending === 0) return false;
    this.halted = false;
    if (!this.ime) return false;
    const bit = pending & -pending;
    const index = Math.log2(bit);
    this.ime = false;
    this.bus.acknowledge(bit);
    this.tick(8);
    this.push16(this.pc);
    this.pc = 0x40 + index * 8;
    this.tick(12);
    return true;
  }

  /** One instruction. Returns T-cycles. */
  step() {
    if (this.imePending) {
      this.imePending = false;
      this.ime = true;
    }
    if (this.halted) {
      this.tick(4);
      return 4;
    }
    const bus = this.bus;
    const op = this.fetch();
    const x = op >> 6;
    const y = (op >> 3) & 7;
    const z = op & 7;
    const p = y >> 1;
    const q = y & 1;
    const before = this.cycles;

    // A load or store whose one memory access is on the last machine cycle.
    const load = (m, addr) => { this.tick(m * 4 - 4); const v = bus.read(addr); this.tick(4); return v; };
    const store = (m, addr, v) => { this.tick(m * 4 - 4); bus.write(addr, v & 0xff); this.tick(4); };

    if (x === 0) {
      switch (z) {
        case 0:
          if (y === 0) this.tick(4);
          else if (y === 1) { const nn = this.fetch16(); this.tick(12); bus.write(nn, this.sp & 0xff); bus.write((nn + 1) & 0xffff, this.sp >> 8); this.tick(8); }
          else if (y === 2) { this.fetch(); this.tick(4); }
          else {
            const d = this.fetch(); const off = d < 0x80 ? d : d - 0x100;
            if (y === 3 || this.cc(y - 4)) { this.pc = (this.pc + off) & 0xffff; this.tick(12); } else this.tick(8);
          }
          break;
        case 1:
          if (q === 0) { this.setRp(p, this.fetch16()); this.tick(12); }
          else { const hl = this.hl; const v = this.getRp(p); const r = hl + v; this.f = (this.f & Z) | ((hl & 0xfff) + (v & 0xfff) > 0xfff ? H : 0) | (r > 0xffff ? C : 0); this.hl = r; this.tick(8); }
          break;
        case 2: {
          const addr = p === 0 ? this.bc : p === 1 ? this.de : this.hl;
          if (q === 0) store(2, addr, this.a);
          else this.a = load(2, addr);
          if (p === 2) this.hl = this.hl + 1;
          else if (p === 3) this.hl = this.hl - 1;
          break;
        }
        case 3: this.setRp(p, this.getRp(p) + (q === 0 ? 1 : -1)); this.tick(8); break;
        case 4: case 5: {
          const inc = z === 4;
          if (y === 6) {
            this.tick(4);
            const v = bus.read(this.hl);
            this.tick(4);
            const r = (v + (inc ? 1 : -1)) & 0xff;
            this.f = (this.f & C) | (r === 0 ? Z : 0) | (inc ? 0 : N) | ((inc ? (v & 15) === 15 : (v & 15) === 0) ? H : 0);
            bus.write(this.hl, r);
            this.tick(4);
          } else {
            const v = this.getR(y);
            const r = (v + (inc ? 1 : -1)) & 0xff;
            this.f = (this.f & C) | (r === 0 ? Z : 0) | (inc ? 0 : N) | ((inc ? (v & 15) === 15 : (v & 15) === 0) ? H : 0);
            this.setR(y, r);
            this.tick(4);
          }
          break;
        }
        case 6: {
          const n = this.fetch();
          if (y === 6) store(3, this.hl, n);
          else { this.setR(y, n); this.tick(8); }
          break;
        }
        default:
          switch (y) {
            case 0: this.a = this.rot(0, this.a); this.f &= ~Z; break;
            case 1: this.a = this.rot(1, this.a); this.f &= ~Z; break;
            case 2: this.a = this.rot(2, this.a); this.f &= ~Z; break;
            case 3: this.a = this.rot(3, this.a); this.f &= ~Z; break;
            case 4: {
              let a = this.a; let c = this.f & C ? 1 : 0;
              if (!(this.f & N)) { if (this.f & H || (a & 15) > 9) a += 6; if (c || a > 0x9f) { a += 0x60; c = 1; } }
              else { if (this.f & H) a = (a - 6) & 0xff; if (c) a -= 0x60; }
              this.a = a & 0xff; this.f = (this.f & N) | (this.a === 0 ? Z : 0) | (c ? C : 0);
              break;
            }
            case 5: this.a ^= 0xff; this.f |= N | H; break;
            case 6: this.f = (this.f & Z) | C; break;
            default: this.f = (this.f & Z) | (this.f & C ? 0 : C); break;
          }
          this.tick(4);
          break;
      }
    } else if (x === 1) {
      if (op === 0x76) { this.halted = true; this.tick(4); }
      else if (y === 6) store(2, this.hl, this.getR(z));
      else if (z === 6) this.setR(y, load(2, this.hl));
      else { this.setR(y, this.getR(z)); this.tick(4); }
    } else if (x === 2) {
      if (z === 6) { this.alu(y, load(2, this.hl)); }
      else { this.alu(y, this.getR(z)); this.tick(4); }
    } else {
      switch (z) {
        case 0:
          if (y < 4) { if (this.cc(y)) { this.tick(12); this.pc = this.pop16(); this.tick(8); } else this.tick(8); }
          else if (y === 4) { const n = this.fetch(); store(3, 0xff00 + n, this.a); }
          else if (y === 5) { const d = this.fetch(); const off = d < 0x80 ? d : d - 0x100; const r = (this.sp + off) & 0xffff; this.flags(0, 0, (this.sp & 15) + (d & 15) > 15, (this.sp & 0xff) + d > 0xff); this.sp = r; this.tick(16); }
          else if (y === 6) { const n = this.fetch(); this.a = load(3, 0xff00 + n); }
          else { const d = this.fetch(); const off = d < 0x80 ? d : d - 0x100; const r = (this.sp + off) & 0xffff; this.flags(0, 0, (this.sp & 15) + (d & 15) > 15, (this.sp & 0xff) + d > 0xff); this.hl = r; this.tick(12); }
          break;
        case 1:
          if (q === 0) { const v = this.pop16(); if (p === 3) this.af = v; else this.setRp(p, v); this.tick(12); }
          else if (p === 0) { this.tick(4); this.pc = this.pop16(); this.tick(12); }
          else if (p === 1) { this.tick(4); this.pc = this.pop16(); this.ime = true; this.tick(12); }
          else if (p === 2) { this.pc = this.hl; this.tick(4); }
          else { this.sp = this.hl; this.tick(8); }
          break;
        case 2:
          if (y < 4) { const nn = this.fetch16(); if (this.cc(y)) { this.pc = nn; this.tick(16); } else this.tick(12); }
          else if (y === 4) store(2, 0xff00 + this.c, this.a);
          else if (y === 5) { const nn = this.fetch16(); store(4, nn, this.a); }
          else if (y === 6) this.a = load(2, 0xff00 + this.c);
          else { const nn = this.fetch16(); this.a = load(4, nn); }
          break;
        case 3:
          if (y === 0) { this.pc = this.fetch16(); this.tick(16); }
          else if (y === 1) this.cb();
          else if (y === 6) { this.ime = false; this.imePending = false; this.tick(4); }
          else if (y === 7) { this.imePending = true; this.tick(4); }
          else this.tick(4);
          break;
        case 4: {
          const nn = this.fetch16();
          if (y < 4 && this.cc(y)) { this.tick(12); this.push16(this.pc); this.pc = nn; this.tick(12); }
          else this.tick(12);
          break;
        }
        case 5:
          if (q === 0) { this.tick(8); this.push16(p === 3 ? this.af : this.getRp(p)); this.tick(8); }
          else { const nn = this.fetch16(); this.tick(12); this.push16(this.pc); this.pc = nn; this.tick(12); }
          break;
        case 6: { const n = this.fetch(); this.alu(y, n); this.tick(8); break; }
        default: this.tick(8); this.push16(this.pc); this.pc = y * 8; this.tick(8); break;
      }
    }
    return this.cycles - before;
  }

  /** The CB prefix: rotates and shifts, then BIT, RES, SET. */
  cb() {
    const op = this.fetch();
    const x = op >> 6;
    const y = (op >> 3) & 7;
    const z = op & 7;
    const bus = this.bus;
    if (z === 6) {
      // (HL): read on the second-to-last cycle, write on the last.
      this.tick(4);
      const v = bus.read(this.hl);
      if (x === 1) {
        this.f = (this.f & C) | (v & (1 << y) ? 0 : Z) | H;
        this.tick(8);
        return;
      }
      this.tick(4);
      let r;
      if (x === 0) r = this.rot(y, v);
      else if (x === 2) r = v & ~(1 << y);
      else r = v | (1 << y);
      bus.write(this.hl, r);
      this.tick(4);
      return;
    }
    const v = this.getR(z);
    if (x === 0) this.setR(z, this.rot(y, v));
    else if (x === 1) this.f = (this.f & C) | (v & (1 << y) ? 0 : Z) | H;
    else if (x === 2) this.setR(z, v & ~(1 << y));
    else this.setR(z, v | (1 << y));
    this.tick(8);
  }
}
