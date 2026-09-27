/**
 * The S-SMP: the SPC700 CPU wired to its timers, its $00F0-$00FF I/O ports,
 * the DSP address/data latch, and the 64-byte IPL boot ROM, all from
 * Anomie's SPC700 doc. Not a port of snes_spc's `SNES_SPC`: only the ported
 * `SDsp` (decision 17's exception) crosses into this file from that project,
 * and only through the ordinary `SnesChip` it already shares with the
 * hand-written driver path.
 *
 * Register map (Anomie's doc):
 *   $F0 TEST     write-only, test-mode bits this player does not model
 *   $F1 CONTROL  write-only: bit7 ROM enable, bit5/4 one-shot port clears,
 *                bit2/1/0 timer 2/1/0 enable
 *   $F2 DSPADDR  the latched DSP register address
 *   $F3 DSPDATA  read/write through to the S-DSP at DSPADDR
 *   $F4-$F7      CPU I/O ports (no S-CPU is modelled; the "in" latches hold
 *                whatever a loaded snapshot set, the "out" latches are
 *                otherwise inert)
 *   $F8-$F9      plain RAM
 *   $FA-$FC      TnTARGET, write-only (read as 0)
 *   $FD-$FF      TnOUT, read-only 4-bit counters, cleared on read
 *   $FFC0-$FFFF  the IPL ROM when CONTROL bit7 is set, else RAM; writes
 *                always land in RAM regardless of the bit
 *
 * Timers (the 3-stage model): a free-running divider (128:1 for T0/T1, so
 * they tick near 8 kHz; 16:1 for T2, near 64 kHz) that never stops or
 * resets, feeding an 8-bit divisor counter (Stage 2, gated by the CONTROL
 * enable bit, target 0 meaning 256, reset to 0 on a 0->1 enable edge) that
 * in turn feeds a 4-bit output counter (Stage 3, read via TnOUT).
 */

import type { Spc700Bus } from './spc700.js';
import type { SnesChip } from './dsp.js';
import type { RegisterEvent } from '../../chip.js';

export const IPL_ROM: Uint8Array = new Uint8Array([
  0xcd, 0xef, 0xbd, 0xe8, 0x00, 0xc6, 0x1d, 0xd0, 0xfc, 0x8f, 0xaa, 0xf4, 0x8f, 0xbb, 0xf5, 0x78,
  0xcc, 0xf4, 0xd0, 0xfb, 0x2f, 0x19, 0xeb, 0xf4, 0xd0, 0xfc, 0x7e, 0xf4, 0xd0, 0x0b, 0xe4, 0xf5,
  0xcb, 0xf4, 0xd7, 0x00, 0xfc, 0xd0, 0xf3, 0xab, 0x01, 0x10, 0xef, 0x7e, 0xf4, 0x10, 0xeb, 0xba,
  0xf6, 0xda, 0x00, 0xba, 0xf4, 0xc4, 0xf4, 0xdd, 0x5d, 0xd0, 0xdb, 0x1f, 0x00, 0x00, 0xc0, 0xff,
]);

const STAGE1_T01 = 128;
const STAGE1_T2 = 16;

class Timer {
  constructor(private readonly stage1Period: number) {}
  private stage1 = 0;
  stage2 = 0;
  out = 0;
  enabled = false;
  target = 0;

  setEnabled(next: boolean) {
    if (next && !this.enabled) this.stage2 = 0; // a 0->1 edge starts the divisor fresh
    this.enabled = next;
  }

  /** One SPC cycle. */
  tick() {
    this.stage1 = (this.stage1 + 1) % this.stage1Period;
    if (this.stage1 !== 0 || !this.enabled) return;
    this.stage2 = (this.stage2 + 1) & 0xff;
    const target = this.target === 0 ? 256 : this.target;
    if (this.stage2 >= target) {
      this.stage2 = 0;
      this.out = (this.out + 1) & 0x0f;
    }
  }

  /** TnOUT: read-only, cleared to 0 by the read. */
  readOut(): number {
    const v = this.out;
    this.out = 0;
    return v;
  }
}

export class Ssmp implements Spc700Bus {
  readonly timers = [new Timer(STAGE1_T01), new Timer(STAGE1_T01), new Timer(STAGE1_T2)];
  control = 0; // CONTROL, $F1
  test = 0; // TEST, $F0
  dspAddr = 0; // DSPADDR, $F2 (the latched register index)
  /** Ports $F4-$F7: index 0 the "in" latch (an S-CPU writing to us; we hold
   * whatever was loaded, since no S-CPU is modelled), index 1 the "out"
   * latch (what we would present to an S-CPU, otherwise inert here). */
  portsIn = new Uint8Array(4);
  portsOut = new Uint8Array(4);
  /** The absolute cycle about to be clocked, same convention as
   * `SnesChip.cycle`: a write captured below is stamped with this value,
   * then `tick()` advances it. */
  cycle = 0;
  /** Every write the CPU made to $F2 (DSPADDR) or $F3 (DSPDATA), in order,
   * stamped with the cycle it landed on: the trace `importSpc` turns into
   * the returned plan's `RegisterEvent[]`. */
  readonly events: RegisterEvent[] = [];

