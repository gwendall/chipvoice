import type {PerformancePlan} from './performance.js';
import {renderPerformance} from './performance.js';
import type {RenderResult} from './render.js';
import {Cpu6510, type Cpu6510Bus} from './psid-cpu6510.js';
import {PAL_CLOCK_HZ, NTSC_CLOCK_HZ} from './chips/c64/sid.js';
import {c64Chip} from './chips/c64/index.js';

/**
 * Plays a PSID or RSID tune through a from-scratch 6510 (`psid-cpu6510.ts`)
 * and a minimal, disclosed C64 environment, and returns every write the
 * tune's own INIT and PLAY code made to the SID as an ordinary
 * `PerformancePlan` - the same shape `importVgm` returns, so it renders
 * through `renderPerformance(plan, c64Chip, {model: plan.model, clockHz:
 * plan.clockHz})` like any other performance. `renderPsid` is the one-call
 * convenience that does exactly that.
 *
 * The header is HVSC's `SID_file_format.txt`; the 6510 is `psid-cpu6510.ts`.
 * What this environment models, and what it does not, is documented next to
 * each piece below and summarized on `docs/chips/c64.md`. In short: one SID
 * at `$D400` (a v3/v4 file naming a second or third SID is rejected, named,
 * rather than silently dropping voices); CIA 1 timer A as a 60 Hz IRQ source
 * with the documented "writing the high byte loads the counter" quirk, and
 * nothing else of the CIA (no timer B, no TOD, no serial); the VIC reduced
 * to a single once-a-frame raster IRQ pulse at the file's own PAL/NTSC
 * period, not a real per-line raster comparator; no bank switching and no
 * KERNAL/BASIC ROM (this package ships no C64 ROM image, and never will -
 * see decision 41), so `$01` is written with the value the spec's formula
 * gives before every INIT/PLAY call but nothing reads it back to change
 * what memory decodes to; and no BASIC interpreter, so an RSID file with the
 * C64 BASIC flag set is rejected by name, not attempted.
 */

/** A PSID/RSID file this environment cannot or does not play, named plainly. */
export class PsidFormatError extends Error {}

export interface ImportPsidOptions {
  /** 1-based song to play. Defaults to the header's own start song. */
  song?: number;
  /** How much real time to run INIT then PLAY for. Default 60 seconds. */
  seconds?: number;
}

export interface PsidPerformance extends PerformancePlan {
  chip: 'c64';
  /** Which SID profile the header asked for: `c64Chip.create`'s `model` option. */
  model: '6581' | '8580';
  /** The header's own PAL/NTSC clock, for `c64Chip.create`'s `clockHz` option. */
  clockHz: number;
  format: 'PSID' | 'RSID';
  version: number;
  songs: number;
  startSong: number;
  /** The song actually rendered (`options.song` or the header's start song). */
  song: number;
  title: string;
  author: string;
  released: string;
}

const PAL_FRAME_CYCLES = 19656; // 63 cycles/line * 312 lines/frame; also the file format's own stated PAL VBI period.
const NTSC_FRAME_CYCLES = 17045; // The file format document's own stated true NTSC VBI period (distinct from the CIA-default fallback below).
const CIA_DEFAULT_PAL = 0x4025; // 60 Hz CIA 1 timer A latch, PAL: the SID file format's own default environment.
const CIA_DEFAULT_NTSC = 0x4295; // Same, NTSC.
const RESERVED_LOW = 0x0400; // "$0000-$03FF" - the file format spec's own reserved area; where this environment's PLAY trampoline and idle loop live.
const TRAMPOLINE_ADDR = 0x0334;
const IDLE_ADDR = 0x0350; // Past the 22-byte trampoline; a `JMP` to itself, where the CPU parks between IRQs.
const MAX_CYCLES_PER_CALL = 50_000_000; // A generous multiple of one frame; guards a INIT/PLAY that never returns.

function decodeWindows1252(bytes: Uint8Array): string {
  let end = bytes.indexOf(0);
  if (end < 0) end = bytes.length;
  // Every byte below 0x80 is ASCII; the file format restricts names to that
  // range in practice, so no fuller Windows-1252 table is worth the weight.
  return Array.from(bytes.subarray(0, end)).map((b) => String.fromCharCode(b)).join('');
}

interface PsidHeader {
  format: 'PSID' | 'RSID';
  version: number;
  dataOffset: number;
  loadAddress: number;
  initAddress: number;
  playAddress: number;
  songs: number;
  startSong: number;
  speed: number;
  name: string;
  author: string;
  released: string;
  flags: number;
  secondSidAddress: number;
  thirdSidAddress: number;
}

