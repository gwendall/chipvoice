import fs from 'node:fs';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {exportNsf, NsfExportError, nesChip, planPerformance, renderPerformance} from '../../packages/chipvoice/dist/index.js';
import {captureNsf} from '../capture-nsf.mjs';
import {compareNsfTrace, parseTrace} from '../nsf-corpus/compare.mjs';
import {loadNative} from '../arrangements/native-sources.mjs';
import {loadArrangement} from '../arrangements/check.mjs';

/**
 * The other direction from `nsf-corpus`: instead of checking that this
 * project reads a real NSF correctly, this checks that `exportNsf`'s own
 * output plays correctly - in the same pinned Game_Music_Emu oracle,
 * reusing its build (`../arrangements/native-oracle.py`, same output
 * directory as `nsf-corpus:check`, so CI's cache step covers both).
 *
 * Four proofs, per file:
 *
 *   1. Command stream (gates CI, exact): the export, replayed by GME, must
 *      produce the exact write stream `scores/capture-nsf.mjs` (this
 *      project's own offline 6502) gets from replaying the very same
 *      export - `matched === total`, not just "matched some". Both sides
 *      execute identical bytes, so anything short of an exact match is a
 *      player bug, not a quantization question. This is a player-
 *      correctness check - the export against itself - and says nothing on
 *      its own about whether the export reproduces the *source*; proof #2
 *      does.
 *   2. Frame writes (gates CI, exact, tests fidelity to the source): the
 *      source capture's own register writes and GME's trace of the export,
 *      each bucketed into 60 Hz frames (`Math.floor(at / PERIOD)`), must
 *      list the exact same writes - address, value, order - frame for
 *      frame, after one constant frame offset (`compareFrameWrites`, found
 *      by the same small search `compareEnvelopes` uses) - `matched ===
 *      total`, again exactly, not by count or percentage. This is not an
 *      audio measurement, so it cannot be fooled by a mixer or an alignment
 *      choice.
 *
 *      A source frame is only counted (and only required to match) while
 *      its own real-time position, `sourceFrame + offset`, still falls
 *      inside the export's one-shot pass through the content - strictly
 *      before `frameCountFor(cycles)`, the same frame count
 *      `quantizeToFrames` (`nsf.ts`) uses to decide when to wrap PLAY back
 *      to `loopFrame`. Past that point the exported player has already
 *      looped, so GME's trace at that real-time position holds the *loop
 *      frame's* content, not the tail source frame's - comparing the two
 *      would fail for a reason that has nothing to do with export fidelity.
 *      This is a principled exclusion, not an excuse: it can only ever drop
 *      frames within `MAX_FRAME_OFFSET_SEARCH` of the very end of the
 *      capture, and only when the capture's last written frame lands within
 *      that same short window of the loop point, so it cannot hide a real
 *      mismatch anywhere else. On this corpus it excludes a handful of
 *      frames on three files whose last captured writes land within a frame
 *      or two of their own loop point - `zelda-native` (1), `zelda-
 *      rendition` (2), `pently-demo` (1) - and every file's comparable
 *      frames, on all thirteen, match 100%: `matched === total`.
 *
 *      Together, proofs #1 and #2 are the reason proof #3's threshold can
 *      be trusted: they prove the export carries every command, in the
 *      right frame, with nothing dropped or reordered, independent of
 *      anyone's mixer.
 *   3. Export loss (the pass/fail audio gate): GME's own trace of playing
 *      the export, parsed back into register writes and rendered through
 *      this project's own `renderPerformance`, against a render of the
 *      *source* capture's untouched events through that same
 *      `renderPerformance`. Both sides go through the identical 2A03 DSP,
 *      so the only thing left to differ is what the export itself changed.
 *      Given proof #2, that is not missing or wrong commands - it is when,
 *      within a frame, a write lands: this project's exported player
 *      applies a whole frame's writes back to back at the very start of its
 *      PLAY call, while a source driver spreads them across its own, longer
 *      PLAY routine, so a note-on that a driver reaches only partway into
 *      its frame plays for more of that one frame in the export than it did
 *      in the source (see `EXPORT_LOSS_RMS_THRESHOLD`'s own comment for the
 *      measured evidence). The threshold is set from the measured band on
 *      this corpus with a small margin, below.
 *   4. GME mixer comparison (informational, not a gate): GME's rendered PCM
 *      of the export against this project's own render of the source. This
 *      crosses two independently written 2A03 emulators (GME's and this
 *      project's), so a sizeable residual is expected even for a perfect
 *      export - their DAC/mixer curves simply do not level a note to the
 *      same loudness - and it says nothing about which side is "right".
 *      Reported on the sheet as "GME's mixer differs from ours by X%", kept
 *      for visibility, never gating CI.
 *
 * The corpus draws on three kinds of the project's own NES content, as the
 * ticket names them: real hardware captures (`mario`/`zelda`'s native
 * NSF-command recordings, decision 29), this project's own driver's 2A03
 * rendition of those same two arrangements, and every file `nsf-corpus`
 * already carries (its own `sources.json`, read again here) - eight
 * independently authored, redistribution-licensed 2A03 NSFs plus two
 * self-authored expansion-audio probes: `vrc6-probe` (round 2 of NEXT-14)
 * and, since NEXT-15, `sunsoft5b-probe` - each replayed once through
 * `capture-nsf.mjs` to get a source capture, then re-exported. `vrc6-probe`
 * closed NEXT-14 round 2 item 3 and `sunsoft5b-probe` closes the equivalent
 * NEXT-15 item the same way: `exportNsf`'s own round-trip of that chip's
 * registers, then Game_Music_Emu's `Nsf_Emu` actually playing that export
 * and held to the same four proofs, below, as any 2A03 file - not just the
 * register-level `Nes_Vrc6_Apu`/`Ay8910` oracles `packages/conform` drives
 * directly. A file whose source uses DMC (several tracker drums do) is
 * expected to fail `exportNsf` with `dmc_unsupported`: that is this
 * format's own stated limit, not a bug, and is reported as a row here
 * rather than skipped quietly.
 *
 *   node scores/nsf-export/corpus.mjs [--json out.json] [--sheet docs/chips/2a03.md]
 *   node scores/nsf-export/corpus.mjs --no-oracle   # skip GME entirely (no network, no C++ build)
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const ORACLE_DIR = path.join(ROOT, '.artifacts', 'nsf-corpus', 'gme-oracle'); // shared with nsf-corpus:check, one CI cache step covers both
const WORK_DIR = path.join(ROOT, '.artifacts', 'nsf-export');
const ORACLE_REVISION = 'fe8da4b6d3876d7542c2fb69d94487e19836d678';
const CPU_HZ = nesChip.spec.clockHz;
const PERIOD = (262 * 341 * 4 - 2) / 12;
// The pass/fail gate (proof #3, module comment): both renders go through
// this project's own 2A03 DSP, so a residual here is the export's own loss
// alone, not a cross-emulator mixing-curve difference.
//
// An earlier version of this metric aligned each side on its own
// independently computed `firstSoundFrame` and measured 13.3-50.7% on the
// eight tracker-driven NSFs - a number that was then wrongly written up here
// as "sub-60 Hz quantization cost". That explanation does not survive
// contact with the files: every one of them (checked against their own NSF
// header, `$411a`) plays at 16666-16639 microseconds per PLAY call, i.e.
// once per 60 Hz frame - their own drivers cannot update anything faster
// than this project's own exported player replays it, so there is no
// sub-frame update rate to lose. The real cause was `compareEnvelopes`
// itself: two independently INIT'd NSF players never agree on which frame
// index is "PLAY call zero" (every player's own INIT-to-first-PLAY overhead
// differs - GME's own reset ceremony alone consumes a full frame before it
// ever calls the exported player's PLAY routine), so the two
// independently-chosen onsets routinely land one frame apart, and on
// percussive content that one frame of slip is enough by itself to produce
// an error of exactly this size. `compareFrameWrites` (proof #2) proves
// this directly: bucketing the source capture's own writes and GME's trace
// of the export into 60 Hz frames and comparing them for exact
// address/value/order equality (not loudness) shows a 100% match, on every
// file in this corpus, at one constant frame offset - the export carries
// every command, in the right frame, unchanged. `compareEnvelopes` now
// searches a small window of frame offsets around each side's own guess and
// keeps whichever minimizes the RMS error, instead of trusting the guesses
// to already agree; measured export loss on the same corpus, same GME
// revision, dropped to 4.5-21.9%.
//
// That remaining residual is real, and traced to a different, correctly
// named mechanism: proof #2 checks *which frame* a write lands in, not
// *when within the frame*. This project's exported player applies a whole
// frame's writes back to back within a few hundred cycles of PLAY starting;
// a source driver spends its own, longer PLAY routine on other bookkeeping
// first and only reaches a given channel's registers well into the frame.
// On `after-the-rain` (21.9%, this corpus's highest), the pulse-1 envelope
// restart (`$4003`) for the note at its second frame lands at cycle 6718 of
// the source's own ~29780-cycle frame (about 23% in) but at cycle 546 of the
// export's corresponding frame (under 2% in) - the new note plays for
// noticeably more of that one frame in the export, which is exactly the
// 0.51-vs-0.61 (peak-normalized) envelope jump measured there. A shift of a
// few thousand cycles within one 16.7 ms frame is inaudible on its own (at
// most it moves a note's attack a couple of milliseconds), but concentrated
// into the one or two frames where a note actually starts, it is large
// enough on a loudness-envelope metric to be measured, without indicating
// any dropped, wrong, or reordered command - proof #2 already rules that
// out. This is the same effect `nsf.ts`'s own module comment already
// documents ("A pitch or volume change mid-frame lands at the start of the
// frame it falls in instead, at most one frame (~16.7ms) early") named
// correctly instead of attributed to a nonexistent faster-than-60Hz update
// rate. 30% sits a real margin above the whole corrected measured band
// (4.5-21.9%); a genuinely broken export (a dropped channel, a wrong note, a
// loop gone wrong) collapses a section's envelope to silence or a different
// shape across many frames at once rather than shifting one attack frame's
// energy within a single 16.7 ms window, and would clear it by a wide margin
// the way the pre-alignment-fix version of this metric did (well over 100%).
const EXPORT_LOSS_RMS_THRESHOLD = 0.3;

// Informational only (proof #4, module comment): a cross-implementation
// comparison (GME's mixer against this project's own), not a same-DSP
// quantization measurement. Every exportable source in this corpus matches
// GME's command stream exactly (proof #1, matched === total, "none"
// divergence) and matches it frame for frame (proof #2, 100%) and clears
// the export-loss gate above, yet still measures 21.3-51.6% here: GME's
// DAC/mixer curve and this project's own do not level a note's loudness
// identically, so the two envelopes track the same shape a beat apart in
// gain even when every write landed correctly, in the right frame. This has
// no threshold and never gates CI (see `formatResult`, `main`); it is
// reported so the gap is visible, not because either side is being called
// wrong.

const run = promisify(execFile);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const noOracle = args.includes('--no-oracle');

/** Builds (once) and runs the oracle on `nsfPath`, retrying the whole
 * build+render on failure - this Mac's network drops TCP connects
 * sometimes - and returns both its command trace and its PCM render.
 * Mirrors `nsf-corpus/corpus.mjs`'s own `oracleTrace`. */
