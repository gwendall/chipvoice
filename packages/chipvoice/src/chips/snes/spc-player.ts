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
 *
 * The write log's encoding (`../../spc-export.ts` builds it, this program
 * only reads it):
 *
 *   event := delta reg value        -- write `value` to DSP register `reg`
 *          | delta $FF lo hi        -- loop: jump the read head to `lo|hi<<8`
 *   delta := ($FF)* final           -- final in $00-$FE; each $FF adds 255
 *                                      ticks and reads another delta byte
 *
 * `reg` is always a real DSP register, $00-$7F, so $FF only ever means the
 * loop sentinel - no escaping is needed. One tick is one full period of
 * Timer 0, whatever `TICKS_PER_SECOND` below is configured for; the exporter
 * bakes T0's target and enable bit directly into the exported RAM image (the
 * $F0-$FF page restores like any other RAM on load, `ssmp.ts`'s
 * `loadSnapshot` doc comment says so and `SPC_export.spec.md`-equivalent
 * real dumps agree), so this program spends no instructions on setup.
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

/** The registers the program reaches directly: DSPADDR/DSPDATA (already
 * mapped into the direct page at their usual addresses) and Timer 0's
 * output counter. */
const DSPADDR = 0xf2;
const DSPDATA = 0xf3;
const T0OUT = 0xfd;

/** The sentinel a `reg` byte can never legitimately be (real registers are
 * $00-$7F), doubling as the delta encoding's continuation byte. */
const SENTINEL = 0xff;

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

  /** Resolves every branch and returns the machine code, as if loaded at
   * `origin`. Throws on an undefined label or a branch out of an 8-bit
   * signed displacement's range - both would be a bug in the program below,
   * not something a caller can hit. */
  assemble(origin: number): Uint8Array {
    const lengths = this.items.map((it) => (it.kind === "bytes" ? it.bytes.length : it.kind === "branch" ? 2 : 0));
    const labelAddr = new Map<string, number>();
    let addr = origin;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (it.kind === "label") labelAddr.set(it.name, addr);
      addr += lengths[i];
    }
    const total = addr - origin;
    const out = new Uint8Array(total);
    addr = origin;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      const at = addr - origin;
      if (it.kind === "bytes") {
        out.set(it.bytes, at);
      } else if (it.kind === "branch") {
        const target = labelAddr.get(it.target);
        if (target === undefined) throw new Error(`spc-player: undefined label "${it.target}"`);
        const rel = target - (addr + 2);
        if (rel < -128 || rel > 127) throw new Error(`spc-player: branch to "${it.target}" out of range (${rel})`);
        out[at] = it.opcode;
        out[at + 1] = rel & 0xff;
      }
      addr += lengths[i];
    }
    return out;
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
 *                  Otherwise it's a DSP register: write it to $F2, read the
 *                  following byte and write that to $F3, then back to
 *                  L_DELTA.
 *   L_LOOP       : read the two-byte target that follows the sentinel and
 *                  set PTR to it, then back to L_DELTA - the read head keeps
 *                  going, now from wherever the exporter marked as the loop
 *                  point.
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
    .movDpA(DSPADDR)
    .movAIndDpY(PTR)
    .incwDp(PTR)
    .movDpA(DSPDATA)
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
