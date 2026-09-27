/**
 * GBS: a DMG song as a cartridge, playable in any GBS player.
 *
 * Mirrors `nsf.ts`'s shape exactly, for the SM83 instead of the 6502: a GBS
 * hands a player two routines, INIT and PLAY, that the player's own emulated
 * CPU runs - INIT sets up the APU once, PLAY runs once per frame forever.
 * This module carries a tiny SM83 player (below, `assemblePlayer`) that
 * reads a compact per-frame encoding of the capture's own writes out of ROM
 * and replays them, looping at the requested cycle forever.
 *
 * Hand-assembled here, not ported from an existing driver or run through an
 * external toolchain (decision 41: nothing in `packages/chipvoice` may be
 * derived from a GPL oracle, and this package carries no assembler
 * dependency) - `AsmSm83` below is the whole toolchain it needs: named
 * mnemonics, labels, and two-pass branch/jump resolution, so the program
 * reads as assembly and the bytes it emits are exactly reproducible from
 * this file, never an opaque blob.
 *
 * Write timing is quantized to the frame, on the VBlank grid: real DMG
 * hardware fires VBlank every 70224 T-cycles (~59.73 Hz, Pan Docs' 154
 * scanlines of 456 cycles each), the same period `gbs-import.ts` already
 * schedules PLAY against and almost every real GBS driver paces itself
 * against. This player uses that same period rather than the header's own
 * programmable timer, so it plays correctly in any GBS player regardless of
 * whether that player even implements the timer path. A pitch or volume
 * change mid-frame lands at the start of the frame it falls in instead, at
 * most one frame (~16.7 ms) early; `scores/gbs-export/corpus.mjs` measures
 * exactly that cost by rendering GME's own trace of the exported file
 * against a render of the untouched capture, both through this project's
 * own DSP, and states a threshold from the measured band.
 *
 * Unlike the 2A03's DMC/DPCM channel, the DMG has no autonomous DMA sample
 * channel: the wave channel (CH3) is entirely register-driven through
 * `$FF30-$FF3F`, exactly like every other register, so there is no separate
 * fixed-bank/sample-memory case to handle the way `nsf.ts` handles DMC. The
 * real-hardware rule that wave RAM only lands cleanly while CH3's DAC is off
 * (`chips/gb/dsp.ts`'s `writeWaveRam`) needs no special exporter logic
 * either: chip state is a pure function of the replayed writes in the order
 * they happened, not of real elapsed cycles, so a capture that already
 * turns the DAC off before rewriting wave RAM replays correctly by
 * construction. The one thing this player genuinely cannot carry is the
 * same residual case `nsf.ts` names for $4011: any register written more
 * than 254 times within a single VBlank frame overflows the per-frame pair
 * count and is rejected as `frame_overflow`, not truncated or slowed down.
 */

import type { RegisterEvent } from "./chip.js";

/** VBlank period in T-cycles (Pan Docs: 154 scanlines of 456 cycles), the
 * same constant `gbs-import.ts`'s `VBLANK_PERIOD` uses for the identical
 * reason: this is the grid PLAY is called against below. */
const VBLANK_PERIOD = 70224;

/** DMG APU register range a GBS's PLAY routine is allowed to touch. */
const REG_BASE = 0xff10;
const REG_LAST = 0xff3f;

/** `LD (C),A` (opcode `$E2`) addresses `$FF00+C`, so a write pair's register
 * offset is encoded relative to `$FF00`, not `REG_BASE` - unlike NSF's
 * `STA_ABS_Y`, which only ever needed one base because 2A03 registers and
 * its encode base were the same address. */
const ENCODE_BASE = 0xff00;

/** Bank-switching model (the GBS format spec, gbdev's mirror of it, already
 * implemented on the read side by `gbs-import.ts`): ROM is one flat program
 * blob starting at `loadAddress`; the fixed low bank ($0000 up to $4000) is
 * always this player's own code, and the switchable window ($4000-$7FFF)
 * shows whichever 16 KiB page of that same blob the last write to
 * $2000-$3FFF selected, by page number. This player only ever needs one
 * data page resident at a time and never selects page 0 (page 0 would just
 * mirror the fixed bank's own bytes back at $4000, which is never useful),
 * so data pages are numbered from 1. */
