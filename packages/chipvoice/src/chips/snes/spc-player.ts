/**
 * The exported .spc's own player: a tiny SPC700 program, written here from
 * Anomie's SPC700 doc (same source `spc700.ts` itself was written from),
 * not derived from any emulator. It does one thing: read a compact register
 * write log out of ARAM and issue it to the S-DSP through $F2/$F3, timed by
 * one of the S-SMP's own hardware timers, looping forever once it reaches
 * the end. `exportSpc` (`../../spc-export.ts`) is the only caller; this file
 * has no dependency on it, so the program can be read and checked on its
 * own.
 *
 * Every register the program touches keeps the direct page ($00-$FF, PSW.P
 * clear) reachable in one byte, so the exported header sets PSW to 0 and the
 * program never changes it. It never uses the stack (no CALL/PCALL/RET/
 * PUSH/POP/BRK): SP's starting value is cosmetic. Y is never written by the
 * program either - the header sets it to 0 and every indirect fetch below
 * relies on that.
 *
 * Zero-page layout the program owns (the exporter's job to leave free of
 * anything else):
 *
 *   $10/$11  PTR    the stream read head, a direct-page word: low byte at
 *                    $10, high byte at $11 (SPC700 word convention, the same
 *                    one INCW and `[d]+Y` both use)
 *   $12      SCRATCH a single byte, live only while the loop sentinel's
 *                    two-byte target is being read (see `L_LOOP` below)
 *   $13/$14  START   a copy-op's source range start, live only during a copy
 *   $15/$16  REND    a copy-op's source range end (exclusive), same lifetime
 *   $17/$18  RETPTR  PTR's value from just before a copy op started, so the
 *                    read head can return to the main stream once the copy
 *                    reaches REND
 *   $19      COPY_ACTIVE  0 outside a copy, 1 while replaying one; a copy's
 *                    source range never itself contains another copy op (the
 *                    exporter only ever points one at plain writes and
 *                    bursts), so this never nests
 *
 * The write log's encoding (`../../spc-export.ts` builds it, this program
 * only reads it):
 *
 *   event := delta reg value        -- write `value` to DSP register `reg`
 *          | delta $FE count (reg value)*count
 *                                    -- a burst: `count` writes (1-255) at
 *                                       the same tick, no per-write delta
 *          | delta $FD lo hi LO HI  -- copy: replay the events stored at
 *                                       ARAM [lo|hi<<8, LO|HI<<8) in place,
 *                                       then resume after this op. This
 *                                       op's own `delta` already spent the
 *                                       real time needed to reach
 *                                       [lo|hi<<8]'s event, so `lo|hi<<8`
 *                                       itself points at that event's own
 *                                       control byte (reg or $FE), never
 *                                       at a delta - replaying one there
 *                                       too would wait for it twice.
 *                                       `LO|HI<<8` is the exclusive end of
 *                                       the last replayed event, delta and
 *                                       all, same as any other event
 *                                       boundary.
 *          | delta $FF lo hi        -- loop: jump the read head to `lo|hi<<8`
 *   delta := ($FF)* final           -- final in $00-$FE; each $FF adds 255
 *                                      ticks and reads another delta byte
 *
 * `reg` is always a real DSP register, $00-$7F, so $FD/$FE/$FF only ever
 * mean the copy/burst/loop sentinels above - no escaping is needed. A copy
 * op's source range holds only plain-write and burst events, never another
 * copy or the loop sentinel, so replaying it never needs its own nested
 * COPY_ACTIVE state. One tick is one full period of Timer 0, whatever
 * `TICKS_PER_SECOND` below is configured for; the exporter bakes T0's target
 * and enable bit directly into the exported RAM image (the $F0-$FF page
 * restores like any other RAM on load, `ssmp.ts`'s `loadSnapshot` doc
 * comment says so and `SPC_export.spec.md`-equivalent real dumps agree), so
 * this program spends no instructions on setup.
 */

/** Timer 0's stage-1 divider is fixed at 128:1, so its stage-2 target alone
 * picks the tick rate: 8000 Hz / target. 8 gives an exact 1000 Hz, i.e. one
 * tick every 1024 SPC cycles (1 ms) - fine enough for envelope and note
 * timing, coarse enough that a byte of delta covers a quarter second before
 * it needs a continuation. */
export const TIMER_TARGET = 8;
export const TICKS_PER_SECOND = 8000 / TIMER_TARGET;

/** The player's zero-page variables. */
export const PTR = 0x10;
export const SCRATCH = 0x12;
export const START = 0x13;
export const REND = 0x15;
export const RETPTR = 0x17;
export const COPY_ACTIVE = 0x19;

/** The registers the program reaches directly: DSPADDR/DSPDATA (already
 * mapped into the direct page at their usual addresses) and Timer 0's
 * output counter. */