  constructor(private readonly chip: SnesChip) {}

  /**
   * Restores every $F0-$FF register and the three timers from a snapshot's
   * raw 64KB RAM dump (and the DSP from its 128-byte register dump), with no
   * write side effects (no event captured, no port-clear, no enable-edge
   * reset). The $F0-$FF page is an overlay on plain RAM (Anomie's doc: reads
   * see the register, writes hit both the register and the underlying RAM
   * cell), so a dumper's own RAM image already holds TEST, CONTROL, DSPADDR
   * and every TnTARGET at their usual addresses; a conforming dumper also
   * writes each timer's live output counter into $FD-$FF (confirmed by
   * reading snes_spc's own `save_regs`, which does exactly this into the
   * same buffer it dumps), so TnOUT is restored from there too.
   */
  loadSnapshot(ram: Uint8Array, dspRegs: Uint8Array) {
    this.chip.ram.set(ram.subarray(0, 0x10000));
    this.chip.dsp.load(dspRegs);
    this.test = ram[0xf0];
    this.control = ram[0xf1];
    this.dspAddr = ram[0xf2];
    for (let i = 0; i < 4; i++) this.portsIn[i] = ram[0xf4 + i];
    for (let i = 0; i < 3; i++) {
      const timer = this.timers[i];
      timer.target = ram[0xfa + i];
      timer.out = ram[0xfd + i] & 0x0f;
      timer.stage2 = 0; // Stage 2 is not observable in the snapshot format
      timer.enabled = (this.control & (1 << i)) !== 0;
    }
    this.cycle = 0;
    this.events.length = 0;
  }

  get romEnabled(): boolean {
    return (this.control & 0x80) !== 0;
  }

  read(addr: number): number {
    addr &= 0xffff;
    if (addr >= 0xffc0 && this.romEnabled) return IPL_ROM[addr - 0xffc0];
    if (addr === 0xf0) return 0; // TEST: write-only
    if (addr === 0xf1) return 0; // CONTROL: write-only
    if (addr === 0xf2) return this.dspAddr;
    if (addr === 0xf3) return this.chip.dsp.read(this.dspAddr & 0x7f);
    if (addr >= 0xf4 && addr <= 0xf7) return this.portsIn[addr - 0xf4];
    if (addr >= 0xfa && addr <= 0xfc) return 0; // TnTARGET: write-only
    if (addr >= 0xfd && addr <= 0xff) return this.timers[addr - 0xfd].readOut();
    return this.chip.ram[addr];
  }

  write(addr: number, value: number): void {
    addr &= 0xffff;
    value &= 0xff;
    // Every write lands in the underlying RAM cell too (the IPL ROM and
    // every $F0-$FF register are overlays on top of plain RAM), except the
    // three read-only TnOUT cells, which have no RAM cell to overlay.
    if (addr < 0xfd || addr > 0xff) this.chip.ram[addr] = value;
    if (addr === 0xf0) { this.test = value; return; }
    if (addr === 0xf1) {
      this.control = value;
      this.timers[0].setEnabled((value & 0x01) !== 0);
      this.timers[1].setEnabled((value & 0x02) !== 0);
      this.timers[2].setEnabled((value & 0x04) !== 0);
      if (value & 0x10) { this.portsIn[0] = 0; this.portsIn[1] = 0; }
      if (value & 0x20) { this.portsIn[2] = 0; this.portsIn[3] = 0; }
      return;
    }
    if (addr === 0xf2) {
      this.dspAddr = value;
      this.events.push({ at: this.cycle, addr: 0xf2, value });
      return;
    }
    if (addr === 0xf3) {
      if (this.dspAddr < 0x80) this.chip.dsp.write(this.dspAddr, value);
      this.events.push({ at: this.cycle, addr: 0xf3, value });
      return;
    }
    if (addr >= 0xf4 && addr <= 0xf7) { this.portsOut[addr - 0xf4] = value; return; }
    if (addr >= 0xfa && addr <= 0xfc) { this.timers[addr - 0xfa].target = value; return; }
    // $FD-$FF: TnOUT, writes have no effect (already excluded from the RAM mirror above).
  }

  /** One SPC cycle: the DSP, every timer's divider, then the cycle count
   * that stamps the *next* write. */
  tick(): void {
    this.chip.dsp.run(1);
    for (const timer of this.timers) timer.tick();
    this.cycle++;
  }
}