const DATA_BANK_REG_ADDR = 0x2000;
const PAGE_SIZE = 0x4000;
const MAX_DATA_BANKS = 255; // one byte per bank number, 1-255 (0 is never selected)
const LOAD_ADDRESS = 0x0400; // the format's minimum; leaves a full 15 KiB fixed bank for this ~100-byte player
const STACK_POINTER = 0xfffe; // Pan Docs' own post-boot-ROM default; the host manages SP entirely (see assemblePlayer)

/** Persistent player state, kept in WRAM since the SM83 has no zero page
 * the way the 6502 does: the read pointer (low/high), the data bank
 * currently selected (mirrored into the hardware bank register whenever it
 * changes), and how many more frames to skip before decoding the next
 * token (the run-length counter). */
const WRAM_PTR_LO = 0xc000;
const WRAM_PTR_HI = 0xc001;
const WRAM_BANK = 0xc002;
const WRAM_REPEAT = 0xc003;

export class GbsExportError extends Error {
  readonly code: "frame_overflow" | "rom_too_large" | "invalid_loop_point" | "metadata_too_long" | "metadata_not_ascii";
  readonly measured?: number;
  readonly limit?: number;
  constructor(code: GbsExportError["code"], message: string, detail: { measured?: number; limit?: number } = {}) {
    super(message);
    this.name = "GbsExportError";
    this.code = code;
    this.measured = detail.measured;
    this.limit = detail.limit;
  }
}

export interface GbsOptions {
  /** Shown by players as the track's name. */
  title?: string;
  author?: string;
  /** Shown by players as the copyright/publisher line. */
  copyright?: string;
  /**
   * Where playback returns to, forever, in cycles. Left out, the whole
   * capture repeats (cycle 0) - GBS has no "play once" convention the way a
   * VGM player does, since nothing marks a cartridge as finished.
   */
  loopAtCycle?: number;
}

/** One frame's worth of register writes, in the order they happened. */
type Frame = { addr: number; value: number }[];

/**
 * Buckets writes into VBlank frames using the same boundary rule the GBS
 * import side already relies on (`Math.round(f * period)`), and finds which
 * frame the requested loop cycle falls into by the identical rule - one
 * sweep, one definition of a frame boundary, so the loop point can never
 * disagree with how events were bucketed.
 */
function quantizeToFrames(events: RegisterEvent[], cycles: number, loopAtCycle: number): { frames: Frame[]; loopFrame: number } {
  const frameCount = Math.max(1, Math.ceil(cycles / VBLANK_PERIOD));
  const frames: Frame[] = [];
  let cursor = 0;
  let loopFrame = frameCount - 1;
  for (let f = 0; f < frameCount; f++) {
    const start = Math.round(f * VBLANK_PERIOD);
    const end = Math.round((f + 1) * VBLANK_PERIOD);
    if (loopAtCycle >= start && loopAtCycle < end) loopFrame = f;
    const bucket: Frame = [];
    while (cursor < events.length && events[cursor].at < end) {
      bucket.push({ addr: events[cursor].addr, value: events[cursor].value & 0xff });
      cursor++;
    }
    if (bucket.length > 254) throw new GbsExportError("frame_overflow", `Frame ${f} has ${bucket.length} register writes; the player's per-frame write-list can only address up to 254 in one frame.`, { measured: bucket.length, limit: 254 });
    frames.push(bucket);
  }
  return { frames, loopFrame };
}