const DSPADDR = 0xf2;
const DSPDATA = 0xf3;
const T0OUT = 0xfd;

/** The sentinel a `reg` byte can never legitimately be (real registers are
 * $00-$7F): $FF is the loop sentinel and doubles as the delta encoding's
 * continuation byte; $FE opens a burst (several same-tick writes sharing one
 * delta); $FD opens a copy (replay an earlier range of the stream). */
const SENTINEL = 0xff;
export const BURST_OP = 0xfe;
export const COPY_OP = 0xfd;

type Item =
  | { kind: "bytes"; bytes: number[] }
  | { kind: "label"; name: string }
  | { kind: "branch"; opcode: number; target: string };

/**
 * A tiny, purpose-built SPC700 emitter: named methods for exactly the
 * instructions this player uses, each one a direct, hand-checked encoding
 * (comment gives the mnemonic and the byte(s)), plus labels and short
 * relative branches resolved in a second pass once every label's address is
 * known. Not a general assembler - there is no mnemonic parser and nothing
 * here claims to support any instruction the player program does not use.
 */
class Asm {
  private readonly items: Item[] = [];

  private push(bytes: number[]): this {
    this.items.push({ kind: "bytes", bytes });
    return this;
  }

  /** MOV X,#imm ($CD nn). */
  movXImm(v: number): this {
    return this.push([0xcd, v & 0xff]);
  }
  /** MOV X,A ($5D). */
  movXA(): this {
    return this.push([0x5d]);
  }
  /** MOV A,dp ($E4 dp). */
  movADp(dp: number): this {
    return this.push([0xe4, dp & 0xff]);
  }
  /** MOV dp,A ($C4 dp). */
  movDpA(dp: number): this {
    return this.push([0xc4, dp & 0xff]);
  }
  /** MOV A,[dp]+Y ($F7 dp): reads the byte at the 16-bit address stored at
   * `dp`/`dp+1`, plus Y (always 0 here). Does not touch the pointer itself. */
  movAIndDpY(dp: number): this {
    return this.push([0xf7, dp & 0xff]);
  }
  /** INCW dp ($3A dp): the direct-page word at `dp`/`dp+1`, plus one. */
  incwDp(dp: number): this {
    return this.push([0x3a, dp & 0xff]);
  }
  /** CMP A,#imm ($68 nn). */
  cmpAImm(v: number): this {
    return this.push([0x68, v & 0xff]);
  }
  /** CMP X,#imm ($C8 nn). */
  cmpXImm(v: number): this {
    return this.push([0xc8, v & 0xff]);
  }
  /** DEC X ($1D). */
  decX(): this {
    return this.push([0x1d]);
  }
  /** MOV dp,#imm ($8F imm dp): the only SPC700 store that takes an immediate
   * straight to memory, so it is how COPY_ACTIVE gets set/cleared without
   * disturbing A. */
  movDpImm(dp: number, imm: number): this {
    return this.push([0x8f, imm & 0xff, dp & 0xff]);
  }
  /** CMP A,dp ($64 dp). */
  cmpADp(dp: number): this {
    return this.push([0x64, dp & 0xff]);
  }

  label(name: string): this {
    this.items.push({ kind: "label", name });
    return this;
  }
  /** BEQ rel ($F0). */
  beq(target: string): this {
    this.items.push({ kind: "branch", opcode: 0xf0, target });
    return this;
  }
  /** BNE rel ($D0). */
  bne(target: string): this {
    this.items.push({ kind: "branch", opcode: 0xd0, target });
    return this;
  }
  /** BRA rel ($2F): always taken. */
  bra(target: string): this {
    this.items.push({ kind: "branch", opcode: 0x2f, target });
    return this;
  }

  /** Every branch opcode this class emits paired with the opcode that takes
   * the opposite condition - `promoteBranch` below's only use for it. BRA
   * has no "opposite" (it maps to `undefined`: an out-of-range BRA promotes
   * straight to a plain JMP instead, see there). */
  private static readonly INVERSE: Record<number, number | undefined> = {
    0xf0: 0xd0, // BEQ <-> BNE
    0xd0: 0xf0,
    0x2f: undefined, // BRA
  };