async function runOracle(nsfPath, seconds, track, attempts = 4) {
  await fs.promises.mkdir(ORACLE_DIR, {recursive: true});
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await run('python3', [path.join(ROOT, 'scores/arrangements/native-oracle.py'), nsfPath, ORACLE_DIR, String(seconds), String(track)]);
      const trace = await readFile(path.join(ORACLE_DIR, 'gme-writes.txt'), 'utf8');
      const pcm = await readFile(path.join(ORACLE_DIR, 'mario-gme.pcm'));
      return {trace, pcm};
    } catch (error) {
      lastError = error;
      const repo = path.join(ORACLE_DIR, 'gme');
      if (fs.existsSync(repo)) {
        try { await run('git', ['-C', repo, 'rev-parse', 'HEAD']); }
        catch { await fs.promises.rm(repo, {recursive: true, force: true}); }
      }
      if (attempt < attempts) await new Promise(done => setTimeout(done, 1000 * 2 ** attempt));
    }
  }
  throw new Error(`native-oracle.py failed after ${attempts} attempts: ${lastError.message}`);
}

/** A pulse/noise-heavy chip's own output is sample-hostile: two independent
 * emulators agreeing on every command still land their edges on different
 * samples (GME's own resampling and filter latency are its own, not this
 * project's), and on a square wave a one-sample phase difference is a
 * near-100% pointwise error at every edge despite sounding identical. A
 * raw sample-domain RMS measures that phase noise, not fidelity, so this
 * compares per-frame loudness envelopes instead - one RMS value per NTSC
 * frame (735 samples at 44100 Hz, this format's own replay granularity),
 * each side's envelope peak-normalized first so two mixers' different
 * absolute gain curves do not register as error either. That is still
 * sensitive to what matters: a dropped channel, a missing section, or a
 * loop gone wrong all show as a shape difference between the envelopes. */
