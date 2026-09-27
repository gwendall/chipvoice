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
 * comparison and a +/-2-tick windowed value match both land around 10-16%
 * for `zelda`, despite its write stream matching the plan or the oracle
 * exactly, register for register, value for value, in order (see
 * `roundTripWrites`/`oracleWriteCompare` below) - the notes are all there,
 * on time to within the stated tolerance, but sample-for-sample matching is
 * not a meaningful test of that.
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
const WINDOW_CYCLES = 4096; // four ticks (spc-player.ts: TIMER_TARGET=8, 8000/8=1000 Hz - 1024 cycles/tick) - see the doc comment above for why one tick alone is too fine a grain
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
  const roundTripWrites = compareWrites(
    importedWrites,
    canonicalizeSrcn(resolveWrites(plan.events).filter((w) => w.cycle < cycles), dirPage),
  );

  // The direct comparison this check exists to make: the exact same
  // exported file, played by two independent SPC700s - this package's own
  // (`imported.events`, already re-derived from the file above) and
  // blargg's (`play-spc`, `spcCpuWrites`/`spcCpuSamples`) - cycle-stamped
  // register writes compared write for write, sample-accurate audio
  // compared the same envelope-correlation way as the round trip above.
  // The write-sequence side of this is gated at 100%: `oracleWriteCompare`
  // (below `first === null`, the pass gate this script's summary line
  // computes) requires every single write to match, register, value, and
  // order, with zero tolerance - real content already meets it exactly
  // (mario 24092/24092, zelda 12665/12665, both cycle-stamped writes with
  // no divergence at all). Gating raw cycle-exact *samples* at 100% the
  // same way is not meaningful, not a looser standard adopted for
  // convenience: see `envelopeMatch`'s own doc comment above for the
  // measured proof (a provably correct export - matching oracle writes
  // exactly - still scores a strict cycle-exact sample comparison at only
  // 10-16% on this same corpus, from sub-tick playback phase alone, not
  // from any divergence) for why the envelope correlation gate, not a raw
  // sample gate, is this check's actual bar for the audio side.
  const oracleWrites = spcCpuWrites(file, cycles);
  const oracleSamples = ChangeStream.from(await spcCpuSamples(file, cycles));
  const oursForOracle = ChangeStream.from(chipSnes.trace(imported.events, cycles, imported.memory));
  const oracleWriteCompare = compareWrites(resolveWrites(imported.events.slice(imported.restoreEvents)), oracleWrites);
  const oracleSampleCompare = compare(oursForOracle, oracleSamples, { cycles, voices: [0, 1] });
  // Reported at three window widths, not just the one this check gates on
  // (`WINDOW_CYCLES`, four ticks) - see `envelopeMatch`'s doc comment for
  // why one tick alone under-resolves a correct export (sub-tick BRR phase,
  // not a real mismatch) and why four is where that effect has already
  // washed out on this corpus. `ENVELOPE_WINDOWS_TICKS` gives the same
  // three widths that doc comment's own measurement names, so every run of
  // this script reproduces them instead of only a historical note.
  const envelopeByWindow = (a, b) => Object.fromEntries(ENVELOPE_WINDOWS_TICKS.map((ticks) => [ticks, envelopeMatch(a, b, cycles, [0, 1], ticks * 1024)]));
  const roundTripEnvelopeWindows = envelopeByWindow(oursRoundTrip, oursDirect);
  const oracleEnvelopeWindows = envelopeByWindow(oursForOracle, oracleSamples);
  const oracleEnvelope = oracleEnvelopeWindows[WINDOW_CYCLES / 1024];

  return { id, cycles, size, roundTripSamples, roundTripEnvelope, roundTripEnvelopeWindows, roundTripWrites, oracleWriteCompare, oracleSampleCompare, oracleEnvelope, oracleEnvelopeWindows };
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
  const oracleWritesOk = r.oracleWriteCompare.first === null;
  const roundTripSamplesOk = r.roundTripEnvelope.correlation >= ENVELOPE_MATCH_THRESHOLD;
  const oracleSamplesOk = r.oracleEnvelope.correlation >= ENVELOPE_MATCH_THRESHOLD;
  const ok = roundTripWritesOk && oracleWritesOk && roundTripSamplesOk && oracleSamplesOk;
  if (!ok) anyDivergence = true;
  const rawPct = (n, d) => (100 * n) / d;
  const fmtEnv = (e) => `envelope corr ${e.correlation.toFixed(4)}, rel RMS error ${(100 * e.relativeRmsError).toFixed(2)}%`;
  const line = [
    (ok ? 'PASS' : 'FAIL').padEnd(4),
    r.id.padEnd(8),
    `ARAM ${r.size.dataEnd}/${r.size.limit}`,
    `round trip: writes ${r.roundTripWrites.matched}/${Math.max(r.roundTripWrites.oursCount, r.roundTripWrites.oracleCount)}, samples ${fmtEnv(r.roundTripEnvelope)} (${rawPct(r.roundTripSamples.identical, r.roundTripSamples.cycles).toFixed(4)}% cycle-exact)`,
    `play-spc: writes ${r.oracleWriteCompare.matched}/${Math.max(r.oracleWriteCompare.oursCount, r.oracleWriteCompare.oracleCount)}, samples ${fmtEnv(r.oracleEnvelope)} (${rawPct(r.oracleSampleCompare.identical, r.oracleSampleCompare.cycles).toFixed(4)}% cycle-exact)`,
  ];
  if (r.roundTripWrites.first) line.push(`round-trip writes diverge at #${r.roundTripWrites.first.index}: ours ${fmtWrite(r.roundTripWrites.first.ours)}, plan ${fmtWrite(r.roundTripWrites.first.oracle)}`);
  if (r.oracleWriteCompare.first) line.push(`play-spc writes diverge at #${r.oracleWriteCompare.first.index}: ours ${fmtWrite(r.oracleWriteCompare.first.ours)}, oracle ${fmtWrite(r.oracleWriteCompare.first.oracle)}`);
  if (!roundTripSamplesOk) line.push(`round-trip envelope correlation ${r.roundTripEnvelope.correlation.toFixed(4)} below the ${ENVELOPE_MATCH_THRESHOLD} threshold`);
  if (!oracleSamplesOk) line.push(`play-spc envelope correlation ${r.oracleEnvelope.correlation.toFixed(4)} below the ${ENVELOPE_MATCH_THRESHOLD} threshold`);
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
  sampleMetric: `envelope correlation: both streams' per-voice RMS loudness in ${WINDOW_CYCLES}-cycle (four ticks, ${(WINDOW_CYCLES / 1024).toFixed(0)} ms) windows, pooled across voices, compared by Pearson correlation; gated at ${ENVELOPE_MATCH_THRESHOLD}. relativeRmsError is the same envelopes' RMS difference relative to the oracle's own RMS, reported but not gated. cycleExact is compare()'s raw, unwindowed cycle-exact percentage, reported but not gated - see envelopeMatch's doc comment in this file for why a raw sample comparison, or even a too-fine windowed one, is the wrong tool for audio this close to correct.`,
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
    `Samples: ${summary.sampleMetric}`,
    '',
    '| Song | ARAM used | Round trip (own CPU): writes | Round trip: samples (envelope corr, rel RMS error, cycle-exact) | play-spc: writes | play-spc: samples (envelope corr, rel RMS error, cycle-exact) |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const r of summary.results) {
    if (r.tooLarge) {
      lines.push(`| ${r.id} | does not fit: ${r.tooLarge.measured} / ${r.tooLarge.limit} bytes | - | - | - | - |`);
      continue;
    }
    const fmtSamples = (s) => `${s.correlation.toFixed(4)} (${pct(100 * s.relativeRmsError)} %, ${pct((100 * s.cycleExact.identical) / s.cycleExact.cycles)} % cycle-exact)`;
    const rtWrites = `${r.roundTrip.writes.matched}/${Math.max(r.roundTrip.writes.oursCount, r.roundTrip.writes.oracleCount)}`;
    const rtSamples = fmtSamples(r.roundTrip.samples);
    const orWrites = `${r.oracle.writes.matched}/${Math.max(r.oracle.writes.oursCount, r.oracle.writes.oracleCount)}`;
    const orSamples = fmtSamples(r.oracle.samples);
    lines.push(`| ${r.id} | ${r.aramUsed} / ${r.aramLimit} bytes | ${rtWrites} | ${rtSamples} | ${orWrites} | ${orSamples} |`);
  }
  lines.push(close);
  fs.writeFileSync(file, text.slice(0, begin) + lines.join('\n') + text.slice(end + close.length));
}