  /** Resolves every branch and returns the machine code, as if loaded at
   * `origin`. A branch too far for an 8-bit signed displacement is promoted
   * rather than rejected: BRA becomes a plain 3-byte JMP !abs (unconditional
   * either way, unlimited range); BEQ/BNE become their own opposite over a
   * JMP !abs, the standard trick for extending a short conditional branch's
   * reach (`BEQ far` becomes `BNE +3 / JMP far`). Promoting a branch grows
   * the program, which can push some other, previously in-range branch out
   * of range too, so this sizes the whole program to a fixed point - never
   * demoting a branch once promoted, so this always terminates. Throws only
   * on an undefined label, a bug in the program below, not something a
   * caller can hit. */
  assemble(origin: number): Uint8Array {
    const promoted = new Array<boolean>(this.items.length).fill(false);
    for (let pass = 0; ; pass++) {
      const lengths = this.items.map((it, i) => {
        if (it.kind === "bytes") return it.bytes.length;
        if (it.kind === "label") return 0;
        if (!promoted[i]) return 2; // a short branch, not yet proven out of range
        return Asm.INVERSE[it.opcode] === undefined ? 3 : 5; // BRA -> JMP, or inverted-branch + JMP
      });
      const labelAddr = new Map<string, number>();
      {
        let addr = origin;
        for (let i = 0; i < this.items.length; i++) {
          const it = this.items[i];
          if (it.kind === "label") labelAddr.set(it.name, addr);
          addr += lengths[i];
        }
      }
      let anyNewlyPromoted = false;
      {
        let addr = origin;
        for (let i = 0; i < this.items.length; i++) {
          const it = this.items[i];
          if (it.kind === "branch" && !promoted[i]) {
            const target = labelAddr.get(it.target);
            if (target === undefined) throw new Error(`spc-player: undefined label "${it.target}"`);
            const rel = target - (addr + 2);
            if (rel < -128 || rel > 127) {
              promoted[i] = true;
              anyNewlyPromoted = true;
            }
          }
          addr += lengths[i];
        }
      }
      if (anyNewlyPromoted) {
        if (pass > this.items.length) throw new Error("spc-player: branch relaxation did not converge");
        continue;
      }
      // This layout is final: every branch's length (short or promoted)
      // matches what `labelAddr` above was computed from, so emit it as-is.
      let addr = origin;
      const total = lengths.reduce((a, b) => a + b, origin) - origin;
      const out = new Uint8Array(total);
      for (let i = 0; i < this.items.length; i++) {
        const it = this.items[i];
        const at = addr - origin;
        if (it.kind === "bytes") {
          out.set(it.bytes, at);
        } else if (it.kind === "branch") {
          const target = labelAddr.get(it.target)!;
          if (!promoted[i]) {
            const rel = target - (addr + 2);
            out[at] = it.opcode;
            out[at + 1] = rel & 0xff;
          } else {
            const inverse = Asm.INVERSE[it.opcode];
            if (inverse === undefined) {
              out[at] = 0x5f; // JMP !abs
              out[at + 1] = target & 0xff;
              out[at + 2] = (target >> 8) & 0xff;
            } else {
              out[at] = inverse;
              out[at + 1] = 3; // skip over the JMP right below when the inverted condition holds
              out[at + 2] = 0x5f; // JMP !abs
              out[at + 3] = target & 0xff;
              out[at + 4] = (target >> 8) & 0xff;
            }
          }
        }
        addr += lengths[i];
      }
      return out;
    }
  }
}

/**
 * Builds the player program, as if assembled to start at `origin`. The
 * returned bytes are the whole program; the exporter places them at
 * `origin` in the exported ARAM image and points the header's PC there.
 *
 * Program flow (labels match the ones in the source below):
 *
 *   L_DELTA      : read one delta byte. $FF -> wait 255 ticks, read another.
 *                  Anything else -> that many ticks (0 skips the wait), then
 *                  fall into L_REG.
 *   L_REG        : read the next byte. $FF -> L_LOOP (the stream repeats).
 *                  $FE -> L_BURST_START. $FD -> L_COPY_START. Otherwise it's
 *                  a DSP register: write it to $F2, read the following byte
 *                  and write that to $F3, then to L_STEP_DONE.
 *   L_BURST_START: read a count byte into X, then loop L_BURST_LOOP that
 *                  many times, each one a plain reg/value write exactly like
 *                  L_REG's own (no delta between them - a burst is several
 *                  writes the exporter placed at the same tick), then to
 *                  L_STEP_DONE.
 *   L_COPY_START : set COPY_ACTIVE first (so it is already set the moment
 *                  PTR passes through the resume address below, not only
 *                  once the jump into the source range is done), then
 *                  read the four-byte source range (START, then REND)
 *                  that follows the sentinel, save PTR into RETPTR, set
 *                  PTR to START, then to L_REG, not L_DELTA - START
 *                  points at the source group's own control byte, its
 *                  delta already spent by this op's own wait, so the
 *                  read head replays it and whatever plain writes and
 *                  bursts follow up to REND, each keeping its own delta,
 *                  exactly as if they appeared here.
 *   L_STEP_DONE  : after a plain write or a whole burst, check COPY_ACTIVE;
 *                  if clear, back to L_DELTA. If set, check PTR against REND
 *                  - short of it, back to L_DELTA (still replaying); at it,
 *                  restore PTR from RETPTR, clear COPY_ACTIVE, and back to
 *                  L_DELTA - the read head resumes the main stream right
 *                  after the copy op.
 *   L_LOOP       : read the two-byte target that follows the sentinel and
 *                  set PTR to it, then back to L_DELTA - the read head keeps
 *                  going, now from wherever the exporter marked as the loop
 *                  point. The exporter never places a loop sentinel inside a
 *                  copy's source range, so this never needs to touch
 *                  COPY_ACTIVE.
 */