/**
 * Encodes frames into the byte stream PLAY's `readByte`/`decode` loop
 * understands - the same shape `nsf.ts`'s `encodeFrames` uses, with pairs
 * encoded relative to `ENCODE_BASE` ($FF00) instead of $4000:
 *
 *   - `N (1-254)` then `N` `(offset, value)` pairs: that many register
 *     writes this frame, `offset` added to $FF00.
 *   - `0`: no writes this frame.
 *   - `0xFF R (R>=1)`: `R` consecutive silent frames.
 *   - `0xFF 0`: loop - jump back to the frame this file's loop point names,
 *     forever.
 *
 * A run is never allowed to swallow the loop frame, for the same reason
 * `nsf.ts` excludes it: the loop-back jump targets a stream position, and a
 * frame folded into the middle of a preceding run has no stream position of
 * its own to land on.
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
      for (const w of bucket) data.push((w.addr - ENCODE_BASE) & 0xff, w.value);
      i++;
    }
  }
  if (loopOffset < 0) loopOffset = data.length; // loopFrame === frames.length can't happen (validated below); kept as a safe fallback
  data.push(0xff, 0x00); // terminal token: loop back to loopOffset, forever
  return { data, loopOffset };
}

function toBankPointer(offset: number, firstDataBank: number): { bank: number; ptrHi: number; ptrLo: number } {
  const bank = firstDataBank + Math.floor(offset / PAGE_SIZE);
  const within = offset % PAGE_SIZE;
  return { bank, ptrHi: (PAGE_SIZE >> 8) + (within >> 8), ptrLo: within & 0xff };
}

// -- A minimal SM83 assembler: named mnemonics and two-pass label/branch
// resolution, so the player program below reads as assembly and its bytes
// are mechanically, verifiably derived from it. Opcodes are the plain
// SM83's, matched against Pan Docs' own opcode table (the same reference
// `chips/gb/cpu.ts` is checked against).

const LD_A_N = 0x3e, LD_H_N = 0x26;
const LD_L_A = 0x6f, LD_H_A = 0x67, LD_A_H = 0x7c, LD_A_L = 0x7d, LD_C_A = 0x4f, LD_B_A = 0x47;
const LD_A_HL = 0x7e, LD_MEM_C_A = 0xe2;
const LD_A_NN = 0xfa, LD_NN_A = 0xea, LDH_N_A = 0xe0;
const INC_HL = 0x23, INC_A = 0x3c, DEC_A = 0x3d, DEC_B = 0x05;
const CP_N = 0xfe, OR_A = 0xb7, XOR_A = 0xaf;
const JR = 0x18, JR_NZ = 0x20, JR_Z = 0x28;
const JP_NN = 0xc3, CALL_NN = 0xcd, RET = 0xc9;
const PUSH_AF = 0xf5, POP_AF = 0xf1;

class AsmSm83 {
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
  imm8(code: number, value: number): this {
    this.bytes.push(code, value & 0xff);
    return this;
  }
  abs16(code: number, addr: number): this {
    this.bytes.push(code, addr & 0xff, (addr >> 8) & 0xff);
    return this;
  }
  jr(code: number, label: string): this {
    this.bytes.push(code);
    this.fixups.push({ pos: this.bytes.length, label, kind: "rel" });
    this.bytes.push(0);
    return this;
  }
  call(label: string): this {
    this.bytes.push(CALL_NN);
    this.fixups.push({ pos: this.bytes.length, label, kind: "abs" });
    this.bytes.push(0, 0);
    return this;
  }
  jp(label: string): this {
    this.bytes.push(JP_NN);
    this.fixups.push({ pos: this.bytes.length, label, kind: "abs" });
    this.bytes.push(0, 0);
    return this;
  }
  address(label: string): number {
    const at = this.labels.get(label);
    if (at === undefined) throw new Error(`gbs player: unresolved label ${label}`);
    return at;
  }
  resolve(): void {
    for (const fix of this.fixups) {
      const target = this.address(fix.label);
      if (fix.kind === "rel") {
        const offset = target - (this.base + fix.pos + 1);
        if (offset < -128 || offset > 127) throw new Error(`gbs player: branch to ${fix.label} out of range (${offset})`);
        this.bytes[fix.pos] = offset & 0xff;
      } else {
        this.bytes[fix.pos] = target & 0xff;
        this.bytes[fix.pos + 1] = (target >> 8) & 0xff;
      }
    }
  }
}

/**
 * The player: INIT powers the APU on and sets up this frame reader's state;
 * PLAY replays one frame's writes (or, mid-run-length-count, none) each
 * call. No stack setup here: the GBS host calls INIT and PLAY the way a
 * subroutine is called (`gbs-import.ts`'s own `call`, and every real GBS
 * player), resetting SP itself before each call, so this player touching SP
 * would only strand the host's own return address.
 */