function parseHeader(bytes: Uint8Array): PsidHeader {
  if (bytes.length < 0x76) throw new PsidFormatError('Too small to be a PSID/RSID header');
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic !== 'PSID' && magic !== 'RSID') throw new PsidFormatError(`Not a PSID/RSID file (magic "${magic}")`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => view.getUint16(at, false); // The header's own fields are big-endian.
  const u32 = (at: number) => view.getUint32(at, false);
  const version = u16(0x04);
  const format = magic as 'PSID' | 'RSID';
  if (format === 'RSID' && (version < 2 || version > 4)) throw new PsidFormatError('RSID requires header version 2, 3 or 4');
  if (version < 1 || version > 4) throw new PsidFormatError(`Unsupported PSID/RSID version ${version}`);
  const dataOffset = u16(0x06);
  if (dataOffset < 0x76 || dataOffset > bytes.length) throw new PsidFormatError('Invalid PSID/RSID dataOffset');
  const hasV2Fields = version >= 2 && dataOffset >= 0x7c;
  const flags = hasV2Fields ? u16(0x76) : 0;
  const secondSidAddress = hasV2Fields && version >= 3 ? bytes[0x7a] : 0;
  const thirdSidAddress = hasV2Fields && version >= 4 ? bytes[0x7b] : 0;
  return {
    format, version, dataOffset,
    loadAddress: u16(0x08), initAddress: u16(0x0a), playAddress: u16(0x0c),
    songs: u16(0x0e) || 1, startSong: u16(0x10) || 1, speed: u32(0x12),
    name: decodeWindows1252(bytes.subarray(0x16, 0x36)),
    author: decodeWindows1252(bytes.subarray(0x36, 0x56)),
    released: decodeWindows1252(bytes.subarray(0x56, 0x76)),
    flags, secondSidAddress, thirdSidAddress,
  };
}

/** `$42-$7F` or `$E0-$FE`, even: the file format's encoding of a second/third SID's middle address byte. */
function namesExtraSid(byte: number): boolean {
  if (byte & 1) return false;
  return (byte >= 0x42 && byte <= 0x7f) || (byte >= 0xe0 && byte <= 0xfe);
}

function validate(header: PsidHeader): void {
  if (header.flags & 0x01) throw new PsidFormatError("Compute!'s Sidplayer MUS tunes are not supported (only the built-in machine-code player is)");
  if (header.format === 'RSID' && header.flags & 0x02) throw new PsidFormatError('RSID files that need the C64 BASIC interpreter are not supported');
  if (header.version >= 3 && namesExtraSid(header.secondSidAddress)) throw new PsidFormatError('Multi-SID PSID/RSID files are not supported (this environment models one SID)');
  if (header.version >= 4 && namesExtraSid(header.thirdSidAddress)) throw new PsidFormatError('Multi-SID PSID/RSID files are not supported (this environment models one SID)');
  if (header.songs < 1 || header.songs > 256) throw new PsidFormatError('Invalid song count');
}

/** Bits 2-3 of the flags word: 00 unknown, 01 PAL, 10 NTSC, 11 both. Unknown/both default to PAL, the format the majority of PSIDs were authored for. */
function clockFor(flags: number): {clockHz: number; frameCycles: number; ciaDefault: number; pal: boolean} {
  const bits = (flags >> 2) & 0x03;
  const ntsc = bits === 0x02;
  return ntsc
    ? {clockHz: NTSC_CLOCK_HZ, frameCycles: NTSC_FRAME_CYCLES, ciaDefault: CIA_DEFAULT_NTSC, pal: false}
    : {clockHz: PAL_CLOCK_HZ, frameCycles: PAL_FRAME_CYCLES, ciaDefault: CIA_DEFAULT_PAL, pal: true};
}

/** Bits 4-5: 00 unknown, 01 6581, 10 8580, 11 both. Unknown/both default to the 6581, the chip most PSIDs were authored against. */
function modelFor(flags: number): '6581' | '8580' {
  return ((flags >> 4) & 0x03) === 0x02 ? '8580' : '6581';
}

/**
 * The bank ($01) value the file format's own formula gives for a call to
 * `address`, written before every INIT/PLAY call in a PSID file (RSID
 * manages its own bank register once its own handlers are installed, so
 * this environment writes it only once, at startup, for RSID).
 */
function bankFor(address: number): number {
  if (address < 0xa000) return 0x37;
  if (address < 0xd000) return 0x36;
  if (address >= 0xe000) return 0x35;
  return 0x34;
}