export function buildPlayerProgram(origin: number): Uint8Array {
  const asm = new Asm();
  asm
    .label("L_DELTA")
    .movAIndDpY(PTR)
    .incwDp(PTR)
    .cmpAImm(SENTINEL)
    .bne("L_FINAL_DELTA")
    .movXImm(255)
    .label("L_WAIT_EXT")
    .movADp(T0OUT)
    .beq("L_WAIT_EXT")
    .decX()
    .bne("L_WAIT_EXT")
    .bra("L_DELTA")
    .label("L_FINAL_DELTA")
    .movXA()
    .cmpXImm(0)
    .beq("L_REG")
    .label("L_WAIT_FINAL")
    .movADp(T0OUT)
    .beq("L_WAIT_FINAL")
    .decX()
    .bne("L_WAIT_FINAL")
    .label("L_REG")
    .movAIndDpY(PTR)
    .incwDp(PTR)
    .cmpAImm(SENTINEL)
    .beq("L_LOOP")
    .cmpAImm(BURST_OP)
    .beq("L_BURST_START")
    .cmpAImm(COPY_OP)
    .beq("L_COPY_START")
    .movDpA(DSPADDR)
    .movAIndDpY(PTR)
    .incwDp(PTR)
    .movDpA(DSPDATA)
    .bra("L_STEP_DONE")
    .label("L_BURST_START")
    .movAIndDpY(PTR)
    .incwDp(PTR)
    .movXA()
    .label("L_BURST_LOOP")
    .movAIndDpY(PTR)
    .incwDp(PTR)
    .movDpA(DSPADDR)
    .movAIndDpY(PTR)
    .incwDp(PTR)
    .movDpA(DSPDATA)
    .decX()
    .bne("L_BURST_LOOP")
    .bra("L_STEP_DONE")
    .label("L_COPY_START")
    // Set COPY_ACTIVE before touching PTR at all: PTR passes straight
    // through the value it will hold once the header is fully read (the
    // resume address, saved into RETPTR below) on its way to being
    // redirected into the source range, and a caller watching for PTR to
    // reach that same address elsewhere (the exporter's own simulator)
    // must be able to tell that in-transit moment apart from the copy
    // actually being done.
    .movDpImm(COPY_ACTIVE, 1)
    .movAIndDpY(PTR)
    .incwDp(PTR)
    .movDpA(START)
    .movAIndDpY(PTR)
    .incwDp(PTR)
    .movDpA(START + 1)
    .movAIndDpY(PTR)
    .incwDp(PTR)
    .movDpA(REND)
    .movAIndDpY(PTR)
    .incwDp(PTR)
    .movDpA(REND + 1)
    .movADp(PTR)
    .movDpA(RETPTR)
    .movADp(PTR + 1)
    .movDpA(RETPTR + 1)
    .movADp(START)
    .movDpA(PTR)
    .movADp(START + 1)
    .movDpA(PTR + 1)
    // Straight to L_REG, not L_DELTA: START points at the source group's
    // own control byte (a register number or $FE), not a delta byte -
    // this op's own opening wait, back in the main stream before the
    // sentinel, already spent the real time needed to get here, so the
    // source's own leading delta (baked in relative to wherever real
    // time was during ITS OWN first occurrence, not portable to this
    // one) is never replayed. Every later group inside the copy keeps
    // its own delta, a self-contained gap from the group before it.
    .bra("L_REG")
    .label("L_STEP_DONE")
    .movADp(COPY_ACTIVE)
    .beq("L_DELTA")
    .movADp(PTR)
    .cmpADp(REND)
    .bne("L_DELTA")
    .movADp(PTR + 1)
    .cmpADp(REND + 1)
    .bne("L_DELTA")
    .movADp(RETPTR)
    .movDpA(PTR)
    .movADp(RETPTR + 1)
    .movDpA(PTR + 1)
    .movDpImm(COPY_ACTIVE, 0)
    .bra("L_DELTA")
    .label("L_LOOP")
    .movAIndDpY(PTR)
    .incwDp(PTR)
    .movDpA(SCRATCH)
    .movAIndDpY(PTR)
    .incwDp(PTR)
    .movDpA(PTR + 1)
    .movADp(SCRATCH)
    .movDpA(PTR)
    .bra("L_DELTA");
  return asm.assemble(origin);
}
