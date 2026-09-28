import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportSpc, importSpc, planPerformance, snesChip, SpcExportSizeError } from 'chipvoice';
import { chipSnes } from '../chips/snes.mjs';
import { spcCpuWrites, spcCpuSamples } from '../oracles/spc-cpu.mjs';
import { compare } from '../compare.mjs';
import { ChangeStream } from '../change-stream.mjs';

/**
 * check:spc-export - `exportSpc` proved against the repo's own SNES music,
 * not a hand-built fixture: the three published arrangements
 * (`scores/arrangements/{mario,zelda,sonic}.json`), planned for `snesChip`
 * the same way `scores/arrangements/check.mjs` does. There is no SNES-native
 * song in `scores/` yet (`native-sources.mjs` only has NES and Mega Drive
 * sources) - when one exists this corpus grows to include it; until then
 * the row for it in `docs/BACKLOG.md` says so.
 *
 *   node src/spc/check-export.mjs [--json <file>] [--sheet <file>] [--report]
 *   node src/spc/check-export.mjs --self-test
 *   node src/spc/check-export.mjs --space room   # report only; refuses --sheet
 *
 * `--self-test` runs a handful of negative tests (and their positive
 * controls) against synthetic data instead of the real corpus, one set per
 * gate this file has: an oracle write altered by one value, an oracle write
 * cycle shifted one past either of the two exact values `WRITE_CYCLE_OFFSETS`
 * names, a write placed past the round-trip timing bound, a voice dropped
 * entirely, and a single sample perturbed by one value - each must make the
 * matching gate fail, not just pass by accident, and each exact gate's own
 * named legitimate value (such as the -6 early exit) must still pass (see
 * `selfTest`'s own doc comment).
 *
 * Two comparisons per song, both against `exportSpc`'s own output, not the
 * pre-export capture directly (its sample directory is legitimately
 * renumbered - see `spc-export.ts`'s doc comment - so a literal register
 * comparison against the original has to canonicalize SRCN the same way
 * `packages/chipvoice/test/spc-export.mjs` does):
 *
 *  - Our own round trip: `importSpc(exportSpc(plan))`, run through this
 *    package's own SPC700, against a direct trace of the original plan
 *    (`chipSnes.trace`, the same "no file at all" render every other
 *    corpus's own side already uses) - the audio a listener would actually
 *    hear from the file, compared to the plan it was built from.
 *  - The real oracle: the same exported file played by `play-spc` (blargg's
 *    SPC700, vendored snes_spc), exactly like `check.mjs` does for its own
 *    corpus - any divergence here is the CPU/timers/snapshot path, since
 *    the DSP itself is already known to match blargg's line for line.
 *
 * Each song's encoded size is reported too: `exportSpc` throws
 * `SpcExportSizeError` rather than write a truncated file, so every row that
 * appears here fit; the number says by how much.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARRANGEMENTS_DIR = path.join(HERE, '../../../../scores/arrangements');
const ARRANGEMENT_IDS = ['mario', 'zelda', 'sonic'];

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.lastIndexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);
/** `--space room` plans and exports the same three arrangements in the
 * "room" acoustic space instead of the default "dry" (see
 * `PerformanceOptions.space`) - a report-only override, never the sheet's
 * own baseline: the published bank exports dry, so the sheet's numbers must
 * stay about that, but a `SpcExportSizeError`'s bytes-needed/available in
 * "room" are otherwise only ever hand-guessed, which the numbers-on-sheets
 * rule (docs/chips/snes.md's own header) exists to prevent. */
const spaceOption = option('space', undefined);

/** `$F2`/`$F3` pairs resolved to `{cycle, reg, value}` - the same dispatch
 * `check.mjs`'s own copy documents (kept independent for the same reason
 * that one gives: this script is not a dependency of `spc-export.ts` or
 * vice versa). */
function resolveWrites(events) {
  let selected;
  const writes = [];
  for (const e of events) {
    if (e.addr === 0xf2) selected = e.value & 0xff;
    else if (e.addr === 0xf3 && selected !== undefined && selected < 0x80) writes.push({ cycle: e.at, reg: selected, value: e.value & 0xff });
  }
  return writes;
}
const isSrcn = (reg) => (reg & 0x0f) === 0x04;

const isKon = (reg) => reg === 0x4c;

/** Which `(dir, srcn)` pairs a KON write actually latches - the same first
 * pass `exportSpc` makes over the write stream (search its source for
 * `usedKeys`) before it compacts anything; see
 * `packages/chipvoice/test/spc-export.mjs` for the full explanation (a
 * capture's driver can issue a stray SRCN write no KON ever plays). */
function usedSrcnKeys(writes) {
  let dir = 0;
  const voiceSrcn = new Array(8).fill(undefined);
  const voiceSrcnDir = new Array(8).fill(undefined);
  const used = new Set();
  for (const w of writes) {
    if (w.reg === 0x5d) dir = w.value;
    else if (isSrcn(w.reg)) {
      const voice = (w.reg >> 4) & 0x7;
      voiceSrcn[voice] = w.value;
      voiceSrcnDir[voice] = dir;
    } else if (isKon(w.reg)) {
      for (let voice = 0; voice < 8; voice++) {
        if ((w.value & (1 << voice)) === 0) continue;
        if (voiceSrcn[voice] === undefined) continue;
        used.add(`${voiceSrcnDir[voice]}:${voiceSrcn[voice]}`);
      }
    }
  }
  return used;
}

/** SRCN canonicalized to `(dir, srcn)` identity in first-use order among only
 * the pairs a KON write actually latches, and DIR canonicalized to
 * `dirPage` (read from a real DIR write in the already-exported round trip)
 * throughout - both the same compaction `exportSpc` itself makes (see
 * `packages/chipvoice/test/spc-export.mjs` for the full explanation). */
function canonicalizeSrcn(writes, dirPage) {
  const used = usedSrcnKeys(writes);
  let dir = 0;
  const firstUse = new Map();
  const out = writes.map((w) => {
    if (w.reg === 0x5d) { dir = w.value; return { ...w, value: dirPage }; }
    if (!isSrcn(w.reg)) return w;
    const key = `${dir}:${w.value}`;
    if (!used.has(key)) return { ...w, value: -1 }; // fixed up below
    let index = firstUse.get(key);
    if (index === undefined) { index = firstUse.size; firstUse.set(key, index); }
    return { ...w, value: index };
  });
  return out.map((w) => (isSrcn(w.reg) && w.value === -1 ? { ...w, value: 0 } : w));
}

const R_FLG = 0x6c;
const R_EDL = 0x7d;
const R_EVOLL = 0x2c;
const R_EVOLR = 0x3c;
const FLG_ECHO_DISABLE = 0x20;

/** The other compaction `exportSpc` makes (see its own doc comment, next to
 * `R_EVOLL`/`R_EVOLR`, for the full reasoning): when a capture's own writes
 * never set EVOLL or EVOLR to anything but zero, the exported file reclaims
 * the echo buffer's ARAM footprint by forcing every FLG write's
 * echo-disable bit set and every EDL write to 0 - neither changes one
 * output sample, since echo is EVOL-scaled and EVOL never leaves zero. A
 * literal write-for-write comparison has to canonicalize the same way SRCN
 * already is, or this harmless, audio-preserving rewrite reads as a
 * divergence. Applied to both sides: a no-op on the already-rewritten
 * export, and the same rewrite `exportSpc` itself would make on the plan. */