function frameEnvelope(mono, sampleRate) {
  const frameSamples = Math.max(1, Math.round((sampleRate * PERIOD) / CPU_HZ));
  const frames = Math.ceil(mono.length / frameSamples);
  const env = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const start = f * frameSamples, end = Math.min(mono.length, start + frameSamples);
    let sumSq = 0;
    for (let i = start; i < end; i++) sumSq += mono[i] * mono[i];
    env[f] = Math.sqrt(sumSq / Math.max(1, end - start));
  }
  return env;
}

function toMono(left, right, n) {
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) mono[i] = (left[i] + right[i]) / 2;
  return mono;
}

/** `gme-render.cpp` calls `gme_ignore_silence(1)` (shared with `nsf-corpus`
 * and the native-arrangement harness, not this ticket's to change): GME
 * skips a track's leading silence before its PCM starts, where this
 * project's own render does not skip anything - INIT's ceremony writes are
 * silent by construction, and a source capture can open on a rest. Without
 * compensating, the two envelopes would be offset from sample zero by
 * however long that lead-in is, an alignment error, not an audible one.
 * Both sides are aligned on their own first frame above a tiny fraction of
 * their own peak instead of assumed to start together. */
function firstSoundFrame(env, threshold = 0.01) {
  const peak = Math.max(1e-9, ...env);
  for (let i = 0; i < env.length; i++) if (env[i] / peak > threshold) return i;
  return 0;
}

