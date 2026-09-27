/**
 * NSF: a 2A03 song as a cartridge, playable in any NSF player.
 *
 * Where `toVgm` hands a player a flat log of writes and waits, an NSF hands
 * it a program: two 6502 routines, INIT and PLAY, that the player's own
 * emulated CPU runs. INIT sets up the APU once; PLAY runs once per 60 Hz
 * frame, forever, and is expected to return before the next frame is due.
 * That shape does not fit a write log directly, so this module carries one
 * of its own: a tiny 6502 player (below, `assemblePlayer`) that reads a
 * compact per-frame encoding of the capture's own writes out of ROM and
 * replays them, looping at the requested cycle forever.
 *
 * The player is hand-assembled here rather than run through ca65 or ported
 * from an existing driver (decision 41: nothing in `packages/chipvoice` may
 * be derived from a GPL oracle, and this package carries no assembler
 * dependency). `Asm6502` below is the whole toolchain it needs: named
 * mnemonics, labels, and two-pass branch/jump resolution, so the program
 * reads as assembly and the bytes it emits are exactly reproducible from
 * this file - never an opaque blob.
 *
 * Write timing is quantized to the frame: a capture stamps every write in
 * CPU cycles, but PLAY can only place writes at its own call, once per
 * frame. A pitch or volume change mid-frame lands at the start of the frame
 * it falls in instead, at most one frame (~16.7 ms) early. `scores/
 * nsf-export/corpus.mjs` measures what that costs in rendered audio, on the
 * repo's own NES content, and states a threshold; nothing here approximates
 * silently; DMC/DPCM playback (a real DMA read of cartridge memory, timed
 * inside the frame) has no representation in this player at all and fails
 * loudly instead.
 */

import type { RegisterEvent } from "./chip.js";

/** Standard $411a NTSC frame period, in CPU cycles: 357366 PPU clocks over
 * four frames (the NTSC APU frame counter's own rate), matching the
 * convention `scores/capture-nsf.mjs` and `scores/arrangements/
 * native-oracle.py`'s GME oracle both already use for this same file
 * format, so frame boundaries here agree with theirs by construction. */
const NTSC_FRAME_PERIOD = (262 * 341 * 4 - 2) / 12;

/** 2A03 register range an NSF's PLAY routine is allowed to touch. */
const REG_BASE = 0x4000;
const REG_LAST = 0x4017;

/** Bank-switching model (nesdev's NSF spec): eight bytes at $5FF8-$5FFF,
 * each mapping a 4 KiB CPU window starting at $8000 + 0x1000*index to a
 * 4 KiB page of the file's program data. This player only ever needs one
 * data page resident at a time, so it uses a single fixed window - bank
 * register 6, the $E000-$EFFF window - for all of it, and mirrors the code
 * page into every other register so a player that resets all eight
 * registers to the header's `BankSwitchInit` values before the first INIT
 * call still finds the code at $8000 regardless of which window it reads
 * fetch bytes through. */
const CODE_PAGE = 0;
const DATA_WINDOW_REG = 6; // $5FFE, mapping $E000-$EFFF
const DATA_WINDOW_BASE = 0xe000;
const PAGE_SIZE = 4096;
const MAX_PAGES = 256; // one byte per bank register value

export class NsfExportError extends Error {
  readonly code: "dmc_unsupported" | "frame_overflow" | "rom_too_large" | "invalid_loop_point" | "metadata_too_long" | "metadata_not_ascii";
  readonly measured?: number;
  readonly limit?: number;
  constructor(code: NsfExportError["code"], message: string, detail: { measured?: number; limit?: number } = {}) {
    super(message);
    this.name = "NsfExportError";
    this.code = code;
    this.measured = detail.measured;
    this.limit = detail.limit;
  }
}