function canonicalizeEcho(writes) {
  let evolL = 0, evolR = 0, everAudible = false;
  for (const w of writes) {
    if (w.reg === R_EVOLL) evolL = w.value & 0xff;
    else if (w.reg === R_EVOLR) evolR = w.value & 0xff;
    if (evolL !== 0 || evolR !== 0) { everAudible = true; break; }
  }
  if (everAudible) return writes;
  return writes.map((w) => {
    if (w.reg === R_FLG) return { ...w, value: (w.value | FLG_ECHO_DISABLE) & 0xff };
    if (w.reg === R_EDL) return { ...w, value: 0 };
    return w;
  });
}

function compareWrites(ours, oracle) {
  const n = Math.min(ours.length, oracle.length);
  let matched = 0;
  while (matched < n && ours[matched].reg === oracle[matched].reg && ours[matched].value === oracle[matched].value) matched++;
  const first = matched < ours.length || matched < oracle.length ? { index: matched, ours: ours[matched] ?? null, oracle: oracle[matched] ?? null } : null;
  return { oursCount: ours.length, oracleCount: oracle.length, matched, first };
}
function fmtWrite(w) {
  return w ? `reg $${w.reg.toString(16).padStart(2, '0')} = $${w.value.toString(16).padStart(2, '0')} @ cycle ${w.cycle}` : '(none)';
}

/** The last write at or before `cycle` in a cycle-ordered write list - used
 * to explain a sample divergence (item 3: "the write just before it") rather
 * than just the bare cycle number. */
function lastWriteAtOrBefore(writes, cycle) {
  let result = null;
  for (const w of writes) {
    if (w.cycle > cycle) break;
    result = w;
  }
  return result;
}

// spc-player.ts: TIMER_TARGET=8, 8000/8 = 1000 Hz = 1024 SPC cycles/tick -
// the same constant packages/chipvoice/test/spc-export.mjs names for its own
// round-trip timing check.
const CYCLES_PER_TICK = 1024;

// check.mjs's own documented "+1 for the last access of an instruction"
// cycle-labeling convention difference between the two CPUs - already
// treated as benign there, and the offset every oracle write carries unless
// T0_POLL_EARLY_EXIT below also applies to it.
const KNOWN_WRITE_OFFSET = 1;

// blargg's vendored snes_spc (oracles/snes-spc/snes_spc/SNES_SPC.cpp,
// `run_timer_`) decides a timer's elapsed periods lazily, only when
// something actually reads or writes it, via `TIMER_DIV(t, time -
// t->next_time) + 1`. The exported player (spc-player.ts) polls Timer 0's
// output counter (`T0OUT`, $FD) in a tight loop - `MOV A,dp` (3 cycles) then
// a taken `BEQ` back to the same poll (4 cycles), 7 cycles per "still
// waiting" iteration - so the real question at each poll is only ever "has
// blargg's lazy formula and this package's own per-cycle timer model (ssmp.ts's
// `Timer.tick()`, which advances every timer by exactly one cycle before the
// CPU's own next bus access can see it) already crossed the same 128-cycle
// prescaler boundary, as of the exact cycle this specific poll read lands
// on". They agree on every boundary that is not itself the poll's own read
// cycle - the ordinary case, `KNOWN_WRITE_OFFSET` alone explains it - but the
// two models differ on whether a read landing exactly on a boundary cycle
// already sees that boundary's own count. When it lands early enough,
// blargg's poll sees the counter go nonzero one iteration before this
// package's own per-cycle model would have looped again, so the write that
// follows the loop lands a whole poll iteration (7 cycles) earlier in
// blargg's trace than KNOWN_WRITE_OFFSET alone predicts - `1 - 7 = -6`. It
// never compounds: the next wait re-synchronizes to the true boundary (there
// is no drift to inherit), so a write with no wait of its own before it
// (delta 0, dispatched straight out of a burst or copy) only ever inherits
// whichever of the two values the wait before it already settled on, never a
// third. Proven by construction, not just observed: a minimal synthetic
// two-write .spc with a single isolated wait never reproduces this (the
// dispatch overhead that walks the poll's own phase forward by a couple of
// cycles each time never has anywhere to accumulate from), but a repeating
// wait-then-write loop does, deterministically, at the same write index
// every time it is rebuilt (see `packages/conform`'s own git history for the
// isolating scratch scripts this was found with). Exhaustively confirmed on
// the whole write stream of both real corpus songs: `oracle[i].cycle -
// ours[i].cycle` takes exactly the two values below, nothing else, for every
// single write in `mario` (24092/24092) and `zelda` (12665/12665). This is a
// boundary-inclusivity artifact of blargg's own lazy catch-up formula, not a
// bug in this package's per-cycle timer (ssmp.ts already resolves the same
// question, and every other project boundary this file's git history has
// checked, the per-cycle model against real hardware behavior), so it is
// shimmed and documented here rather than patched into the vendored oracle.
const T0_POLL_ITERATION_COST = 7;
const WRITE_CYCLE_OFFSETS = [KNOWN_WRITE_OFFSET, KNOWN_WRITE_OFFSET - T0_POLL_ITERATION_COST]; // [1, -6] - exact, no tolerance band around either

/**
 * Like compareWrites, but for the oracle comparison: content (register,
 * value, order) is gated at exact equality, same as compareWrites, and every
 * matched write's cycle is gated at exact equality to `ours[i].cycle` plus
 * one of `WRITE_CYCLE_OFFSETS` - no residual, no running count, no "close
 * enough" tolerance around either value. See `WRITE_CYCLE_OFFSETS`'s own doc
 * comment for what the second value is and why it is exact rather than a
 * band. Any other cycle relationship fails the gate and is reported as the
 * first write whose cycle diverges.
 */
function compareOracleWrites(ours, oracle) {
  const n = Math.min(ours.length, oracle.length);
  let matched = 0;
  while (matched < n && ours[matched].reg === oracle[matched].reg && ours[matched].value === oracle[matched].value) matched++;
  const first = matched < ours.length || matched < oracle.length ? { index: matched, ours: ours[matched] ?? null, oracle: oracle[matched] ?? null } : null;

  let cycleFirst = null;
  let earlyExits = 0; // how many matched writes used WRITE_CYCLE_OFFSETS[1] (the -6 case) rather than the plain +1
  for (let i = 0; i < matched; i++) {
    const diff = oracle[i].cycle - ours[i].cycle;
    if (!WRITE_CYCLE_OFFSETS.includes(diff)) {
      cycleFirst = { index: i, ours: ours[i], oracle: oracle[i], diff };
      break;
    }
    if (diff !== KNOWN_WRITE_OFFSET) earlyExits++;
  }
  return { oursCount: ours.length, oracleCount: oracle.length, matched, first, cycleOk: cycleFirst === null, cycleFirst, earlyExits };
}

/**
 * The round trip's own timing gate: how far every write actually lands from
 * the tick it was rounded to when exported, computed live from the real
 * songs (packages/chipvoice/test/spc-export.mjs makes the same measurement
 * on a synthetic fixture; this is that same arithmetic run here so the bound
 * is a number this script itself produces, not one only asserted from a
 * unit test's historical note). `ours` and `plan` must already be paired
 * position for position (the same two arrays compareWrites/roundTripWrites
 * compares) - see that test file's own doc comment for the full derivation
 * of the margin this is gated against: half a tick of unavoidable rounding,
 * plus spc-player.ts's L_BURST_LOOP dispatch cost for a worst-case same-tick
 * chord retrigger, measured there at an empirical ~2-tick ceiling on both
 * real songs; 3 ticks is that measured ceiling with real margin, not a
 * number picked to make this pass.
 */
