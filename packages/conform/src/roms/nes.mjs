import { nesChip } from 'chipvoice';
import { Cpu6502 } from './cpu6502.mjs';

/**
 * Enough of a NES to run blargg's APU test ROMs: a 6502, 2 KiB of RAM, 8 KiB
 * of work RAM at `$6000` where the newer tests write their result, the
 * program at `$8000`, a PPU that raises a vertical-blank flag sixty times a
 * second and keeps what is written to its first name table so the older
 * tests' screen can be read back as text, and the chip on `$4000-$4017`.
 *
 * What the tests read is `$4015` - length counters, the DMC's bytes, the two
 * interrupt flags - and what they feel is the frame IRQ and the DMC IRQ on
 * the CPU's interrupt line. Both come from the chip; this only wires them.
 *
 * Power-on is, as blargg measured it, as if `$00` had been written to
 * `$4017` and then the CPU started nine to twelve cycles later. The chip
 * powers on at cycle 0 in that state; the CPU's seven-cycle reset sequence
 * and a few cycles of nothing put its first instruction there.
 */
const NTSC_FRAME = 29781;
const VBLANK_START = 27394;

export class Nes {
  /** @param {Uint8Array} rom an iNES file, mapper 0 */
  constructor(rom) {
    if (String.fromCharCode(...rom.subarray(0, 3)) !== 'NES' || rom[3] !== 0x1a) throw new Error('not an iNES file');
    const prgBanks = rom[4];
    const trainer = rom[6] & 0x04 ? 512 : 0;
    this.prg = rom.subarray(16 + trainer, 16 + trainer + prgBanks * 16384);
    this.prgMask = prgBanks === 1 ? 0x3fff : 0x7fff;
    this.ram = new Uint8Array(0x800);
    this.wram = new Uint8Array(0x2000);
    this.chip = nesChip.digital();
    this.chip.load(0x8000, this.prg.subarray(0, Math.min(this.prg.length, 0x8000)));
    if (prgBanks === 1) this.chip.load(0xc000, this.prg);
    this.vblank = false;
    this.frameCycle = 0;
    this.cpu = new Cpu6502(this);
    this.lastBus = 0;
    // The PPU, as far as text goes: the control register for the address
    // increment, the address latch, and the name table the tests print to.
    this.ppuControl = 0;
    this.ppuAddress = 0;
    this.ppuLatch = false;
    this.nametable = new Uint8Array(0x800);
    /** Cycles at which pulse 1 started an audible note: blargg's beeps. */
    this.beeps = [];
    this.pulseLow = 0;
    /** Every register write, stamped with its cycle: a ROM as a corpus log. */
    this.log = [];
  }

  /**
   * Power on: the chip at cycle 0 as if `$00` had just been written to
   * `$4017`, the CPU's first instruction after its seven-cycle reset sequence.
   * blargg's `4017_timing` measures that gap and wants nine to twelve.
   */
  powerOn() {
    this.chip.write(0x4017, 0x00);
    this.chip.write(0x4015, 0x00);
    this.cpu.reset();
    this.tick(3);
  }

  /** The reset button: the chip's reset line, then the CPU's. */
  reset() {
    this.chip.resetButton();
    this.cpu.reset();
    this.tick(3);
  }

  tick(cycles) {
    for (let i = 0; i < cycles; i++) {
      this.chip.step();
      this.frameCycle++;
      if (this.frameCycle === VBLANK_START) this.vblank = true;
      if (this.frameCycle >= NTSC_FRAME) this.frameCycle = 0;
    }
  }

  read(addr) {
    addr &= 0xffff;
    let v;
    if (addr < 0x2000) v = this.ram[addr & 0x7ff];
    else if (addr < 0x4000) {
      if ((addr & 7) === 2) {
        v = this.vblank ? 0x80 : 0x00;
        this.vblank = false;
      } else v = 0;
    } else if (addr === 0x4015) v = this.chip.readStatus();
    else if (addr < 0x4020) v = 0;
    else if (addr < 0x6000) v = this.lastBus;
    else if (addr < 0x8000) v = this.wram[addr - 0x6000];
    else v = this.prg[(addr - 0x8000) & this.prgMask];
    this.lastBus = v;
    return v;
  }