export interface NsfOptions {
  /** Shown by players as the track's name. */
  title?: string;
  author?: string;
  /** Shown by players as the copyright/publisher line. */
  copyright?: string;
  /**
   * Where playback returns to, forever, in cycles. Left out, the whole
   * capture repeats (cycle 0) - NSF has no "play once" convention the way a
   * VGM player does, since nothing marks a cartridge as finished.
   */
  loopAtCycle?: number;
  /**
   * DMC sample memory a capture loaded, if any (`RecordedSong.memory` /
   * `PerformancePlan.memory`). Always rejected today (see the module
   * comment); accepted as an option so a caller that has it gets a named
   * error instead of silent silence where a sample should be.
   */
  memory?: { address: number; bytes: Uint8Array }[];
}

/** One frame's worth of register writes, in the order they happened. */
type Frame = { addr: number; value: number }[];

/**
 * Buckets writes into 60 Hz frames using the same boundary rule the NSF
 * capture side already relies on (`Math.round(f * period)`), and finds
 * which frame the requested loop cycle falls into by the identical rule -
 * one sweep, one definition of a frame boundary, so the loop point can
 * never disagree with how events were bucketed.
 */
function quantizeToFrames(events: RegisterEvent[], cycles: number, loopAtCycle: number): { frames: Frame[]; loopFrame: number } {
  const frameCount = Math.max(1, Math.ceil(cycles / NTSC_FRAME_PERIOD));
  const frames: Frame[] = [];
  let cursor = 0;
  let loopFrame = frameCount - 1;
  for (let f = 0; f < frameCount; f++) {
    const start = Math.round(f * NTSC_FRAME_PERIOD);
    const end = Math.round((f + 1) * NTSC_FRAME_PERIOD);
    if (loopAtCycle >= start && loopAtCycle < end) loopFrame = f;
    const bucket: Frame = [];
    while (cursor < events.length && events[cursor].at < end) {
      bucket.push({ addr: events[cursor].addr, value: events[cursor].value & 0xff });
      cursor++;
    }
    if (bucket.length > 254) throw new NsfExportError("frame_overflow", `Frame ${f} has ${bucket.length} register writes; the player's per-frame write-list can only address up to 254 in one frame.`, { measured: bucket.length, limit: 254 });
    frames.push(bucket);
  }
  return { frames, loopFrame };
}

/**
 * Encodes frames into the byte stream PLAY's `readByte`/`decode` loop
 * understands:
 *
 *   - `N (1-254)` then `N` `(offset, value)` pairs: that many register
 *     writes this frame, `offset` added to $4000.
 *   - `0`: no writes this frame (cheaper than a one-frame run below).
 *   - `0xFF R (R>=1)`: `R` consecutive silent frames (most NSF content is
 *     mostly held notes, so a run of silence is the common case; this pays
 *     two bytes for up to 254 empty frames instead of one byte each).
 *   - `0xFF 0`: loop - jump back to the frame this file's loop point names,
 *     forever.
 *
 * A run is never allowed to swallow the loop frame: that frame must always
 * start its own token, because the loop-back jump targets a stream
 * position, and a frame folded into the middle of a preceding run has no
 * stream position of its own to land on.
 */
function encodeFrames(frames: Frame[], loopFrame: number): { data: number[]; loopOffset: number } {
  const data: number[] = [];
  let loopOffset = -1;
  let i = 0;
  while (i < frames.length) {
    if (i === loopFrame) loopOffset = data.length;
    const bucket = frames[i];
    if (bucket.length === 0) {
      let j = i + 1;
      while (j < frames.length && frames[j].length === 0 && j !== loopFrame && j - i < 255) j++;
      const run = j - i;
      if (run === 1) data.push(0);
      else data.push(0xff, run);
      i = j;
    } else {
      data.push(bucket.length);
      for (const w of bucket) data.push((w.addr - REG_BASE) & 0xff, w.value);
      i++;
    }
  }
  if (loopOffset < 0) loopOffset = data.length; // loopFrame === frames.length can't happen (validated below); kept as a safe fallback
  data.push(0xff, 0x00); // terminal token: loop back to loopOffset, forever
  return { data, loopOffset };
}

