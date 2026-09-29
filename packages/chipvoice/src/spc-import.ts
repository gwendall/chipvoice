import type {PerformancePlan} from './performance.js';
import type {RegisterEvent} from './chip.js';
import {Spc700} from './chips/snes/spc700.js';
import {Ssmp} from './chips/snes/ssmp.js';
import {DSP_SNAPSHOT_RESTORE_ADDR, SnesChip, SPC_HZ} from './chips/snes/dsp.js';

/**
 * The ID666 tag, when a file carries one: the song's own metadata, never
 * required for playback (the S-DSP and S-SMP snapshot restores exactly
 * without it). Fields are read leniently - a dumper's tag is free-form text
 * padded with spaces or NULs - and left out rather than guessed when a value
 * does not look like the field it claims to be.
 */
export interface Id666Tag {
  title?: string;
  gameTitle?: string;
  dumper?: string;
  comments?: string;
  artist?: string;
  /** Seconds the song plays before any fade-out, as the tag records it. */
  secondsToPlay?: number;
  /** Fade-out length, in seconds. */
  fadeSeconds?: number;
}

export interface SpcPerformancePlan extends PerformancePlan {
  id666?: Id666Tag;
  /**
   * How many of `events`, from the start, are the synthetic per-register
   * DSPADDR/DSPDATA restore pairs (see `importSpc`'s doc comment). This
   * does NOT cover every synthetic event the plan opens with - the DSPADDR
   * seed and the `DSP_SNAPSHOT_RESTORE_ADDR` sentinel both come right
   * after this many entries, deliberately outside this count, so a caller
   * that only wants to skip the per-register restore pairs (e.g. `check.mjs`'s
   * `resolveWrites`, which still wants to see the DSPADDR seed) can. See
   * `snapshotEvents` for the index of the first write the CPU itself made.
   */
  restoreEvents: number;
  /**
   * How many of `events`, from the start, are synthetic (not writes the CPU
   * actually made while playing): the `restoreEvents` per-register restore
   * pairs, plus the DSPADDR seed and the `DSP_SNAPSHOT_RESTORE_ADDR`
   * sentinel that follow them. A comparison against a real CPU oracle -
   * which loads a snapshot's registers and hidden latches directly, never
   * through any $F2/$F3 write a replay can see - skips exactly this many
   * events from the front before comparing.
   */
  snapshotEvents: number;
}

// The .spc container: a fixed-offset struct, not a chip's own behavior, so
// this layout is read from the format's own file-header convention (cross-
// checked against two independent write-ups) rather than any emulator's
// source. Offsets and sizes below are exactly that struct.
const SIGNATURE = 'SNES-SPC700 Sound File Data'; // reference loaders check only this 27-byte prefix
const HEADER_HAS_ID666 = 0x23;
const HEADER_PCL = 0x25;
const HEADER_PCH = 0x26;
const HEADER_A = 0x27;
const HEADER_X = 0x28;
const HEADER_Y = 0x29;
const HEADER_PSW = 0x2a;
const HEADER_SP = 0x2b;
const HEADER_TEXT = 0x2c;
const HEADER_RAM = 0x100;
const RAM_SIZE = 0x10000;
const HEADER_DSP = HEADER_RAM + RAM_SIZE; // 0x10100
const DSP_SIZE = 128;
const MIN_FILE_SIZE = HEADER_DSP + DSP_SIZE; // 0x10180, the minimum a conforming file must reach

function ascii(bytes: Uint8Array, at: number, length: number): string {
  let end = length;
  while (end > 0 && (bytes[at + end - 1] === 0 || bytes[at + end - 1] === 0x20)) end--;
  let out = '';
  for (let i = 0; i < end; i++) {
    const b = bytes[at + i];
    if (b === 0) break; // an embedded NUL ends the string even inside a padded field
    out += String.fromCharCode(b);
  }
  return out;
}

/** True once every byte up to the first NUL/space pad is printable ASCII: the
 * test a lenient string field must pass before it is reported at all. */
function looksLikeText(s: string): boolean {
  if (!s.length) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c > 0x7e) return false;
  }
  return true;
}

/** The tag's numeric fields are ASCII digits, loosely space/NUL padded (some
 * dumpers left them binary; a field that is not plausible digits is dropped
 * rather than misread). */
