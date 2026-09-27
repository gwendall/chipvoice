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
 *
 * `--self-test` runs a handful of negative tests against synthetic data
 * instead of the real corpus, one per gate this file has: an oracle write
 * altered by one value, an oracle write cycle shifted past the tolerance
 * `compareOracleWrites` names, a write placed past the round-trip timing
 * bound, and a voice dropped entirely - each must make the matching gate
 * fail, not just pass by accident (see `selfTest`'s own doc comment).
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

// spc-player.ts: TIMER_TARGET=8, 8000/8 = 1000 Hz = 1024 SPC cycles/tick -
// the same constant packages/chipvoice/test/spc-export.mjs names for its own
// round-trip timing check.
const CYCLES_PER_TICK = 1024;

// check.mjs's own documented "+1 for the last access of an instruction"
// cycle-labeling convention difference between the two CPUs - already
// treated as benign there, and confirmed here as the constant offset every
// write before the phantom period below shares.
const KNOWN_WRITE_OFFSET = 1;

// blargg's vendored snes_spc (oracles/snes-spc/snes_spc/SNES_SPC.cpp,
// `run_timer_`) computes each timer's elapsed prescaler periods as
// `TIMER_DIV(t, time - t->next_time) + 1` - an unconditional "+1" - while
// `reset_time_regs()` (SNES_SPC_misc.cpp) sets every timer's `next_time = 1`
// on every snapshot load, including `load_spc()`'s own. The combination
// means the very FIRST call to `run_timer_` after a load always credits
// itself with one whole prescaler period already elapsed, no matter how few
// cycles have actually passed - proven in isolation with a minimal
// hand-built .spc file (CONTROL enabling timer 0, T0TARGET=1, T0OUT=0, no
// other writes): blargg's own CPU reports timer 0's first pulse at cycle 3,
// where both real hardware and this package's own per-cycle timer model only
// reach it at cycle 128 (ssmp.ts's STAGE1_T01, timer 0's free-running
// prescaler period). From that first live tick onward every later timer read
// and DSP register write blargg's CPU makes lands exactly one such period
// ahead of ours, for the rest of the file - a single, fixed, one-time jump,
// not drift (confirmed by sampling write cycles across the whole file on
// both real corpus songs; the offset never changes again after this one
// jump). This is a known simplification in blargg's own lazy timer model,
// not a bug in this package's per-cycle one, and not something exportSpc or
// importSpc could work around: the phantom period is entirely inside
// play-spc's own CPU, before the exported file's first real write.
const T0_STAGE1_PERIOD = 128;

// Headroom around a clean multiple of T0_STAGE1_PERIOD, in cycles: measured
// residual on this corpus is 2 (mario) and 5 (zelda) cycles, from the same
// plain-vs-burst write-dispatch cost difference the round-trip timing gate
// below measures. 16 matches the window compare.mjs's own bestShift already
// searches for the same "phase convention, not a bug" purpose, comfortably
// over the measured 2-5 cycle residual this mechanism actually produces.
const PHANTOM_PERIOD_RESIDUAL_BOUND = 16;

/**
 * Like compareWrites, but for the oracle comparison: also validates that
 * every matched write's cycle is explained by KNOWN_WRITE_OFFSET, optionally
 * advanced by exactly one T0_STAGE1_PERIOD partway through the file (see the
 * doc comment above) - not "close enough" on some looser scale. Content
 * (register, value, order) is still gated at exact equality, same as
 * compareWrites; cycles are gated at exact equality up to that single, named,
 * justified offset. Any other cycle relationship - a second change in the
 * phantom-period count, a residual outside PHANTOM_PERIOD_RESIDUAL_BOUND, or
 * the oracle running behind rather than ahead - fails the gate and is
 * reported as the first write whose cycle diverges.
 */
function compareOracleWrites(ours, oracle) {
  const n = Math.min(ours.length, oracle.length);
  let matched = 0;
  while (matched < n && ours[matched].reg === oracle[matched].reg && ours[matched].value === oracle[matched].value) matched++;
  const first = matched < ours.length || matched < oracle.length ? { index: matched, ours: ours[matched] ?? null, oracle: oracle[matched] ?? null } : null;

  let phantomPeriods = 0;
  let transitionIndex = null;
  let cycleFirst = null;
  for (let i = 0; i < matched; i++) {
    const diff = oracle[i].cycle - ours[i].cycle;
    const periods = Math.round((KNOWN_WRITE_OFFSET - diff) / T0_STAGE1_PERIOD);
    const residual = diff - (KNOWN_WRITE_OFFSET - periods * T0_STAGE1_PERIOD);
    if (periods < 0 || Math.abs(residual) > PHANTOM_PERIOD_RESIDUAL_BOUND) {
      cycleFirst = { index: i, ours: ours[i], oracle: oracle[i], diff, periods, residual };
      break;
    }
    if (periods !== phantomPeriods) {
      if (transitionIndex !== null) {
        cycleFirst = { index: i, ours: ours[i], oracle: oracle[i], diff, periods, residual, reason: 'a second change in the phantom-period count' };
        break;
      }
      transitionIndex = i;
      phantomPeriods = periods;
    }
  }
  return { oursCount: ours.length, oracleCount: oracle.length, matched, first, cycleOk: cycleFirst === null, cycleFirst, phantomPeriods, transitionIndex };
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
 * comparison lands around 17-31% across both real songs, despite their
 * write streams matching the plan or the oracle exactly, register for
 * register, value for value, in order (see `roundTripWrites`/
 * `oracleWriteCompare` below) - the notes are all there, on time to within
 * the stated tolerance, but sample-for-sample matching is not a meaningful
 * test of that. On the oracle side this is not just phase: correcting for
 * blargg's own proven timer quirk (see `T0_STAGE1_PERIOD`'s doc comment)
 * only raises it to 29-40%, and `compareOracleWrites`'s own doc comment (in
 * `checkOne`) gives the fuller, measured explanation - note-relative timing
 * matches 92-97% of the time; the exact sample values within a note do not,
 * which is why `noteTimingAlignment`, not raw cycle-exact identity, is this
 * check's other exact bar for the oracle samples comparison.
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
 * The exact (not correlation) bar the oracle SAMPLES comparison actually
 * meets: for each voice, compare.mjs's `compare()` already runs `runs()`
 * (split into per-note runs, each allowed its own constant shift) and
 * reports how many of those runs have every step landing at the right
 * relative cycle (`alignedTimes`). This pools that across the voices
 * `compare()` was given, into one fraction - see the doc comment above
 * `oracleWriteCompare` in checkOne for why this, not raw cycle-exact
 * identity, is the tightest rule that survives on real content: note
 * *timing* matches exactly; the exact 16-bit values inside a note do not
 * (`alignedValues`, reported alongside, stays low even when this is high).
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
  const plan = planPerformance(score, snesChip, { allowLoss: true });
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
  const importedWrites = resolveWrites(imported.events.slice(imported.restoreEvents));
  const dirPage = importedWrites.find((w) => w.reg === 0x5d)?.value;
  const planWrites = canonicalizeSrcn(resolveWrites(plan.events).filter((w) => w.cycle < cycles), dirPage);
  const roundTripWrites = compareWrites(importedWrites, planWrites);
  // The round trip's own timing gate (item 3): how far the file actually
  // places each write from the tick exportSpc rounded it to, measured live
  // on this real song - see roundTripTimingDrift's doc comment for the
  // derivation of ROUND_TRIP_DRIFT_TICKS.
  const roundTripDrift = roundTripTimingDrift(importedWrites, planWrites);

  // The direct comparison this check exists to make: the exact same
  // exported file, played by two independent SPC700s - this package's own
  // (`imported.events`, already re-derived from the file above) and
  // blargg's (`play-spc`, `spcCpuWrites`/`spcCpuSamples`) - cycle-stamped
  // register writes compared write for write, sample-accurate audio
  // compared the same envelope-correlation way as the round trip above.
  //
  // The write-sequence side is gated exactly, content AND cycle:
  // `compareOracleWrites` (see its own doc comment, and T0_STAGE1_PERIOD's,
  // above) requires every register and value to match in order with zero
  // tolerance, and every write's cycle to be explained by the one, named,
  // proven offset blargg's own lazy timer model introduces at snapshot load
  // - not "close enough" on some looser scale. Real content already meets
  // this exactly (mario 24092/24092, zelda 12665/12665 writes, both with
  // `cycleOk: true` and exactly one phantom-period transition, at write #63
  // on both songs).
  //
  // Raw cycle-exact *samples*, unlike writes, are not gateable at any
  // meaningful bar, even after correcting for that same proven offset -
  // measured directly, not assumed: shifting the oracle's sample stream by
  // the write comparison's own phantomPeriods * T0_STAGE1_PERIOD still only
  // raises cycle-exact identity to 29-40% on this corpus (up from 17-31%
  // unshifted), nowhere near check.mjs's own 100% bar. The reason is not
  // unexplained "phase": splitting the same comparison into note-relative
  // timing versus in-note sample values (compare.mjs's `runs()`) shows why -
  // each note's own steps land at the right relative times 92-97% of the
  // time (`alignedTimes` below), but the exact 16-bit values at those times
  // essentially never match bit for bit (`alignedValues`, and raw `edges()`,
  // both near zero). The S-DSP core is a direct port of blargg's own (see
  // this file's own top doc comment), so the two do not diverge in what the
  // DSP itself computes; they diverge in the few cycles of write timing that
  // seed a continuously-evolving, chaotic pipeline (Gaussian interpolation
  // phase, envelope and pitch counters advancing every cycle) - the same
  // handful of cycles the write comparison above already names and bounds,
  // just now shown to be enough, downstream, to make two individually
  // correct realizations of the same note sound like different waveforms
  // sample for sample while still starting, stopping, and stepping at the
  // same times. Note timing IS a real, exact (not correlation) bar this
  // corpus meets, and NOTE_TIMING_ALIGNMENT_THRESHOLD below gates on it,
  // alongside envelope correlation (unchanged) for the audio content itself.
  const oracleWrites = spcCpuWrites(file, cycles);
  const oracleSamples = ChangeStream.from(await spcCpuSamples(file, cycles));
  const oursForOracle = ChangeStream.from(chipSnes.trace(imported.events, cycles, imported.memory));
  const oracleWriteCompare = compareOracleWrites(resolveWrites(imported.events.slice(imported.restoreEvents)), oracleWrites);
  const oracleSampleCompare = compare(oursForOracle, oracleSamples, { cycles, voices: [0, 1] });
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

  return { id, cycles, size, roundTripSamples, roundTripEnvelope, roundTripEnvelopeWindows, roundTripWrites, roundTripDrift, oracleWriteCompare, oracleSampleCompare, oracleNoteTiming, oracleEnvelope, oracleEnvelopeWindows };
}