function toPagePointer(offset: number, firstDataPage: number): { page: number; ptrHi: number; ptrLo: number } {
  const page = firstDataPage + Math.floor(offset / PAGE_SIZE);
  const within = offset % PAGE_SIZE;
  return { page, ptrHi: (DATA_WINDOW_BASE >> 8) + (within >> 8), ptrLo: within & 0xff };
}

// -- A minimal 6502 assembler: named mnemonics and two-pass label/branch
// resolution, so the player program below reads as assembly and its bytes
// are mechanically, verifiably derived from it. Opcodes are the plain
// 6502's (no illegal/undocumented instructions), matched against the
// classic opcode table (e.g. the 6502 datasheet, nesdev's "6502 instructions").

const SEI = 0x78, CLD = 0xd8, LDA_IMM = 0xa9, LDY_IMM = 0xa0;
const STA_ABS = 0x8d, STA_ABS_Y = 0x99, STA_ZP = 0x85, LDA_ZP = 0xa5, LDY_ZP = 0xa4, LDA_IND_Y = 0xb1;
const CMP_IMM = 0xc9, BEQ = 0xf0, BNE = 0xd0, JMP_ABS = 0x4c, JSR_ABS = 0x20, RTS = 0x60;
const INC_ZP = 0xe6, DEC_ZP = 0xc6, TAX = 0xaa, DEX = 0xca, PHA = 0x48, PLA = 0x68;
const SEC = 0x38, SBC_IMM = 0xe9;

class Asm6502 {
  readonly bytes: number[] = [];
  private readonly labels = new Map<string, number>();
  private readonly fixups: { pos: number; label: string; kind: "rel" | "abs" }[] = [];
  constructor(private readonly base: number) {}

  label(name: string): void {
    this.labels.set(name, this.base + this.bytes.length);
  }
  op(code: number): this {
    this.bytes.push(code);
    return this;
  }
  imm(code: number, value: number): this {
    this.bytes.push(code, value & 0xff);
    return this;
  }
  zp(code: number, addr: number): this {
    this.bytes.push(code, addr & 0xff);
    return this;
  }
  abs(code: number, addr: number): this {
    this.bytes.push(code, addr & 0xff, (addr >> 8) & 0xff);
    return this;
  }
  branchTo(code: number, label: string): this {
    this.bytes.push(code);
    this.fixups.push({ pos: this.bytes.length, label, kind: "rel" });
    this.bytes.push(0);
    return this;
  }
  jsrTo(label: string): this {
    this.bytes.push(JSR_ABS);
    this.fixups.push({ pos: this.bytes.length, label, kind: "abs" });
    this.bytes.push(0, 0);
    return this;
  }
  jmpTo(label: string): this {
    this.bytes.push(JMP_ABS);
    this.fixups.push({ pos: this.bytes.length, label, kind: "abs" });
    this.bytes.push(0, 0);
    return this;
  }
  address(label: string): number {
    const at = this.labels.get(label);
    if (at === undefined) throw new Error(`nsf player: unresolved label ${label}`);
    return at;
  }
  resolve(): void {
    for (const fix of this.fixups) {
      const target = this.address(fix.label);
      if (fix.kind === "rel") {
        const offset = target - (this.base + fix.pos + 1);
        if (offset < -128 || offset > 127) throw new Error(`nsf player: branch to ${fix.label} out of range (${offset})`);
        this.bytes[fix.pos] = offset & 0xff;
      } else {
        this.bytes[fix.pos] = target & 0xff;
        this.bytes[fix.pos + 1] = (target >> 8) & 0xff;
      }
    }
  }
}