function digits(bytes: Uint8Array, at: number, length: number): number | undefined {
  let s = '';
  for (let i = 0; i < length; i++) {
    const b = bytes[at + i];
    if (b === 0 || b === 0x20) continue;
    if (b < 0x30 || b > 0x39) return undefined;
    s += String.fromCharCode(b);
  }
  if (!s.length) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * The ID666 tag's fields, at the offsets both the text and binary sub-
 * formats share (title, game title, dumper, comments, and the "seconds
 * before fade" / "fade length" pair the ticket's "length" is read from). The
 * two sub-formats only diverge from the date field onward, which this parser
 * does not otherwise depend on, so no text/binary sniff is needed for what
 * it reports.
 */
function parseId666(bytes: Uint8Array): Id666Tag | undefined {
  const title = ascii(bytes, 0x2e, 32);
  const gameTitle = ascii(bytes, 0x4e, 32);
  const dumper = ascii(bytes, 0x6e, 16);
  const comments = ascii(bytes, 0x7e, 32);
  const secondsToPlay = digits(bytes, 0xa9, 3);
  const fadeMillis = digits(bytes, 0xac, 5) ?? digits(bytes, 0xac, 4);
  // Artist sits one byte later in the binary sub-format (the date field
  // before it is 4 raw bytes there instead of an 11-byte date string); try
  // both and keep whichever reads as plausible text.
  const artistText = ascii(bytes, 0xb1, 32);
  const artistBinary = ascii(bytes, 0xb0, 32);
  const artist = looksLikeText(artistText) ? artistText : looksLikeText(artistBinary) ? artistBinary : undefined;
  const tag: Id666Tag = {};
  if (looksLikeText(title)) tag.title = title;
  if (looksLikeText(gameTitle)) tag.gameTitle = gameTitle;
  if (looksLikeText(dumper)) tag.dumper = dumper;
  if (looksLikeText(comments)) tag.comments = comments;
  if (artist) tag.artist = artist;
  if (secondsToPlay !== undefined && secondsToPlay > 0 && secondsToPlay <= 36000) tag.secondsToPlay = secondsToPlay;
  if (fadeMillis !== undefined && fadeMillis >= 0 && fadeMillis <= 60000) tag.fadeSeconds = fadeMillis / 1000;
  return Object.keys(tag).length ? tag : undefined;
}

/**
 * Plays an .spc snapshot (SPC700 + S-DSP state, the SNES's own music format)
 * through this package's own S-SMP and S-DSP: restores the CPU, the 64 KB
 * ARAM and every DSP register exactly, then runs the real CPU for the
 * requested duration, capturing the trace of $F2/$F3 (DSPADDR/DSPDATA)
 * writes it makes. The returned plan replays like any other: `events` for a
 * fresh chip's `schedule()`, `memory` for its `load()`. Because a fresh
 * chip's S-DSP starts with every register and all hidden state at its own
 * construction defaults - exactly what this snapshot's registers and the
 * decode/envelope/echo state this format cannot capture both amount to - the
 * plan opens with a synthetic write of every DSP register (at cycle 0,
 * before the real trace) rather than needing a second, driver-specific way
 * to load a plan's initial register file.
 *
 * Length comes from `options.seconds` when given, else the ID666 tag's
 * "seconds before fade" (plus its fade length, when both are present and
 * plausible). Most SPC music loops forever in the engine's own timeline, so
 * nothing in the format itself says how long a performance is: a file with
 * neither is rejected rather than defaulted, since a made-up length would
 * either cut a real performance short or, picked long "to be safe", make
 * every such import silently pay for however many simulated seconds that
 * guess cost.
 */
export function importSpc(bytes: Uint8Array, options: {seconds?: number} = {}): SpcPerformancePlan {
  if (bytes.length < MIN_FILE_SIZE) throw new Error(`Truncated .spc file (need at least ${MIN_FILE_SIZE} bytes, got ${bytes.length})`);
  let signatureOk = true;
  for (let i = 0; i < SIGNATURE.length; i++) if (bytes[i] !== SIGNATURE.charCodeAt(i)) { signatureOk = false; break; }
  if (!signatureOk) throw new Error('Not an SPC700 Sound File (bad signature)');

  const hasId666 = bytes[HEADER_HAS_ID666];
  const id666 = hasId666 === 0x1a ? parseId666(bytes) : undefined;

  const ram = bytes.subarray(HEADER_RAM, HEADER_RAM + RAM_SIZE);
  const dspRegs = bytes.subarray(HEADER_DSP, HEADER_DSP + DSP_SIZE);

  const chip = new SnesChip();
  const ssmp = new Ssmp(chip);
  ssmp.loadSnapshot(ram, dspRegs);
  const cpu = new Spc700(ssmp);
  cpu.pc = bytes[HEADER_PCL] | (bytes[HEADER_PCH] << 8);
  cpu.a = bytes[HEADER_A];
  cpu.x = bytes[HEADER_X];
  cpu.y = bytes[HEADER_Y];
  cpu.psw = bytes[HEADER_PSW];
  cpu.sp = bytes[HEADER_SP];

  let seconds = options.seconds;
  if (seconds === undefined && id666?.secondsToPlay !== undefined) seconds = id666.secondsToPlay + (id666.fadeSeconds ?? 0);
  if (seconds === undefined) throw new Error('No duration available: pass options.seconds, or use a file whose ID666 tag has a "seconds to play" field');
  if (!(seconds > 0) || seconds > 36000) throw new Error('Invalid or implausible SPC duration');
  const totalCycles = Math.round(seconds * SPC_HZ);

  // Every one of the 128 DSP registers, restored the same way a fresh chip
  // will see any other write: through DSPADDR/DSPDATA, before the real
  // trace below. Register $7C (ENDX) is the one register real hardware
  // always clears on write regardless of the byte sent; a fresh chip's
  // ENDX already reads 0, so this is a no-op for it, matching the snapshot
  // only in the case that matters (nothing in S-DSP playback reads ENDX
  // back as an input, only the CPU does).
  const events: RegisterEvent[] = [];
  for (let reg = 0; reg < DSP_SIZE; reg++) {
    events.push({at: 0, addr: 0xf2, value: reg});
    events.push({at: 0, addr: 0xf3, value: dspRegs[reg]});
  }
  const restoreEvents = events.length;
  // DSPADDR ($F2) is S-SMP latch state, not one of the 128 DSP registers
  // the loop above restores. A snapshot taken mid-song (the normal case)
  // almost never has $F2 written again before the CPU's very next real
  // instruction: the resumed trace typically starts with a bare
  // "MOV $F3,A" targeting DSPDATA, relying on $F2 already holding the
  // register the program selected before the snapshot was taken. A fresh
  // chip replaying `events` without this line starts with the loop's own
  // last iteration selected (register 127) instead, so that first real
  // write lands on the wrong register. This event seeds the true selected
  // register; it is stamped at cycle 0 like the restore loop, but placed
  // after `restoreEvents` so callers that skip the first `restoreEvents`
  // entries (the synthetic per-register restore writes) still see it.
  events.push({at: 0, addr: 0xf2, value: ssmp.dspAddr});
  // The 128 writes above land every register at its snapshot value, but a
  // fresh `SnesChip` replaying them is left with the DSP's hidden
  // per-sample latches (the echo address, the direction page, the KON
  // edge-latch) and its echo history at their constructor defaults, not at
  // what a chip that had actually been playing up to this instant would
  // hold. Those latches only ever re-sync from the register file once a
  // sample (`SDsp`'s `echo_29`/`misc_*` phases), so without this event a
  // replay's very first sample - and, through the echo buffer's 8-deep
  // history, every sample until the ring wraps once - runs on stale state
  // instead of the snapshot's own (see `SDsp.restoreInternalState`'s doc
  // comment). `DSP_SNAPSHOT_RESTORE_ADDR` is not a real port; `SnesChip`
  // recognizes it as "the register file you now hold is a snapshot's" and
  // re-syncs those latches from it immediately, matching what `SDsp.load`
  // already does for a caller with the raw register block in hand. Placed
  // after `restoreEvents` for the same reason as the DSPADDR seed above.
  events.push({at: 0, addr: DSP_SNAPSHOT_RESTORE_ADDR, value: 0});
  const snapshotEvents = events.length;

  const maxEvents = 4_000_000;
  while (ssmp.cycle < totalCycles) {
    cpu.step();
    if (ssmp.events.length > maxEvents) throw new Error('SPC playback exceeds four million register writes');
  }
  for (const e of ssmp.events) events.push(e);

  return {
    chip: 'snes',
    seconds,
    loopStartSeconds: 0,
    events,
    restoreEvents,
    snapshotEvents,
    memory: [{address: 0, bytes: ram.slice()}],
    notes: [],
    losses: [],
    ...(id666 ? {id666} : {}),
  };
}
