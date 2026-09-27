import { c64Chip } from 'chipvoice';
import { Cpu6502 } from './cpu6502.mjs';

/**
 * Enough of a Commodore 64 to run VICE's `testprogs/SID` on a 6510: 64 KiB of
 * RAM, a PRG loader that starts the CPU at the BASIC stub's `SYS` address
 * rather than interpreting BASIC, the SID at `$D400-$D7FF` (mirrored, as on
 * the real bus), a VIC-II reduced to its raster line - PAL, 63 cycles a line,
 * 312 lines a frame - because a few of these programs poll `$D011`'s bit 7
 * for a stable moment to disable the display, and CIA 1's two timers, which
 * `resid-test`'s programs chain into a 32-bit free-running cycle counter to
 * measure envelope timings in cycles rather than in frames.
 *
 * None of the chosen programs need the KERNAL for their verdict: each one
 * writes it to `$D7FF` (VICE's debug cartridge register, 0 for pass, `$ff`
 * for fail) and to `$D020`, the border colour, then parks itself in a jump to
 * its own address. A few call `$FFD2`, the KERNAL's CHROUT, purely to print
 * their working in text on a real machine; that call is hooked as a no-op
 * RTS here (see `chrout()`) rather than emulated, since nothing the harness
 * reads depends on what it would have printed.
 *
 * Known limits:
 * - The `$00`/`$01` I/O port is plain RAM: there is no ROM to bank in or out,
 *   so the PLA's banking logic is not modelled.
 * - The VIC-II is its raster line and nothing else: no sprites, no bad
 *   lines, no video output, and no cycle stealing from the CPU. The chosen
 *   programs that touch it only ever poll `$D011`'s bit 7 for a frame
 *   boundary or write `$D020`/`$D021`/`$D015`/`$D018`, which are accepted and
 *   otherwise ignored.
 * - CIA 1's timers model the free-running/one-shot and "count timer A's
 *   underflow" modes the chosen programs use, phi2-driven, with the ICR's
 *   read-and-clear convention; CIA 2, the serial port and the keyboard
 *   matrix are not modelled, and `$DC00`/`$DC01` read as `$ff` (no key, no
 *   joystick).
 */
const PAL_CYCLES_PER_LINE = 63;
const PAL_LINES_PER_FRAME = 312;
export const C64_CLOCK_HZ = 985248; // PAL

export class C64 {
  /** @param {Uint8Array} prg a C64 PRG file: a two-byte load address, then its bytes. */
  constructor(prg) {
    this.ram = new Uint8Array(0x10000);
    this.startPc = this.loadPrg(prg);
    this.sid = c64Chip.digital();
    this.cpu = new Cpu6502(this);
    this.cpu.pc = this.startPc;
    this.rasterCycle = 0;
    this.rasterLine = 0;
    this.vic = { d011: 0x1b, d015: 0, d018: 0, d020: 0, d021: 0 };
    this.cia1 = {
      ta: 0xffff, taLatch: 0xffff, taRunning: false, taOneShot: false,
      tb: 0xffff, tbLatch: 0xffff, tbRunning: false, tbOneShot: false, tbInMode: 0,
      icrData: 0, icrMask: 0,
    };
    /** The debug cartridge register at `$D7FF`: null until the program writes a verdict. */
    this.verdict = null;
    /** Every SID register write, stamped with its cycle: a log, as the other machines keep. */
    this.log = [];
  }

  /**
   * Loads a PRG at its header's address, then finds the BASIC stub's `SYS`
   * token (`$9e`) and reads the decimal address written after it in ASCII -
   * what a real BASIC would have parsed to build the machine code call. Every
   * chosen program's first line is `10 SYS <addr>`, whichever assembler built
   * it, so this needs no per-program offset.
   */
  loadPrg(prg) {
    const loadAddr = prg[0] | (prg[1] << 8);
    const body = prg.subarray(2);
    for (let i = 0; i < body.length; i++) this.ram[(loadAddr + i) & 0xffff] = body[i];
    const sys = body.indexOf(0x9e);
    if (sys < 0 || sys > 16) throw new Error('PRG has no BASIC "SYS" stub near its start');
    let i = sys + 1;
    let digits = '';
    while (body[i] >= 0x30 && body[i] <= 0x39) { digits += String.fromCharCode(body[i]); i++; }
    if (!digits) throw new Error('PRG\'s SYS token has no decimal address after it');
    return parseInt(digits, 10);
  }

  tick(cycles) {
    for (let i = 0; i < cycles; i++) {
      this.sid.step();
      this.tickVic();
      this.tickCia1();
    }
  }

  tickVic() {
    if (++this.rasterCycle < PAL_CYCLES_PER_LINE) return;
    this.rasterCycle = 0;
    if (++this.rasterLine >= PAL_LINES_PER_FRAME) this.rasterLine = 0;
  }

  /**
   * CIA 1's two timers, phi2-driven. A timer loaded with `n` and started
   * underflows for the first time `n + 1` cycles later - counting down
   * through `n, n-1, ..., 1, 0`, then reloading on the cycle after it reaches
   * zero - which is the real chip's convention and what makes `envrate` and
   * `envtime`'s cycle counts land exactly. Timer B's "count timer A's
   * underflow" mode (`resid-test`'s 32-bit free-running counter) only steps
   * it on the cycles timer A actually underflowed.
   */
  tickCia1() {
    const c = this.cia1;
    let taUnderflow = false;
    if (c.taRunning) {
      if (c.ta === 0) {
        c.ta = c.taLatch;
        taUnderflow = true;
        if (c.taOneShot) c.taRunning = false;
      } else c.ta--;
    }
    if (taUnderflow) c.icrData |= 0x01;
    if (c.tbRunning) {
      const step = c.tbInMode >= 2 ? taUnderflow : true;
      if (step) {
        if (c.tb === 0) {
          c.tb = c.tbLatch;
          c.icrData |= 0x02;
          if (c.tbOneShot) c.tbRunning = false;
        } else c.tb--;
      }
    }
  }