/**
 * The player: INIT sets up the APU and this frame reader's state; PLAY
 * replays one frame's writes (or, mid-run-length-count, none) each call.
 *
 * Zero page: $00/$01 the read pointer (low/high), $02 the current data
 * page (mirrored into bank register 6 whenever it changes), $03 how many
 * more frames to skip before decoding the next token (the run-length
 * counter), $04 a write's register offset, held here rather than in Y
 * across the second of a pair's two `readByte` calls - `readByte` needs Y
 * as its own scratch register (`LDA (zp),Y` with Y always 0), and would
 * clobber the offset if it stayed there.
 */
function assemblePlayer(firstDataPage: number, loopPage: number, loopPtrHi: number, loopPtrLo: number): { bytes: number[]; initAddr: number; playAddr: number } {
  const ZP_PTR_LO = 0x00, ZP_PTR_HI = 0x01, ZP_PAGE = 0x02, ZP_REPEAT = 0x03, ZP_OFFSET = 0x04;
  const BANK6_REG = 0x5ffe; // $5FF8 + 6: the register mapping $E000-$EFFF

  const asm = new Asm6502(0x8000);

  // No stack reset here: the NSF player's own driver stub sets up S before
  // ever jumping to INIT (nesdev's NSF convention - the player calls INIT
  // and PLAY the way a subroutine is called, and expects each to RTS back
  // to it), so INIT touching S would strand the player's own return
  // address instead of the file's.
  asm.label("init");
  asm.op(SEI);
  asm.op(CLD);
  asm.imm(LDA_IMM, 0x00);
  asm.abs(STA_ABS, 0x4015); // silence every channel...
  asm.imm(LDA_IMM, 0x40);
  asm.abs(STA_ABS, 0x4017); // ...then enable the frame counter with IRQ off
  asm.imm(LDA_IMM, (DATA_WINDOW_BASE >> 8) & 0xff);
  asm.zp(STA_ZP, ZP_PTR_HI);
  asm.imm(LDA_IMM, 0x00);
  asm.zp(STA_ZP, ZP_PTR_LO);
  asm.imm(LDA_IMM, firstDataPage);
  asm.zp(STA_ZP, ZP_PAGE);
  asm.imm(LDA_IMM, 0x00);
  asm.zp(STA_ZP, ZP_REPEAT);
  asm.op(RTS);

  asm.label("play");
  asm.zp(LDA_ZP, ZP_REPEAT);
  asm.branchTo(BEQ, "decode");
  asm.zp(DEC_ZP, ZP_REPEAT); // mid-run: skip this frame, one run frame closer to the next token
  asm.op(RTS);

  asm.label("decode");
  asm.jsrTo("readByte"); // A = control byte
  asm.imm(CMP_IMM, 0xff);
  asm.branchTo(BEQ, "special");
  asm.op(TAX); // X = pair count (sets Z from the count itself)
  asm.branchTo(BEQ, "playRts");
  asm.label("pairLoop");
  asm.jsrTo("readByte"); // A = register offset from $4000
  asm.zp(STA_ZP, ZP_OFFSET); // readByte's own LDY #0 would clobber Y, so this rides in zero page instead
  asm.jsrTo("readByte"); // A = value
  asm.zp(LDY_ZP, ZP_OFFSET);
  asm.abs(STA_ABS_Y, REG_BASE);
  asm.op(DEX);
  asm.branchTo(BNE, "pairLoop");
  asm.label("playRts");
  asm.op(RTS);

  asm.label("special");
  asm.jsrTo("readByte"); // A = the run length, or 0 for "loop"
  asm.imm(CMP_IMM, 0x00);
  asm.branchTo(BNE, "isRepeat");
  asm.imm(LDA_IMM, loopPage);
  asm.zp(STA_ZP, ZP_PAGE);
  asm.abs(STA_ABS, BANK6_REG);
  asm.imm(LDA_IMM, loopPtrHi);
  asm.zp(STA_ZP, ZP_PTR_HI);
  asm.imm(LDA_IMM, loopPtrLo);
  asm.zp(STA_ZP, ZP_PTR_LO);
  asm.jmpTo("decode"); // this frame plays the loop target's own first token, immediately
  asm.label("isRepeat");
  asm.op(SEC);
  asm.imm(SBC_IMM, 0x01); // this frame is already the run's first silent frame
  asm.zp(STA_ZP, ZP_REPEAT);
  asm.op(RTS);

  // A = *ptr++, rolling from $EFFF back to $E000 and swapping in the next
  // data page (mirrored into bank register 6) whenever the pointer would
  // walk past the fixed 4 KiB window.
  asm.label("readByte");
  asm.imm(LDY_IMM, 0x00);
  asm.zp(LDA_IND_Y, ZP_PTR_LO);
  asm.op(PHA);
  asm.zp(INC_ZP, ZP_PTR_LO);
  asm.branchTo(BNE, "readDone");
  asm.zp(INC_ZP, ZP_PTR_HI);
  asm.zp(LDA_ZP, ZP_PTR_HI);
  asm.imm(CMP_IMM, ((DATA_WINDOW_BASE + PAGE_SIZE) >> 8) & 0xff);
  asm.branchTo(BNE, "readDone");
  asm.imm(LDA_IMM, (DATA_WINDOW_BASE >> 8) & 0xff);
  asm.zp(STA_ZP, ZP_PTR_HI);
  asm.zp(INC_ZP, ZP_PAGE);
  asm.zp(LDA_ZP, ZP_PAGE);
  asm.abs(STA_ABS, BANK6_REG);
  asm.label("readDone");
  asm.op(PLA);
  asm.op(RTS);

  asm.resolve();
  if (asm.bytes.length > PAGE_SIZE) throw new Error(`nsf player: ${asm.bytes.length} bytes, more than one 4 KiB page`);
  return { bytes: asm.bytes, initAddr: asm.address("init"), playAddr: asm.address("play") };
}