function assemblePlayer(firstDataBank: number, loopBank: number, loopPtrHi: number, loopPtrLo: number): { bytes: number[]; initAddr: number; playAddr: number } {
  const asm = new AsmSm83(LOAD_ADDRESS);

  asm.label("init");
  asm.imm8(LD_A_N, 0x80);
  asm.imm8(LDH_N_A, 0x26); // NR52 = $80: power on, unconditionally, before any other write can take effect (dsp.ts discards register writes while power is off)
  asm.op(XOR_A);
  asm.abs16(LD_NN_A, WRAM_PTR_LO); // ptr = $4000 (the data window's own base), low byte first
  asm.imm8(LD_A_N, PAGE_SIZE >> 8);
  asm.abs16(LD_NN_A, WRAM_PTR_HI);
  asm.imm8(LD_A_N, firstDataBank);
  asm.abs16(LD_NN_A, WRAM_BANK);
  asm.abs16(LD_NN_A, DATA_BANK_REG_ADDR); // select it in hardware too, so the first readByte finds real data at $4000
  asm.op(XOR_A);
  asm.abs16(LD_NN_A, WRAM_REPEAT);
  asm.op(RET);

  asm.label("play");
  asm.abs16(LD_A_NN, WRAM_REPEAT);
  asm.op(OR_A);
  asm.jr(JR_Z, "decode");
  asm.op(DEC_A); // mid-run: skip this frame, one run frame closer to the next token
  asm.abs16(LD_NN_A, WRAM_REPEAT);
  asm.op(RET);

  asm.label("decode");
  asm.call("readByte"); // A = control byte
  asm.imm8(CP_N, 0xff);
  asm.jr(JR_Z, "special");
  asm.op(LD_B_A); // B = pair count
  asm.op(OR_A); // Z iff the pair count itself is 0 (CP above only tested equality to $FF)
  asm.jr(JR_Z, "playRts");
  asm.label("pairLoop");
  asm.call("readByte"); // A = register offset from $FF00
  asm.op(LD_C_A);
  asm.call("readByte"); // A = value
  asm.op(LD_MEM_C_A); // ($FF00+C) = A
  asm.op(DEC_B);
  asm.jr(JR_NZ, "pairLoop");
  asm.label("playRts");
  asm.op(RET);

  asm.label("special");
  asm.call("readByte"); // A = the run length, or 0 for "loop"
  asm.op(OR_A);
  asm.jr(JR_NZ, "isRepeat");
  asm.imm8(LD_A_N, loopBank);
  asm.abs16(LD_NN_A, WRAM_BANK);
  asm.abs16(LD_NN_A, DATA_BANK_REG_ADDR);
  asm.imm8(LD_A_N, loopPtrHi);
  asm.abs16(LD_NN_A, WRAM_PTR_HI);
  asm.imm8(LD_A_N, loopPtrLo);
  asm.abs16(LD_NN_A, WRAM_PTR_LO);
  asm.jp("decode"); // this frame plays the loop target's own first token, immediately
  asm.label("isRepeat");
  asm.op(DEC_A); // this frame is already the run's first silent frame
  asm.abs16(LD_NN_A, WRAM_REPEAT);
  asm.op(RET);

  // A = *ptr++, rolling from $7FFF back to $4000 and swapping in the next
  // data bank (mirrored into the hardware bank register) whenever the
  // pointer would walk past the switchable window's own top.
  asm.label("readByte");
  asm.abs16(LD_A_NN, WRAM_PTR_LO);
  asm.op(LD_L_A);
  asm.abs16(LD_A_NN, WRAM_PTR_HI);
  asm.op(LD_H_A);
  asm.op(LD_A_HL);
  asm.op(PUSH_AF);
  asm.op(INC_HL);
  asm.op(LD_A_H);
  asm.imm8(CP_N, 0x80);
  asm.jr(JR_NZ, "readDone");
  asm.imm8(LD_H_N, PAGE_SIZE >> 8);
  asm.abs16(LD_A_NN, WRAM_BANK);
  asm.op(INC_A);
  asm.abs16(LD_NN_A, WRAM_BANK);
  asm.abs16(LD_NN_A, DATA_BANK_REG_ADDR);
  asm.label("readDone");
  asm.op(LD_A_L);
  asm.abs16(LD_NN_A, WRAM_PTR_LO);
  asm.op(LD_A_H);
  asm.abs16(LD_NN_A, WRAM_PTR_HI);
  asm.op(POP_AF);
  asm.op(RET);

  asm.resolve();
  const codeAreaSize = PAGE_SIZE - LOAD_ADDRESS;
  if (asm.bytes.length > codeAreaSize) throw new Error(`gbs player: ${asm.bytes.length} bytes, more than the ${codeAreaSize}-byte fixed bank`);
  return { bytes: asm.bytes, initAddr: asm.address("init"), playAddr: asm.address("play") };
}

