import type { RegisterEvent } from "./chip.js";
import { SnesChip, SPC_HZ } from "./chips/snes/dsp.js";
import { Spc700 } from "./chips/snes/spc700.js";
import { Ssmp } from "./chips/snes/ssmp.js";
import { buildPlayerProgram, PTR, SCRATCH, TIMER_TARGET, TICKS_PER_SECOND, BURST_OP, COPY_OP, COPY_ACTIVE } from "./chips/snes/spc-player.js";

/**
 * SPC export: a SNES song's register-write capture, frozen into a standard
 * `.spc` snapshot - the file every SPC player already opens, on real
 * hardware too, with no chipvoice runtime involved. `importSpc` is this
 * file's mirror image: it plays a `.spc` snapshot back through this
 * package's own SPC700; this file writes one, carrying its own tiny SPC700
 * player (`chips/snes/spc-player.ts`) into the snapshot's ARAM so any player
 * can run it.
 *
 * The container is the same fixed-offset struct `spc-import.ts` reads (this
 * file keeps its own copy of the offsets rather than importing them, since
 * they describe the file format, not shared runtime behavior):
 *
 *   0x00-0xFF   header: signature, ID666 flag, CPU registers, the tag
 *   0x100       64 KB of ARAM
 *   0x10100     128 DSP registers
 *   0x10180     64 bytes of "extra RAM" some tools expect after them
 *
 * What goes into the ARAM:
 *
 *  - The player (`buildPlayerProgram`), at a fixed origin ($0200, clear of
 *    the zero page/stack it doesn't use).
 *  - A compacted sample directory and the BRR data it points to: only the
 *    samples a KON write in the song ever actually latches, each copied out
 *    of the capture's `memory` once (scanned by its own BRR end flag, not
 *    assumed to be any particular length), with its loop point carried over
 *    as the same relative offset into the copy. Directory entries are
 *    renumbered to a compact 0.., and every SRCN *and* DIR write in the
 *    exported stream is rewritten to match, DIR always to this one
 *    compacted table's own page - the DSP knows nothing about the
 *    original bank, or its original page. "A KON write ever actually
 *    latches", not "the song's SRCN writes ever name": a driver can issue
 *    a stray SRCN write moments
 *    before the real one, at the very same tick, that no KON ever plays
 *    (real captures do this) - naming every SRCN write, glitch or not,
 *    would give the glitch its own bogus directory entry, reading whatever
 *    `memory` happens to hold at that never-really-used slot. `exportSpc`'s
 *    own pass over the write stream (search it for `usedKeys`) only
 *    compacts pairs a KON actually references; every other SRCN write is
 *    inert by construction, so it is rewritten to point at index 0.
 *  - The write stream itself: every `$F2`/`$F3` pair the capture ever made,
 *    as `{reg, value}`, each preceded by how many player ticks to wait
 *    first (see the encoding note on `buildPlayerProgram`). Two compaction
 *    passes run first, over the writes' own cycle stamps alone, before any
 *    of this function's real timing simulation: consecutive writes that
 *    land on the same tick (a voice's registers all set at once, ordinary
 *    at a keyed-on moment) fold into one burst event instead of several
 *    separate ones, and a run of events byte-identical to one already
 *    emitted earlier in the very same stream (a repeated bar, ordinary in
 *    real music) becomes a back-reference that replays the earlier bytes in
 *    place instead of storing them again - see the "group" and "planned
 *    event" comment further down for why deciding *which* events to fold or
 *    reuse this way never needs the real player simulation at all, only the
 *    real one deciding each surviving event's actual delta does. One tick is
 *    Timer 0's own period; `TIMER_TARGET`'s doc comment says which one and
 *    why. A write's original cycle stamp is rounded to the nearest tick -
 *    `1000 / TICKS_PER_SECOND` in milliseconds, half of that as a bound on
 *    its own - and that target is then chased by a *simulated* player: a
 *    second, scratch copy of this package's own SPC700 actually runs the
 *    assembled player program during export, so every real cycle the wait
 *    loop and the write dispatch itself cost is accounted for exactly, not
 *    estimated (see the pass 2 note below, in `exportSpc` itself, for why:
 *    without it a dense stretch of writes drifts the whole player late, one
 *    real but uncounted instruction-cost at a time).
 *  - The header's own CPU registers restore the CPU to the very first
 *    instruction of the player (PC at its origin, Y at 0 - every indirect
 *    fetch the player does relies on that - PSW at 0 so the direct page is
 *    $0000-$00FF), and the DSP register dump and the RAM image's own
 *    $F0-$FF page carry the DSP's own reset state, Timer 0's target and
 *    enable bit, and the stream's starting read head: nothing the player
 *    runs has to set any of that up itself, the snapshot already has it,
 *    exactly the way a real dump would.
 *
 * The echo buffer (ESA/EDL, `$6D`/`$7D`) is a window into this same ARAM the
 * DSP writes into on its own, not something the player or this export
 * places anything in - so this function tracks every value the capture
 * ever gives ESA, EDL and FLG (`$6C`, starting from the DSP's own reset
 * values for whatever plays before the first write) and refuses to produce
 * a file where any window the echo buffer could *write* through - only
 * while FLG's echo-disable bit is clear, the same condition both the DSP's
 * own `echo_write` and the real oracle's post-load `clear_echo()` gate on -
 * would land on the player, the directory, a sample, the write stream, or
 * the IPL ROM's reserved region ($FFC0-$FFFF, mapped or not - a real dump's
 * CPU could still read it there if CONTROL's ROM bit were ever set, which
 * this export never does, but the bytes are left alone regardless).
 *
 * A song too big to fit - player, directory, samples and stream all under
 * $FFC0, with the echo buffer clear of that - throws `SpcExportSizeError`
 * rather than writing a truncated file.
 */