/** Shared by both audio proofs: peak-normalize each side on its own, then
 * find the constant frame offset that lines them up best.
 *
 * `firstSoundFrame` gives a starting guess for each side, but it is only a
 * guess: every NSF player's own INIT-to-first-PLAY overhead is different
 * (this project's own exported player's INIT is a handful of instructions;
 * a tracker driver's INIT does its own setup; GME's own reset ceremony
 * before it ever calls the exported player's PLAY routine, `compare.mjs`'s
 * own doc comment) so there is no reason the two sides' first audible frame
 * should be the *same* frame index - it is routinely one whole frame apart,
 * a fixed, expected latency, not a difference in content. A per-frame
 * write-list comparison of this exact corpus (`compareFrameWrites`, the
 * per-file diagnostic behind it: bucket both sides by
 * `floor(cycle / PERIOD)`, the frame index `firstSoundFrame` cannot see)
 * shows every one of the 8 tracker-driven corpus files matches every write,
 * in order, on every frame, at exactly one constant offset - so searching a
 * small window around the two guesses and keeping whichever offset
 * minimizes the relative RMS error recovers the real alignment instead of
 * assuming the guesses already agree. On percussive content (a noise-channel
 * hit decaying over 2-3 frames) leaving that one frame of slip uncorrected
 * is enough on its own to produce an error of several times this proof's
 * real size - which is exactly what the unsearched version of this function
 * measured. */
const MAX_FRAME_OFFSET_SEARCH = 8;
function compareEnvelopes(envA, envB) {
  const baseA = firstSoundFrame(envA), baseB = firstSoundFrame(envB);
  const peakA = Math.max(1e-9, ...envA), peakB = Math.max(1e-9, ...envB);
  let best = null;
  for (let offset = -MAX_FRAME_OFFSET_SEARCH; offset <= MAX_FRAME_OFFSET_SEARCH; offset++) {
    const startA = baseA, startB = baseB + offset;
    if (startB < 0 || startB >= envB.length) continue;
    const frames = Math.min(envA.length - startA, envB.length - startB);
    if (frames <= 0) continue;
    let sumSq = 0, refSumSq = 0;
    for (let f = 0; f < frames; f++) {
      const a = envA[f + startA] / peakA, b = envB[f + startB] / peakB;
      const d = a - b;
      sumSq += d * d;
      refSumSq += b * b;
    }
    const rms = Math.sqrt(sumSq / frames), refRms = Math.sqrt(refSumSq / frames);
    const relativeRmsError = refRms > 0 ? rms / refRms : rms;
    if (!best || relativeRmsError < best.relativeRmsError) best = {frames, startA, startB, offset, relativeRmsError};
  }
  return {frames: best.frames, alignment: {aLeadInFrames: best.startA, bLeadInFrames: best.startB, offsetFrames: best.offset}, relativeRmsError: best.relativeRmsError};
}

/** A `renderPerformance` result's per-frame loudness envelope. */
function renderedEnvelope(audio) {
  return frameEnvelope(toMono(audio.left, audio.right, audio.left.length), audio.sampleRate);
}

/** GME's raw PCM (stereo s16le) as a `renderPerformance`-shaped envelope,
 * so it compares through the same `compareEnvelopes` as two of our own
 * renders. */
function gmePcmEnvelope(pcm) {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const samples = pcm.length >> 2; // stereo s16le
  const left = new Float32Array(samples), right = new Float32Array(samples);
  for (let i = 0; i < samples; i++) { left[i] = view.getInt16(i * 4, true) / 32768; right[i] = view.getInt16(i * 4 + 2, true) / 32768; }
  return frameEnvelope(toMono(left, right, samples), 44100);
}