function asciiField(bytes: Uint8Array, offset: number, length: number, text: string, field: string): void {
  if (!/^[\x20-\x7e]*$/.test(text)) throw new NsfExportError("metadata_not_ascii", `${field} must be plain ASCII (0x20-0x7e); NSF's header has no encoding to carry anything wider.`);
  if (text.length > length - 1) throw new NsfExportError("metadata_too_long", `${field} is ${text.length} characters, more than the header field's ${length - 1} (one byte is reserved for the terminator).`, { measured: text.length, limit: length - 1 });
  for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
}

/**
 * Builds a standard NSF v1 file: one song, NTSC only, no expansion audio.
 * NSF2's added feature bits (a non-returning INIT, its own IRQ, a
 * suppressed PLAY) and NSFe's richer metadata have no counterpart this
 * player needs - one song's title/artist/copyright fit NSF v1's header
 * fields exactly - so there is no reason to spend the extra version.
 *
 * @param events register writes, stamped in 2A03 CPU cycles (as `recordSong` / `planPerformance` produce them)
 * @param cycles how long the capture runs, in cycles: writes at or past it are dropped
 */
export function exportNsf(events: RegisterEvent[], cycles: number, options: NsfOptions = {}): Uint8Array<ArrayBuffer> {
  if (!Number.isFinite(cycles) || cycles <= 0) throw new Error("nsf: invalid capture length");

  if (options.memory && options.memory.length) {
    throw new NsfExportError("dmc_unsupported", "This capture loaded DMC/DPCM sample memory; this player only replays register writes in 60 Hz bursts and has no mechanism to serve sample bytes through a real DMA read during playback.", { measured: options.memory.length, limit: 0 });
  }
  // $4010-$4013 alone configure the DMC's rate, its direct-load DAC value,
  // and a sample's address/length; a driver clearing them to 0 at power-on
  // (this project's own capture-nsf.mjs ceremony does exactly that, and
  // real drivers commonly mirror it) is not DMC playback and is carried
  // like any other register write. What actually starts a DMA sample read
  // - the CPU stalling while the cartridge serves bytes mid-frame, which
  // this burst-per-PLAY-call replay has no way to carry - is $4015 written
  // with bit 4 set (`Nes_Apu`'s own enable/restart convention). A bare
  // $4011 write (writing straight to the DAC, never enabling the DMA
  // channel) is an ordinary register write this player already carries,
  // subject to the same frame quantization as every other write.
  const dmcWrites = events.filter((e) => e.addr === 0x4015 && (e.value & 0x10) !== 0);
  if (dmcWrites.length) {
    throw new NsfExportError("dmc_unsupported", "This capture enables DMC/DPCM sample playback ($4015 written with bit 4 set); that needs its sample bytes served sub-frame, from cartridge memory, during the CPU's own stall on a real DMA read - this player only replays writes once per 60 Hz frame and cannot carry it.", { measured: dmcWrites.length, limit: 0 });
  }

  const loopAtCycle = options.loopAtCycle ?? 0;
  if (!Number.isFinite(loopAtCycle) || loopAtCycle < 0 || loopAtCycle >= cycles) {
    throw new NsfExportError("invalid_loop_point", `loopAtCycle must fall within [0, cycles); got ${loopAtCycle} for a ${cycles}-cycle capture.`, { measured: loopAtCycle, limit: cycles });
  }

  const kept = events.filter((e) => e.addr >= REG_BASE && e.addr <= REG_LAST).sort((a, b) => a.at - b.at);
  const { frames, loopFrame } = quantizeToFrames(kept, cycles, loopAtCycle);
  const { data, loopOffset } = encodeFrames(frames, loopFrame);

  const FIRST_DATA_PAGE = 1;
  const { page: loopPage, ptrHi: loopPtrHi, ptrLo: loopPtrLo } = toPagePointer(loopOffset, FIRST_DATA_PAGE);
  const dataPages = Math.max(1, Math.ceil(data.length / PAGE_SIZE));
  if (1 + dataPages > MAX_PAGES) {
    throw new NsfExportError("rom_too_large", `The encoded write stream needs ${dataPages} 4 KiB banks plus the code bank, more than NSF's ${MAX_PAGES}-bank limit (one byte per bank register).`, { measured: (1 + dataPages) * PAGE_SIZE, limit: MAX_PAGES * PAGE_SIZE });
  }

  const player = assemblePlayer(FIRST_DATA_PAGE, loopPage, loopPtrHi, loopPtrLo);

  const totalPages = 1 + dataPages;
  const pool = new Uint8Array(totalPages * PAGE_SIZE);
  pool.set(player.bytes, CODE_PAGE * PAGE_SIZE);
  pool.set(data, FIRST_DATA_PAGE * PAGE_SIZE);

  const HEADER = 128;
  const file = new Uint8Array(HEADER + pool.length);
  const view = new DataView(file.buffer);
  file.set([0x4e, 0x45, 0x53, 0x4d, 0x1a], 0); // "NESM" 0x1A
  file[5] = 1; // version
  file[6] = 1; // total songs
  file[7] = 1; // starting song (1-based)
  view.setUint16(8, 0x8000, true); // load address
  view.setUint16(10, player.initAddr, true);
  view.setUint16(12, player.playAddr, true);
  asciiField(file, 14, 32, options.title ?? "", "title");
  asciiField(file, 46, 32, options.author ?? "", "author");
  asciiField(file, 78, 32, options.copyright ?? "", "copyright");
  view.setUint16(110, 16666, true); // NTSC speed, the standard $411a rate
  for (let reg = 0; reg < 8; reg++) file[112 + reg] = CODE_PAGE; // mirror code into every window...
  file[112 + DATA_WINDOW_REG] = FIRST_DATA_PAGE; // ...except the one window PLAY reads data through
  view.setUint16(120, 19997, true); // PAL speed, unused (NTSC-only below) but set to the standard value
  file[122] = 0; // NTSC only
  file[123] = 0; // no expansion sound chip
  file.set(pool, HEADER);
  return file;
}