export interface SpcExportOptions {
  title?: string;
  artist?: string;
  /** The game or project the track is from. */
  game?: string;
  /** Free text, in the tag's comment field. */
  notes?: string;
  /**
   * Where playback loops back to, in cycles. Defaults to 0 (the whole song
   * repeats): unlike `toVgm`'s file, which is content to stop, an `.spc` is
   * expected to play forever, the way a game's own track does. The loop
   * lands on the first register write at or after this point, not the
   * cycle itself - see the write stream's own doc comment (in `exportSpc`)
   * for why, and what that costs when this doesn't already land on a write.
   */
  loopAtCycle?: number;
  /**
   * The tag's "seconds to play" field. Defaults to `Math.round(cycles /
   * 1024000)` - one full pass through the captured performance, loop
   * segment included, the same span `cycles` already names.
   */
  secondsToPlay?: number;
  /** The tag's fade-out length, in seconds. Defaults to 0. */
  fadeSeconds?: number;
}

export class SpcExportSizeError extends Error {
  constructor(
    message: string,
    readonly measured: number,
    readonly limit: number,
  ) {
    super(message);
    this.name = "SpcExportSizeError";
  }
}

const SIGNATURE = "SNES-SPC700 Sound File Data\x1a\x1a";
const HEADER_VERSION_MINOR = 0x1e; // 30: an ordinary, unremarkable version stamp; no tool reads this
const HEADER_HAS_ID666 = 0x23;
const HEADER_PCL = 0x25;
const HEADER_PCH = 0x26;
const HEADER_A = 0x27;
const HEADER_X = 0x28;
const HEADER_Y = 0x29;
const HEADER_PSW = 0x2a;
const HEADER_SP = 0x2b;
const HEADER_TITLE = 0x2e;
const HEADER_GAME = 0x4e;
const HEADER_DUMPER = 0x6e;
const HEADER_COMMENTS = 0x7e;
const HEADER_SECONDS = 0xa9;
const HEADER_FADE_MS = 0xac;
const HEADER_ARTIST = 0xb1; // the "text" sub-format's offset (see spc-import.ts)
const HEADER_RAM = 0x100;
const RAM_SIZE = 0x10000;
const HEADER_DSP = HEADER_RAM + RAM_SIZE; // 0x10100
const DSP_SIZE = 128;
const EXTRA_RAM_SIZE = 64; // "the extra RAM": some readers expect it after the DSP dump
const FILE_SIZE = HEADER_DSP + DSP_SIZE + EXTRA_RAM_SIZE;

/** Where the player program starts. Everything below $0200 is the zero
 * page and the stack page, neither used for anything but the player's own
 * two scratch variables (`PTR`, `SCRATCH`, both under $0200). */
const CODE_ORIGIN = 0x0200;
/** The IPL ROM's reserved region: off limits to every allocation below,
 * mapped or not. */
const IPL_START = 0xffc0;

const R_DIR = 0x5d;
const R_FLG = 0x6c;
const R_ESA = 0x6d;
const R_EDL = 0x7d;
const R_KON = 0x4c;
/** FLG's echo-disable bit: while set, the DSP's own `echo_write` never
 * touches ARAM (it still *reads* the echo region for the FIR filter's
 * history regardless of this bit, same as real hardware, but a read cannot
 * corrupt this export's data - only a write can, so only the write side
 * gates what this export needs to reserve). `SNES_SPC::clear_echo()`
 * (the real oracle, run right after loading a snapshot) checks the same bit
 * on the DSP's dumped `FLG` before deciding whether the echo region even
 * needs clearing. */
const FLG_ECHO_DISABLE = 0x20;
/** `$x4` on any of the eight voices: SRCN, the sample this voice plays. */
const isSrcnReg = (reg: number) => (reg & 0x0f) === 0x04;

const CYCLES_PER_TICK = SPC_HZ / TICKS_PER_SECOND; // 1024, exactly

interface ResolvedWrite {
  cycle: number;
  reg: number;
  value: number;
}

/** `$F2`/`$F3` pairs, resolved to `{reg, value}`: the same dispatch
 * `SnesChip.write()` applies (DSPADDR latches, DSPDATA writes when the
 * latch names a real register, `< 0x80`). Mirrors `resolveWrites` in
 * `packages/conform/src/spc/check.mjs`, kept independent since that package
 * is not a dependency of this one. */
function resolveWrites(events: RegisterEvent[]): ResolvedWrite[] {
  const sorted = events.slice().sort((a, b) => a.at - b.at);
  let selected: number | undefined;
  const writes: ResolvedWrite[] = [];
  for (const e of sorted) {
    if (e.addr === 0xf2) selected = e.value & 0xff;
    else if (e.addr === 0xf3 && selected !== undefined && selected < 0x80) {
      writes.push({ cycle: e.at, reg: selected, value: e.value & 0xff });
    }
  }
  return writes;
}

/** A BRR sample's length, in bytes: 9-byte blocks until one's header byte
 * (bit 0) says it's the last. */
function brrSampleLength(ram: Uint8Array, start: number): number {
  const MAX_BLOCKS = 4096; // 36864 bytes: more than the whole ARAM, so this is "corrupt", not "long"
  let addr = start & 0xffff;
  for (let blocks = 1; blocks <= MAX_BLOCKS; blocks++) {
    const header = ram[addr];
    addr = (addr + 9) & 0xffff;
    if (header & 0x01) return blocks * 9;
  }
  throw new Error(`SPC export: the sample at $${start.toString(16)} has no BRR end block within ${MAX_BLOCKS} blocks; the capture's memory or directory looks corrupt`);
}