function roundTripTimingDrift(ours, plan, cyclesPerTick = CYCLES_PER_TICK) {
  const n = Math.min(ours.length, plan.length);
  let maxCycleDiff = 0;
  let worst = null;
  for (let i = 0; i < n; i++) {
    const target = Math.round(plan[i].cycle / cyclesPerTick) * cyclesPerTick;
    const diff = Math.abs(ours[i].cycle - target);
    if (diff > maxCycleDiff) { maxCycleDiff = diff; worst = { index: i, ours: ours[i], target }; }
  }
  return { maxCycleDiff, worst, ticks: maxCycleDiff / cyclesPerTick };
}
const ROUND_TRIP_DRIFT_TICKS = 3; // see roundTripTimingDrift's doc comment

/**
 * How much of the two streams' audio agrees, tolerant of the timing this
 * export's own tick-quantized, timer-polled player necessarily adds:
 * `exportSpc` rounds every write to the nearest tick (`WINDOW_CYCLES` below -
 * `spc-player.ts`'s `TIMER_TARGET`, 1000 Hz, 1024 cycles), and the player's
 * polling loop adds a further small, bounded per-write latency on top of
 * that (measured empirically against this same corpus: at most 132 cycles,
 * about an eighth of a tick, over 12665 writes for `zelda`).
 *
 * A raw sample-value comparison - cycle-exact (`compare()`) or even a
 * windowed match of the raw 16-bit output value at each tick - turns out to
 * be the wrong tool here, and not just because of the jitter above: the
 * S-DSP's output is an audio-rate waveform, oscillating from a BRR sample's
 * own pitch, typically many times within a single 1024-cycle tick. Shifting
 * that waveform by even a handful of 32-cycle output samples (far less than
 * one tick) moves it roughly out of phase with itself, and a raw sample (or
 * raw-value-within-a-window) comparison scores two out-of-phase copies of
 * the same waveform as almost entirely different, the same way a sine wave
 * correlates poorly with a slightly delayed copy of itself even though it is
 * the identical tone. Measured on this exact corpus: a strict cycle-exact
 * comparison of the ROUND TRIP (this package's own CPU on both sides, one
 * pass through a real file and one direct trace of the plan it came from)
 * lands around 17-31% across both real songs, despite their write streams
 * matching the plan exactly, register for register, value for value, in
 * order (see `roundTripWrites` below) - the notes are all there, on time to
 * within the stated tolerance, but sample-for-sample matching of two
 * independently tick-rounded renders is not a meaningful test of that, which
 * is why the round trip stays gated on this envelope correlation rather than
 * raw identity. The oracle (play-spc) side is a different case: once the
 * samples comparison is built to remove the CPU-timing variable entirely
 * (see the doc comment above `oracleWriteCompare`/`oracleSampleCompare` in
 * `checkOne`), a strict cycle-exact comparison there reaches 100% on both
 * real songs, so it is gated on exactly that (`identical === cycles`) rather
 * than this correlation. `oracleEnvelope`/`oracleNoteTiming` are still
 * reported for context, not gated.
 *
 * What does survive a timing shift far smaller than a note's own length is
 * loudness over a short window - a shifted sine wave has the same RMS as an
 * unshifted one, provided the window is wide enough not to itself resolve
 * that shift. This instead computes each side's RMS envelope in
 * `WINDOW_CYCLES`-wide windows and reports the Pearson correlation between
 * the two envelopes, per voice, pooled into one score across both voices
 * and the whole song. A genuine content problem - a dropped note, a stuck
 * voice, a wrong pitch changing which samples get triggered when - moves
 * the envelope itself, not just its phase, and still shows up as a real
 * drop in this score.
 *
 * `WINDOW_CYCLES` is four ticks (4096 cycles, 4 ms), not one: a single
 * tick's own window turns out too fine a grain for this to work in
 * practice on real content - a BRR sample's fundamental period is often
 * close to or shorter than one tick, so even a correct export scores this
 * comparison's 1-tick window as low as 0.75 on `zelda`, not from anything
 * wrong (`roundTripWrites` below already establishes the write stream
 * matches exactly, register for register, value for value, in order) but
 * because a windowed RMS at that grain still resolves the sub-tick phase
 * the doc comment above already says a raw comparison can't survive. Four
 * ticks is still far below anything a listener could perceive as
 * separately timed, and correlation on this corpus climbs smoothly and
 * monotonically as the window widens further - 0.75 at 1 tick, 0.96 at 4,
 * 0.98 at 16-64 - the signature of exactly this phase effect, not a real
 * mismatch, which instead shows correlation falling or flat as the window
 * widens past its own scale (measured on this same corpus with a real bug
 * still in place - the sample directory's own page number was not
 * rewritten along with its entries, so every voice played back whatever
 * happened to be at the *original* capture's directory page instead -
 * correlation *fell* as the window widened, 0.51 at 1 tick to 0.26 at one
 * second). `ENVELOPE_MATCH_THRESHOLD` is set at 0.95, comfortably under
 * the ~0.96-0.98 this corpus's own correct export reaches at this window.
 */
const WINDOW_CYCLES = 4 * CYCLES_PER_TICK; // four ticks - see the doc comment above for why one tick alone is too fine a grain
const ENVELOPE_WINDOWS_TICKS = [1, 2, 4]; // reported every run (see checkOne's envelopeByWindow) - the same three widths the doc comment above measures, so the 1-tick-under-resolves/4-tick-is-enough claim stays checkable, not just historical
const SAMPLE_OUTPUT_CYCLES = 32; // the S-DSP's own output period (dsp.ts: CLOCKS_PER_SAMPLE)
const ENVELOPE_MATCH_THRESHOLD = 0.95; // Pearson correlation; see the doc comment above

/**
 * The one exact, narrow exclusion the oracle samples gate needs, and why:
 * blargg's own SNES_SPC.cpp keeps the DSP lazily caught up, exactly the same
 * "advance only when observed" bookkeeping as `run_timer_`'s own lazy
 * catch-up (see `WRITE_CYCLE_OFFSETS`'s doc comment) - `dsp_write`/`dsp_read`
 * run the DSP forward only as far as whatever CPU access just touched it.
 * `play-spc`'s one-shot `end_frame(cycles)` render commits the DSP's own
 * final, not-yet-observed output period only once, in a single trailing
 * catch-up call at the exact frame boundary (`SNES_SPC.cpp`'s `end_frame`,
 * "Catch DSP up to CPU"). This package's own per-cycle DSP model has no such
 * batching - driven by the identical write timeline (`oracleWrites`), it
 * always computes and emits the output sample for every `SAMPLE_OUTPUT_CYCLES`
 * period up to and including the one ending exactly at `cycles`, regardless
 * of whether blargg's own one-shot render tool happened to flush that same
 * trailing sample before it returned.
 *
 * Measured directly, on the whole corpus: `mario`'s oracle sample stream is
 * byte-for-byte identical to ours through the entire render (its own tail
 * happens to have already decayed to silence, so this never becomes
 * observable there). `zelda`'s has exactly one divergence in its entire
 * 39086556-cycle run, at cycle 39086555 - the very last cycle - and it is
 * this package's own trailing sample that `play-spc`'s own recorded output
 * never reaches: `play-spc`'s last recorded sample for that run ends at
 * cycle 39086523, exactly one `SAMPLE_OUTPUT_CYCLES` period earlier, not at
 * 39086555. Not a bug in either DSP core's math (every other sample in both
 * songs, tens of millions of them, matches exactly) and not something to
 * patch into the vendored oracle (a one-shot batch tool's own last output
 * period is inherently not guaranteed the way a live, continuously-run chip
 * is) - so it is excluded here, by the smallest, most literal margin the
 * mechanism above can ever affect: one trailing `SAMPLE_OUTPUT_CYCLES`
 * period, not a number picked to make one song pass.
 */