/** Proof #3 (informational): GME's own render of the export against this
 * project's render of the source, both reduced to loudness envelopes. */
function compareMixer(pcm, reference) {
  return compareEnvelopes(gmePcmEnvelope(pcm), renderedEnvelope(reference));
}

/** Proof #2 (the pass/fail gate): this project's own render of the write
 * stream GME's trace shows the export actually produced, against this
 * project's own render of the untouched source capture. Both go through
 * the identical 2A03 DSP, so what is left is the export's own loss alone. */
function compareExportLoss(replayed, original) {
  return compareEnvelopes(renderedEnvelope(replayed), renderedEnvelope(original));
}

/** The number of frames `exportNsf` actually encodes for a `cycles`-long
 * capture - `quantizeToFrames` (`nsf.ts`) 's own `frameCount`. The exported
 * player runs through frames `0 .. frameCount - 1` once and then wraps PLAY
 * back to `loopFrame` forever; a real-time frame index at or past this
 * point is playing looped content, not the tail of the one-shot pass, no
 * matter what source frame it lines up with after an offset. Kept in sync
 * with `nsf.ts` by the same formula, not imported, because this file has no
 * access to `quantizeToFrames` itself (only the exported bytes and traces
 * of them) - `packages/chipvoice/test/nsf.mjs` checks the two independently
 * against the same real export. */
function frameCountFor(cycles) {
  return Math.max(1, Math.ceil(cycles / PERIOD));
}

/** The new deterministic proof (round 2 item 2): buckets the source
 * capture's own register writes and GME's trace of the export by 60 Hz
 * frame (`Math.floor(at / PERIOD)`, this format's own replay granularity -
 * `quantizeToFrames`'s `Math.round` frame boundaries differ from `floor` by
 * at most half a cycle, never enough to move a write across a frame
 * boundary on this corpus) and requires the two sides' write lists
 * (address, value, order) to match exactly, frame by frame, after one
 * constant frame offset - the same kind of offset search `compareEnvelopes`
 * does, but on exact command content instead of loudness, so unlike proofs
 * #3 and #4 it says nothing about the mixer or the DSP and cannot be fooled
 * by one. This gates CI exactly (`matched === total`, `main`), not by count
 * or percentage: this project's own exported player replays whatever
 * `quantizeToFrames` bucketed the source into, one bucket per PLAY call,
 * byte for byte, so anything less than every comparable frame matching is a
 * real defect, not expected loss.
 *
 * "Comparable" excludes a source frame once its own real-time position
 * (`sourceFrame + offset`) reaches or passes `frameCountFor(cycles)`
 * (round 3 item 1): past that point the exported player has already
 * finished its one-shot pass and wrapped back to `loopFrame`, so GME's
 * trace there holds the *loop frame's* content, which has no reason to
 * equal a *different*, later source frame's content - that is not a defect
 * in the export, it is asking the wrong question of the trace. This can
 * only ever drop frames within `MAX_FRAME_OFFSET_SEARCH` of the very end of
 * the capture (the exclusion test is `sourceFrame + offset >=
 * frameCountFor(cycles)`, and `sourceFrame` itself never reaches
 * `frameCountFor(cycles)`), so it cannot hide a mismatch anywhere earlier in
 * a file, and `excludedFrames` is always reported alongside `total` so the
 * exclusion is visible, not silent.
 *
 * A source that genuinely bursts writes from more than one frame into a
 * single PLAY call (a burst of updates a few cycles apart, inside one frame
 * boundary - `quantizeToFrames`'s own doc comment) would show as one source
 * frame's writes appearing merged into a neighbouring frame here, reported
 * by frame number in `mismatchedFrames`, still failing the gate: this
 * corpus has no such source, but a future one would be caught, not
 * averaged away. */
// VRC6's ten registers (NEXT-14): included the same way as any 2A03
// register, so a VRC6-touching capture is held to the exact same
// frame-for-frame gate as this file's own 2A03 corpus, not a separate,
// looser one.
const isVrc6Reg = (addr) => (addr >= 0x9000 && addr <= 0x9003) || (addr >= 0xa000 && addr <= 0xa002) || (addr >= 0xb000 && addr <= 0xb002);

// Sunsoft 5B's two sound ports (NEXT-15): same reasoning as VRC6 above.
const isSunsoft5bReg = (addr) => (addr & 0xe000) === 0xc000 || (addr & 0xe000) === 0xe000;