interface UsedSample {
  key: string;
  bytes: Uint8Array;
  loopOffset: number; // relative to the sample's own start
  newStart: number; // filled in once the layout is known
}

/**
 * Freezes a SNES song's register-write capture into a standard `.spc` file.
 * See this file's own doc comment for what goes where and why.
 *
 * @param events every `$F2`/`$F3` write the capture made, in the order the
 *   driver issued them - `recordSong`'s `events`, or a `PerformancePlan`'s
 * @param cycles how long the capture runs, in SPC cycles (`SPC_HZ`, i.e.
 *   1024000/s): `recordSong`'s `cycles`, or `Math.round(plan.seconds *
 *   SPC_HZ)` for a `PerformancePlan`. Writes at or past it are dropped, the
 *   same contract `toVgm` documents and applies (a `PerformancePlan`'s own
 *   events can run a little past this - an envelope's release tail finishing
 *   after the performance's last tick)
 * @param memory the capture's preloaded RAM - `recordSong`'s or a
 *   `PerformancePlan`'s `memory` - holding the original sample directory
 *   and BRR data the write stream's SRCN values point into
 */
export function exportSpc(
  events: RegisterEvent[],
  cycles: number,
  memory: { address: number; bytes: Uint8Array }[],
  options: SpcExportOptions = {},
): Uint8Array<ArrayBuffer> {
  const loopAtCycle = options.loopAtCycle ?? 0;
  if (!(loopAtCycle >= 0) || loopAtCycle > cycles) {
    throw new Error(`SPC export: loopAtCycle (${loopAtCycle}) must be between 0 and cycles (${cycles})`);
  }

  const originalRam = new Uint8Array(RAM_SIZE);
  for (const block of memory) originalRam.set(block.bytes, block.address);

  const resetRegs = new SnesChip().dsp.regs.slice(); // the S-DSP's own reset register file
  // A capture's own events can run a little past `cycles` (an envelope's
  // release tail finishing after the performance's own last tick) - dropped
  // here, the same "writes at or past it are dropped" contract `toVgm`
  // documents and applies (vgm.ts's own `kept` filter), not carried into
  // the exported stream where they would land past `totalTick` and produce
  // a negative wait back down to the loop point.
  const writes = resolveWrites(events).filter((w) => w.cycle < cycles);

  // ---- Pass 1: track DIR/ESA/EDL over time, compact the sample directory,
  // and rewrite each SRCN write's value to its compact index in place. ----
  let curDir = resetRegs[R_DIR];
  let curFlg = resetRegs[R_FLG];
  let curEsa = resetRegs[R_ESA];
  let curEdl = resetRegs[R_EDL];
  const echoFootprints: { start: number; size: number }[] = [];
  // Only a *live* echo write can corrupt this export's data, so only record
  // a footprint for spans where FLG's echo-disable bit is actually clear -
  // otherwise the DSP's reset-state ESA/EDL (which point at a page most
  // songs never touch) would force a conservative reservation no real song
  // ever needs, since every driver leaves echo disabled until it has set
  // ESA/EDL to their real, intended values (see `driver.ts`'s `powerOn`).
  const recordEcho = () => {
    if (curFlg & FLG_ECHO_DISABLE) return;
    const size = (curEdl & 0x0f) === 0 ? 4 : (curEdl & 0x0f) * 0x800;
    echoFootprints.push({ start: (curEsa & 0xff) * 0x100, size });
  };
  recordEcho(); // whatever plays before the first FLG/ESA/EDL write, if anything does

  // A SRCN write only names a sample the song actually plays once some
  // later KON bit for that same voice latches it - the driver can (and in
  // practice does) issue a stray SRCN write a moment before the real one, at
  // the very same tick, that nothing ever key-ons (see this file's own doc
  // comment on "glitch SRCN writes"). Compacting every SRCN write on sight,
  // meaningful or not, would give a glitch value its own bogus directory
  // entry: its bytes come from whatever `originalRam` happens to hold at
  // that never-really-used sample slot, wasting ARAM and, in the worst
  // case, tripping `brrSampleLength`'s corruption check on garbage data. So
  // this first pass only records which (dir, srcn) pairs a KON write ever
  // actually references; the compaction pass below only builds a directory
  // entry for those, and remaps every other SRCN write - inert by
  // construction, since no KON in this stream ever reads it back - to
  // whichever real sample lands at index 0.
  const usedKeys = new Set<string>();
  {
    let dir = resetRegs[R_DIR];
    const voiceSrcn: (number | undefined)[] = new Array(8).fill(undefined);
    const voiceSrcnDir: (number | undefined)[] = new Array(8).fill(undefined);
    for (const w of writes) {
      if (w.reg === R_DIR) dir = w.value;
      else if (isSrcnReg(w.reg)) {
        const voice = (w.reg >> 4) & 0x7;
        voiceSrcn[voice] = w.value;
        voiceSrcnDir[voice] = dir;
      } else if (w.reg === R_KON) {
        for (let voice = 0; voice < 8; voice++) {
          if ((w.value & (1 << voice)) === 0) continue;
          if (voiceSrcn[voice] === undefined) continue; // KON with no SRCN ever set for this voice: nothing to latch
          usedKeys.add(`${voiceSrcnDir[voice]}:${voiceSrcn[voice]}`);
        }
      }
    }
  }

  const usedSamples: UsedSample[] = [];
  const sampleIndex = new Map<string, number>(); // "dir:srcn" -> index into usedSamples
  const remapped: ResolvedWrite[] = new Array(writes.length);
  let hasUnusedSrcnWrite = false;
  for (let i = 0; i < writes.length; i++) {
    const w = writes[i];
    if (w.reg === R_DIR) curDir = w.value;
    else if (w.reg === R_FLG) { curFlg = w.value; recordEcho(); }
    else if (w.reg === R_ESA) { curEsa = w.value; recordEcho(); }
    else if (w.reg === R_EDL) { curEdl = w.value; recordEcho(); }

    if (isSrcnReg(w.reg)) {
      const key = `${curDir}:${w.value}`;
      if (!usedKeys.has(key)) {
        // A glitch value: filled in below, once the directory it must point
        // somewhere valid in is actually built.
        remapped[i] = { cycle: w.cycle, reg: w.reg, value: -1 };
        hasUnusedSrcnWrite = true;
        continue;
      }
      let index = sampleIndex.get(key);
      if (index === undefined) {
        const entryAddr = (curDir * 0x100 + w.value * 4) & 0xffff;
        const start = originalRam[entryAddr] | (originalRam[(entryAddr + 1) & 0xffff] << 8);
        const loopAddr = originalRam[(entryAddr + 2) & 0xffff] | (originalRam[(entryAddr + 3) & 0xffff] << 8);
        const length = brrSampleLength(originalRam, start);
        index = usedSamples.length;
        sampleIndex.set(key, index);
        usedSamples.push({ key, bytes: originalRam.slice(start, (start + length) & 0x1ffff), loopOffset: loopAddr - start, newStart: -1 });
      }
      remapped[i] = { cycle: w.cycle, reg: w.reg, value: index };
    } else {
      remapped[i] = w;
    }
  }
  if (hasUnusedSrcnWrite) {
    // Every real song latches at least one sample before its first KON, so
    // usedSamples is never empty here; index 0 is as inert a placeholder as
    // any other, since by construction no KON in this stream ever reads it
    // back through this particular write's voice/value.
    for (let i = 0; i < remapped.length; i++) {
      if (isSrcnReg(remapped[i].reg) && remapped[i].value === -1) remapped[i] = { ...remapped[i], value: 0 };
    }
  }
  if (usedSamples.length > 256) {
    throw new SpcExportSizeError(`SPC export: the song uses ${usedSamples.length} distinct samples, more than the 256 a directory can address`, usedSamples.length, 256);
  }

  // ---- Layout: player code, then the (page-aligned) directory, then the
  // samples it points to, then the write stream. ----
  const codeBytes = buildPlayerProgram(CODE_ORIGIN);
  const directoryAddr = (CODE_ORIGIN + codeBytes.length + 0xff) & ~0xff;
  const directoryLen = usedSamples.length * 4;
  let cursor = directoryAddr + directoryLen;
  for (const s of usedSamples) {
    s.newStart = cursor;
    cursor += s.bytes.length;
  }
  const streamAddr = cursor;

  // Every sample directory pass 1 compacted lives at this one page,
  // regardless of which page (or pages) the original capture's own DIR
  // register named - the whole point of compacting to a single 0.. table.
  // The SRCN writes above are already rewritten to index into it; DIR
  // itself has to be rewritten too, or the DSP goes on looking for that
  // table wherever the original capture's DIR pointed (typically the
  // original sample bank's own page, not this export's), reading whatever
  // this export actually put there instead - the player's own code, for
  // any song whose capture used the same page this export places code at.
  // The written page is always this same `directoryAddr`, however many
  // distinct DIR values the capture itself used, because the compacted
  // directory is the one table every remapped SRCN index now means.
  const dirPage = (directoryAddr >> 8) & 0xff;
  for (let i = 0; i < remapped.length; i++) {
    if (remapped[i].reg === R_DIR) remapped[i] = { ...remapped[i], value: dirPage };
  }

  // ---- Everything below the write stream is in place before any of it is
  // encoded: the player, the directory and the samples it points to, and
  // the $F0-$FF I/O page state a real dump restores on load (`ssmp.ts`'s
  // `loadSnapshot` doc comment - CONTROL enables Timer 0 only, its target
  // picks the tick rate, TnOUT starts at 0). Pass 2 below needs all of this
  // ready first: it runs the player for real to time the stream it is
  // itself writing. ----
  const ram = new Uint8Array(RAM_SIZE);
  ram.set(codeBytes, CODE_ORIGIN);
  for (const s of usedSamples) ram.set(s.bytes, s.newStart);
  for (let i = 0; i < usedSamples.length; i++) {
    const s = usedSamples[i];
    const loop = (s.newStart + s.loopOffset) & 0xffff;
    const at = directoryAddr + i * 4;
    ram[at] = s.newStart & 0xff;
    ram[at + 1] = (s.newStart >> 8) & 0xff;
    ram[at + 2] = loop & 0xff;
    ram[at + 3] = (loop >> 8) & 0xff;
  }
  ram[PTR] = streamAddr & 0xff;
  ram[PTR + 1] = (streamAddr >> 8) & 0xff;
  ram[0xf1] = 0x01; // CONTROL: Timer 0 enabled, ROM disabled, ports untouched
  ram[0xfa] = TIMER_TARGET;

  // ---- Pass 2a: group `remapped` into bursts, from the writes' own cycle
  // stamps alone - no real player simulation involved yet. A "group" is
  // either one plain write or a run of `BURST_MIN` or more consecutive
  // writes that all land on the very same tick (a voice's registers all set
  // at once, ordinary at a keyed-on moment): folding them under one $FE
  // header instead of a separate delta/reg/value triple each saves both
  // bytes and - just as important for the timing pass below - the real
  // per-write dispatch cost a dense run of individually-encoded writes
  // would otherwise have to pay for one at a time.
  //
  // This grouping (and the back-reference matching in pass 2b, right after)
  // only has to decide *which* events belong together or repeat - a
  // property of the source material's own relative timing, not of how
  // expensively any particular encoding dispatches it - so both run against
  // a cheap "naive" delta (chasing each write's cycle stamp from a running,
  // always tick-aligned position, ignoring dispatch cost entirely) rather
  // than the real simulated player pass 2c runs afterward. Two occurrences
  // of the same pattern get identical naive bytes regardless of where in
  // the song each one starts, because the naive delta is self-correcting -
  // it is recomputed from each write's own absolute cycle stamp every step,
  // not accumulated - so it never drifts away from the pattern's own
  // relative timing the way a running total could. ----
  const BURST_MIN = 4; // below this, a burst's own $FE+count header does not pay for itself
  // The real profitability floor is `matchedNaiveBytes > 6` below, in bytes,
  // not groups - this is only the smallest span a copy can even name (a
  // one-group "range" is nonsensical) and, not coincidentally, `HASH_GROUPS`
  // itself: nothing shorter than the hash window ever gets tried as a
  // candidate anyway. Measured on this repo's own three arrangements: 2
  // (this value) over 3 saves 2966/887/904 bytes (mario/zelda/sonic); 1
  // (also trying single-group candidates, via `HASH_GROUPS` 1) loses badly
  // instead - short, common single-group keys collide often enough to
  // spend more on failed or barely-profitable matches than they save.
  const MATCH_MIN_GROUPS = 2;
  const HASH_GROUPS = 2; // how many groups a candidate back-reference is first hashed on; see MATCH_MIN_GROUPS above for why 1 measures worse

  const naiveDeltaBytes = (ticks: number): number[] => {
    const out: number[] = [];
    let d = ticks;
    while (d >= 255) {
      out.push(0xff);
      d -= 255;
    }
    out.push(d);
    return out;
  };

  interface Group {
    writeIndices: number[]; // indices into `remapped`
    naiveBytes: number[]; // this group's own bytes, under the naive (non-real-time) delta
    kind: "write" | "burst";
  }
  const groups: Group[] = [];
  {
    let naivePos = 0;
    let i = 0;
    while (i < remapped.length) {
      const w = remapped[i];
      const ticks = Math.max(0, Math.round((w.cycle - naivePos) / CYCLES_PER_TICK));
      const target = naivePos + ticks * CYCLES_PER_TICK;
      let j = i + 1;
      while (j < remapped.length && j - i < 255 && Math.round((remapped[j].cycle - target) / CYCLES_PER_TICK) === 0) j++;
      const runLen = j - i;
      if (runLen >= BURST_MIN) {
        const bytes = naiveDeltaBytes(ticks);
        bytes.push(BURST_OP, runLen);
        const indices: number[] = [];
        for (let k = 0; k < runLen; k++) {
          bytes.push(remapped[i + k].reg, remapped[i + k].value & 0xff);
          indices.push(i + k);
        }
        groups.push({ writeIndices: indices, naiveBytes: bytes, kind: "burst" });
        i += runLen;
      } else {
        const bytes = naiveDeltaBytes(ticks);
        bytes.push(w.reg, w.value & 0xff);
        groups.push({ writeIndices: [i], naiveBytes: bytes, kind: "write" });
        i += 1;
      }
      naivePos = target;
    }
  }

  // ---- Pass 2b: greedy LZ77-style matching over `groups` - a run of one or
  // more consecutive groups whose naive bytes exactly match a run already
  // emitted earlier becomes one $FD copy event, referencing the earlier
  // occurrence's own final byte range (filled in by pass 2c below, which
  // always processes groups in the same left-to-right order this pass
  // decided, so an earlier occurrence's range is always already known by
  // the time a later copy needs to reference it). `consumed` tracks which
  // group indices this pass has already folded into someone else's copy, so
  // a later match can never point at a source range that is itself partly
  // spoken for by an even earlier copy - a copy's source is always plain
  // groups a later pass 2c step gives their own real byte range. ----
  type PlannedEvent =
    | { kind: "write"; writeIndices: number[] }
    | { kind: "burst"; writeIndices: number[] }
    | { kind: "copy"; writeIndices: number[]; sourceGroupStart: number; sourceGroupCount: number };
  const planned: PlannedEvent[] = [];
  const firstOcc = new Map<string, number>();
  const consumed = new Array<boolean>(groups.length).fill(false);
  const keyOfRange = (start: number, count: number) => groups.slice(start, start + count).map((g) => g.naiveBytes.join(":")).join("|");
  {
    let cursor = 0;
    while (cursor < groups.length) {
      const key = groups.length - cursor >= HASH_GROUPS ? keyOfRange(cursor, HASH_GROUPS) : null;
      let matched = false;
      if (key !== null) {
        const src = firstOcc.get(key);
        if (src !== undefined) {
          let k = 0;
          while (
            cursor + k < groups.length &&
            src + k < cursor &&
            !consumed[src + k] &&
            groups[src + k].naiveBytes.length === groups[cursor + k].naiveBytes.length &&
            groups[src + k].naiveBytes.every((v, idx) => v === groups[cursor + k].naiveBytes[idx])
          ) {
            k++;
          }
          const matchedNaiveBytes = groups.slice(cursor, cursor + k).reduce((s, g) => s + g.naiveBytes.length, 0);
          if (k >= MATCH_MIN_GROUPS && matchedNaiveBytes > 6) {
            const indices: number[] = [];
            for (let g = cursor; g < cursor + k; g++) indices.push(...groups[g].writeIndices);
            planned.push({ kind: "copy", writeIndices: indices, sourceGroupStart: src, sourceGroupCount: k });
            for (let g = cursor; g < cursor + k; g++) consumed[g] = true;
            cursor += k;
            matched = true;
          }
        }
      }
      if (!matched) {
        if (key !== null && !firstOcc.has(key)) firstOcc.set(key, cursor);
        const g = groups[cursor];
        planned.push(g.kind === "write" ? { kind: "write", writeIndices: g.writeIndices } : { kind: "burst", writeIndices: g.writeIndices });
        cursor += 1;
      }
    }
  }
  // ---- Pass 2c: encode `planned` for real, timed by actually running it.
  // Loop bookkeeping is inspired by toVgm's (vgm.ts), but can't emit a
  // separate "wait up to loopTick" step the way VGM's self-delimiting
  // commands allow (a wait of zero samples there is simply zero bytes):
  // this grammar needs exactly one delta before every event, so a synthetic
  // marker delta would either duplicate the very next event's own delta
  // (two deltas in a row, which the player can't parse) or, if skipped,
  // desync the byte the player reads as the event tag from the one meant as
  // its first payload byte. So the loop point is simply the byte offset of
  // the first *event* (write, burst or copy) whose last covered write's
  // original cycle stamp is at or after `loopAtCycle` - group-granular, not
  // write-granular, because a burst or copy event has no addressable byte
  // offset in the middle of it a jump could land on.
  //
  // Every wait a `.spc` player as simple as this one's own `spc-player.ts`
  // can do comes in whole ticks (Timer 0's own period), but *reading* the
  // stream, dispatching an event and looping back to read the next delta is
  // not itself free - almost entirely the byte reads and the $F2/$F3
  // writes (or the copy bookkeeping) themselves. A delta computed from the
  // raw cycle/tick math alone (as if reading and dispatching an event took
  // no time) silently ignores that cost; it is small next to a whole tick,
  // but a dense stretch - several notes changing in the same or adjacent
  // ticks, ordinary in a real arrangement - adds it up event after event
  // with nothing ever giving it back, and it was large enough on the
  // repo's own SNES arrangements to measurably late-shift the whole second
  // half of a song (see this file's own tests and the conformance sheet).
  // Rather than estimate that cost by hand (fragile - it depends on exactly
  // which instructions `buildPlayerProgram` assembles, and a bug in the
  // estimate is invisible until measured against a real song), this pass
  // runs a second, scratch copy of this package's own S-SMP and S-DSP -
  // loaded with the exact ARAM and DSP state above - as the real player,
  // live: it pokes each event's bytes into that chip's own ARAM (the same
  // bytes this function is also collecting into `stream`, its actual
  // output) and then single-steps the CPU until it has read past them, so
  // `ssmp.cycle` afterward is exactly where the real exported player will
  // be too - including, for a copy event, the real cost of replaying
  // whatever plain writes and bursts its source range holds, not just the
  // copy op's own few bytes. The next event's delta is then however many
  // ticks Timer 0 still needs to count down once that catches up to the
  // event's own original cycle stamp (a burst or copy's *first* covered
  // write's, since that is the moment this event as a whole is meant to
  // begin) - often zero for an event that lands only a handful of cycles
  // after the one before it, exactly the dense-stretch case this is for -
  // so every real SPC700 cost the exported file will actually pay is
  // accounted for, not estimated.
  //
  // A song whose write stream still does not fit in the ARAM left over
  // (`IPL_START - streamAddr`) stops trusting this real simulation the
  // moment the very first byte would land at or past `IPL_START`: nothing
  // written past that point is real ARAM the exported player could ever
  // run from, so single-stepping through it would either hang forever or
  // execute garbage. From there this pass falls back to the same naive,
  // no-dispatch-cost delta this file's other two passes already use, purely
  // to keep counting real bytes so `SpcExportSizeError` below can report
  // how many the song's write stream actually needs - the file is rejected
  // either way, so that fallback's own timing accuracy does not matter. ----
  const simChip = new SnesChip();
  const ssmp = new Ssmp(simChip);
  ssmp.loadSnapshot(ram, resetRegs);
  const cpu = new Spc700(ssmp);
  cpu.pc = CODE_ORIGIN;
  cpu.a = 0;
  cpu.x = 0;
  cpu.y = 0;
  cpu.psw = 0;
  cpu.sp = 0xef;
  const readPtr = () => simChip.ram[PTR] | (simChip.ram[PTR + 1] << 8);
  // Far more real SPC700 steps than reading one event's worth of bytes and
  // dispatching it could ever take, even waiting out a full 255-tick delta
  // continuation - a safety net against this simulation itself looping
  // forever on a `buildPlayerProgram` bug, not a limit any real event
  // approaches.
  const MAX_STEPS_PER_EVENT = 1_000_000;
  // A copy event's own header (5 bytes: COPY_OP + start lo/hi + end lo/hi)
  // sits immediately before the next event's own bytes, so PTR passes
  // straight through `target` while L_COPY_START is still just reading
  // that header - well before it redirects PTR into the source range,
  // replays it, and restores PTR from RETPTR. Stopping on `readPtr() ===
  // target` alone would end the simulation right there, before the
  // replay (and its real cost) ever happens. COPY_ACTIVE (0 outside a
  // copy, 1 while one is being replayed) tells the two apart: only a
  // `target` reached with COPY_ACTIVE back at 0 means the event, copy or
  // not, is actually done.
  const runUntilPtrReaches = (target: number) => {
    for (let i = 0; readPtr() !== target || simChip.ram[COPY_ACTIVE] !== 0; i++) {
      if (i >= MAX_STEPS_PER_EVENT) {
        throw new Error(`SPC export: the player never reached byte $${target.toString(16)} of its own write stream after ${MAX_STEPS_PER_EVENT} steps - a bug in buildPlayerProgram or this simulation, not a normal export failure`);
      }
      cpu.step();
    }
  };
  const stream: number[] = [];
  let loopByteOffset = -1;
  let overflowed = false;
  let fallbackCycle = 0; // valid only once `overflowed` - see pass 2c's own doc comment above
  // A footprint here is a *static* address range - it says nothing about
  // when during the song the echo write it stands for actually happens, the
  // same simplification the "prove the echo buffer never lands on any of
  // it" check below already makes. That is deliberately conservative for
  // the exported file's own correctness (that check runs regardless of
  // timing), but it also means live echo hardware in *this* simulation can
  // scribble over one of these addresses in `simChip.ram` at literally any
  // point once its footprint is active, including moments before this same
  // pass ever pokes a byte there - so any address inside a footprint is
  // already unsafe for the live simulation to read back later (see
  // `pokeStream` below), not just for the finished file.
  const inEchoFootprint = (addr: number) => echoFootprints.some(({ start, size }) => ((addr - start + RAM_SIZE) % RAM_SIZE) < size);
  const pokeStream = (byte: number) => {
    const at = streamAddr + stream.length;
    // The IPL ROM overflow case (past `IPL_START`) and this one (inside a
    // live echo footprint) are unrelated causes, but both mean the same
    // thing to this pass: `simChip.ram` at `at` cannot be trusted, either
    // because nothing real would ever run from there or because the DSP's
    // own echo hardware can silently overwrite it while this same
    // simulation is still running - a copy event replaying such a byte
    // later would then either read garbage or (found empirically exporting
    // `sonic`) spin `runUntilPtrReaches` for a byte value that can never
    // come back, since the corrupting write lands after this pass already
    // moved on. Both stop trusting the live simulation the same way, from
    // here on; which one actually applies is only resolved once by the two
    // dedicated checks after the main loop below, each with its own
    // specific, address-naming error.
    if (!overflowed && (at >= IPL_START || inEchoFootprint(at))) overflowed = true;
    if (!overflowed) simChip.ram[at] = byte;
    stream.push(byte);
  };
  const emitDelta = (deltaTicks: number) => {
    let d = deltaTicks;
    while (d >= 255) {
      pokeStream(0xff);
      d -= 255;
    }
    pokeStream(d);
  };
  const currentCycle = () => (overflowed ? fallbackCycle : ssmp.cycle);

  // Only a plain-write or burst group ever gets an entry here (its own real
  // byte range, once emitted) - a copy is never itself a valid source, see
  // pass 2b above. `contentStart` is where that same group's own bytes
  // begin right after its leading delta - a copy's source always starts
  // there, not at `start`: the copy op's own opening wait (below) already
  // spends whatever real time is needed to reach the first replayed
  // group's target, so replaying that group's own stored delta too would
  // wait for it a second time, on top of the fresh, real-time-correct
  // wait the copy op itself just did. Every other group's own delta - the
  // gap from the group before it, still inside the copied range - is a
  // portable, self-contained interval, not tied to when the source
  // occurrence happened to fall, and is replayed as stored.
  const groupByteRange = new Map<number, { start: number; end: number; contentStart: number }>();
  let groupsCursor = 0; // tracks the same left-to-right walk over `groups` pass 2b made

  for (const pe of planned) {
    const firstCycle = remapped[pe.writeIndices[0]].cycle;
    const lastCycle = remapped[pe.writeIndices[pe.writeIndices.length - 1]].cycle;
    if (loopByteOffset < 0 && lastCycle >= loopAtCycle) loopByteOffset = stream.length;

    const before = currentCycle();
    const ticksNeeded = Math.max(0, Math.round((firstCycle - before) / CYCLES_PER_TICK));
    const overflowedBefore = overflowed;
    const startOffset = stream.length;
    emitDelta(ticksNeeded);
    const contentOffset = stream.length;
    if (pe.kind === "write") {
      const w = remapped[pe.writeIndices[0]];
      pokeStream(w.reg);
      pokeStream(w.value & 0xff);
    } else if (pe.kind === "burst") {
      pokeStream(BURST_OP);
      pokeStream(pe.writeIndices.length);
      for (const idx of pe.writeIndices) {
        pokeStream(remapped[idx].reg);
        pokeStream(remapped[idx].value & 0xff);
      }
    } else {
      const start = groupByteRange.get(pe.sourceGroupStart)!;
      const end = groupByteRange.get(pe.sourceGroupStart + pe.sourceGroupCount - 1)!;
      pokeStream(COPY_OP);
      pokeStream(start.contentStart & 0xff);
      pokeStream((start.contentStart >> 8) & 0xff);
      pokeStream(end.end & 0xff);
      pokeStream((end.end >> 8) & 0xff);
    }

    if (!overflowedBefore && !overflowed) {
      runUntilPtrReaches(streamAddr + stream.length);
    } else {
      fallbackCycle = before + ticksNeeded * CYCLES_PER_TICK;
    }

    if (pe.kind === "copy") {
      groupsCursor += pe.sourceGroupCount;
    } else {
      groupByteRange.set(groupsCursor, { start: streamAddr + startOffset, end: streamAddr + stream.length, contentStart: streamAddr + contentOffset });
      groupsCursor += 1;
    }
  }
  // No event ever reaches loopAtCycle (it names a point after the last
  // write, or there are no writes at all): the loop point falls through to
  // the tail below, a silent stub that waits out to `cycles` and jumps to
  // itself, forever.
  if (loopByteOffset < 0) loopByteOffset = stream.length;
  // Rounded to the nearest tick everywhere else in this pass (a symmetric
  // jitter, fine for mid-song timing), but this one final wait is not
  // symmetric: it is what keeps the loop jump itself from ever firing
  // before `cycles`. Rounding it down, on the roughly half of songs whose
  // remaining cycles happen to fall in the lower half of a tick, lands the
  // jump a few hundred cycles short - close enough that a listener would
  // never hear it, but far enough that a caller sampling exactly `cycles`
  // worth of playback (this file's own round-trip check, `check-export.mjs`)
  // catches the very first sliver of the loop target's own content already
  // replaying inside that window, a real extra write no plan-side trace
  // ever has. Rounding up instead means this wait is never short, so the
  // loop can only ever fire at or after `cycles` - at most a fraction of a
  // tick longer than strictly needed, same order of magnitude as the
  // dispatch jitter every other wait in this file already carries.
  emitDelta(Math.max(0, Math.ceil((cycles - currentCycle()) / CYCLES_PER_TICK)));
  const loopTarget = (streamAddr + loopByteOffset) & 0xffff;
  pokeStream(0xff);
  pokeStream(loopTarget & 0xff);
  pokeStream((loopTarget >> 8) & 0xff);

  const dataEnd = streamAddr + stream.length;

  // ---- Prove the echo buffer never lands on any of it. Checked before the
  // plain size check below (same `overflowed` trip can come from either
  // cause - see `pokeStream`'s own doc comment - and an echo overlap gets
  // its own, more specific address-naming message instead of just being
  // folded into "too large"). ----
  const reserved = new Uint8Array(RAM_SIZE);
  reserved.fill(1, 0, dataEnd);
  reserved.fill(1, IPL_START, RAM_SIZE);
  for (const { start, size } of echoFootprints) {
    for (let i = 0; i < size; i++) {
      const addr = (start + i) & 0xffff;
      if (reserved[addr]) {
        throw new SpcExportSizeError(
          `SPC export: the echo buffer (ESA/EDL give bytes $${start.toString(16)}-$${((start + size) & 0xffff).toString(16)}) overlaps the player/directory/samples/stream region (bytes $0-$${dataEnd.toString(16)}) at $${addr.toString(16)}`,
          dataEnd,
          addr,
        );
      }
    }
  }

  if (overflowed) {
    throw new SpcExportSizeError(
      `SPC export needs ${stream.length} bytes of ARAM for the DSP write stream alone, on top of the player, directory and samples already using $${CODE_ORIGIN.toString(16)}-$${(streamAddr - 1).toString(16)}, more than the ${IPL_START - streamAddr} available before the IPL ROM's reserved region ($FFC0-$FFFF)`,
      stream.length,
      IPL_START - streamAddr,
    );
  }

  // ---- The write stream, now timed, is the only thing missing from `ram`
  // (built before Pass 2, above) - `simChip.ram` also has it, from the same
  // pokes, but also everything the simulation's own playback wrote on top
  // (echo history, wherever it left PTR, ...), none of which belongs in a
  // fresh snapshot meant to start the song, not resume it mid-flight. ----
  ram.set(stream, streamAddr);

  const dsp = resetRegs; // the DSP's own reset state; the write stream (including whatever power-on writes the capture made) drives it from here

  const file = new Uint8Array(FILE_SIZE);
  for (let i = 0; i < SIGNATURE.length; i++) file[i] = SIGNATURE.charCodeAt(i);
  file[0x21] = 0x30; // version major '0' - unread by any of this repo's own loaders
  file[0x22] = HEADER_VERSION_MINOR;
  file[HEADER_HAS_ID666] = 0x1a;
  file[HEADER_PCL] = CODE_ORIGIN & 0xff;
  file[HEADER_PCH] = (CODE_ORIGIN >> 8) & 0xff;
  file[HEADER_A] = 0;
  file[HEADER_X] = 0;
  file[HEADER_Y] = 0; // every indirect fetch the player does assumes this
  file[HEADER_PSW] = 0; // P=0: the direct page is $0000-$00FF
  file[HEADER_SP] = 0xef; // never touched (no CALL/PUSH/BRK in the player); the usual convention

  const text = (at: number, len: number, s: string | undefined) => {
    for (let i = 0; i < len; i++) file[at + i] = i < (s?.length ?? 0) ? s!.charCodeAt(i) & 0x7f : 0x20;
  };
  const digits = (at: number, len: number, value: number) => {
    const s = String(Math.max(0, Math.round(value)));
    if (s.length > len) throw new Error(`SPC export: ${value} does not fit in a ${len}-digit tag field`);
    for (let i = 0; i < len - s.length; i++) file[at + i] = 0x20;
    for (let i = 0; i < s.length; i++) file[at + len - s.length + i] = s.charCodeAt(i);
  };
  text(HEADER_TITLE, 32, options.title);
  text(HEADER_GAME, 32, options.game);
  text(HEADER_DUMPER, 16, "chipvoice");
  text(HEADER_COMMENTS, 32, options.notes);
  text(HEADER_ARTIST, 32, options.artist);
  digits(HEADER_SECONDS, 3, options.secondsToPlay ?? Math.round(cycles / SPC_HZ));
  digits(HEADER_FADE_MS, 5, Math.round((options.fadeSeconds ?? 0) * 1000));

  file.set(ram, HEADER_RAM);
  file.set(dsp, HEADER_DSP);
  // The 64 bytes of "extra RAM" after the DSP dump: zeroed, since nothing
  // this export writes uses them - left in for the readers that expect the
  // file to reach this far.

  return file;
}