const ORACLE_TAIL_TRIM_CYCLES = SAMPLE_OUTPUT_CYCLES;

function windowedRms(cs, voice, cycles, windowCycles) {
  const windows = Math.ceil(cycles / windowCycles);
  const sumSq = new Float64Array(windows);
  const count = new Int32Array(windows);
  let cur = 0;
  let idx = 0;
  const cyc = cs.cycle, val = cs.value, vo = cs.voice, len = cs.length;
  for (let sampleCycle = 0; sampleCycle < cycles; sampleCycle += SAMPLE_OUTPUT_CYCLES) {
    while (idx < len && cyc[idx] <= sampleCycle) {
      if (vo[idx] === voice) cur = val[idx];
      idx++;
    }
    const w = Math.floor(sampleCycle / windowCycles);
    sumSq[w] += cur * cur;
    count[w] += 1;
  }
  const out = new Float64Array(windows);
  for (let w = 0; w < windows; w++) out[w] = count[w] > 0 ? Math.sqrt(sumSq[w] / count[w]) : 0;
  return out;
}

function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  let sumA = 0, sumB = 0;
  for (let i = 0; i < n; i++) { sumA += a[i]; sumB += b[i]; }
  const meanA = sumA / n, meanB = sumB / n;
  let cov = 0, varA = 0, varB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA, db = b[i] - meanB;
    cov += da * db; varA += da * da; varB += db * db;
  }
  if (varA === 0 || varB === 0) return varA === varB ? 1 : 0;
  return cov / Math.sqrt(varA * varB);
}

function relativeRmsError(a, b) {
  const n = Math.min(a.length, b.length);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { const d = a[i] - b[i]; num += d * d; den += b[i] * b[i]; }
  return Math.sqrt(num / Math.max(den, 1e-9));
}

function envelopeMatch(a, b, cycles, voices, windowCycles = WINDOW_CYCLES) {
  const pooledA = [], pooledB = [];
  for (const voice of voices) {
    pooledA.push(...windowedRms(a, voice, cycles, windowCycles));
    pooledB.push(...windowedRms(b, voice, cycles, windowCycles));
  }
  return { correlation: pearson(pooledA, pooledB), relativeRmsError: relativeRmsError(pooledA, pooledB) };
}

// Measured minimum across this corpus is 24/26 (zelda, 92.3%); mario is
// 279/287 (97.2%). 0.85 sits comfortably under the measured floor, the same
// margin style ENVELOPE_MATCH_THRESHOLD already uses against its own
// 0.96-0.98 measured range.
const NOTE_TIMING_ALIGNMENT_THRESHOLD = 0.85;

/**
 * Reported alongside the oracle samples comparison, not gated: for each
 * voice, compare.mjs's `compare()` already runs `runs()` (split into
 * per-note runs, each allowed its own constant shift) and reports how many
 * of those runs have every step landing at the right relative cycle
 * (`alignedTimes`). This pools that across the voices `compare()` was given,
 * into one fraction. Before the oracle samples comparison was rebuilt to
 * drive both DSPs from the same write timeline (see the doc comment above
 * `oracleWriteCompare`/`oracleSampleCompare` in `checkOne`), this was that
 * comparison's own exact bar, since note *timing* matched exactly while the
 * exact 16-bit values inside a note did not (`alignedValues`, reported
 * alongside, stays low even when this is high); it stays here as evidence
 * that the CPU-timing difference the write comparison names is exactly what
 * this already tolerated, not a second, undiscovered problem.
 */
function noteTimingAlignment(compareResult) {
  let ours = 0, theirs = 0, alignedTimes = 0, alignedValues = 0;
  for (const pv of compareResult.perVoice) {
    ours += pv.runs.ours;
    theirs += pv.runs.theirs;
    alignedTimes += pv.runs.alignedTimes;
    alignedValues += pv.runs.alignedValues;
  }
  const runs = Math.max(ours, theirs, 1);
  return { ours, theirs, alignedTimes, alignedValues, fraction: alignedTimes / runs, valueFraction: alignedValues / runs };
}

/** How many bytes of ARAM the export actually used - player, directory,
 * samples and write stream - read back out of the file itself rather than
 * from `exportSpc`'s internals: the stream's read head (`$10`/`$11`) gives
 * where it starts, and walking the same delta/reg/value grammar
 * `spc-player.ts` reads gives where it ends, at the loop sentinel. $FE
 * (BURST_OP) and $FD (COPY_OP) are the same two escapes `spc-player.ts`'s
 * own doc comment gives; a copy op's own bytes are just its 5-byte header
 * (op + 4-byte source range) - the range it points at was already walked
 * (and counted) earlier in this same pass, so this never recurses into it. */
const IPL_START = 0xffc0;
const BURST_OP = 0xfe;
const COPY_OP = 0xfd;
function measureArenaUsed(file) {
  const ram = file.subarray(0x100, 0x100 + 0x10000);
  const streamAddr = ram[0x10] | (ram[0x11] << 8);
  let addr = streamAddr;
  const readByte = () => { const b = ram[addr]; addr += 1; return b; };
  for (;;) {
    let d;
    do { d = readByte(); } while (d === 0xff);
    void d;
    const reg = readByte();
    if (reg === 0xff) { readByte(); readByte(); break; } // loop sentinel + its 2-byte target
    if (reg === BURST_OP) {
      const count = readByte();
      for (let i = 0; i < count; i++) { readByte(); readByte(); }
      continue;
    }
    if (reg === COPY_OP) { readByte(); readByte(); readByte(); readByte(); continue; } // source range: lo hi LO HI
    readByte(); // value byte
  }
  return { streamAddr, dataEnd: addr, limit: IPL_START };
}