/**
 * The environment's own IRQ handler, installed only for a PSID whose
 * `playAddress` is nonzero (a PSID with `playAddress === 0`, and every
 * RSID, installs and manages its own handler instead, and this trampoline
 * is never wired in for those).
 *
 * Acknowledges both IRQ sources this environment models - `LDA $DC0D` reads
 * and so clears CIA 1's latch, `LDA #1 / STA $D019` clears the VIC raster
 * latch's one modeled bit - regardless of which one fired, saves A/X/Y,
 * calls PLAY, restores them, and returns with RTI. Without acknowledging
 * both, whichever source did not fire would still look pending after the
 * first PLAY call and the level-triggered IRQ line would refire before the
 * next real instruction ever ran.
 */
function trampoline(playAddress: number): Uint8Array {
  return Uint8Array.from([
    0x48, // PHA
    0xad, 0x0d, 0xdc, // LDA $DC0D
    0xa9, 0x01, // LDA #$01
    0x8d, 0x19, 0xd0, // STA $D019
    0x8a, 0x48, // TXA, PHA
    0x98, 0x48, // TYA, PHA
    0x20, playAddress & 0xff, playAddress >> 8, // JSR PLAY
    0x68, 0xa8, // PLA, TAY
    0x68, 0xaa, // PLA, TAX
    0x68, // PLA
    0x40, // RTI
  ]);
}

/**
 * The C64 memory map a PSID/RSID tune sees, minus everything this ticket's
 * "clear subset" does not model - see the module doc comment. `events`
 * collects every write to `$D400-$D7FF`, mirrored the same way `Sid.write`
 * mirrors it, each stamped with the environment's own absolute cycle count.
 */
class PsidEnvironment implements Cpu6510Bus {
  readonly ram = new Uint8Array(0x10000);
  readonly events: PerformancePlan['events'] = [];
  cycle = 0;
  private sidBus = 0;
  private cia1 = {latch: 0xffff, counter: 0xffff, running: false, oneShot: false, irqEnabled: false, icrMask: 0, icrLatch: 0};
  private vic = {framePeriod: PAL_FRAME_CYCLES, cycleInFrame: 0, irqEnabled: false, irqLatch: 0};

  read(addr: number): number {
    if ((addr & 0xfc00) === 0xd400) return this.sidBus;
    if ((addr & 0xff00) === 0xdc00) return this.readCia1(addr & 0xff);
    if (addr === 0xd019) return this.vic.irqLatch | (this.irqAsserted() ? 0x80 : 0);
    if (addr === 0xd01a) return this.vic.irqEnabled ? 0x01 : 0x00;
    if (addr === 0x02a6) return this.ram[addr]; // Set once at startup; a tune may read it back, per the spec.
    return this.ram[addr];
  }

  write(addr: number, value: number): void {
    const v = value & 0xff;
    if ((addr & 0xfc00) === 0xd400) {
      this.sidBus = v;
      this.events.push({at: this.cycle, addr, value: v});
      return;
    }
    if ((addr & 0xff00) === 0xdc00) { this.writeCia1(addr & 0xff, v); return; }
    if (addr === 0xd019) { if (v & 0x01) this.vic.irqLatch &= ~0x01; return; } // Write-1-to-clear, real VIC convention.
    if (addr === 0xd01a) { this.vic.irqEnabled = (v & 0x01) !== 0; return; }
    this.ram[addr] = v;
  }

  private readCia1(reg: number): number {
    switch (reg) {
      case 0x04: return this.cia1.counter & 0xff;
      case 0x05: return this.cia1.counter >> 8;
      case 0x0d: { const r = (this.cia1.icrLatch & this.cia1.icrMask ? 0x80 : 0) | this.cia1.icrLatch; this.cia1.icrLatch = 0; return r; }
      case 0x0e: return (this.cia1.running ? 0x01 : 0) | (this.cia1.oneShot ? 0x08 : 0);
      default: return 0; // Timer B, TOD and serial are not modeled; reads are inert.
    }
  }