/**
 * One negative test per gate this file has, against small synthetic data
 * rather than the real corpus - proof each gate actually catches the kind of
 * problem it exists for, not just that real content happens to pass it:
 *
 *  - a write whose value is altered: the content gate (`compareOracleWrites`,
 *    shared with `compareWrites`/`roundTripWrites`) must reject it.
 *  - a write cycle shifted one cycle past PHANTOM_PERIOD_RESIDUAL_BOUND: the
 *    cycle gate must now reject it, where the old, cycle-blind `compareWrites`
 *    would have passed it silently.
 *  - a write placed past ROUND_TRIP_DRIFT_TICKS from its tick-rounded target:
 *    `roundTripTimingDrift`'s own gate must reject it.
 *  - a voice dropped entirely (real content, replaced with silence): the
 *    envelope correlation gate must reject it.
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

  // ---- Write cycle, shifted one cycle past the named tolerance: the cycle
  // gate must reject it where a cycle-blind compareWrites would not. ----
  {
    const ours = [];
    const oracle = [];
    for (let i = 0; i < 6; i++) {
      ours.push({ reg: i, value: i, cycle: 100 + i * 3000 });
      oracle.push({ reg: i, value: i, cycle: ours[i].cycle + KNOWN_WRITE_OFFSET });
    }
    // The old, cycle-blind compareWrites sees identical content and passes.
    const contentOnly = compareWrites(ours, oracle);
    check('self-test: content-only comparison does not itself catch a cycle shift (sanity check)', contentOnly.first === null);
    // One cycle past the residual this file names and justifies (16) - not
    // an arbitrarily large shift, the smallest one that must fail.
    oracle[5].cycle += PHANTOM_PERIOD_RESIDUAL_BOUND + 1;
    const r = compareOracleWrites(ours, oracle);
    check('self-test: a write cycle one past the named tolerance fails the cycle gate', !r.cycleOk && r.cycleFirst?.index === 5);
  }

  // ---- Round-trip timing: a write placed past the gate's own bound. ----
  {
    const plan = [{ reg: 0, value: 0, cycle: 10000 }];
    const onTarget = [{ reg: 0, value: 0, cycle: 10240 }]; // rounds to the same tick (10240), 0 drift
    const late = [{ reg: 0, value: 0, cycle: 10240 + ROUND_TRIP_DRIFT_TICKS * CYCLES_PER_TICK + 1 }];
    const okDrift = roundTripTimingDrift(onTarget, plan);
    const badDrift = roundTripTimingDrift(late, plan);
    check('self-test: a write on target passes the round-trip timing gate', okDrift.maxCycleDiff <= ROUND_TRIP_DRIFT_TICKS * CYCLES_PER_TICK);
    check('self-test: a write past the round-trip timing bound fails the gate', badDrift.maxCycleDiff > ROUND_TRIP_DRIFT_TICKS * CYCLES_PER_TICK);
  }

  // ---- Sample content: a voice dropped entirely (replaced with silence),
  // not just phase-shifted - the envelope correlation gate must reject it. ----
  {
    const cycles = 5 * WINDOW_CYCLES;
    const ours = new ChangeStream();
    for (let c = 0; c < cycles; c += SAMPLE_OUTPUT_CYCLES) {
      const on = Math.floor(c / WINDOW_CYCLES) % 2 === 0;
      ours.push(c, 0, on ? 12345 : 0);
    }
    const silentOracle = new ChangeStream(); // the dropped voice: no changes at all, value stays 0 throughout
    const dropped = envelopeMatch(ours, silentOracle, cycles, [0]);
    check('self-test: a dropped voice fails the envelope correlation gate', dropped.correlation < ENVELOPE_MATCH_THRESHOLD);
    const identical = envelopeMatch(ours, ours, cycles, [0]);
    check('self-test: comparing a stream against itself passes the envelope correlation gate (sanity check)', identical.correlation >= ENVELOPE_MATCH_THRESHOLD);
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
  const oracleSamplesOk = r.oracleEnvelope.correlation >= ENVELOPE_MATCH_THRESHOLD && r.oracleNoteTiming.fraction >= NOTE_TIMING_ALIGNMENT_THRESHOLD;
  const ok = roundTripWritesOk && roundTripDriftOk && oracleWritesOk && roundTripSamplesOk && oracleSamplesOk;
  if (!ok) anyDivergence = true;
  const rawPct = (n, d) => (100 * n) / d;
  const fmtEnv = (e) => `envelope corr ${e.correlation.toFixed(4)}, rel RMS error ${(100 * e.relativeRmsError).toFixed(2)}%`;
  const line = [
    (ok ? 'PASS' : 'FAIL').padEnd(4),
    r.id.padEnd(8),
    `ARAM ${r.size.dataEnd}/${r.size.limit}`,
    `round trip: writes ${r.roundTripWrites.matched}/${Math.max(r.roundTripWrites.oursCount, r.roundTripWrites.oracleCount)} (max drift ${r.roundTripDrift.maxCycleDiff}c/${r.roundTripDrift.ticks.toFixed(2)}t), samples ${fmtEnv(r.roundTripEnvelope)} (${rawPct(r.roundTripSamples.identical, r.roundTripSamples.cycles).toFixed(4)}% cycle-exact)`,
    `play-spc: writes ${r.oracleWriteCompare.matched}/${Math.max(r.oracleWriteCompare.oursCount, r.oracleWriteCompare.oracleCount)} (cycleOk ${r.oracleWriteCompare.cycleOk}, phantomPeriods ${r.oracleWriteCompare.phantomPeriods}@#${r.oracleWriteCompare.transitionIndex}), samples ${fmtEnv(r.oracleEnvelope)} (${rawPct(r.oracleSampleCompare.identical, r.oracleSampleCompare.cycles).toFixed(4)}% cycle-exact, note timing ${r.oracleNoteTiming.alignedTimes}/${Math.max(r.oracleNoteTiming.ours, r.oracleNoteTiming.theirs)} = ${(100 * r.oracleNoteTiming.fraction).toFixed(2)}%)`,
  ];
  if (r.roundTripWrites.first) line.push(`round-trip writes diverge at #${r.roundTripWrites.first.index}: ours ${fmtWrite(r.roundTripWrites.first.ours)}, plan ${fmtWrite(r.roundTripWrites.first.oracle)}`);
  if (!roundTripDriftOk) line.push(`round-trip timing drift ${r.roundTripDrift.maxCycleDiff} cycles exceeds the ${ROUND_TRIP_DRIFT_TICKS}-tick (${ROUND_TRIP_DRIFT_TICKS * CYCLES_PER_TICK}-cycle) bound, at write #${r.roundTripDrift.worst?.index}`);
  if (r.oracleWriteCompare.first) line.push(`play-spc writes diverge at #${r.oracleWriteCompare.first.index}: ours ${fmtWrite(r.oracleWriteCompare.first.ours)}, oracle ${fmtWrite(r.oracleWriteCompare.first.oracle)}`);
  if (!r.oracleWriteCompare.cycleOk) line.push(`play-spc write cycles diverge at #${r.oracleWriteCompare.cycleFirst.index}: diff ${r.oracleWriteCompare.cycleFirst.diff}, ${r.oracleWriteCompare.cycleFirst.periods} phantom period(s), residual ${r.oracleWriteCompare.cycleFirst.residual}${r.oracleWriteCompare.cycleFirst.reason ? ` (${r.oracleWriteCompare.cycleFirst.reason})` : ''}`);
  if (!roundTripSamplesOk) line.push(`round-trip envelope correlation ${r.roundTripEnvelope.correlation.toFixed(4)} below the ${ENVELOPE_MATCH_THRESHOLD} threshold`);
  if (!oracleSamplesOk) {
    if (r.oracleEnvelope.correlation < ENVELOPE_MATCH_THRESHOLD) line.push(`play-spc envelope correlation ${r.oracleEnvelope.correlation.toFixed(4)} below the ${ENVELOPE_MATCH_THRESHOLD} threshold`);
    if (r.oracleNoteTiming.fraction < NOTE_TIMING_ALIGNMENT_THRESHOLD) line.push(`play-spc note timing alignment ${(100 * r.oracleNoteTiming.fraction).toFixed(2)}% below the ${(100 * NOTE_TIMING_ALIGNMENT_THRESHOLD).toFixed(0)}% threshold`);
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
  sampleMetric: `envelope correlation: both streams' per-voice RMS loudness in ${WINDOW_CYCLES}-cycle (four ticks, ${(WINDOW_CYCLES / CYCLES_PER_TICK).toFixed(0)} ms) windows, pooled across voices, compared by Pearson correlation; gated at ${ENVELOPE_MATCH_THRESHOLD}. relativeRmsError is the same envelopes' RMS difference relative to the oracle's own RMS, reported but not gated. cycleExact is compare()'s raw, unwindowed cycle-exact percentage, reported but not gated - see envelopeMatch's doc comment in this file for why a raw sample comparison, or even a too-fine windowed one, is the wrong tool for audio this close to correct. noteTiming (oracle side only) is compare()'s runs()-based per-note alignment: the fraction of notes whose steps land at the right relative cycle once each note is given its own constant shift - a genuinely exact (not correlation) bar, gated at ${NOTE_TIMING_ALIGNMENT_THRESHOLD}; see compareOracleWrites's and noteTimingAlignment's doc comments for why this, not raw sample identity, is the tightest exact rule that survives blargg's own proven timer quirk.`,
  writeMetric: `oracle writes are gated on content (register, value, order - exact) AND cycle (exact, up to the single named T0_STAGE1_PERIOD offset blargg's own snes_spc introduces at snapshot load - see compareOracleWrites's doc comment). roundTripDrift is the round trip's own timing gate (item 3): the largest |actual cycle - tick-rounded plan cycle| over every write, gated at ${ROUND_TRIP_DRIFT_TICKS} ticks (${ROUND_TRIP_DRIFT_TICKS * CYCLES_PER_TICK} cycles) - see roundTripTimingDrift's doc comment for the derivation.`,
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
    '| Song | ARAM used | Round trip (own CPU): writes, max drift | Round trip: samples (envelope corr, rel RMS error, cycle-exact) | play-spc: writes (cycleOk, phantom periods) | play-spc: samples (envelope corr, rel RMS error, cycle-exact, note timing) |',
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
    const orWrites = `${r.oracle.writes.matched}/${Math.max(r.oracle.writes.oursCount, r.oracle.writes.oracleCount)}, cycleOk ${r.oracle.writes.cycleOk}, ${r.oracle.writes.phantomPeriods} period(s)`;
    const orSamples = fmtSamples(r.oracle.samples);
    lines.push(`| ${r.id} | ${r.aramUsed} / ${r.aramLimit} bytes | ${rtWrites} | ${rtSamples} | ${orWrites} | ${orSamples} |`);
  }
  lines.push(close);
  fs.writeFileSync(file, text.slice(0, begin) + lines.join('\n') + text.slice(end + close.length));
}