  read(addr) {
    addr &= 0xffff;
    if (addr >= 0xd400 && addr < 0xd800) {
      if (addr === 0xd7ff) return this.verdict ?? 0xff;
      return this.sid.read(addr);
    }
    if (addr >= 0xd000 && addr < 0xd400) return this.readVic(addr);
    if (addr >= 0xdc00 && addr < 0xdd00) return this.readCia1(addr);
    return this.ram[addr];
  }

  write(addr, value) {
    addr &= 0xffff;
    value &= 0xff;
    if (addr >= 0xd400 && addr < 0xd800) {
      if (addr === 0xd7ff) { this.verdict = value; return; }
      this.log.push({ at: this.cpu.cycles, addr, value });
      this.sid.write(addr, value);
      return;
    }
    if (addr >= 0xd000 && addr < 0xd400) { this.writeVic(addr, value); return; }
    if (addr >= 0xdc00 && addr < 0xdd00) { this.writeCia1(addr, value); return; }
    this.ram[addr] = value;
  }

  readVic(addr) {
    switch (addr & 0x3f) {
      case 0x11: return (this.vic.d011 & 0x7f) | (this.rasterLine >= 256 ? 0x80 : 0);
      case 0x12: return this.rasterLine & 0xff;
      case 0x15: return this.vic.d015;
      case 0x18: return this.vic.d018;
      case 0x20: return this.vic.d020;
      case 0x21: return this.vic.d021;
      default: return 0xff;
    }
  }

  writeVic(addr, value) {
    switch (addr & 0x3f) {
      case 0x11: this.vic.d011 = value & 0x7f; break;
      case 0x15: this.vic.d015 = value; break;
      case 0x18: this.vic.d018 = value; break;
      case 0x20: this.vic.d020 = value & 0x0f; break;
      case 0x21: this.vic.d021 = value & 0x0f; break;
      default: break;
    }
  }

  readCia1(addr) {
    const c = this.cia1;
    switch (addr & 0x0f) {
      case 0x00: return 0xff; // PRA: no key, no joystick
      case 0x01: return 0xff; // PRB
      case 0x04: return c.ta & 0xff;
      case 0x05: return (c.ta >> 8) & 0xff;
      case 0x06: return c.tb & 0xff;
      case 0x07: return (c.tb >> 8) & 0xff;
      case 0x0d: { const v = c.icrData | (c.icrData & c.icrMask ? 0x80 : 0); c.icrData = 0; return v; }
      case 0x0e: return (c.taRunning ? 0x01 : 0) | (c.taOneShot ? 0x08 : 0);
      case 0x0f: return (c.tbRunning ? 0x01 : 0) | (c.tbOneShot ? 0x08 : 0) | (c.tbInMode << 5);
      default: return 0xff;
    }
  }

  writeCia1(addr, value) {
    const c = this.cia1;
    switch (addr & 0x0f) {
      // Writing the low byte always only latches. Writing the high byte
      // latches too, and - the real chip's documented quirk, which
      // `envrate` and `envtime` rely on to start a timer at a known count -
      // also loads the counter immediately if the timer is not running.
      case 0x04: c.taLatch = (c.taLatch & 0xff00) | value; break;
      case 0x05: c.taLatch = (c.taLatch & 0x00ff) | (value << 8); if (!c.taRunning) c.ta = c.taLatch; break;
      case 0x06: c.tbLatch = (c.tbLatch & 0xff00) | value; break;
      case 0x07: c.tbLatch = (c.tbLatch & 0x00ff) | (value << 8); if (!c.tbRunning) c.tb = c.tbLatch; break;
      case 0x0d:
        if (value & 0x80) c.icrMask |= value & 0x7f; else c.icrMask &= ~value & 0x7f;
        break;
      case 0x0e:
        c.taRunning = !!(value & 0x01);
        c.taOneShot = !!(value & 0x08);
        if (value & 0x10) c.ta = c.taLatch;
        break;
      case 0x0f:
        c.tbRunning = !!(value & 0x01);
        c.tbOneShot = !!(value & 0x08);
        c.tbInMode = (value >> 5) & 0x03;
        if (value & 0x10) c.tb = c.tbLatch;
        break;
      default: break;
    }
  }

  /**
   * `$FFD2`, the KERNAL's CHROUT, hooked rather than emulated: there is no
   * KERNAL loaded, so a call that reached it would fetch a `$00` and read as
   * BRK. None of the chosen programs' verdicts depend on what it prints, so
   * this performs exactly its RTS and nothing else - the byte that would
   * have been printed is dropped. Six cycles, an RTS's own cost, are charged
   * so the cycle budget stays honest.
   */
  chrout() {
    const lo = this.cpu.pull();
    const hi = this.cpu.pull();
    this.cpu.pc = ((lo | (hi << 8)) + 1) & 0xffff;
    this.cpu.tick(6);
  }

  /** True once the program has parked itself in a jump to its own address. */
  halted() {
    const pc = this.cpu.pc;
    return this.read(pc) === 0x4c && (this.read(pc + 1) | (this.read(pc + 2) << 8)) === pc;
  }

  /** Runs up to `cycles` cycles, or until the program halts, hooking CHROUT. */
  run(cycles) {
    const until = this.cpu.cycles + cycles;
    while (this.cpu.cycles < until) {
      if (this.halted()) return;
      if (this.cpu.pc === 0xffd2) { this.chrout(); continue; }
      this.cpu.step();
    }
  }
}
