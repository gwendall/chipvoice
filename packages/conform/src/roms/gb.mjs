import { gbChip } from 'chipvoice';
import { Sm83 } from './sm83.mjs';

/**
 * Enough of a Game Boy to run blargg's dmg_sound ROMs: an SM83, a 32 KiB ROM
 * with no mapper, video RAM the tests print into, external RAM at `$A000`
 * where they write their result, work RAM and its echo, high RAM, the
 * divider and the timer, a line counter for the vertical blank, and the chip
 * on `$FF10-$FF3F`.
 *
 * Power-on is what the boot ROM leaves: the CPU's registers as it hands them
 * over, the APU on with its first pulse having played the chime, the divider
 * where the boot ROM's timing puts it.
 */
const T_PER_LINE = 456;
const LINES = 154;

export class GameBoy {
  /** @param {Uint8Array} rom */
  constructor(rom) {
    this.rom = rom;
    this.vram = new Uint8Array(0x2000);
    this.eram = new Uint8Array(0x2000);
    this.wram = new Uint8Array(0x2000);
    this.oam = new Uint8Array(0xa0);
    this.hram = new Uint8Array(0x7f);
    this.io = new Uint8Array(0x80);
    this.ie = 0;
    this.if = 0;
    this.chip = gbChip.digital();
    this.cpu = new Sm83(this);
    this.tCycles = 0;
    this.timerCycles = 0;
    /** Every APU register write, stamped with its T-cycle. */
    this.log = [];
  }

  powerOn() {
    // The boot ROM's chime leaves the APU like this.
    for (const [addr, value] of [[0xff26, 0x80], [0xff25, 0xf3], [0xff24, 0x77], [0xff10, 0x80], [0xff11, 0xbf], [0xff12, 0xf3], [0xff14, 0xbf], [0xff17, 0x3f], [0xff1a, 0x7f], [0xff1c, 0x9f], [0xff21, 0x00], [0xff22, 0x00]]) {
      this.chip.write(addr, value);
    }
    // The divider as the boot ROM hands it over.
    for (let i = 0; i < 0xabcc; i++) this.chip.clockT();
    this.io[0x00] = 0xcf;
    this.io[0x40] = 0x91;
  }

  tick(t) {
    for (let i = 0; i < t; i++) {
      this.chip.step();
      this.tCycles++;
      this.timerTick();
    }
  }

  /** TIMA at the rate TAC picks, and the overflow interrupt. */
  timerTick() {
    const tac = this.io[0x07];
    if (!(tac & 0x04)) return;
    const divisor = [1024, 16, 64, 256][tac & 3];
    if (++this.timerCycles < divisor) return;
    this.timerCycles = 0;
    if (this.io[0x05] === 0xff) {
      this.io[0x05] = this.io[0x06];
      this.if |= 0x04;
    } else this.io[0x05]++;
  }

  interrupts() {
    return this.ie & this.if & 0x1f;
  }

  acknowledge(bit) {
    this.if &= ~bit;
  }

  read(addr) {
    addr &= 0xffff;
    if (addr < 0x8000) return this.rom[addr & 0x7fff] ?? 0xff;
    if (addr < 0xa000) return this.vram[addr - 0x8000];
    if (addr < 0xc000) return this.eram[addr - 0xa000];
    if (addr < 0xe000) return this.wram[addr - 0xc000];
    if (addr < 0xfe00) return this.wram[addr - 0xe000];
    if (addr < 0xfea0) return this.oam[addr - 0xfe00];
    if (addr < 0xff00) return 0xff;
    if (addr === 0xffff) return this.ie;
    if (addr >= 0xff80) return this.hram[addr - 0xff80];
    if (addr >= 0xff10 && addr <= 0xff3f) return this.chip.read(addr);
    const reg = addr & 0x7f;
    switch (reg) {
      case 0x04: return (this.tCycles >> 8) & 0xff;
      case 0x0f: return this.if | 0xe0;
      case 0x44: return Math.floor(this.tCycles / T_PER_LINE) % LINES;
      case 0x41: {
        const line = Math.floor(this.tCycles / T_PER_LINE) % LINES;
        const dot = this.tCycles % T_PER_LINE;
        const mode = line >= 144 ? 1 : dot < 80 ? 2 : dot < 252 ? 3 : 0;
        return 0x80 | (this.io[0x41] & 0x78) | mode;
      }
      default: return this.io[reg];
    }
  }

  write(addr, value) {
    addr &= 0xffff;
    value &= 0xff;
    if (addr < 0x8000) return;
    if (addr < 0xa000) { this.vram[addr - 0x8000] = value; return; }
    if (addr < 0xc000) { this.eram[addr - 0xa000] = value; return; }
    if (addr < 0xe000) { this.wram[addr - 0xc000] = value; return; }
    if (addr < 0xfe00) { this.wram[addr - 0xe000] = value; return; }
    if (addr < 0xfea0) { this.oam[addr - 0xfe00] = value; return; }
    if (addr < 0xff00) return;
    if (addr === 0xffff) { this.ie = value; return; }
    if (addr >= 0xff80) { this.hram[addr - 0xff80] = value; return; }
    if (addr >= 0xff10 && addr <= 0xff3f) {
      this.log.push({ at: this.tCycles, addr, value });
      this.chip.write(addr, value);
      return;
    }
    const reg = addr & 0x7f;
    if (reg === 0x04) {
      // A write to DIV resets it, and the APU's frame sequencer follows it.
      this.tCycles -= this.tCycles & 0xffff;
      this.chip.resetDivider();
      return;
    }
    if (reg === 0x0f) { this.if = value & 0x1f; return; }
    this.io[reg] = value;
  }

  /** blargg's protocol at `$A000`: signature, status, text. */
  result() {
    const e = this.eram;
    const valid = e[1] === 0xde && e[2] === 0xb0 && e[3] === 0x61;
    let text = '';
    for (let i = 4; i < e.length && e[i] !== 0; i++) text += String.fromCharCode(e[i]);
    return { valid, status: e[0], text: text.trim() };
  }

  /** True when the program has parked itself in a jump to its own address. */
  halted() {
    const pc = this.cpu.pc;
    return this.read(pc) === 0xc3 && (this.read(pc + 1) | (this.read(pc + 2) << 8)) === pc;
  }

  /** Runs `t` T-cycles of program, taking interrupts between instructions. */
  run(t) {
    const until = this.cpu.cycles + t;
    while (this.cpu.cycles < until) {
      if (!this.cpu.interrupt()) this.cpu.step();
    }
  }
}