function bucketWritesByFrame(events) {
  const buckets = new Map();
  for (const e of events) {
    const is2a03 = e.addr >= 0x4000 && e.addr <= 0x4017 && e.addr !== 0x4014 && e.addr !== 0x4016;
    if (!is2a03 && !isVrc6Reg(e.addr) && !isSunsoft5bReg(e.addr)) continue;
    const f = Math.floor(e.at / PERIOD);
    if (!buckets.has(f)) buckets.set(f, []);
    buckets.get(f).push({addr: e.addr, value: e.value});
  }
  return buckets;
}

function writeListsEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i].addr !== b[i].addr || a[i].value !== b[i].value) return false;
  return true;
}

function compareFrameWrites(sourceEvents, gmeEvents, cycles) {
  const source = bucketWritesByFrame(sourceEvents);
  const gme = bucketWritesByFrame(gmeEvents);
  const frameNumbers = [...source.keys()].sort((a, b) => a - b);
  const frameCount = frameCountFor(cycles);
  const comparableAt = offset => frameNumbers.filter(f => f + offset >= 0 && f + offset < frameCount);
  let best = {offset: 0, matched: -1, comparable: []};
  for (let offset = -MAX_FRAME_OFFSET_SEARCH; offset <= MAX_FRAME_OFFSET_SEARCH; offset++) {
    const comparable = comparableAt(offset);
    const matched = comparable.filter(f => writeListsEqual(source.get(f), gme.get(f + offset))).length;
    if (matched > best.matched || (matched === best.matched && comparable.length > best.comparable.length)) best = {offset, matched, comparable};
  }
  const mismatchedFrames = best.comparable.filter(f => !writeListsEqual(source.get(f), gme.get(f + best.offset)));
  return {total: best.comparable.length, matched: best.matched, offset: best.offset, mismatchedFrames, excludedFrames: frameNumbers.length - best.comparable.length};
}

function renderReference(events, seconds, memory = []) {
  const plan = {chip: '2a03', seconds, loopStartSeconds: 0, events, memory, notes: [], losses: []};
  return renderPerformance(plan, nesChip);
}

async function corpusSources() {
  const sources = [];
  for (const id of ['mario', 'zelda']) {
    const native = await loadNative(id);
    sources.push({
      id: `${id}-native`, title: `${id[0].toUpperCase()}${id.slice(1)} (native recording)`, url: null,
      events: native.events, cycles: Math.round(native.seconds * CPU_HZ), loopAtCycle: Math.round(native.loopStartSeconds * CPU_HZ), memory: native.memory,
    });
    try {
      const score = await loadArrangement(id);
      const plan = planPerformance(score, nesChip, {allowLoss: true});
      sources.push({
        id: `${id}-rendition`, title: `${id[0].toUpperCase()}${id.slice(1)} (this project's 2A03 rendition)`, url: null,
        events: plan.events, cycles: Math.round(plan.seconds * CPU_HZ), loopAtCycle: Math.round(plan.loopStartSeconds * CPU_HZ), memory: plan.memory,
      });
    } catch (error) {
      sources.push({id: `${id}-rendition`, title: `${id[0].toUpperCase()}${id.slice(1)} (this project's 2A03 rendition)`, url: null, planError: error.message});
    }
  }
  const nsfSources = JSON.parse(await readFile(path.join(ROOT, 'scores/nsf-corpus/sources.json'), 'utf8'));
  for (const [id, spec] of Object.entries(nsfSources)) {
    const bytes = await readFile(path.join(ROOT, 'scores/nsf-corpus/files', spec.file));
    const digest = sha256(bytes);
    if (digest !== spec.sha256) throw new Error(`${id}: does not match the committed SHA-256`);
    const capture = captureNsf(bytes, {frames: spec.frames ?? 300, track: spec.track ?? 0});
    sources.push({id, title: spec.title, url: spec.url, events: capture.events, cycles: capture.cycles, loopAtCycle: 0, memory: capture.memory ?? []});
  }
  return sources;
}

