import type {PerformancePlan} from './performance.js';
import {Sm83, type Sm83Bus} from './chips/gb/cpu.js';
import {CLOCK_HZ} from './chips/gb/dsp.js';

/** A GBS file's 112-byte header (OC ReMix's GBS format spec, gbdev's mirror
 * of it). `title`/`author`/`copyright` are ASCII, space/NUL padded to 32
 * bytes; trailing padding is trimmed. */
export interface GbsHeader {
  version: number;
  songCount: number;
  /** 1-based, as the header and every GBS player's song list show it. */
  firstSong: number;
  loadAddress: number;
  initAddress: number;
  playAddress: number;
  stackPointer: number;
  timerModulo: number;
  timerControl: number;
  title: string;
  author: string;
  copyright: string;
}

export interface GbsImportOptions {
  /** 1-based song number, matching the header's own numbering; defaults to
   * `header.firstSong`. INIT receives it zero-based in the A register, as
   * the format specifies. */
  track?: number;
  /**
   * How long to play. A GBS carries no duration or loop point (unlike NSF's
   * playback-rate field or VGM's sample-accurate length): whoever calls
   * INIT has to decide when to stop calling PLAY. 150 seconds is a plain
   * default long enough for most songs to loop at least once; callers that
   * need an exact length (the corpus scorer, an exporter) pass their own.
   */
  seconds?: number;
}

const HEADER_SIZE = 112;
/** VBlank fires every 70224 cycles on a DMG (Pan Docs: 154 scanlines of 456
 * cycles), the rate almost every GBS driver paces PLAY against. */
const VBLANK_PERIOD = 70224;
/** TAC's low two bits select the timer's increment rate; Pan Docs gives the
 * frequencies (4096, 262144, 65536, 16384 Hz), converted here to a
 * cycle-count shift (4194304 / f is a power of two for all four). */
const TIMER_SHIFT = [10, 4, 6, 8];
/** Fixed low addresses the SM83 jumps to for RST nn and each interrupt; a
 * GBS file's own load address is always $400 or higher (checked below), so
 * this range is never part of its program and is safe to overwrite with
 * relocation stubs. Also doubles as the sentinel INIT/PLAY return to. */
const SENTINEL = 0x0068;

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let end = offset;
  while (end < offset + length && bytes[end] !== 0) end++;
  let text = '';
  for (let i = offset; i < end; i++) text += String.fromCharCode(bytes[i]);
  return text.trimEnd();
}

/** Parses and validates a GBS header. Throws on anything this player does
 * not model, by name, rather than guessing: only version 1 is defined for
 * this format; the load address must leave the relocation stubs' low
 * addresses free; the timer control's reserved bits (3-6) must be zero;
 * bit 7 is an undocumented "halve the timer period" flag some players
 * recognize as a CGB double-speed accommodation, which this player does
 * not implement. */