async function checkOne(id) {
  const score = JSON.parse(fs.readFileSync(path.join(ARRANGEMENTS_DIR, `${id}.json`), 'utf8'));
  const plan = planPerformance(score, snesChip, { allowLoss: true, ...(spaceOption ? { space: spaceOption } : {}) });
  const cycles = Math.round(plan.seconds * snesChip.spec.clockHz);
  const loopAtCycle = Math.round(plan.loopStartSeconds * snesChip.spec.clockHz);

  // A whole arrangement's write stream, at several minutes, can outgrow the
  // 64 KB this format has to fit in - `exportSpc` throws rather than write
  // a truncated file (this file's own doc comment, and the ticket's own
  // wording); that is reported here as its own row, not a script crash and
  // not folded into the conformance pass/fail, since it is a capacity limit,
  // not a divergence from any oracle.
  let file;
  try {
    file = exportSpc(plan.events, cycles, plan.memory, { title: score.title ?? id, loopAtCycle });
  } catch (e) {
    if (e instanceof SpcExportSizeError) return { id, cycles, tooLarge: { message: e.message, measured: e.measured, limit: e.limit } };
    throw e;
  }
  const size = measureArenaUsed(file);

  // Our own round trip: the file's audio, against a direct trace of the
  // plan it was built from.
  const imported = importSpc(file, { seconds: plan.seconds });
  const oursDirect = ChangeStream.from(chipSnes.trace(plan.events, cycles, plan.memory));
  // chipSnes.trace builds a fresh chip and needs the restore events (the
  // synthetic $F2/$F3 pairs importSpc emits to load all 128 DSP registers
  // from the file's dump) to establish the DSP's starting state before the
  // "real" stream plays - the same reason check.mjs traces plan.events
  // unsliced and only slices for its write-sequence comparisons.
  const oursRoundTrip = ChangeStream.from(chipSnes.trace(imported.events, cycles, imported.memory));
  const roundTripSamples = compare(oursRoundTrip, oursDirect, { cycles, voices: [0, 1] });
  const roundTripEnvelope = envelopeMatch(oursRoundTrip, oursDirect, cycles, [0, 1]);
  // exportSpc drops writes at or past `cycles` (a release tail finishing
  // after the plan's own last tick - see its own doc comment); the plan
  // side of this comparison needs the same filter to compare like with
  // like.
  const importedWrites = canonicalizeEcho(resolveWrites(imported.events.slice(imported.restoreEvents)));
  const dirPage = importedWrites.find((w) => w.reg === 0x5d)?.value;
  const planWrites = canonicalizeEcho(canonicalizeSrcn(resolveWrites(plan.events).filter((w) => w.cycle < cycles), dirPage));
  const roundTripWrites = compareWrites(importedWrites, planWrites);
  // The round trip's own timing gate (item 3): how far the file actually
  // places each write from the tick exportSpc rounded it to, measured live
  // on this real song - see roundTripTimingDrift's doc comment for the
  // derivation of ROUND_TRIP_DRIFT_TICKS.
  const roundTripDrift = roundTripTimingDrift(importedWrites, planWrites);

  // The direct comparison this check exists to make: the exact same
  // exported file, played by two independent SPC700s - this package's own
  // (`imported.events`, already re-derived from the file above) and
  // blargg's (`play-spc`, `spcCpuWrites`/`spcCpuSamples`).
  //
  // The write-sequence side is gated exactly, content AND cycle:
  // `compareOracleWrites` (see its own doc comment, and
  // `WRITE_CYCLE_OFFSETS`'s, above) requires every register and value to
  // match in order with zero tolerance, and every write's cycle to equal
  // `ours[i].cycle` plus one of exactly two named values - no residual, no
  // running count. Real content meets this exactly on both real corpus
  // songs (mario 24092/24092, zelda 12665/12665 writes, both `cycleOk:
  // true`).
  //
  // The samples side is gated exactly too, `identical === cycles`, the same
  // bar `check:spc` already gates its own DSP-only comparison at - but only
  // once the one remaining degree of freedom the write comparison above
  // already explains is taken out of it. Driving this package's own DSP
  // with `imported.events` (this package's own CPU's own write cycles)
  // and comparing against blargg's actual output re-tests the write
  // comparison's own already-named, already-exact `WRITE_CYCLE_OFFSETS`
  // difference a second time, through a far noisier instrument: a note's
  // Gaussian interpolation phase and envelope/pitch counters keep advancing
  // every cycle once a note starts, so even the documented, bounded,
  // self-correcting few-cycle write-time difference leaves that note's
  // whole remaining audio shifted from the oracle's own, and a raw
  // cycle-exact sample comparison scores two out-of-phase copies of the same
  // waveform as almost entirely different (see `envelopeMatch`'s own doc
  // comment below for the general version of this effect). Measured
  // directly: comparing this way capped out at 92.56% (mario) / 98.00%
  // (zelda) cycle-exact, even after the `play-spc.cpp` sample-clock fix
  // this file's own git history already made.
  //
  // What this check actually exists to prove is narrower and already fully
  // covered elsewhere: given the *same* write, does the S-DSP core compute
  // the *same* sample - a question with no CPU-timing content in it at all,
  // and the one `check:spc` already answers at 100% for a hand-built write
  // trace. So the samples comparison below drives this package's own DSP
  // with blargg's own actual write cycles (`oracleWrites`, already proven
  // content-identical by `oracleWriteCompare` above), not this package's
  // own CPU's independently-derived ones - the same shared-stimulus,
  // separate-DSP-implementations shape `check:spc` already uses, just built
  // from a real exported file's write stream instead of a hand-written
  // fixture. `oracleNoteTiming` and the envelope correlation are still
  // reported below (not gated): they were this file's own gate before this
  // rebuild, and stay as evidence that the CPU-timing difference the write
  // comparison names is exactly what note-relative timing and loudness
  // correlation already tolerated, not a second, undiscovered problem.
  const oracleWrites = spcCpuWrites(file, cycles);
  const oracleSamples = ChangeStream.from(await spcCpuSamples(file, cycles));
  const oracleWriteCompare = compareOracleWrites(resolveWrites(imported.events.slice(imported.restoreEvents)), oracleWrites);
  // The samples comparison drives this package's own DSP with blargg's own
  // write cycles (`oracleWrites`), not this package's own CPU's re-derived
  // ones (`imported.events`): `oracleWriteCompare` above already proves the
  // two CPUs' write cycles agree exactly, up to the one named, exact,
  // two-valued rule `WRITE_CYCLE_OFFSETS` documents - so re-introducing that
  // same few-cycle CPU-timing difference here would test it a second time,
  // through a much noisier instrument (a note's own interpolation and
  // envelope phase, once shifted by even a few cycles, stays shifted for the
  // rest of that note - see the git history that measured this before this
  // rebuild for the raw numbers). Feeding both DSPs the identical write
  // timeline isolates this comparison to the one thing it exists to check -
  // whether the S-DSP core itself, given the same stimulus, produces the
  // same audio - the same thing `check:spc` already gates at 100%, and the
  // reason this can be gated the same way.
  const restoreEvents = imported.events.slice(0, imported.restoreEvents);
  const oracleWriteEvents = oracleWrites.flatMap((w) => [{ at: w.cycle, addr: 0xf2, value: w.reg }, { at: w.cycle, addr: 0xf3, value: w.value }]);
  const oursForOracle = ChangeStream.from(chipSnes.trace([...restoreEvents, ...oracleWriteEvents], cycles, imported.memory));
  // See ORACLE_TAIL_TRIM_CYCLES's own doc comment: the exact gate excludes
  // this package's own trailing output period, which play-spc's one-shot
  // render cannot be relied on to have flushed.
  const oracleSampleCompare = compare(oursForOracle, oracleSamples, { cycles: cycles - ORACLE_TAIL_TRIM_CYCLES, voices: [0, 1] });
  const oracleNoteTiming = noteTimingAlignment(oracleSampleCompare);
  // Reported at three window widths, not just the one this check gates on
  // (`WINDOW_CYCLES`, four ticks) - see `envelopeMatch`'s doc comment for
  // why one tick alone under-resolves a correct export (sub-tick BRR phase,
  // not a real mismatch) and why four is where that effect has already
  // washed out on this corpus. `ENVELOPE_WINDOWS_TICKS` gives the same
  // three widths that doc comment's own measurement names, so every run of
  // this script reproduces them instead of only a historical note.
  const envelopeByWindow = (a, b) => Object.fromEntries(ENVELOPE_WINDOWS_TICKS.map((ticks) => [ticks, envelopeMatch(a, b, cycles, [0, 1], ticks * CYCLES_PER_TICK)]));
  const roundTripEnvelopeWindows = envelopeByWindow(oursRoundTrip, oursDirect);
  const oracleEnvelopeWindows = envelopeByWindow(oursForOracle, oracleSamples);
  const oracleEnvelope = oracleEnvelopeWindows[WINDOW_CYCLES / CYCLES_PER_TICK];

  return { id, cycles, size, roundTripSamples, roundTripEnvelope, roundTripEnvelopeWindows, roundTripWrites, roundTripDrift, oracleWrites, oracleWriteCompare, oracleSampleCompare, oracleNoteTiming, oracleEnvelope, oracleEnvelopeWindows };
}