  private writeCia1(reg: number, v: number): void {
    switch (reg) {
      case 0x04: this.cia1.latch = (this.cia1.latch & 0xff00) | v; return;
      case 0x05:
        this.cia1.latch = (this.cia1.latch & 0x00ff) | (v << 8);
        // "Writing the high byte latches too, and also loads the counter
        // immediately if the timer is not running" - the same documented
        // quirk `packages/conform/src/roms/c64.mjs` models for VICE's own
        // CIA test ROMs, cited there to the same behaviour.
        if (!this.cia1.running) this.cia1.counter = this.cia1.latch;
        return;
      case 0x0d:
        if (v & 0x80) this.cia1.icrMask |= v & 0x7f;
        else this.cia1.icrMask &= ~v;
        return;
      case 0x0e:
        this.cia1.running = (v & 0x01) !== 0;
        this.cia1.oneShot = (v & 0x08) !== 0;
        if (v & 0x10) this.cia1.counter = this.cia1.latch; // Force-load strobe.
        return;
      default: return;
    }
  }

  private irqAsserted(): boolean {
    return ((this.cia1.icrLatch & this.cia1.icrMask) !== 0) || ((this.vic.irqLatch & (this.vic.irqEnabled ? 0x01 : 0)) !== 0);
  }

  /** Advances every modeled peripheral by `cycles`, the cost of one 6510 instruction. */
  advance(cycles: number): boolean {
    this.cycle += cycles;
    if (this.cia1.running && this.cia1.latch < 0xffff) {
      let remaining = this.cia1.counter - cycles;
      let guard = 0;
      while (remaining < 0 && guard++ < 1_000_000) {
        this.cia1.icrLatch |= 0x01;
        if (this.cia1.oneShot) { this.cia1.running = false; remaining = 0; break; }
        remaining += this.cia1.latch + 1;
      }
      this.cia1.counter = remaining & 0xffff;
    } else if (this.cia1.running) {
      this.cia1.counter = (this.cia1.counter - cycles) & 0xffff;
    }
    this.vic.cycleInFrame += cycles;
    while (this.vic.cycleInFrame >= this.vic.framePeriod) {
      this.vic.cycleInFrame -= this.vic.framePeriod;
      this.vic.irqLatch |= 0x01;
    }
    return this.irqAsserted();
  }

  setupCia1(latch: number, running: boolean, irqEnabled: boolean) {
    this.cia1.latch = latch; this.cia1.counter = latch; this.cia1.running = running;
    this.cia1.icrMask = irqEnabled ? 0x01 : 0; this.cia1.icrLatch = 0; this.cia1.oneShot = false;
  }

  setupVic(framePeriod: number, irqEnabled: boolean) {
    this.vic.framePeriod = framePeriod; this.vic.cycleInFrame = 0; this.vic.irqEnabled = irqEnabled; this.vic.irqLatch = 0;
  }
}

/** Runs `cpu` from `pc`, dispatching real IRQs, until it executes an RTS back to `sentinel`, or the cycle budget runs out. */
function runUntilReturn(cpu: Cpu6510, env: PsidEnvironment, pc: number, sentinel: number, budget: number): void {
  cpu.pc = pc;
  cpu.s = (cpu.s - 2) & 0xff; // Room for the sentinel return address, as if JSR pushed it.
  env.ram[0x100 + ((cpu.s + 1) & 0xff)] = (sentinel - 1) & 0xff;
  env.ram[0x100 + ((cpu.s + 2) & 0xff)] = (sentinel - 1) >> 8;
  let spent = 0;
  while (cpu.pc !== sentinel) {
    const cycles = cpu.step();
    spent += cycles;
    if (env.advance(cycles)) cpu.irq();
    if (spent > budget) throw new PsidFormatError('INIT/PLAY did not return within the cycle budget (an infinite loop, or a routine this environment cannot model)');
  }
}