function asciiField(bytes: Uint8Array, offset: number, length: number, text: string, field: string): void {
  if (!/^[\x20-\x7e]*$/.test(text)) throw new GbsExportError("metadata_not_ascii", `${field} must be plain ASCII (0x20-0x7e); GBS's header has no encoding to carry anything wider.`);
  if (text.length > length - 1) throw new GbsExportError("metadata_too_long", `${field} is ${text.length} characters, more than the header field's ${length - 1} (one byte is reserved for the terminator).`, { measured: text.length, limit: length - 1 });
  for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
}

/**
 * Builds a standard GBS v1 file: one song, paced by VBlank (see the module
 * doc comment for why the header's own programmable timer is left unused).
 *
 * @param events register writes, stamped in DMG CPU T-cycles (as `recordSong` / `planPerformance` produce them)
 * @param cycles how long the capture runs, in cycles: writes at or past it are dropped
 */
export function exportGbs(events: RegisterEvent[], cycles: number, options: GbsOptions = {}): Uint8Array<ArrayBuffer> {
  if (!Number.isFinite(cycles) || cycles <= 0) throw new Error("gbs: invalid capture length");

  const loopAtCycle = options.loopAtCycle ?? 0;
  if (!Number.isFinite(loopAtCycle) || loopAtCycle < 0 || loopAtCycle >= cycles) {
    throw new GbsExportError("invalid_loop_point", `loopAtCycle must fall within [0, cycles); got ${loopAtCycle} for a ${cycles}-cycle capture.`, { measured: loopAtCycle, limit: cycles });
  }

  const kept = events.filter((e) => e.addr >= REG_BASE && e.addr <= REG_LAST).sort((a, b) => a.at - b.at);
  const { frames, loopFrame } = quantizeToFrames(kept, cycles, loopAtCycle);
  const { data, loopOffset } = encodeFrames(frames, loopFrame);

  const FIRST_DATA_BANK = 1;
  const { bank: loopBank, ptrHi: loopPtrHi, ptrLo: loopPtrLo } = toBankPointer(loopOffset, FIRST_DATA_BANK);
  const dataBanks = Math.max(1, Math.ceil(data.length / PAGE_SIZE));
  if (FIRST_DATA_BANK + dataBanks - 1 > MAX_DATA_BANKS) {
    throw new GbsExportError("rom_too_large", `The encoded write stream needs ${dataBanks} switchable 16 KiB banks, more than GBS's single-byte bank register can address (${MAX_DATA_BANKS} banks, numbered 1-${MAX_DATA_BANKS}).`, { measured: dataBanks, limit: MAX_DATA_BANKS });
  }

  const player = assemblePlayer(FIRST_DATA_BANK, loopBank, loopPtrHi, loopPtrLo);

  const codeAreaSize = PAGE_SIZE - LOAD_ADDRESS; // bytes available in the fixed low bank at/after loadAddress
  const program = new Uint8Array(codeAreaSize + dataBanks * PAGE_SIZE);
  program.set(player.bytes, 0);
  program.set(data, codeAreaSize);

  const HEADER = 112;
  const file = new Uint8Array(HEADER + program.length);
  const view = new DataView(file.buffer);
  file.set([0x47, 0x42, 0x53, 0x01], 0); // "GBS" version 1
  file[4] = 1; // one song
  file[5] = 1; // starting song (1-based)
  view.setUint16(6, LOAD_ADDRESS, true);
  view.setUint16(8, player.initAddr, true);
  view.setUint16(10, player.playAddr, true);
  view.setUint16(12, STACK_POINTER, true);
  file[14] = 0; // timerModulo, unused: the timer is disabled below
  file[15] = 0; // timerControl bit 2 clear: PLAY is paced by VBlank (59.73 Hz), not the header's own timer
  asciiField(file, 0x10, 32, options.title ?? "", "title");
  asciiField(file, 0x30, 32, options.author ?? "", "author");
  asciiField(file, 0x50, 32, options.copyright ?? "", "copyright");
  file.set(program, HEADER);
  return file;
}
