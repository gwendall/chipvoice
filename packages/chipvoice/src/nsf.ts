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
 * it falls in instead, at most one frame (~16.7 ms) early, and a burst of
 * writes a source driver spaced a few cycles apart (a vibrato trick, say)
 * collapses to however far apart PLAY's own instructions land them.
 * `scores/nsf-export/corpus.mjs` measures exactly that cost - nothing else
 * - by rendering GME's own trace of the exported file and comparing it
 * against a render of the untouched capture, both through this project's
 * own DSP, and states a threshold from the measured band; nothing here
 * approximates silently.
 *
 * DMC/DPCM sample playback is autonomous hardware DMA: the 2A03 itself,
 * not PLAY's own code, steals CPU cycles to read cartridge memory at
 * $C000-$FFFF while the CPU stalls, driven purely by $4012 (sample
 * address), $4013 (sample length) and $4015 bit 4 (start/restart). None of
 * that needs a mid-frame instruction from PLAY, so a capture that carries
 * its sample memory (`NsfOptions.memory`) exports normally: the sample
 * bytes are placed at their real addresses in a fixed upper bank that is
 * never bank-switched away, and the $4010-$4013/$4015 writes replay at
 * frame start like any other register write. A capture that enables DMC
 * without carrying its sample bytes is rejected by name
 * (`dmc_sample_missing`) rather than exported silently short a sample. The
 * one DMC-adjacent case this player genuinely cannot carry is raw $4011
 * streaming - writing the direct-load DAC many times within a single frame
 * to reconstruct a waveform without ever touching the DMA channel - since
 * that needs each write timed to a fraction of a frame; it is rejected as
 * `dmc_unsupported`.
 *
 * Konami's VRC6 (`isVrc6Addr`, `chips/nes/vrc6-core.ts`) rides the same
 * cartridge bus as the 2A03 but its ten registers sit at $9000-$9003,
 * $A000-$A002 and $B000-$B002 - three pages away from $4000-$4017, too far
 * for one `base+Y` store to reach both ranges. A capture that writes any of
 * them is carried the same way as any 2A03 write (one byte per frame's
 * write, quantized the same way), through a small in-ROM table of whichever
 * registers this particular capture actually touches (`assemblePlayer`'s
 * `regLoTable`/`regHiTable`) rather than a fixed offset from $4000; see
 * that function's own doc comment for the dispatch this replaced. The
 * file's own header records this: NSF's expansion-audio byte at offset 123
 * sets bit 0 (VRC6) whenever the capture used any of the ten registers, so
 * a player that supports VRC6 knows to route them, and one that does not
 * knows to refuse the file rather than misplay it silently.
 */

import type { RegisterEvent } from "./chip.js";
import { isVrc6Addr } from "./chips/nes/vrc6-core.js";

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
 * register 1, the $9000-$9FFF window - for all of it, and mirrors the code
 * page into every other register so a player that resets all eight
 * registers to the header's `BankSwitchInit` values before the first INIT
 * call still finds the code at $8000 regardless of which window it reads
 * fetch bytes through.
 *
 * Registers 4-7 ($C000-$FFFF) are reserved, whole, for DMC/DPCM sample
 * memory: real DMA hardware reads that range directly, at any moment, so
 * whatever is mapped there has to hold the song's sample bytes for the
 * entire time DMC might fire, never swapped for the write log's own use
 * the way a bank-switched NSF might otherwise reuse it. When a capture
 * carries no sample memory, these four registers just mirror the code
 * page too, same as any other unused window. */
const CODE_PAGE = 0;
const DATA_WINDOW_REG = 1; // $5FF9, mapping $9000-$9FFF
const DATA_WINDOW_BASE = 0x9000;
const DMC_FIRST_REG = 4; // $5FFC-$5FFF, mapping $C000-$FFFF across four consecutive registers
const DMC_REG_COUNT = 4;
const DMC_BASE = 0xc000; // the only range the DMC's hardware DMA can read from
const DMC_DAC_STREAM_LIMIT = 4; // $4011 writes within one 60 Hz frame before it's PCM streaming, not driver bookkeeping
const PAGE_SIZE = 4096;
const MAX_PAGES = 256; // one byte per bank register value