export function parseGbsHeader(bytes: Uint8Array): GbsHeader {
  if (bytes.length < HEADER_SIZE || bytes[0] !== 0x47 || bytes[1] !== 0x42 || bytes[2] !== 0x53) throw new Error('Expected a GBS file');
  const version = bytes[3];
  if (version !== 1) throw new Error(`Unsupported GBS version ${version}; only version 1 is defined`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const songCount = bytes[4], firstSong = bytes[5];
  if (songCount < 1) throw new Error('GBS declares zero songs');
  if (firstSong < 1 || firstSong > songCount) throw new Error('Invalid GBS first song');
  const loadAddress = view.getUint16(6, true);
  const initAddress = view.getUint16(8, true);
  const playAddress = view.getUint16(10, true);
  const stackPointer = view.getUint16(12, true);
  const timerModulo = bytes[14];
  const timerControl = bytes[15];
  if (loadAddress < 0x400 || loadAddress > 0x7fff) throw new Error('Unsupported GBS load address (expected $400-$7FFF)');
  if (timerControl & 0x80) throw new Error('CGB double-speed timer rate is not supported');
  if (timerControl & 0x78) throw new Error('Invalid GBS: reserved timer control bits are set');
  return {
    version, songCount, firstSong, loadAddress, initAddress, playAddress, stackPointer, timerModulo, timerControl,
    title: ascii(bytes, 0x10, 32), author: ascii(bytes, 0x30, 32), copyright: ascii(bytes, 0x50, 32),
  };
}

/**
 * Plays a GBS file through the SM83 (`chips/gb/cpu.ts`) and this package's
 * own DMG APU, capturing every write the file's own INIT/PLAY routines make
 * to `$FF10-$FF3F` as a `PerformancePlan` - the same shape `importVgm`
 * returns, so it renders through the ordinary `renderPerformance(plan,
 * gbChip)` path. Written from the GBS format spec (Kevin Horton/gbdev) and
 * Pan Docs; the CPU and the environment below are this package's own code
 * (decision 41), not a port of any existing GBS player.
 *
 * The environment this needs, beyond the CPU itself:
 *
 * - **Memory map.** ROM occupies $0000-$7FFF: a fixed low bank ($0000 up to
 *   the load address's page) and a switchable high bank selected by writing
 *   its page number, as a whole byte, to $2000-$3FFF (the format spec's
 *   own words: pages are aligned relative to the load address, and a page
 *   is selected by writing its number there). This player only supports a
 *   load address below $4000 needing more than one page, or a load address
 *   at or above $4000 needing only one; the other combination - a load
 *   address in the banked window whose program spans more than one page -
 *   is rejected explicitly rather than guessed at, since the format spec
 *   does not say how such a file's fixed bank would be populated.
 *   $0000-$1FFF, $4000-$5FFF and $6000-$7FFF are real MBC control lines
 *   (RAM enable, RAM bank/upper ROM bits, mode select) this player does not
 *   implement; writes there are accepted and ignored, exactly as real
 *   silicon ignores a write to an MBC register a cartridge does not wire
 *   up. $A000-$BFFF (cartridge RAM) is a zeroed, non-persistent shadow.
 * - **RST and interrupt vectors, relocated to the load address.** A GBS
 *   file's RST/interrupt handlers live at `loadAddress + offset`, not at
 *   the fixed addresses real hardware calls them at, because the file has
 *   no boot ROM to place it there itself. This player writes an ordinary
 *   `JP loadAddress+offset` at each of $00/$08/.../$38 (RST) and
 *   $40/$48/.../$60 (interrupts) into the low ROM bank before running
 *   anything, exactly the relocation the format spec describes - the CPU
 *   itself stays generic; nothing in `cpu.ts` knows GBS exists.
 * - **INIT then PLAY, at VBlank or the header's timer rate.** INIT is
 *   called once with the zero-based song index in A; PLAY is then called
 *   repeatedly, every 70224 cycles (VBlank, 59.7 Hz) unless the header's
 *   timer is enabled, in which case every `(256 - timerModulo) <<
 *   shift(timerControl)` cycles instead. Neither call is reached through a
 *   real interrupt: like every GBS player, this one calls them directly at
 *   the cycle they are due, which is musically identical and lets a
 *   deadline (below) catch a routine that never returns instead of
 *   silently drifting the song's timing around it.
 * - **HALT still needs somewhere to wake up to.** A driver that does
 *   `ei; halt` to pace its own loop against VBlank (a standard idiom, not
 *   specific to any one driver) would hang forever if nothing ever set an
 *   interrupt flag. This player runs a minimal, generic VBlank/timer edge
 *   tracker - IF's bit 0 every 70224 cycles, bit 2 at the header's own
 *   timer rate if enabled - enough to wake HALT and to service `ei`'d code
 *   that jumps through the relocated vectors above; it is not a PPU, and
 *   the well-known HALT-bug artifact (IME=0, IE&IF already set at the
 *   moment of HALT) is not reproduced.
 *
 * What is deliberately not modeled, and fails loud rather than silently:
 * a version other than 1; a load address outside $400-$7FFF; the CGB
 * double-speed timer bit; reserved timer-control bits; a track outside
 * [1, songCount]; a serial transfer (`$FF02` bit 7 set - this player has no
 * link cable partner); INIT or PLAY overrunning its cycle budget. What is
 * modeled as an inert, DMG-accurate stub because real DMG hardware has
 * nothing wired up there either: VRAM, OAM, the LCD/PPU registers, cart
 * RAM persistence, CGB-only I/O ($FF4D and the palette/HDMA registers), and
 * the joypad (always reads "nothing pressed").
 */
export function importGbs(bytes: Uint8Array, options: GbsImportOptions = {}): PerformancePlan {
  const header = parseGbsHeader(bytes);
  const track = options.track ?? header.firstSong;
  if (!Number.isInteger(track) || track < 1 || track > header.songCount) throw new Error('Invalid GBS track');
  const seconds = options.seconds ?? 150;
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 600) throw new Error('Invalid GBS render length');

  const program = bytes.subarray(HEADER_SIZE);
  if (program.length === 0) throw new Error('GBS has no program data');
  const pageSize = 0x4000;
  const virtualSize = header.loadAddress + program.length;
  const pageCount = Math.ceil(virtualSize / pageSize);
  if (header.loadAddress >= pageSize && pageCount > 1) throw new Error('Unsupported GBS memory layout: load address is in the banked window and the program needs more than one page');
  const rom = new Uint8Array(pageCount * pageSize);
  rom.set(program, header.loadAddress);

  // The format spec's own relocation: an ordinary JP at each vector address.
  for (const offset of [0x00, 0x08, 0x10, 0x18, 0x20, 0x28, 0x30, 0x38, 0x40, 0x48, 0x50, 0x58, 0x60]) {
    const target = (header.loadAddress + offset) & 0xffff;
    rom[offset] = 0xc3;
    rom[offset + 1] = target & 0xff;
    rom[offset + 2] = (target >> 8) & 0xff;
  }

  const wram = new Uint8Array(0x2000); // $C000-$DFFF; RAM is cleared, per the format spec.
  const hram = new Uint8Array(0x80); // $FF80-$FFFE, plus IE shadowed at index $7F.
  const vram = new Uint8Array(0x2000), oam = new Uint8Array(0xa0), sram = new Uint8Array(0x2000);
  const apu = new Uint8Array(0x30); // $FF10-$FF3F shadow: last write wins, read back as written.
  const io = new Uint8Array(0x80); // Everything else in $FF00-$FF7F: inert unless named above.
  let bank = 1; // Power-on default; a one-page file never needs it read.
  let divEpoch = 0;

  const events: PerformancePlan['events'] = [];
  const seedApu = (addr: number, value: number) => { apu[addr - 0xff10] = value; events.push({at: 0, addr, value}); };
  // The boot ROM's own power-up register state (Pan Docs), reused verbatim
  // from `packages/conform/src/roms/gb.mjs`'s already-vetted harness table:
  // the same state `docs/chips/dmg.md`'s "Power-on state" section describes
  // as what a cartridge sees once the boot ROM has finished, chime included.
  for (const [addr, value] of [[0xff26, 0x80], [0xff25, 0xf3], [0xff24, 0x77], [0xff10, 0x80], [0xff11, 0xbf], [0xff12, 0xf3], [0xff14, 0xbf], [0xff17, 0x3f], [0xff1a, 0x7f], [0xff1c, 0x9f], [0xff21, 0x00], [0xff22, 0x00]] as const) seedApu(addr, value);

  let nextVblank = VBLANK_PERIOD;
  const timerEnabled = (header.timerControl & 0x04) !== 0;
  const timerShift = TIMER_SHIFT[header.timerControl & 3];
  const timerPeriod = (256 - header.timerModulo) << timerShift;
  let nextTimer = timerPeriod;
  let tima = header.timerModulo;

  const bus: Sm83Bus = {
    tick(t: number) {
      const now = cpu.cycles; // cpu.cycles has already advanced by t when tick() runs (see Sm83.tick).
      if (now >= nextVblank) { io[0x0f] |= 0x01; nextVblank += VBLANK_PERIOD; }
      if (timerEnabled) {
        while (now >= nextTimer) {
          nextTimer += timerPeriod;
          tima = (tima + 1) & 0xff;
          if (tima === 0) { tima = header.timerModulo; io[0x0f] |= 0x04; }
        }
      }
    },
    interrupts() { return io[0x0f] & hram[0x7f] & 0x1f; },
    acknowledge(bit: number) { io[0x0f] &= ~bit; },
    read(addr: number) {
      if (addr < pageSize) return rom[addr];
      if (addr < 0x8000) { const page = addr < 0x4000 ? 0 : bank; if (page >= pageCount) throw new Error(`GBS selects ROM bank ${page} beyond the file's ${pageCount} bank(s)`); return rom[page * pageSize + (addr & 0x3fff)]; }
      if (addr < 0xa000) return vram[addr - 0x8000];
      if (addr < 0xc000) return sram[addr - 0xa000];
      if (addr < 0xe000) return wram[addr - 0xc000];
      if (addr < 0xfe00) return wram[addr - 0xe000];
      if (addr < 0xfea0) return oam[addr - 0xfe00];
      if (addr < 0xff00) return 0xff;
      if (addr === 0xff00) return 0xcf | (io[0x00] & 0x30); // Nothing pressed: bits 0-3 read high.
      if (addr === 0xff04) return ((cpu.cycles - divEpoch) >> 8) & 0xff;
      if (addr === 0xff05) return tima;
      if (addr === 0xff06) return header.timerModulo;
      if (addr === 0xff07) return header.timerControl;
      if (addr >= 0xff10 && addr <= 0xff3f) return apu[addr - 0xff10];
      if (addr === 0xffff) return hram[0x7f];
      if (addr >= 0xff80) return hram[addr - 0xff80];
      return io[addr - 0xff00];
    },
    write(addr: number, value: number) {
      value &= 0xff;
      if (addr >= 0x2000 && addr < 0x4000) { bank = value; return; }
      if (addr < 0x8000) return; // RAM enable / RAM bank/upper bits / mode select: no MBC RAM is modeled.
      if (addr < 0xa000) { vram[addr - 0x8000] = value; return; }
      if (addr < 0xc000) { sram[addr - 0xa000] = value; return; }
      if (addr < 0xe000) { wram[addr - 0xc000] = value; return; }
      if (addr < 0xfe00) { wram[addr - 0xe000] = value; return; }
      if (addr < 0xfea0) { oam[addr - 0xfe00] = value; return; }
      if (addr < 0xff00) return;
      if (addr === 0xff00) { io[0x00] = value & 0x30; return; }
      if (addr === 0xff01) { io[0x01] = value; return; }
      if (addr === 0xff02) { if (value & 0x80) throw new Error('GBS playback does not model the serial port'); io[0x02] = value; return; }
      if (addr === 0xff04) { divEpoch = cpu.cycles; return; }
      if (addr === 0xff05) { tima = value; return; }
      if (addr === 0xff06) return; // header.timerModulo is authoritative for this player's own timer edges.
      if (addr === 0xff07) return; // likewise header.timerControl.
      if (addr === 0xff0f) { io[0x0f] = value & 0x1f; return; }
      if (addr >= 0xff10 && addr <= 0xff3f) { if (events.length >= 2_000_000) throw new Error('GBS exceeds two million register writes'); apu[addr - 0xff10] = value; events.push({at: cpu.cycles, addr, value}); return; }
      if (addr === 0xffff) { hram[0x7f] = value & 0x1f; return; }
      if (addr >= 0xff80) { hram[addr - 0xff80] = value; return; }
      io[addr - 0xff00] = value;
    },
  };

  const cpu = new Sm83(bus);

  // A driver's own RET pops this back into PC; it is never fetched from
  // (the loop below stops as soon as PC reaches it), so nothing needs to
  // live there.
  const call = (address: number, budgetFrames: number) => {
    cpu.sp = (header.stackPointer - 2) & 0xffff;
    bus.write(cpu.sp, SENTINEL & 0xff);
    bus.write((cpu.sp + 1) & 0xffff, SENTINEL >> 8);
    cpu.pc = address;
    cpu.halted = false;
    const deadline = cpu.cycles + budgetFrames * VBLANK_PERIOD;
    while (cpu.pc !== SENTINEL) {
      // Polled once per instruction boundary: wakes a HALT waiting on
      // VBlank or the timer, and services the vector when IME is set.
      cpu.interrupt();
      cpu.step();
      if (cpu.cycles > deadline) throw new Error(`GBS routine at $${address.toString(16)} exceeded its ${budgetFrames}-frame budget`);
    }
  };

  cpu.a = track - 1;
  cpu.sp = header.stackPointer;
  // A driver that clears memory or builds a table in INIT is legitimate;
  // give it more room than the one-frame budget PLAY must keep to.
  call(header.initAddress, 4);
  const period = timerEnabled ? timerPeriod : VBLANK_PERIOD;
  const frames = Math.max(1, Math.round((seconds * CLOCK_HZ) / period));
  for (let frame = 0; frame < frames; frame++) {
    cpu.cycles = (frame + 1) * period;
    call(header.playAddress, 1);
  }

  return {chip: 'dmg', seconds: (frames * period) / CLOCK_HZ, loopStartSeconds: 0, events, memory: [], notes: [], losses: []};
}