/** Decode a PSID or RSID file into a `PerformancePlan`, by actually running its INIT and PLAY code. */
export function importPsid(bytes: Uint8Array, options: ImportPsidOptions = {}): PsidPerformance {
  const header = parseHeader(bytes);
  validate(header);
  const song = Math.min(Math.max(1, options.song ?? header.startSong), header.songs);
  const seconds = options.seconds ?? 60;
  if (!(seconds > 0) || seconds > 600) throw new PsidFormatError('seconds must be between 0 and 600, the same bound renderPerformance enforces');

  const env = new PsidEnvironment();
  let dataStart = header.dataOffset;
  let loadAddress = header.loadAddress;
  if (loadAddress === 0) {
    if (dataStart + 2 > bytes.length) throw new PsidFormatError('Truncated PSID/RSID data (missing embedded load address)');
    loadAddress = bytes[dataStart] | (bytes[dataStart + 1] << 8);
    dataStart += 2;
  }
  if (header.format === 'RSID' && loadAddress < 0x07e8) throw new PsidFormatError('Malformed RSID: effective load address below $07E8');
  const prg = bytes.subarray(dataStart);
  if (loadAddress + prg.length > 0x10000) throw new PsidFormatError('PSID/RSID data overruns the address space');
  env.ram.set(prg, loadAddress);

  const initAddress = header.initAddress || loadAddress;
  const playAddress = header.playAddress;
  const {clockHz, frameCycles, ciaDefault, pal} = clockFor(header.flags);
  const model = modelFor(header.flags);
  const speedBit = ((header.speed >>> Math.min(song - 1, 31)) & 1) as 0 | 1;

  env.ram[0x02a6] = pal ? 1 : 0;
  if (header.format === 'PSID') {
    // "For PSID files, default environment": VIC IRQ enabled only when the
    // speed flag is 0 (VBI-driven tunes), CIA 1 timer A always running at
    // 60 Hz but only IRQ-active when the speed flag is 1 (CIA-driven).
    env.setupCia1(ciaDefault, true, speedBit === 1);
    env.setupVic(frameCycles, speedBit === 0);
    env.ram[0x01] = bankFor(initAddress);
  } else {
    // "For RSID files, default environment": CIA 1 timer A running and
    // already IRQ-active; the VIC raster IRQ is set up but left disabled.
    // RSID tunes install and manage their own handlers from here.
    env.setupCia1(ciaDefault, true, true);
    env.setupVic(frameCycles, false);
    env.ram[0x01] = 0x37;
  }

  if (header.format === 'PSID' && playAddress !== 0) {
    env.ram.set(trampoline(playAddress), TRAMPOLINE_ADDR);
    env.ram[0xfffe] = TRAMPOLINE_ADDR & 0xff;
    env.ram[0xffff] = TRAMPOLINE_ADDR >> 8;
  }

  const cpu = new Cpu6510(env);
  cpu.a = song - 1; // "the song number to be played (0x00 for song 1)" - the spec's only stated INIT convention (given for the BASIC-flag case), adopted generally.
  cpu.x = 0; cpu.y = 0; cpu.s = 0xff; cpu.p = 0x24;
  const sentinel = 0xea31; // An address this environment's RAM never holds real code at; only ever reached via the synthetic return address below.

  runUntilReturn(cpu, env, initAddress, sentinel, MAX_CYCLES_PER_CALL);
  if (header.format === 'PSID') env.ram[0x01] = bankFor(initAddress);

  // With INIT done, real hardware never falls off the end of a program: the
  // KERNAL's own idle loop (or, for these tunes, this environment's stand-in
  // for it) just spins waiting for the next IRQ. Installing that spin loop
  // and parking the CPU in it is what makes the sentinel return address
  // above safe to reuse for every INIT call - nothing ever executes there.
  env.ram.set([0x4c, IDLE_ADDR & 0xff, IDLE_ADDR >> 8], IDLE_ADDR); // JMP IDLE_ADDR
  cpu.pc = IDLE_ADDR;
  cpu.p &= ~0x04; // Clear I: nothing runs with interrupts masked forever.

  // From here, every SID write is genuine interrupt-driven playback: real
  // hardware IRQs, dispatched to whatever is at $FFFE/$FFFF - this
  // environment's own trampoline for a PSID with a nonzero playAddress, or
  // the tune's own handler (installed during INIT) for a PSID with
  // playAddress === 0 and for every RSID. Not a scheduled shortcut.
  const endCycle = Math.round(seconds * clockHz);
  while (env.cycle < endCycle) {
    const cycles = cpu.step();
    if (env.advance(cycles)) cpu.irq();
  }

  return {
    chip: 'c64', model, clockHz,
    format: header.format, version: header.version,
    songs: header.songs, startSong: header.startSong, song,
    title: header.name, author: header.author, released: header.released,
    seconds, loopStartSeconds: 0,
    events: env.events, memory: [], notes: [], losses: [],
  };
}

/**
 * `importPsid`, immediately rendered to samples through the C64's own SID -
 * `renderPerformance` with the model and clock the header asked for already
 * applied, for a caller that just wants the audio.
 */
export function renderPsid(bytes: Uint8Array, options: ImportPsidOptions & {sampleRate?: number; gain?: number; onProgress?: (fraction: number) => void} = {}): RenderResult & {performance: PsidPerformance} {
  const performance = importPsid(bytes, options);
  const result = renderPerformance(performance, c64Chip, {sampleRate: options.sampleRate, gain: options.gain, model: performance.model, clockHz: performance.clockHz, onProgress: options.onProgress});
  return {...result, performance};
}