/**
 * One set of tests per gate this file has, against small synthetic data
 * rather than the real corpus - proof each gate actually catches the kind of
 * problem it exists for, not just that real content happens to pass it, and
 * (for the two exact gates item 3 and item 5 ask for) proof each gate's own
 * named legitimate value still passes, so the gate is exact rather than
 * merely strict:
 *
 *  - a write whose value is altered: the content gate (`compareOracleWrites`,
 *    shared with `compareWrites`/`roundTripWrites`) must reject it.
 *  - a write cycle at exactly `WRITE_CYCLE_OFFSETS[0]` (+1) or
 *    `WRITE_CYCLE_OFFSETS[1]` (-6, the named early-exit value): the cycle
 *    gate must accept both - positive controls, since the second value is a
 *    proven, exact, legitimate outcome (see `WRITE_CYCLE_OFFSETS`'s doc
 *    comment), not tolerance. A write cycle one past either value: the cycle
 *    gate must reject it, where the old, cycle-blind `compareWrites` would
 *    have passed it silently.
 *  - a write placed past ROUND_TRIP_DRIFT_TICKS from its tick-rounded target:
 *    `roundTripTimingDrift`'s own gate must reject it (round trip, item 4:
 *    unchanged).
 *  - a voice dropped entirely (real content, replaced with silence): the
 *    round trip's own envelope correlation gate must reject it (item 4:
 *    unchanged).
 *  - a single sample perturbed by one value: the oracle samples gate
 *    (`identical === cycles`, item 3/5) must reject it, exactly, not just
 *    reduce a correlation score.
 *
 * Returns the number of checks that did NOT behave as expected.
 */
function selfTest() {
  let failures = 0;
  const check = (name, ok) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if (!ok) failures++;
  };

  // ---- Write content, altered by one write: compareOracleWrites's content
  // gate (shared with compareWrites) must reject it. ----
  {
    const ours = [
      { reg: 0x00, value: 0x10, cycle: 100 },
      { reg: 0x01, value: 0x20, cycle: 1130 },
      { reg: 0x02, value: 0x30, cycle: 2160 },
    ];
    const oracle = ours.map((w) => ({ ...w, cycle: w.cycle + KNOWN_WRITE_OFFSET }));
    oracle[1].value = 0x21; // the one altered write
    const r = compareOracleWrites(ours, oracle);
    check('self-test: an altered write value fails the content gate', r.first !== null && r.first.index === 1);
  }

  // ---- Write cycle: exact equality to one of WRITE_CYCLE_OFFSETS, no
  // residual band around either value. ----
  {
    const ours = [];
    for (let i = 0; i < 6; i++) ours.push({ reg: i, value: i, cycle: 100 + i * 3000 });

    // Positive control: the plain +1 offset on every write passes, and is
    // not counted as an early exit.
    const plusOne = ours.map((w) => ({ ...w, cycle: w.cycle + KNOWN_WRITE_OFFSET }));
    const plusOneResult = compareOracleWrites(ours, plusOne);
    check('self-test: every write at the plain +1 offset passes the cycle gate', plusOneResult.cycleOk && plusOneResult.earlyExits === 0);

    // Positive control: the named early-exit value (-6) also passes outright
    // - the second of exactly two named exact values, not a tolerance band
    // (see WRITE_CYCLE_OFFSETS's doc comment) - and is counted as such.
    const earlyExit = ours.map((w) => ({ ...w, cycle: w.cycle + WRITE_CYCLE_OFFSETS[1] }));
    const earlyExitResult = compareOracleWrites(ours, earlyExit);
    check('self-test: every write at the named early-exit offset (-6) passes the cycle gate', earlyExitResult.cycleOk && earlyExitResult.earlyExits === ours.length);

    // The old, cycle-blind compareWrites sees identical content and passes
    // regardless of cycle - the sanity check that motivates a separate cycle
    // gate at all.
    const farOff = ours.map((w) => ({ ...w, cycle: w.cycle + 12345 }));
    check('self-test: content-only comparison does not itself catch a cycle shift (sanity check)', compareWrites(ours, farOff).first === null);

    // Negative: one cycle past +1 (and not equal to -6 either) fails - the
    // smallest shift that must fail, not an arbitrarily large one.
    const pastPlusOne = ours.map((w, i) => ({ ...w, cycle: w.cycle + (i === 5 ? KNOWN_WRITE_OFFSET + 1 : KNOWN_WRITE_OFFSET) }));
    const pastPlusOneResult = compareOracleWrites(ours, pastPlusOne);
    check('self-test: a write cycle one past +1 fails the cycle gate', !pastPlusOneResult.cycleOk && pastPlusOneResult.cycleFirst?.index === 5);

    // Negative: one cycle past the named early-exit value (-7) fails too.
    const pastEarlyExit = ours.map((w, i) => ({ ...w, cycle: w.cycle + (i === 5 ? WRITE_CYCLE_OFFSETS[1] - 1 : KNOWN_WRITE_OFFSET) }));
    const pastEarlyExitResult = compareOracleWrites(ours, pastEarlyExit);
    check('self-test: a write cycle one past the named early-exit value (-7) fails the cycle gate', !pastEarlyExitResult.cycleOk && pastEarlyExitResult.cycleFirst?.index === 5);
  }

  // ---- Round-trip timing: a write placed past the gate's own bound (item
  // 4: unchanged from before this round). ----
  {
    const plan = [{ reg: 0, value: 0, cycle: 10000 }];
    const onTarget = [{ reg: 0, value: 0, cycle: 10240 }]; // rounds to the same tick (10240), 0 drift
    const late = [{ reg: 0, value: 0, cycle: 10240 + ROUND_TRIP_DRIFT_TICKS * CYCLES_PER_TICK + 1 }];
    const okDrift = roundTripTimingDrift(onTarget, plan);
    const badDrift = roundTripTimingDrift(late, plan);
    check('self-test: a write on target passes the round-trip timing gate', okDrift.maxCycleDiff <= ROUND_TRIP_DRIFT_TICKS * CYCLES_PER_TICK);
    check('self-test: a write past the round-trip timing bound fails the gate', badDrift.maxCycleDiff > ROUND_TRIP_DRIFT_TICKS * CYCLES_PER_TICK);
  }

  // ---- Round-trip sample content: a voice dropped entirely (replaced with
  // silence), not just phase-shifted - the envelope correlation gate must
  // reject it (item 4: unchanged from before this round). ----
  {
    const cycles = 5 * WINDOW_CYCLES;
    const ours = new ChangeStream();
    for (let c = 0; c < cycles; c += SAMPLE_OUTPUT_CYCLES) {
      const on = Math.floor(c / WINDOW_CYCLES) % 2 === 0;
      ours.push(c, 0, on ? 12345 : 0);
    }
    const silentOracle = new ChangeStream(); // the dropped voice: no changes at all, value stays 0 throughout
    const dropped = envelopeMatch(ours, silentOracle, cycles, [0]);
    check('self-test: a dropped voice fails the round-trip envelope correlation gate', dropped.correlation < ENVELOPE_MATCH_THRESHOLD);
    const identical = envelopeMatch(ours, ours, cycles, [0]);
    check('self-test: comparing a stream against itself passes the round-trip envelope correlation gate (sanity check)', identical.correlation >= ENVELOPE_MATCH_THRESHOLD);
  }

  // ---- Oracle samples: the exact identical === cycles gate (item 3/5) - a
  // single sample perturbed by one value must fail it outright, not just
  // move a correlation score. ----
  {
    const cycles = 4 * SAMPLE_OUTPUT_CYCLES;
    const a = new ChangeStream();
    const b = new ChangeStream();
    for (let c = 0; c < cycles; c += SAMPLE_OUTPUT_CYCLES) { a.push(c, 0, 1000); b.push(c, 0, 1000); }
    const identical = compare(a, b, { cycles, voices: [0] });
    check('self-test: two identical streams pass the exact oracle sample gate (sanity check)', identical.identical === identical.cycles);

    const perturbed = new ChangeStream();
    for (let c = 0; c < cycles; c += SAMPLE_OUTPUT_CYCLES) perturbed.push(c, 0, c === SAMPLE_OUTPUT_CYCLES ? 1001 : 1000); // one sample off by one value
    const off = compare(a, perturbed, { cycles, voices: [0] });
    check('self-test: a one-sample perturbation fails the exact oracle sample gate', off.identical !== off.cycles && off.first !== null && off.first.cycle === SAMPLE_OUTPUT_CYCLES);
  }

  return failures;
}

