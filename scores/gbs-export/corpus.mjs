import fs from 'node:fs';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {exportGbs, GbsExportError, gbChip, importGbs, planPerformance, renderPerformance} from '../../packages/chipvoice/dist/index.js';
import {compareGbsTrace, parseTrace} from '../gbs-corpus/compare.mjs';
import {loadArrangement} from '../arrangements/check.mjs';

/**
 * The other direction from `gbs-corpus`: instead of checking that this
 * project reads a real GBS correctly, this checks that `exportGbs`'s own
 * output plays correctly - in the same pinned Game_Music_Emu oracle,
 * reusing its build (`../gbs-corpus/native-oracle-gbs.py`, same output
 * directory as `gbs-corpus:check`, so CI's cache step covers both).
 * Mirrors `nsf-export/corpus.mjs`'s method and its four proofs exactly,
 * adapted where the DMG genuinely differs from the 2A03.
 *
 * Four proofs, per file:
 *
 *   1. Command stream (gates CI, exact, value+order): the export, replayed
 *      by GME, must produce the exact same writes - address, value, in
 *      order - as `importGbs` (this project's own SM83, `chips/gb/cpu.ts`,
 *      the one #103/NEXT-06 validated) gets from replaying the very same
 *      export. Both sides execute identical bytes, so this is a player-
 *      correctness check, not a source-fidelity one (proof #2 is that).
 *
 *      Unlike NSF's proof #1, this does not additionally require the two
 *      sides to land on the exact same *cycle*. `scores/gbs-corpus/
 *      compare.mjs` already found, while proving NEXT-06/#103, that GME's
 *      own SM83 core (`Gb_Cpu.cpp`) charges a flat 4 T-cycles per
 *      instruction regardless of its real Pan-Docs length, so the gap
 *      between GME's timing and an accurate SM83's grows and resets across
 *      a run depending on which instructions executed, not a fixed offset -
 *      a genuine, already-accepted difference in timing model, not an export
 *      defect. `compareGbsTrace` (reused here unchanged) reports both
 *      `matched` (cycle-exact, informational, expected low for the same
 *      reason) and `valueMatched` (address+value+order only); this proof
 *      gates on `valueMatched === total`, applying that established finding
 *      from the start rather than gating on a timing claim GME's own CPU
 *      model cannot meet.
 *   2. Frame writes (gates CI, exact, tests fidelity to the source): the
 *      source capture's own register writes and GME's trace of the export,
 *      each bucketed into VBlank frames (`Math.floor(at / VBLANK_PERIOD)`),
 *      must list the exact same writes - address, value, order - frame for
 *      frame, after one constant frame offset (search, same shape as
 *      `nsf-export`'s) - `matched === total`, exactly. Not an audio
 *      measurement, so a mixer or an alignment choice cannot fool it.
 *
 *      A source frame is only counted while its own real-time position
 *      (`sourceFrame + offset`) still falls inside the export's one-shot
 *      pass through the content - strictly before `frameCountFor(cycles)`,
 *      the same frame count `quantizeToFrames` (`gbs.ts`) uses to decide
 *      when to wrap PLAY back to `loopFrame`. Past that point the exported
 *      player has already looped, so comparing against it is asking the
 *      wrong question, not finding a real defect - the same principled
 *      exclusion `nsf-export/corpus.mjs` documents, reported as
 *      `excludedFrames` rather than silently dropped.
 *   3. Export loss (the pass/fail audio gate): GME's own trace of playing
 *      the export, parsed back into register writes and rendered through
 *      this project's own `renderPerformance`, against a render of the
 *      *source* capture's untouched events through that same
 *      `renderPerformance`. Both sides go through the identical DMG DSP, so
 *      the only thing left to differ is what the export itself changed -
 *      the same once-per-frame timing-within-a-frame cost `nsf-export`
 *      measures (module comment there), not a dropped or wrong command
 *      (proofs #1 and #2 already rule that out). The threshold is set from
 *      the measured band on this corpus with a small margin, below.
 *   4. GME mixer comparison (informational, not a gate): GME's rendered PCM
 *      of the export against this project's own render of the source. Two
 *      independently written DMG APU emulators, so a sizeable residual is
 *      expected even for a perfect export; reported for visibility, never
 *      gating CI.
 *
 * The corpus draws on the same three kinds of content the ticket names,
 * adapted to what this project actually has for the DMG:
 *
 *   - This project's own driver's DMG rendition of the three published
 *     arrangements (`mario`, `zelda`, `sonic` - `scores/arrangements/
 *     check.mjs`'s own `arrangementChips` already includes `gbChip` for all
 *     three, unlike NSF's two).
 *   - Native GB hardware recordings: **none**. `scores/arrangements/
 *     native-sources.mjs` only carries `mario`/`zelda` (2A03) and `sonic`
 *     (Mega Drive) - no DMG entry exists in this repo, so this category is
 *     empty. Stated explicitly rather than silently omitted, matching the
 *     ticket's own conditional phrasing ("the native GB recordings if the
 *     repo has any").
 *   - The five independently authored, redistribution-licensed GBS files
 *     `gbs-corpus` already carries, captured once through our own
 *     `importGbs` (the same tool `gbs-corpus:check` scores against GME) to
 *     get a source capture, then re-exported.
 *
 *   node scores/gbs-export/corpus.mjs [--json out.json] [--sheet docs/chips/dmg.md]
 *   node scores/gbs-export/corpus.mjs --no-oracle   # skip GME entirely (no network, no C++ build)
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const ORACLE_DIR = path.join(ROOT, '.artifacts', 'gbs-corpus', 'gme-oracle'); // shared with gbs-corpus:check, one CI cache step covers both
const WORK_DIR = path.join(ROOT, '.artifacts', 'gbs-export');
const ORACLE_REVISION = 'fe8da4b6d3876d7542c2fb69d94487e19836d678';
const CPU_HZ = gbChip.spec.clockHz;
const VBLANK_PERIOD = 70224;
const REG_BASE = 0xff10, REG_LAST = 0xff3f; // same range `gbs.ts`'s own encoder keeps, gbs.ts:55-56

// The pass/fail gate (proof #3, module comment): both renders go through
// this project's own DMG DSP, so a residual here is the export's own timing
// loss alone, not a cross-emulator mixing-curve difference. Set from the
// measured band on this corpus with a small margin, the same way
// `nsf-export/corpus.mjs`'s own threshold was derived - see that file for
// the full account of why this kind of loss exists (a whole frame's writes
// land back to back at the very start of the exported player's PLAY call,
// where a source driver spreads them across its own longer routine).
const EXPORT_LOSS_RMS_THRESHOLD = 0.3;

const run = promisify(execFile);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const noOracle = args.includes('--no-oracle');

/** Builds (once) and runs the oracle on `gbsPath`, retrying the whole
 * build+render on failure - this Mac's network drops TCP connects
 * sometimes - and returns both its command trace and its PCM render.
 * Mirrors `nsf-export/corpus.mjs`'s own `runOracle` and `gbs-corpus/
 * corpus.mjs`'s `oracleTrace`. */