export class NsfExportError extends Error {
  readonly code: "dmc_unsupported" | "dmc_sample_missing" | "frame_overflow" | "rom_too_large" | "invalid_loop_point" | "metadata_too_long" | "metadata_not_ascii" | "too_many_registers";
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
   * `PerformancePlan.memory`). Every block must fall within $C000-$FFFF -
   * the only range the DMC's hardware DMA can read from - and is embedded
   * in a fixed upper bank of the file that is never bank-switched away, so
   * a real DMA read always finds the right bytes no matter when it fires.
   * A capture that enables DMC ($4015 bit 4) without supplying the memory
   * that carries its samples is rejected (`dmc_sample_missing`) rather
   * than exported silently short a sample.
   */
  memory?: { address: number; bytes: Uint8Array }[];
}

/** One frame's worth of register writes, in the order they happened. */
type Frame = { addr: number; value: number }[];

/**
 * The most times a single register is written within any one 60 Hz frame -
 * a coarse, approximate bucketing (`Math.floor`, not `quantizeToFrames`'s
 * exact rounding) that only needs to be right at the scale genuine PCM
 * streaming shows up at: dozens to hundreds of writes per frame, far past
 * anything a driver's own bookkeeping would ever produce for one register.
 */
function maxWritesPerFrame(events: RegisterEvent[], addr: number): number {
  let max = 0, frame = -1, count = 0;
  for (const e of events) {
    if (e.addr !== addr) continue;
    const f = Math.floor(e.at / NTSC_FRAME_PERIOD);
    if (f !== frame) {
      frame = f;
      count = 0;
    }
    count++;
    if (count > max) max = count;
  }
  return max;
}

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
 *   - `N (1-254)` then `N` `(index, value)` pairs: that many register
 *     writes this frame, `index` naming one of `registerIndex`'s entries -
 *     see `assemblePlayer`'s doc comment for why an index into an in-ROM
 *     table replaced the older "offset from $4000" encoding.
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
function encodeFrames(frames: Frame[], loopFrame: number, registerIndex: Map<number, number>): { data: number[]; loopOffset: number } {
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
      for (const w of bucket) data.push(registerIndex.get(w.addr)!, w.value);
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
const STA_ABS = 0x8d, STA_ZP = 0x85, LDA_ZP = 0xa5, LDY_ZP = 0xa4, LDA_IND_Y = 0xb1;
const LDA_ABS_Y = 0xb9, STA_IND_Y = 0x91;
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
  /** Any absolute-addressing opcode whose operand is a label's address rather than a literal one (`jsrTo`/`jmpTo` generalized to `LDA addr,Y` and the like). */
  absToLabel(code: number, label: string): this {
    this.bytes.push(code);
    this.fixups.push({ pos: this.bytes.length, label, kind: "abs" });
    this.bytes.push(0, 0);
    return this;
  }
  /** Raw bytes, not an instruction - for the in-ROM tables the code itself indexes into. */
  raw(bytes: number[]): this {
    for (const b of bytes) this.bytes.push(b & 0xff);
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
 * Each write's register is looked up by index in `regLoTable`/`regHiTable`,
 * two in-ROM bytes per distinct register this capture actually uses
 * (`registerTable`, built by `exportNsf`), rather than stored as a fixed
 * offset from $4000 the way an earlier version of this player did. A
 * single `STA base,Y` can only reach 256 bytes from `base`, which covers
 * every 2A03 register ($4000-$4017) in one page, but not VRC6's ten
 * ($9000-$9003, $A000-$A002, $B000-$B002) - three pages away and not
 * contiguous with $4000 or with each other. Indexing a table of whichever
 * addresses this specific capture touches and storing through the
 * resolved pointer (`STA (zp),Y` with Y always 0) reaches any of the
 * 65536 CPU addresses uniformly, at the cost of a few more cycles per
 * write than the old fixed-base store - well inside a 60 Hz frame's
 * budget even at the 254-write ceiling `quantizeToFrames` enforces.
 *
 * Zero page: $00/$01 the read pointer (low/high), $02 the current data
 * page (mirrored into bank register 6 whenever it changes), $03 how many
 * more frames to skip before decoding the next token (the run-length
 * counter), $04 a write's register-table index, $05/$06 the resolved
 * write-target pointer (low/high - `STA (zp),Y`'s zero-page operand names
 * the low byte, and the 6502 always reads the high byte from the next
 * one, so these two must stay adjacent). $04 is held in zero page rather
 * than in Y or X across the pair's two `readByte` calls: `readByte` needs
 * Y as its own scratch register (`LDA (zp),Y` with Y always 0) and would
 * clobber it there, and X keeps counting the pair loop down the entire
 * time (`DEX`/`BNE` below), so it is never free to hold anything else
 * either.
 */
function assemblePlayer(firstDataPage: number, loopPage: number, loopPtrHi: number, loopPtrLo: number, registerTable: number[]): { bytes: number[]; initAddr: number; playAddr: number } {
  const ZP_PTR_LO = 0x00, ZP_PTR_HI = 0x01, ZP_PAGE = 0x02, ZP_REPEAT = 0x03, ZP_INDEX = 0x04, ZP_WPTR_LO = 0x05, ZP_WPTR_HI = 0x06;
  const DATA_REG_ADDR = 0x5ff8 + DATA_WINDOW_REG; // the register mapping the data window
  const regLoTable = registerTable.map((addr) => addr & 0xff);
  const regHiTable = registerTable.map((addr) => (addr >> 8) & 0xff);

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
  asm.jsrTo("readByte"); // A = register-table index
  asm.zp(STA_ZP, ZP_INDEX); // readByte's own LDY #0 would clobber Y, so this rides in zero page instead
  asm.jsrTo("readByte"); // A = value
  asm.op(PHA); // stash the value while Y resolves the target address through the tables
  asm.zp(LDY_ZP, ZP_INDEX);
  asm.absToLabel(LDA_ABS_Y, "regLoTable");
  asm.zp(STA_ZP, ZP_WPTR_LO);
  asm.absToLabel(LDA_ABS_Y, "regHiTable");
  asm.zp(STA_ZP, ZP_WPTR_HI);
  asm.op(PLA);
  asm.imm(LDY_IMM, 0x00);
  asm.zp(STA_IND_Y, ZP_WPTR_LO);
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
  asm.abs(STA_ABS, DATA_REG_ADDR);
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
  asm.abs(STA_ABS, DATA_REG_ADDR);
  asm.label("readDone");
  asm.op(PLA);
  asm.op(RTS);

  // The register-table bytes `pairLoop` above indexes by Y: not code, but
  // they live in the same ROM page and are addressed the same way (a plain
  // label), so they are appended here rather than carried as a separate
  // pool the exporter has to place itself.
  asm.label("regLoTable");
  asm.raw(regLoTable);
  asm.label("regHiTable");
  asm.raw(regHiTable);

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

  // $4010-$4013 alone configure the DMC's rate, its direct-load DAC value,
  // and a sample's address/length; a driver clearing them to 0 at power-on
  // (this project's own capture-nsf.mjs ceremony does exactly that, and
  // real drivers commonly mirror it) is not DMC playback and is carried
  // like any other register write, same as $4015 bit 4 clear. Starting a
  // DMA sample read ($4015 written with bit 4 set) is autonomous hardware:
  // the 2A03 itself stalls the CPU and reads cartridge memory directly, so
  // PLAY does not need to do anything mid-frame for it either - it only
  // needs the sample bytes physically present where the DMA will look.
  //
  // The one case that genuinely cannot be carried is raw $4011 streaming:
  // writing the direct-load DAC many times within a single frame to
  // reconstruct a waveform without ever touching the DMA channel. That
  // needs each write timed to a fraction of a frame, which a once-per-60 Hz
  // PLAY call structurally cannot give it, so it is rejected outright
  // regardless of whether sample memory is available.
  const dacWritesPerFrame = maxWritesPerFrame(events, 0x4011);
  if (dacWritesPerFrame > DMC_DAC_STREAM_LIMIT) {
    throw new NsfExportError("dmc_unsupported", `This capture writes $4011 (the DMC's direct-load DAC) up to ${dacWritesPerFrame} times within a single 60 Hz frame - raw PCM streamed straight through the DAC, not DMA sample playback. That needs each write timed to a fraction of a frame, which this player's once-per-frame PLAY call cannot carry.`, { measured: dacWritesPerFrame, limit: DMC_DAC_STREAM_LIMIT });
  }

  const hasDmcMemory = !!(options.memory && options.memory.length);
  const dmcStarts = events.some((e) => e.addr === 0x4015 && (e.value & 0x10) !== 0);
  if (dmcStarts && !hasDmcMemory) {
    throw new NsfExportError("dmc_sample_missing", "This capture enables DMC/DPCM sample playback ($4015 written with bit 4 set) but carries no sample memory (RecordedSong.memory / PerformancePlan.memory); the export needs the sample bytes physically present at the addresses $4012/$4013 point to, and this capture has none to place there.", { measured: 0, limit: 1 });
  }
  if (hasDmcMemory) {
    for (const block of options.memory!) {
      if (block.address < DMC_BASE || block.address + block.bytes.length > 0x10000) {
        throw new NsfExportError("dmc_unsupported", `A DMC sample memory block at $${block.address.toString(16)} (${block.bytes.length} bytes) falls outside $C000-$FFFF, the only range the DMC's hardware DMA can read from; this player can only place sample bytes there.`, { measured: block.address, limit: DMC_BASE });
      }
    }
  }

  const loopAtCycle = options.loopAtCycle ?? 0;
  if (!Number.isFinite(loopAtCycle) || loopAtCycle < 0 || loopAtCycle >= cycles) {
    throw new NsfExportError("invalid_loop_point", `loopAtCycle must fall within [0, cycles); got ${loopAtCycle} for a ${cycles}-cycle capture.`, { measured: loopAtCycle, limit: cycles });
  }

  // 2A03 registers and Konami VRC6's ten (`isVrc6Addr`, three pages away at
  // $9000-$9003/$A000-$A002/$B000-$B002) are carried the same way: every
  // distinct register this capture actually writes gets one entry in
  // `registerTable`, in first-seen order, and each write is encoded as an
  // index into it (`encodeFrames`) rather than an offset from a single
  // fixed base - see `assemblePlayer`'s doc comment for why.
  const kept = events.filter((e) => (e.addr >= REG_BASE && e.addr <= REG_LAST) || isVrc6Addr(e.addr)).sort((a, b) => a.at - b.at);
  const registerTable: number[] = [];
  const registerIndex = new Map<number, number>();
  for (const w of kept) {
    if (!registerIndex.has(w.addr)) {
      registerIndex.set(w.addr, registerTable.length);
      registerTable.push(w.addr);
    }
  }
  if (registerTable.length > 256) {
    throw new NsfExportError("too_many_registers", `This capture writes ${registerTable.length} distinct registers; the player's write table can only address up to 256 of them (one index byte per write).`, { measured: registerTable.length, limit: 256 });
  }
  const usesVrc6 = registerTable.some((addr) => isVrc6Addr(addr));

  const { frames, loopFrame } = quantizeToFrames(kept, cycles, loopAtCycle);
  const { data, loopOffset } = encodeFrames(frames, loopFrame, registerIndex);

  const FIRST_DATA_PAGE = 1;
  const { page: loopPage, ptrHi: loopPtrHi, ptrLo: loopPtrLo } = toPagePointer(loopOffset, FIRST_DATA_PAGE);
  const dataPages = Math.max(1, Math.ceil(data.length / PAGE_SIZE));
  const dmcPageCount = hasDmcMemory ? DMC_REG_COUNT : 0;
  const totalPages = 1 + dataPages + dmcPageCount;
  if (totalPages > MAX_PAGES) {
    throw new NsfExportError("rom_too_large", `The encoded write stream${hasDmcMemory ? " plus its DMC sample memory" : ""} needs ${totalPages - 1} 4 KiB banks plus the code bank, more than NSF's ${MAX_PAGES}-bank limit (one byte per bank register).`, { measured: totalPages * PAGE_SIZE, limit: MAX_PAGES * PAGE_SIZE });
  }

  const player = assemblePlayer(FIRST_DATA_PAGE, loopPage, loopPtrHi, loopPtrLo, registerTable);

  const dmcFirstPage = FIRST_DATA_PAGE + dataPages;
  const pool = new Uint8Array(totalPages * PAGE_SIZE);
  pool.set(player.bytes, CODE_PAGE * PAGE_SIZE);
  pool.set(data, FIRST_DATA_PAGE * PAGE_SIZE);
  if (hasDmcMemory) {
    for (const block of options.memory!) {
      pool.set(block.bytes, dmcFirstPage * PAGE_SIZE + (block.address - DMC_BASE));
    }
  }

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
  file[112 + DATA_WINDOW_REG] = FIRST_DATA_PAGE; // ...except the one window PLAY reads data through...
  if (hasDmcMemory) {
    for (let i = 0; i < DMC_REG_COUNT; i++) file[112 + DMC_FIRST_REG + i] = dmcFirstPage + i; // ...and the fixed upper bank, when there is DMC sample memory to place there
  }
  view.setUint16(120, 19997, true); // PAL speed, unused (NTSC-only below) but set to the standard value
  file[122] = 0; // NTSC only
  file[123] = usesVrc6 ? 0x01 : 0; // expansion sound chip bitfield, bit 0 = VRC6
  file.set(pool, HEADER);
  return file;
}