if (flag('self-test')) {
  const failures = selfTest();
  console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}  self-test: ${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

const results = [];
for (const id of ARRANGEMENT_IDS) results.push(await checkOne(id));

console.log(`exportSpc against the repo's own SNES arrangements: ${results.length} song(s)\n`);
let anyDivergence = false;
for (const r of results) {
  if (r.tooLarge) {
    console.log(`SIZE  ${r.id.padEnd(8)}  does not fit: ${r.tooLarge.measured} bytes needed, ${r.tooLarge.limit} available - not a divergence, not counted against the check`);
    continue;
  }
  const roundTripWritesOk = r.roundTripWrites.first === null;
  const roundTripDriftOk = r.roundTripDrift.maxCycleDiff <= ROUND_TRIP_DRIFT_TICKS * CYCLES_PER_TICK;
  const oracleWritesOk = r.oracleWriteCompare.first === null && r.oracleWriteCompare.cycleOk;
  const roundTripSamplesOk = r.roundTripEnvelope.correlation >= ENVELOPE_MATCH_THRESHOLD;
  // Exact, not tolerant (item 3): identical === cycles, the same bar
  // check:spc gates its own DSP-only comparison at - see the doc comment
  // above oracleWriteCompare/oracleSampleCompare in checkOne for why this is
  // now achievable exactly. oracleEnvelope/oracleNoteTiming stay as reported
  // evidence only, not part of this gate.
  const oracleSamplesOk = r.oracleSampleCompare.identical === r.oracleSampleCompare.cycles;
  const ok = roundTripWritesOk && roundTripDriftOk && oracleWritesOk && roundTripSamplesOk && oracleSamplesOk;
  if (!ok) anyDivergence = true;
  const rawPct = (n, d) => (100 * n) / d;
  const fmtEnv = (e) => `envelope corr ${e.correlation.toFixed(4)}, rel RMS error ${(100 * e.relativeRmsError).toFixed(2)}%`;
  const line = [
    (ok ? 'PASS' : 'FAIL').padEnd(4),
    r.id.padEnd(8),
    `ARAM ${r.size.dataEnd}/${r.size.limit}`,
    `round trip: writes ${r.roundTripWrites.matched}/${Math.max(r.roundTripWrites.oursCount, r.roundTripWrites.oracleCount)} (max drift ${r.roundTripDrift.maxCycleDiff}c/${r.roundTripDrift.ticks.toFixed(2)}t), samples ${fmtEnv(r.roundTripEnvelope)} (${rawPct(r.roundTripSamples.identical, r.roundTripSamples.cycles).toFixed(4)}% cycle-exact)`,
    `play-spc: writes ${r.oracleWriteCompare.matched}/${Math.max(r.oracleWriteCompare.oursCount, r.oracleWriteCompare.oracleCount)} (cycleOk ${r.oracleWriteCompare.cycleOk}, ${r.oracleWriteCompare.earlyExits} early-exit write(s)), samples ${rawPct(r.oracleSampleCompare.identical, r.oracleSampleCompare.cycles).toFixed(4)}% cycle-exact (reported only: ${fmtEnv(r.oracleEnvelope)}, note timing ${r.oracleNoteTiming.alignedTimes}/${Math.max(r.oracleNoteTiming.ours, r.oracleNoteTiming.theirs)} = ${(100 * r.oracleNoteTiming.fraction).toFixed(2)}%)`,
  ];
  if (r.roundTripWrites.first) line.push(`round-trip writes diverge at #${r.roundTripWrites.first.index}: ours ${fmtWrite(r.roundTripWrites.first.ours)}, plan ${fmtWrite(r.roundTripWrites.first.oracle)}`);
  if (!roundTripDriftOk) line.push(`round-trip timing drift ${r.roundTripDrift.maxCycleDiff} cycles exceeds the ${ROUND_TRIP_DRIFT_TICKS}-tick (${ROUND_TRIP_DRIFT_TICKS * CYCLES_PER_TICK}-cycle) bound, at write #${r.roundTripDrift.worst?.index}`);
  if (r.oracleWriteCompare.first) line.push(`play-spc writes diverge at #${r.oracleWriteCompare.first.index}: ours ${fmtWrite(r.oracleWriteCompare.first.ours)}, oracle ${fmtWrite(r.oracleWriteCompare.first.oracle)}`);
  if (!r.oracleWriteCompare.cycleOk) line.push(`play-spc write cycles diverge at #${r.oracleWriteCompare.cycleFirst.index}: diff ${r.oracleWriteCompare.cycleFirst.diff}, ${r.oracleWriteCompare.cycleFirst.periods} phantom period(s), residual ${r.oracleWriteCompare.cycleFirst.residual}${r.oracleWriteCompare.cycleFirst.reason ? ` (${r.oracleWriteCompare.cycleFirst.reason})` : ''}`);
  if (!roundTripSamplesOk) line.push(`round-trip envelope correlation ${r.roundTripEnvelope.correlation.toFixed(4)} below the ${ENVELOPE_MATCH_THRESHOLD} threshold`);
  if (!oracleSamplesOk) {
    // Item 3: when the exact sample gate fails, report the first differing
    // sample - cycle, voice, both values - and the write just before it, not
    // a correlation number, so the next cause (if any) is findable directly
    // from this line.
    const d = r.oracleSampleCompare.first;
    if (d) {
      const before = lastWriteAtOrBefore(r.oracleWrites, d.cycle);
      line.push(`play-spc samples diverge at cycle ${d.cycle}, voice ${d.voice}: ours ${d.a}, oracle ${d.b}; last write at/before: ${fmtWrite(before)}`);
    }
  }
  console.log(line.join('  '));
  // Envelope correlation at each reported window width, both sides - the
  // gate above uses only the four-tick column; one and two ticks are here
  // to show *why* it is the four-tick column and not a narrower one (see
  // envelopeMatch's doc comment for the full case): correlation should
  // climb as the window widens on a correct export (sub-tick BRR phase
  // washing out), and on this corpus it does, for both songs, on both
  // sides of the comparison.
  const fmtWindows = (windows) => ENVELOPE_WINDOWS_TICKS.map((t) => `${t}t=${windows[t].correlation.toFixed(4)}`).join(' ');
  console.log(`      envelope by window - round trip: ${fmtWindows(r.roundTripEnvelopeWindows)}  play-spc: ${fmtWindows(r.oracleEnvelopeWindows)}`);
}

const summary = {
  date: new Date().toISOString().slice(0, 10),
  oracle: 'play-spc (blargg\'s SPC700, vendored snes_spc)',
  sampleMetric: `Round trip (own CPU on both sides): envelope correlation - both streams' per-voice RMS loudness in ${WINDOW_CYCLES}-cycle (four ticks, ${(WINDOW_CYCLES / CYCLES_PER_TICK).toFixed(0)} ms) windows, pooled across voices, compared by Pearson correlation; gated at ${ENVELOPE_MATCH_THRESHOLD}. relativeRmsError is the same envelopes' RMS difference relative to the oracle's own RMS, reported but not gated. Oracle (play-spc): gated exactly, identical === cycles, the same bar check:spc gates its own DSP-only comparison at - achieved by driving this package's own DSP with blargg's own actual write cycles (oracleWrites), not this package's own CPU's independently re-derived ones, isolating the comparison to DSP-core equivalence alone (see the doc comment above oracleWriteCompare/oracleSampleCompare in checkOne). cycleExact on both sides is compare()'s raw, unwindowed cycle-exact percentage. correlation and noteTiming on the oracle side are reported for context only (not gated): they were this file's gate before the samples comparison below was rebuilt to be exact, and stay as evidence that the CPU-timing difference compareOracleWrites names is exactly what they already tolerated.`,
  writeMetric: `oracle writes are gated on content (register, value, order - exact) AND cycle: exact equality to ours[i].cycle plus one of exactly two named values, WRITE_CYCLE_OFFSETS (${JSON.stringify(WRITE_CYCLE_OFFSETS)}) - no residual, no running count. See WRITE_CYCLE_OFFSETS's and compareOracleWrites's doc comments for the derivation of the second value (a boundary-inclusivity artifact of blargg's own lazy timer catch-up formula, proven and shimmed, not a bug in this package's own per-cycle timer). earlyExits counts how many matched writes used the second value rather than the plain +1. roundTripDrift is the round trip's own timing gate (item 3): the largest |actual cycle - tick-rounded plan cycle| over every write, gated at ${ROUND_TRIP_DRIFT_TICKS} ticks (${ROUND_TRIP_DRIFT_TICKS * CYCLES_PER_TICK} cycles) - see roundTripTimingDrift's doc comment for the derivation.`,
  songs: results.length,
  results: results.map((r) => r.tooLarge
    ? { id: r.id, cycles: r.cycles, tooLarge: r.tooLarge }
    : {
      id: r.id,
      cycles: r.cycles,
      aramUsed: r.size.dataEnd,
      aramLimit: r.size.limit,
      roundTrip: {
        writes: r.roundTripWrites,
        drift: r.roundTripDrift,
        samples: {
          correlation: r.roundTripEnvelope.correlation, relativeRmsError: r.roundTripEnvelope.relativeRmsError,
          cycleExact: { identical: r.roundTripSamples.identical, cycles: r.roundTripSamples.cycles, first: r.roundTripSamples.first },
          // Same correlation, at each width `ENVELOPE_WINDOWS_TICKS` names -
          // reported so the four-tick gate's justification (see
          // envelopeMatch's doc comment) is a live number every run makes,
          // not just a note from whenever it was last measured by hand.
          correlationByWindow: Object.fromEntries(ENVELOPE_WINDOWS_TICKS.map((t) => [t, r.roundTripEnvelopeWindows[t].correlation])),
        },
      },
      oracle: {
        writes: r.oracleWriteCompare,
        samples: {
          correlation: r.oracleEnvelope.correlation, relativeRmsError: r.oracleEnvelope.relativeRmsError,
          cycleExact: { identical: r.oracleSampleCompare.identical, cycles: r.oracleSampleCompare.cycles, first: r.oracleSampleCompare.first },
          noteTiming: r.oracleNoteTiming,
          correlationByWindow: Object.fromEntries(ENVELOPE_WINDOWS_TICKS.map((t) => [t, r.oracleEnvelopeWindows[t].correlation])),
        },
      },
    }),
};
console.log(`\n${results.length} song(s) checked, ${results.filter((r) => r.tooLarge).length} too large to fit in ARAM`);

const jsonPath = option('json', null);
if (jsonPath) {
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2) + '\n');
}
const sheetPath = option('sheet', null);
if (sheetPath && spaceOption && spaceOption !== 'dry') {
  throw new Error(`--sheet regenerates docs/chips/snes.md's own dry-mode baseline; --space ${spaceOption} would write numbers for a space the published bank does not export in. Run --space room without --sheet for a report.`);
}
if (sheetPath) writeSheet(sheetPath, summary);