async function runOracle(gbsPath, seconds, track, attempts = 4) {
  await fs.promises.mkdir(ORACLE_DIR, {recursive: true});
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await run('python3', [path.join(ROOT, 'scores/gbs-corpus/native-oracle-gbs.py'), gbsPath, ORACLE_DIR, String(seconds), String(track)]);
      const trace = await readFile(path.join(ORACLE_DIR, 'gme-writes.txt'), 'utf8');
      const pcm = await readFile(path.join(ORACLE_DIR, 'gbs-gme.pcm'));
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
  throw new Error(`native-oracle-gbs.py failed after ${attempts} attempts: ${lastError.message}`);
}

/** Same reasoning as `nsf-export/corpus.mjs`'s own `frameEnvelope`: a
 * pulse/noise-heavy chip's raw samples are sample-hostile between two
 * independent emulators, so this compares per-VBlank-frame loudness
 * envelopes instead, each side peak-normalized first. */
function frameEnvelope(mono, sampleRate) {
  const frameSamples = Math.max(1, Math.round((sampleRate * VBLANK_PERIOD) / CPU_HZ));
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

/** `gme-render.cpp` calls `gme_ignore_silence(1)`, shared with `gbs-corpus`
 * (not this ticket's to change): GME skips a track's leading silence, where
 * this project's own render does not. Both sides are aligned on their own
 * first frame above a tiny fraction of their own peak instead of assumed to
 * start together - same as `nsf-export/corpus.mjs`. */
function firstSoundFrame(env, threshold = 0.01) {
  const peak = Math.max(1e-9, ...env);
  for (let i = 0; i < env.length; i++) if (env[i] / peak > threshold) return i;
  return 0;
}

/** Shared by both audio proofs: peak-normalize each side on its own, then
 * find the constant frame offset that lines them up best. Same shape and
 * same reasoning as `nsf-export/corpus.mjs`'s `compareEnvelopes` - every GBS
 * player's own INIT-to-first-PLAY overhead differs (this project's own
 * exported player's INIT is a handful of instructions; GME runs its own
 * reset ceremony first), so the two sides' first audible frame is routinely
 * one frame apart, a fixed latency, not a difference in content. */
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

/** GME's raw PCM (stereo s16le) as a `renderPerformance`-shaped envelope. */
function gmePcmEnvelope(pcm) {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const samples = pcm.length >> 2; // stereo s16le
  const left = new Float32Array(samples), right = new Float32Array(samples);
  for (let i = 0; i < samples; i++) { left[i] = view.getInt16(i * 4, true) / 32768; right[i] = view.getInt16(i * 4 + 2, true) / 32768; }
  return frameEnvelope(toMono(left, right, samples), 44100);
}

/** Proof #4 (informational): GME's own render of the export against this
 * project's render of the source, both reduced to loudness envelopes. */
function compareMixer(pcm, reference) {
  return compareEnvelopes(gmePcmEnvelope(pcm), renderedEnvelope(reference));
}

/** Proof #3 (the pass/fail gate): this project's own render of the write
 * stream GME's trace shows the export actually produced, against this
 * project's own render of the untouched source capture. */
function compareExportLoss(replayed, original) {
  return compareEnvelopes(renderedEnvelope(replayed), renderedEnvelope(original));
}

/** The number of frames `exportGbs` actually encodes for a `cycles`-long
 * capture - `quantizeToFrames` (`gbs.ts`)'s own `frameCount`. Kept in sync
 * with `gbs.ts` by the same formula, not imported, for the same reason
 * `nsf-export/corpus.mjs`'s `frameCountFor` gives: this file only has
 * access to the exported bytes and traces of them, not the internal
 * function - `packages/chipvoice/test/gbs.mjs` checks the two independently
 * against the same real export. */
function frameCountFor(cycles) {
  return Math.max(1, Math.ceil(cycles / VBLANK_PERIOD));
}

/** Proof #2 (gates CI, exact): buckets the source capture's own register
 * writes and GME's trace of the export by VBlank frame
 * (`Math.floor(at / VBLANK_PERIOD)`) and requires the two sides' write lists
 * (address, value, order) to match exactly, frame by frame, after one
 * constant frame offset - the same search `compareEnvelopes` does, but on
 * exact command content instead of loudness, so this says nothing about the
 * DSP and cannot be fooled by it. Gates on `matched === total`, not by count
 * or percentage - this project's own exported player replays whatever
 * `quantizeToFrames` bucketed the source into, one bucket per PLAY call,
 * byte for byte, so anything less than every comparable frame matching is a
 * real defect.
 *
 * "Comparable" excludes a source frame once its own real-time position
 * (`sourceFrame + offset`) reaches or passes `frameCountFor(cycles)`: past
 * that point the exported player has already finished its one-shot pass and
 * wrapped back to `loopFrame`, so GME's trace there holds the *loop frame's*
 * content, which has no reason to equal a *different*, later source frame's
 * content - not a defect in the export, asking the wrong question of the
 * trace. This can only ever drop frames within `MAX_FRAME_OFFSET_SEARCH` of
 * the very end of the capture, and `excludedFrames` is always reported
 * alongside `total` so the exclusion is visible, never silent - the exact
 * same principled shape `nsf-export/corpus.mjs`'s `compareFrameWrites` uses. */
function bucketWritesByFrame(events) {
  const buckets = new Map();
  for (const e of events) {
    if (e.addr < REG_BASE || e.addr > REG_LAST) continue;
    const f = Math.floor(e.at / VBLANK_PERIOD);
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

/** Substantiates proof #3's export-loss number (PR review, point 1) instead
 * of leaving it as a bare percentage: how far into its own VBlank frame the
 * *source* capture's own writes actually land, in cycles and as a percent of
 * a full frame. `quantizeToFrames` (`gbs.ts`) can only ever place a whole
 * frame's writes at that frame's own start - so this offset *is* what export
 * loss measures the cost of throwing away. A driver whose own writes already
 * sit near their frame's start (every real GBS driver in this corpus, all
 * VBlank/timer-interrupt driven) loses little; a source that times writes at
 * their real, continuous cycle across the whole frame - this project's own
 * `planPerformance` output for `mario`/`zelda`/`sonic`, which is not itself a
 * VBlank-quantized GBS driver - loses more, because more of that timing is
 * real content the quantization discards. Filtered to the same `REG_BASE
 * ..REG_LAST` range `quantizeToFrames` itself keeps, so a write this function
 * never even considers can't skew the average either. */
function sourceWriteTiming(events) {
  let count = 0, sumCycles = 0, maxCycles = 0;
  for (const e of events) {
    if (e.addr < REG_BASE || e.addr > REG_LAST) continue;
    const offset = e.at - Math.floor(e.at / VBLANK_PERIOD) * VBLANK_PERIOD;
    count++; sumCycles += offset; if (offset > maxCycles) maxCycles = offset;
  }
  if (!count) return null;
  const meanCycles = sumCycles / count;
  return {count, meanCycles, maxCycles, meanPct: (meanCycles / VBLANK_PERIOD) * 100, maxPct: (maxCycles / VBLANK_PERIOD) * 100};
}

/** Replaces proof #1's raw `firstDivergence` pair in the sheet (PR review,
 * point 3): that pair is always the very first post-INIT (first PLAY-call)
 * write, because `compareGbsTrace`'s own cycle-exact shift only ever applies
 * to the INIT phase (`gbs-corpus/compare.mjs`'s module comment) - so it
 * reads as a fresh failure on every row even though every proof passes, and
 * says nothing about how far GME's own flat-4-T-cycle-per-instruction SM83
 * model (the same module comment) actually drifts from an accurate SM83
 * over a whole run.
 *
 * This reports a bounded number instead: `ours`/`theirs` already agree on
 * every address and value, in order, for the whole run (proof #1 gates
 * `valueMatched === total`), so once both sides' first PLAY-phase write is
 * used as a fixed anchor (the same write `compareGbsTrace`'s own
 * `initPhaseCount` names), every later pair's `at` can be compared directly.
 * The `anchor` gap itself is the same, already-understood, fixed INIT/reset-
 * ceremony offset `compareGbsTrace`'s own `shift` captures; `maxDrift`/
 * `meanDrift` are what is left after that fixed offset is factored out - the
 * part GME's own timing model actually contributes, in T-cycles. */
function playPhaseCycleDrift(oursEvents, gmeTraceText) {
  const ours = oursEvents.filter(e => e.at !== 0);
  const theirs = parseTrace(gmeTraceText).filter(e => e.at !== 0);
  const initPhaseCount = ours.filter(e => e.at < VBLANK_PERIOD).length;
  if (initPhaseCount >= ours.length || initPhaseCount >= theirs.length) return null;
  const anchor = theirs[initPhaseCount].at - ours[initPhaseCount].at;
  const total = Math.min(ours.length, theirs.length);
  let maxDrift = 0, sumDrift = 0, samples = 0;
  for (let i = initPhaseCount; i < total; i++) {
    const drift = Math.abs((theirs[i].at - ours[i].at) - anchor);
    if (drift > maxDrift) maxDrift = drift;
    sumDrift += drift; samples++;
  }
  return {anchor, maxDrift, meanDrift: samples ? sumDrift / samples : 0, samples};
}

function renderReference(events, seconds) {
  const plan = {chip: 'dmg', seconds, loopStartSeconds: 0, events, memory: [], notes: [], losses: []};
  return renderPerformance(plan, gbChip);
}

async function corpusSources() {
  const sources = [];
  // This project's own DMG rendition of the three published arrangements -
  // no native GB hardware recordings exist in this repo (module comment).
  for (const id of ['mario', 'zelda', 'sonic']) {
    try {
      const score = await loadArrangement(id);
      const plan = planPerformance(score, gbChip, {allowLoss: true});
      sources.push({
        id: `${id}-rendition`, title: `${id[0].toUpperCase()}${id.slice(1)} (this project's DMG rendition)`, url: null,
        events: plan.events, cycles: Math.round(plan.seconds * CPU_HZ), loopAtCycle: Math.round(plan.loopStartSeconds * CPU_HZ),
      });
    } catch (error) {
      sources.push({id: `${id}-rendition`, title: `${id[0].toUpperCase()}${id.slice(1)} (this project's DMG rendition)`, url: null, planError: error.message});
    }
  }
  // The gbs-corpus's own five independently authored files, captured once
  // through our own `importGbs` (no GME involved in the capture itself),
  // then re-exported below.
  const gbsSources = JSON.parse(await readFile(path.join(ROOT, 'scores/gbs-corpus/sources.json'), 'utf8'));
  for (const [id, spec] of Object.entries(gbsSources)) {
    const bytes = await readFile(path.join(ROOT, 'scores/gbs-corpus/files', spec.file));
    const digest = sha256(bytes);
    if (digest !== spec.sha256) throw new Error(`${id}: does not match the committed SHA-256`);
    const seconds = spec.seconds ?? 60;
    const plan = importGbs(bytes, {track: spec.track, seconds});
    sources.push({id, title: spec.title, url: spec.url, events: plan.events, cycles: Math.round(plan.seconds * CPU_HZ), loopAtCycle: 0});
  }
  return sources;
}

async function scoreSource(source) {
  if (source.planError) return {id: source.id, title: source.title, url: source.url, skipped: `this project's own driver could not render this arrangement for DMG: ${source.planError}`};

  let file;
  try {
    file = exportGbs(source.events, source.cycles, {title: source.title.slice(0, 31), loopAtCycle: source.loopAtCycle});
  } catch (error) {
    if (!(error instanceof GbsExportError)) throw error;
    return {id: source.id, title: source.title, url: source.url, exportError: {code: error.code, message: error.message, measured: error.measured, limit: error.limit}};
  }

  const seconds = Math.min(600, Math.max(1, Math.ceil(source.cycles / CPU_HZ) + 1));
  // Proof #1's "our own SM83" side: `importGbs` replaying the export we just
  // produced is literally this project's own SM83 (`chips/gb/cpu.ts`)
  // running the exported bytes - no separate offline tool needed the way
  // NSF's `capture-nsf.mjs` is, because the export *is* a GBS file and
  // `importGbs` already plays any GBS file this project reads.
  const ourReplay = importGbs(file, {seconds});

  // PR review, point 1: what export loss (proof #3) actually spends -
  // computed from the source capture alone, so it does not depend on the
  // oracle and is reported even under `--no-oracle`.
  const sourceTiming = sourceWriteTiming(source.events);

  let comparison = null, exportLoss = null, mixerDiff = null, frameWrites = null, cycleDrift = null;
  if (!noOracle) {
    await fs.promises.mkdir(WORK_DIR, {recursive: true});
    const gbsPath = path.join(WORK_DIR, `${source.id}.gbs`);
    await fs.promises.writeFile(gbsPath, file);
    const {trace, pcm} = await runOracle(gbsPath, seconds, 0); // our exports always have exactly one song; GME's tracks are zero-based
    const gmeEvents = parseTrace(trace);
    // Proof #1 (module comment): value+order, not cycle-exact - see the
    // module comment for why, citing gbs-corpus/compare.mjs's own finding.
    comparison = compareGbsTrace(ourReplay, VBLANK_PERIOD, trace);
    // PR review, point 3: the bounded, post-INIT drift number that replaces
    // the raw `firstDivergence` pair in the sheet.
    cycleDrift = playPhaseCycleDrift(ourReplay.events, trace);
    // Proof #2: the source capture's own writes against GME's trace of the
    // export, bucketed by frame - exact command content, not loudness.
    frameWrites = compareFrameWrites(source.events, gmeEvents, source.cycles);
    const original = renderReference(source.events, source.cycles / CPU_HZ);
    // Proof #3: what GME actually played back from the export, rendered by
    // our own DSP, against our own render of the untouched source.
    const replayed = renderReference(gmeEvents, source.cycles / CPU_HZ);
    exportLoss = compareExportLoss(replayed, original);
    // Proof #4 (informational): GME's own PCM of the export against our
    // render of the source.
    mixerDiff = compareMixer(pcm, original);
  }
  return {id: source.id, title: source.title, url: source.url, bytes: file.length, comparison, exportLoss, mixerDiff, frameWrites, sourceTiming, cycleDrift};
}

/** Kept to a small, fixed set of shapes (translated verbatim in
 * docs/check-translations.py's `gbs-export` rule). */
function formatResult(r) {
  if (r.skipped) return {commands: 'not rendered', frameWrites: '-', loss: '-', mixer: '-', timing: '-', note: r.skipped};
  if (r.exportError) return {commands: `not exportable: ${r.exportError.code}`, frameWrites: '-', loss: '-', mixer: '-', timing: '-', note: r.exportError.message};
  const timingText = r.sourceTiming ? `mean ${r.sourceTiming.meanPct.toFixed(1)}%, max ${r.sourceTiming.maxPct.toFixed(1)}%` : '-';
  if (!r.comparison) return {commands: `${r.bytes} bytes`, frameWrites: 'not compared', loss: 'not compared', mixer: 'not compared', timing: timingText, note: 'not compared'};
  // PR review, point 3: a bounded post-INIT drift figure (module comment on
  // `playPhaseCycleDrift`), not the raw first-mismatch pair every row used to
  // show - that pair is always the first post-INIT write and reads as a
  // fresh failure on every row even though every proof passes.
  const driftText = r.cycleDrift ? `max ${Math.round(r.cycleDrift.maxDrift)}c, mean ${r.cycleDrift.meanDrift.toFixed(1)}c from the first PLAY write (n=${r.cycleDrift.samples})` : 'none';
  const lossText = `${(r.exportLoss.relativeRmsError * 100).toFixed(1)}%${r.exportLoss.relativeRmsError > EXPORT_LOSS_RMS_THRESHOLD ? ' (over threshold)' : ''}`;
  const mixerText = `GME's mixer differs from ours by ${(r.mixerDiff.relativeRmsError * 100).toFixed(1)}%`;
  const frameWritesText = `${r.frameWrites.matched}/${r.frameWrites.total} (offset ${r.frameWrites.offset >= 0 ? '+' : ''}${r.frameWrites.offset})` +
    (r.frameWrites.excludedFrames ? `, excluding ${r.frameWrites.excludedFrames} frame${r.frameWrites.excludedFrames === 1 ? '' : 's'} past the loop wrap` : '') +
    (r.frameWrites.mismatchedFrames.length ? `, frames ${r.frameWrites.mismatchedFrames.slice(0, 8).join(', ')}${r.frameWrites.mismatchedFrames.length > 8 ? ', ...' : ''} differ` : '');
  return {commands: `${r.comparison.valueMatched}/${r.comparison.total} (${r.comparison.matched}/${r.comparison.total} cycle-exact)`, frameWrites: frameWritesText, loss: lossText, mixer: mixerText, timing: timingText, note: driftText};
}

async function main() {
  const sources = await corpusSources();
  const results = [];
  for (const source of sources) {
    const result = await scoreSource(source);
    results.push(result);
    const formatted = formatResult(result);
    console.log(`${result.id}: ${formatted.commands}, frame writes ${formatted.frameWrites}, export loss ${formatted.loss}, ${formatted.mixer}, source write timing ${formatted.timing}, cycle drift (informational): ${formatted.note}`);
  }

  const jsonPath = option('json', null);
  if (jsonPath) {
    fs.mkdirSync(path.dirname(jsonPath), {recursive: true});
    fs.writeFileSync(jsonPath, JSON.stringify({date: new Date().toISOString().slice(0, 10), oracleRevision: ORACLE_REVISION, exportLossRmsThreshold: EXPORT_LOSS_RMS_THRESHOLD, results}, null, 2) + '\n');
  }

  const sheetPath = option('sheet', null);
  if (sheetPath) {
    const text = fs.readFileSync(sheetPath, 'utf8');
    const begin = text.indexOf('<!-- gbs-export:begin -->'), end = text.indexOf('<!-- gbs-export:end -->');
    if (begin < 0 || end < 0) throw new Error(`${sheetPath} has no gbs-export markers`);
    const lines = [
      '<!-- gbs-export:begin -->',
      `Written by \`gbs-export:sheet\` on ${new Date().toISOString().slice(0, 10)}, against Game_Music_Emu revision \`${ORACLE_REVISION}\`. Frame writes gates CI exactly (matched must equal total, not just be nonzero or "close"); commands gates on value+order (address and value, in order - see the module comment for why not cycle-exact, citing gbs-corpus/compare.mjs's own finding about GME's SM83 timing model). Commands: the export, replayed by GME, against this project's own SM83 (\`importGbs\`) replaying the same export - identical bytes on both sides. Frame writes: the source capture's own register writes against GME's trace of the export, bucketed into VBlank frames and compared for exact address/value/order equality after one constant frame offset (an expected, fixed PLAY-call latency); a source frame stops counting once its own real-time slot passes the point where the exported player wraps back to its loop frame, reported as "excluding N frame(s) past the loop wrap" when that applies. Export loss: relative RMS error, after peak-normalizing and offset-aligning (searched, not assumed), between two same-DSP renders (GME's trace of the export, replayed; the untouched source) - the coarse secondary gate, threshold ${(EXPORT_LOSS_RMS_THRESHOLD * 100).toFixed(0)}%. GME mixer: the same metric between GME's own PCM of the export and this project's render of the source - two independent emulators, reported for visibility, not gated. Source write timing: how far into its own VBlank frame the source capture's own writes land on average and at most, as a percent of a frame - what export loss spends, since a whole frame's writes can only ever be replayed at that frame's own start. First cycle divergence: informational, not gated - the largest and mean T-cycle drift between the export replayed by GME and by this project's own SM83, once both sides' first post-INIT write is used as a fixed anchor (GME's own flat-4-T-cycle-per-instruction SM83 model, module comment, not an export defect).`,
      '',
      '| Song | Commands (value+order, cycle-exact) | Frame writes | Export loss | GME mixer | Source write timing (mean/max % of frame) | First cycle divergence (informational) |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      ...results.map(r => { const f = formatResult(r); const name = r.url ? `[${r.title}](${r.url})` : r.title; return `| ${name} | ${f.commands} | ${f.frameWrites} | ${f.loss} | ${f.mixer} | ${f.timing} | ${f.note} |`; }),
      '<!-- gbs-export:end -->',
    ];
    fs.writeFileSync(sheetPath, text.slice(0, begin) + lines.join('\n') + text.slice(end + '<!-- gbs-export:end -->'.length));
  }

  // Proofs #1 and #2 (module comment) are exact gates.
  const commandsBroken = results.filter(r => r.comparison && r.comparison.valueMatched !== r.comparison.total);
  const frameWritesBroken = results.filter(r => r.frameWrites && r.frameWrites.matched !== r.frameWrites.total);
  // Proof #3, the coarse secondary gate: kept as a margin check on top of
  // the two exact proofs above, not a substitute for them.
  const overThreshold = results.filter(r => r.exportLoss && r.exportLoss.relativeRmsError > EXPORT_LOSS_RMS_THRESHOLD);
  if (commandsBroken.length) {
    console.error(`${commandsBroken.length} export(s) did not match GME's command stream exactly on value+order (both sides run identical bytes, so this is a player bug): ${commandsBroken.map(r => `${r.id} (${r.comparison.valueMatched}/${r.comparison.total})`).join(', ')}`);
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

// Exported for `packages/chipvoice/test/gbs.mjs`'s own negative check: that
// gates CI on the same real export/replay pipeline this file uses, driven
// entirely through `importGbs` (no GME, no network), so it can assert the
// exact-match gates above actually catch a corrupted write without paying
// for the oracle.
export {compareFrameWrites, frameCountFor};