async function scoreSource(source) {
  if (source.planError) return {id: source.id, title: source.title, url: source.url, skipped: `this project's own driver could not render this arrangement for 2A03: ${source.planError}`};

  let file;
  try {
    file = exportNsf(source.events, source.cycles, {title: source.title.slice(0, 31), loopAtCycle: source.loopAtCycle, memory: source.memory});
  } catch (error) {
    if (!(error instanceof NsfExportError)) throw error;
    return {id: source.id, title: source.title, url: source.url, exportError: {code: error.code, message: error.message, measured: error.measured, limit: error.limit}};
  }

  const frames = Math.ceil(source.cycles / PERIOD) + 4;
  const ourReplay = captureNsf(file, {frames, track: 0});

  let comparison = null, exportLoss = null, mixerDiff = null, frameWrites = null;
  if (!noOracle) {
    await fs.promises.mkdir(WORK_DIR, {recursive: true});
    const nsfPath = path.join(WORK_DIR, `${source.id}.nsf`);
    await fs.promises.writeFile(nsfPath, file);
    const seconds = Math.min(600, Math.max(1, Math.ceil(source.cycles / CPU_HZ) + 1));
    const {trace, pcm} = await runOracle(nsfPath, seconds, 0);
    const gmeEvents = parseTrace(trace);
    comparison = compareNsfTrace(ourReplay, trace);
    // Proof #4 (new, deterministic, not audio-based): the source capture's
    // own writes against GME's trace of the export, bucketed by frame -
    // exact command content, not loudness (module comment).
    frameWrites = compareFrameWrites(source.events, gmeEvents, source.cycles);
    const original = renderReference(source.events, source.cycles / CPU_HZ, source.memory ?? []);
    // Proof #2: what GME actually played back from the export, rendered by
    // our own DSP, against our own render of the untouched source - both
    // sides identical except for what the export itself changed.
    const replayed = renderReference(gmeEvents, source.cycles / CPU_HZ, source.memory ?? []);
    exportLoss = compareExportLoss(replayed, original);
    // Proof #3 (informational): GME's own PCM of the export against our
    // render of the source - two independent emulators, not a same-DSP
    // measurement (module comment).
    mixerDiff = compareMixer(pcm, original);
  }
  return {id: source.id, title: source.title, url: source.url, bytes: file.length, comparison, exportLoss, mixerDiff, frameWrites};
}

/** Kept to a small, fixed set of shapes (translated verbatim in
 * docs/check-translations.py's `nsf-export` rule). */
function formatResult(r) {
  if (r.skipped) return {commands: 'not rendered', frameWrites: '-', loss: '-', mixer: '-', note: r.skipped};
  if (r.exportError) return {commands: `not exportable: ${r.exportError.code}`, frameWrites: '-', loss: '-', mixer: '-', note: r.exportError.message};
  if (!r.comparison) return {commands: `${r.bytes} bytes`, frameWrites: 'not compared', loss: 'not compared', mixer: 'not compared', note: 'none'};
  const divergence = r.comparison.firstDivergence
    ? (r.comparison.firstDivergence.ours && r.comparison.firstDivergence.gme
        ? `cycle ${r.comparison.firstDivergence.ours.at} vs ${r.comparison.firstDivergence.gme.at}, $${r.comparison.firstDivergence.ours.addr.toString(16)}: ${r.comparison.firstDivergence.ours.value} vs ${r.comparison.firstDivergence.gme.value}`
        : `cycle ${(r.comparison.firstDivergence.ours ?? r.comparison.firstDivergence.gme).at}: one side has no more commands`)
    : 'none';
  const lossText = `${(r.exportLoss.relativeRmsError * 100).toFixed(1)}%${r.exportLoss.relativeRmsError > EXPORT_LOSS_RMS_THRESHOLD ? ' (over threshold)' : ''}`;
  const mixerText = `GME's mixer differs from ours by ${(r.mixerDiff.relativeRmsError * 100).toFixed(1)}%`;
  const frameWritesText = `${r.frameWrites.matched}/${r.frameWrites.total} (offset ${r.frameWrites.offset >= 0 ? '+' : ''}${r.frameWrites.offset})` +
    (r.frameWrites.excludedFrames ? `, excluding ${r.frameWrites.excludedFrames} frame${r.frameWrites.excludedFrames === 1 ? '' : 's'} past the loop wrap` : '') +
    (r.frameWrites.mismatchedFrames.length ? `, frames ${r.frameWrites.mismatchedFrames.slice(0, 8).join(', ')}${r.frameWrites.mismatchedFrames.length > 8 ? ', ...' : ''} differ` : '');
  return {commands: `${r.comparison.matched}/${r.comparison.total}`, frameWrites: frameWritesText, loss: lossText, mixer: mixerText, note: divergence};
}