process.exit(anyDivergence && !flag('report') ? 1 : 0);

function writeSheet(file, summary) {
  const marker = 'spc-export';
  const text = fs.readFileSync(file, 'utf8');
  const open = `<!-- ${marker}:begin -->`;
  const close = `<!-- ${marker}:end -->`;
  const begin = text.indexOf(open);
  const end = text.indexOf(close);
  if (begin < 0 || end < 0) throw new Error(`${file} has no ${marker} markers`);
  const pct = (n) => n.toFixed(4);
  const lines = [
    open,
    `Written by \`check:spc-export\` on ${summary.date}, against ${summary.oracle}.`,
    '',
    `Writes: ${summary.writeMetric}`,
    '',
    `Samples: ${summary.sampleMetric}`,
    '',
    '| Song | ARAM used | Round trip (own CPU): writes, max drift | Round trip: samples (envelope corr, rel RMS error, cycle-exact) | play-spc: writes (cycleOk, early exits) | play-spc: samples (cycle-exact - gated exact; envelope corr, note timing reported only) |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const r of summary.results) {
    if (r.tooLarge) {
      lines.push(`| ${r.id} | does not fit: ${r.tooLarge.measured} / ${r.tooLarge.limit} bytes | - | - | - | - |`);
      continue;
    }
    const fmtSamples = (s) => `${s.correlation.toFixed(4)} (${pct(100 * s.relativeRmsError)} %, ${pct((100 * s.cycleExact.identical) / s.cycleExact.cycles)} % cycle-exact${s.noteTiming ? `, ${pct(100 * s.noteTiming.fraction)} % note timing` : ''})`;
    const rtWrites = `${r.roundTrip.writes.matched}/${Math.max(r.roundTrip.writes.oursCount, r.roundTrip.writes.oracleCount)}, ${r.roundTrip.drift.maxCycleDiff}c (${r.roundTrip.drift.ticks.toFixed(2)}t)`;
    const rtSamples = fmtSamples(r.roundTrip.samples);
    const orWrites = `${r.oracle.writes.matched}/${Math.max(r.oracle.writes.oursCount, r.oracle.writes.oracleCount)}, cycleOk ${r.oracle.writes.cycleOk}, ${r.oracle.writes.earlyExits} early-exit`;
    const orSamples = fmtSamples(r.oracle.samples);
    lines.push(`| ${r.id} | ${r.aramUsed} / ${r.aramLimit} bytes | ${rtWrites} | ${rtSamples} | ${orWrites} | ${orSamples} |`);
  }
  lines.push(close);
  fs.writeFileSync(file, text.slice(0, begin) + lines.join('\n') + text.slice(end + close.length));
}