  write(addr, value) {
    addr &= 0xffff;
    if (addr < 0x2000) this.ram[addr & 0x7ff] = value;
    else if (addr < 0x4000) {
      const reg = addr & 7;
      if (reg === 0) this.ppuControl = value;
      else if (reg === 6) {
        this.ppuAddress = this.ppuLatch ? (this.ppuAddress & 0xff00) | value : ((value << 8) | (this.ppuAddress & 0xff)) & 0x3fff;
        this.ppuLatch = !this.ppuLatch;
      } else if (reg === 7) {
        if (this.ppuAddress >= 0x2000 && this.ppuAddress < 0x2800) this.nametable[this.ppuAddress - 0x2000] = value;
        this.ppuAddress = (this.ppuAddress + (this.ppuControl & 0x04 ? 32 : 1)) & 0x3fff;
      } else if (reg === 5 || reg === 2) this.ppuLatch = false;
    }
    else if (addr >= 0x4000 && addr <= 0x4017) {
      // OAM DMA stalls the CPU for 513 cycles; the tests do not use it, and
      // it is not the chip's business.
      if (addr === 0x4014) this.tick(513);
      else {
        if (addr === 0x4002) this.pulseLow = value;
        if (addr === 0x4003 && (((value & 7) << 8) | this.pulseLow) >= 8) this.beeps.push(this.cpu.cycles);
        this.log.push({ at: this.cpu.cycles, addr, value });
        this.chip.write(addr, value);
      }
    } else if (addr >= 0x6000 && addr < 0x8000) this.wram[addr - 0x6000] = value;
  }

  /** The interrupt line: level, from the chip's two flags. */
  irqPending() {
    return this.chip.irqLine();
  }

  /**
   * What the first name table says, as text: blargg's font puts each ASCII
   * character at its own tile index, so the screen reads back directly.
   * Blank rows are dropped and the rest joined with newlines.
   */
  screenText() {
    const rows = [];
    for (let r = 0; r < 30; r++) {
      let line = '';
      for (let c = 0; c < 32; c++) {
        const t = this.nametable[r * 32 + c];
        line += t >= 0x20 && t < 0x7f ? String.fromCharCode(t) : ' ';
      }
      if (line.trim()) rows.push(line.trimEnd());
    }
    return rows.join('\n');
  }

  /** True when the program has parked itself in a jump to its own address. */
  halted() {
    const pc = this.cpu.pc;
    return this.read(pc) === 0x4c && (this.read(pc + 1) | (this.read(pc + 2) << 8)) === pc;
  }

  /** The test's status byte and text, per blargg's protocol at `$6000`. */
  result() {
    const w = this.wram;
    const valid = w[1] === 0xde && w[2] === 0xb0 && w[3] === 0x61;
    let text = '';
    for (let i = 4; i < w.length && w[i] !== 0; i++) text += String.fromCharCode(w[i]);
    return { valid, status: w[0], text: text.trim() };
  }

  /**
   * Runs `cycles` cycles of program.
   *
   * The 6502 polls its interrupt line before an instruction's last cycle, so
   * a line that rises during an instruction is not seen until the next one
   * has run. Sampling the line before each instruction and taking the
   * interrupt after it is that rule at instruction granularity: blargg's
   * `irq_timing` wants the handler no sooner than 29833 cycles after a
   * `$4017` write whose flag rises at 29831, and this is where the two go.
   */
  run(cycles) {
    const until = this.cpu.cycles + cycles;
    while (this.cpu.cycles < until) {
      const pending = this.irqPending();
      this.cpu.step();
      if (pending && this.irqPending()) this.cpu.irq();
    }
  }
}