async function main() {
  const sources = await corpusSources();
  const results = [];
  for (const source of sources) {
    const result = await scoreSource(source);
    results.push(result);
    const formatted = formatResult(result);
    console.log(`${result.id}: ${formatted.commands}, frame writes ${formatted.frameWrites}, export loss ${formatted.loss}, ${formatted.mixer}, first divergence: ${formatted.note}`);
  }

  const jsonPath = option('json', null);
  if (jsonPath) {
    fs.mkdirSync(path.dirname(jsonPath), {recursive: true});
    fs.writeFileSync(jsonPath, JSON.stringify({date: new Date().toISOString().slice(0, 10), oracleRevision: ORACLE_REVISION, exportLossRmsThreshold: EXPORT_LOSS_RMS_THRESHOLD, results}, null, 2) + '\n');
  }

  const sheetPath = option('sheet', null);
  if (sheetPath) {
    const text = fs.readFileSync(sheetPath, 'utf8');
    const begin = text.indexOf('<!-- nsf-export:begin -->'), end = text.indexOf('<!-- nsf-export:end -->');
    if (begin < 0 || end < 0) throw new Error(`${sheetPath} has no nsf-export markers`);
    const lines = [
      '<!-- nsf-export:begin -->',
      `Written by \`nsf-export:sheet\` on ${new Date().toISOString().slice(0, 10)}, against Game_Music_Emu revision \`${ORACLE_REVISION}\`. Commands and frame writes both gate CI exactly (matched must equal total, not just be nonzero or "close"). Commands: the export, replayed by GME, against this project's own offline replay of the same export - identical bytes on both sides, so anything short of an exact match is a player bug. Frame writes: the source capture's own register writes against GME's trace of the export, bucketed into 60 Hz frames and compared for exact address/value/order equality after one constant frame offset (an expected, fixed PLAY-call latency - every NSF player's own INIT-to-first-PLAY overhead differs) - a deterministic command-content proof, not an audio measurement; a source frame stops counting once its own real-time slot passes the point where the exported player wraps back to its loop frame, reported as "excluding N frame(s) past the loop wrap" when that applies. Export loss: relative RMS error, after peak-normalizing and offset-aligning (searched, not assumed), between two same-DSP renders (GME's trace of the export, replayed; the untouched source) - the coarse secondary gate, threshold ${(EXPORT_LOSS_RMS_THRESHOLD * 100).toFixed(0)}%. GME mixer: the same metric between GME's own PCM of the export and this project's render of the source - two independent emulators, reported for visibility, not gated.`,
      '',
      '| Song | Commands | Frame writes | Export loss | GME mixer | First divergence |',
      '| --- | --- | --- | --- | --- | --- |',
      ...results.map(r => { const f = formatResult(r); const name = r.url ? `[${r.title}](${r.url})` : r.title; return `| ${name} | ${f.commands} | ${f.frameWrites} | ${f.loss} | ${f.mixer} | ${f.note} |`; }),
      '<!-- nsf-export:end -->',
    ];
    fs.writeFileSync(sheetPath, text.slice(0, begin) + lines.join('\n') + text.slice(end + '<!-- nsf-export:end -->'.length));
  }

  // Proofs #1 and #2 (module comment) are exact gates: both sides run
  // identical bytes (commands) or the same once-per-frame source
  // (frame writes, past the loop-wrap exclusion), so anything short of
  // `matched === total` is a real defect, not a matter of degree.
  const commandsBroken = results.filter(r => r.comparison && r.comparison.matched !== r.comparison.total);
  const frameWritesBroken = results.filter(r => r.frameWrites && r.frameWrites.matched !== r.frameWrites.total);
  // Proof #3, the coarse secondary gate (round 3 item 3): kept as a margin
  // check on top of the two exact proofs above, not a substitute for them.
  const overThreshold = results.filter(r => r.exportLoss && r.exportLoss.relativeRmsError > EXPORT_LOSS_RMS_THRESHOLD);
  if (commandsBroken.length) {
    console.error(`${commandsBroken.length} export(s) did not match GME's command stream exactly (both sides run identical bytes, so this is a player bug): ${commandsBroken.map(r => `${r.id} (${r.comparison.matched}/${r.comparison.total})`).join(', ')}`);
    process.exitCode = 1;
  }
  if (frameWritesBroken.length) {
    console.error(`${frameWritesBroken.length} export(s) did not match the source's own writes frame for frame (after excluding frames past the loop wrap): ${frameWritesBroken.map(r => `${r.id} (${r.frameWrites.matched}/${r.frameWrites.total}, frames ${r.frameWrites.mismatchedFrames.join(', ')} differ)`).join(', ')}`);
    process.exitCode = 1;
  }
  if (overThreshold.length) {
    console.error(`${overThreshold.length} export(s) exceeded the ${(EXPORT_LOSS_RMS_THRESHOLD * 100).toFixed(0)}% export-loss RMS threshold: ${overThreshold.map(r => r.id).join(', ')}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();

// Exported for `packages/chipvoice/test/nsf.mjs`'s own negative check (round
// 3 item 4): that gates CI on the same real export/replay pipeline this
// file uses, driven entirely through `captureNsf` (no GME, no network), so
// it can assert the exact-match gates above actually catch a corrupted
// write without paying for the oracle.
export {compareFrameWrites, frameCountFor};
