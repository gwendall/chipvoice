import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildScript, CPU_HZ, NTSC_FRAME } from './script.mjs';
import { readWav } from './wav.mjs';
import { magnitudeSpectrum, thirdOctaveBands, bandLevel, dB, nextPow2 } from './fft.mjs';
import { renderScript } from './render.mjs';

/**
 * `bench:nes:compare <capture.wav>`: takes a real (or synthetic) capture of
 * this bench's own script, and measures the analog stage against it -
 * CONFORMANCE.md's "analog stage protocol", steps 3-5.
 *
 *   node src/bench/compare.mjs <capture.wav> [--rom <file>] [--json <file>]
 *     [--sheet <file>] [--search-window <seconds>]
 *
 * What it does, in order:
 *  1. Finds the two sync markers (three up/down `$4011` edges, two frames
 *     apart, once near the start and once near the end) by their transient
 *     energy - a shape no tone or noise segment produces, so cross-checking
 *     against the script's other content is not needed to tell them apart.
 *  2. From the two markers' measured separation against the script's own
 *     (nominal) separation, fits one affine map from script cycles to
 *     capture samples - the recording's unknown start latency and its
 *     clock's small offset from 1.789773 MHz, folded into one offset and
 *     one scale.
 *  3. Extracts each tone and noise segment from the capture with that map,
 *     and from two renders of the same script: the shipping `nesdev`
 *     profile (what the sheet's tolerance is judged against) and a
 *     profile-free render (the DAC curve alone, what a unit's own filters
 *     are judged against, since the shipping profile is itself a guess at
 *     them).
 *  4. Reports the per-third-octave-band error against the profile render
 *     (CONFORMANCE.md's number, tolerance 1 dB from 40 Hz-15 kHz for a
 *     first-order stage), after solving for the one overall level offset a
 *     line-out capture can't be free of; and fits the profile-free ratio to
 *     two high-pass corners and one low-pass corner, the shape `nesdev`
 *     itself is - not by assuming that shape is right, but by finding
 *     whichever version of it the capture actually shows.
 */
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOLERANCE_DB = 1; // CONFORMANCE.md: first-order stages, 40 Hz-15 kHz
const SYNC_EDGES = 6; // three up/down pairs
const SYNC_GAP_S = (2 * NTSC_FRAME) / CPU_HZ; // frames between edges, in the idealised script model

// ---------------------------------------------------------------- sync ----

function movingAverage(x, win) {
  const out = new Float64Array(x.length);
  let sum = 0;
  for (let i = 0; i < x.length; i++) {
    sum += x[i];
    if (i >= win) sum -= x[i - win];
    out[i] = sum / Math.min(i + 1, win);
  }
  return out;
}

/**
 * Finds the sync marker's six edges within `samples[from, to)`, by the
 * energy of the sample-to-sample difference: a fast edge shows up as a
 * spike no matter what the (unknown) filtering ahead of it did to its
 * shape, since none of this bench's filters are slow enough to erase a
 * step entirely in under a millisecond. Returns the first edge's sample
 * index, or null if six evenly-spaced spikes were not found.
 */
export function findSyncMarker(samples, sampleRate, from, to) {
  from = Math.max(1, Math.floor(from));
  to = Math.min(samples.length, Math.ceil(to));
  if (to - from < 8) return null;

  const win = Math.max(1, Math.round(sampleRate * 0.0008));
  const raw = new Float64Array(to - from);
  for (let i = from; i < to; i++) {
    const d = samples[i] - samples[i - 1];
    raw[i - from] = d * d;
  }
  const env = movingAverage(raw, win);

  const sorted = Float64Array.from(env).sort();
  const median = sorted[Math.floor(sorted.length / 2)] || 0;
  const threshold = Math.max(median * 12, 1e-10);
  const expectedGap = SYNC_GAP_S * sampleRate;

  // A candidate is not just a local maximum, but an ISOLATED one: the
  // marker's edges sit in the silence the script puts either side of them,
  // so the energy a gap's width away, apart from the peak itself, should
  // be near the floor. A tone or a noise segment is loud continuously, not
  // in six pulses, so this is what tells a real edge from a coincidental
  // sequence of loud moments inside one - which the spacing test alone
  // cannot, since a continuously busy signal has a local maximum every few
  // samples, near enough to any target position to satisfy it by accident.
  const guard = win;
  const span = Math.round(expectedGap * 0.6);
  function prominence(i) {
    const lo = Math.max(0, i - span);
    const hi = Math.min(env.length, i + span);
    const around = [];
    for (let j = lo; j < hi; j += 4) if (Math.abs(j - i) > guard) around.push(env[j]);
    around.sort((a, b) => a - b);
    const floor = around.length ? around[Math.floor(around.length / 2)] : 0;
    return floor > 1e-12 ? env[i] / floor : Infinity;
  }

  const peaks = [];
  for (let i = 1; i < env.length - 1; i++) {
    if (env[i] > threshold && env[i] >= env[i - 1] && env[i] > env[i + 1]) {
      if (peaks.length === 0 || i - peaks[peaks.length - 1] > win) peaks.push(i);
    }
  }
  const candidates = peaks.filter((i) => prominence(i) > 25);

  // Several chains of six roughly-evenly-spaced peaks can still coincide by
  // chance, so among every chain that fits the spacing, the one whose
  // weakest edge is strongest wins - not the first one found. But a tone
  // can ALSO chain: a square wave has two edges a period apart, and every
  // few periods can land close enough to `expectedGap` to fit six of them.
  // What gives a tone-built chain away is what sits at each gap's own
  // midpoint: the marker has nothing there but silence, while a tone always
  // has its OTHER edge there too - the one the chain skipped over to make
  // the spacing fit - since a period divides an integer number of times
  // into the gap the chain is built from. A chain with a strong candidate
  // near any of its five midpoints is an aliased tone, not the marker.
  function hasMidpointIntruder(chain) {
    const band = expectedGap * 0.2;
    for (let k = 0; k + 1 < chain.length; k++) {
      const mid = (chain[k] + chain[k + 1]) / 2;
      for (const c of candidates) {
        if (c === chain[k] || c === chain[k + 1]) continue;
        if (Math.abs(c - mid) < band) return true;
      }
    }
    return false;
  }

  const tol = 0.3; // clock drift and recording latency, generously
  let bestChain = null;
  let bestScore = -Infinity;
  for (const start of candidates) {
    const chain = [start];
    for (let k = 1; k < SYNC_EDGES; k++) {
      const wantAt = chain[chain.length - 1] + expectedGap;
      let best = null;
      let bestDiff = expectedGap * tol;
      for (const c of candidates) {
        const diff = Math.abs(c - wantAt);
        if (diff < bestDiff) {
          best = c;
          bestDiff = diff;
        }
      }
      if (best === null) break;
      chain.push(best);
    }
    if (chain.length === SYNC_EDGES && !hasMidpointIntruder(chain)) {
      const score = Math.min(...chain.map((c) => env[c]));
      if (score > bestScore) {
        bestScore = score;
        bestChain = chain;
      }
    }
  }
  return bestChain ? bestChain[0] + from : null;
}

/**
 * One affine map, script cycles to capture samples, from where the two
 * markers' first edges actually landed: `sample = t0 + (cycle - anchor) *
 * scale`. `scale` carries both the capture's true sample rate (if its
 * header lied) and the unit's own clock offset from 1.789773 MHz - the
 * bench cannot tell those apart, and does not need to, since both affect a
 * spectral comparison the same way.
 */
export function fitDrift(startSample, endSample, script, sampleRate) {
  const start = script.segments.find((s) => s.id === 'sync-start');
  const end = script.segments.find((s) => s.id === 'sync-end');
  const cycles = end.startCycle - start.startCycle;
  const samples = endSample - startSample;
  const scale = samples / cycles; // samples per script cycle
  const nominalScale = sampleRate / CPU_HZ; // samples per cycle, if the clock were exact
  return {
    anchorCycle: start.startCycle,
    t0: startSample,
    scale,
    // A clock running `ppm` parts per million fast packs the same number of
    // real cycles into less real time, so fewer of the recording's own
    // samples land between the two markers: `scale` (samples measured per
    // nominal cycle) is `nominalScale / (1 + ppm/1e6)`, not the other way
    // around, hence the reciprocal here rather than a plain ratio.
    ppm: (nominalScale / scale - 1) * 1e6, // ~0 when the recording's clock matches 1.789773 MHz exactly
  };
}

function toSample(drift, cycle) {
  return drift.t0 + (cycle - drift.anchorCycle) * drift.scale;
}

// ------------------------------------------------------------- filters ----

/** The exact magnitude response of `dsp-lite.mjs`'s `OnePoleHighPass`, in dB. */
function hpMagDb(fHz, fcHz, fs) {
  const w = (2 * Math.PI * fHz) / fs;
  const c = Math.exp((-2 * Math.PI * fcHz) / fs);
  const num = 2 * c * Math.sin(w / 2);
  const den = Math.sqrt(1 - 2 * c * Math.cos(w) + c * c);
  return dB(den > 0 ? num / den : 0);
}

/** The exact magnitude response of `dsp-lite.mjs`'s `OnePoleLowPass`, in dB. */
function lpMagDb(fHz, fcHz, fs) {
  const w = (2 * Math.PI * fHz) / fs;
  const c = 1 - Math.exp((-2 * Math.PI * fcHz) / fs);
  const num = c;
  const den = Math.sqrt(1 - 2 * (1 - c) * Math.cos(w) + (1 - c) * (1 - c));
  return dB(den > 0 ? num / den : 0);
}

function stageMagDb(fHz, hp1, hp2, lp, fs) {
  return hpMagDb(fHz, hp1, fs) + hpMagDb(fHz, hp2, fs) + lpMagDb(fHz, lp, fs);
}

/**
 * Fits (hp1, hp2, lp) to `points` ({freq, measuredDb}, the capture's level
 * relative to the profile-free render's, at each tone), by coordinate
 * descent with a shrinking step - the same shape `src/fit-c64.mjs` uses for
 * its own six-parameter fit, since both are "start near, walk downhill on
 * each number in turn". The overall level offset a capture can't avoid is
 * solved in closed form at every trial point instead of searched, since for
 * a fixed (hp1, hp2, lp) it is just the mean residual.
 */
export function fitCorners(points, sampleRate, initial = { hp1: 90, hp2: 440, lp: 14000 }) {
  const bounds = { hp1: [10, 1000], hp2: [20, 3000], lp: [2000, 20000] };

  function residuals(model) {
    const predicted = points.map((p) => stageMagDb(p.freq, model.hp1, model.hp2, model.lp, sampleRate));
    const gainDb = points.reduce((sum, p, i) => sum + (p.measuredDb - predicted[i]), 0) / points.length;
    let sse = 0;
    for (let i = 0; i < points.length; i++) {
      const e = points[i].measuredDb - predicted[i] - gainDb;
      sse += e * e;
    }
    return { sse, gainDb };
  }

  let model = { ...initial };
  let best = residuals(model).sse;
  for (let step = 40; step > 0.05; step /= 2) {
    let improved = true;
    while (improved) {
      improved = false;
      for (const key of ['hp1', 'hp2', 'lp']) {
        for (const delta of [step, -step]) {
          const [lo, hi] = bounds[key];
          const candidate = { ...model, [key]: Math.max(lo, Math.min(hi, model[key] + delta)) };
          if (candidate.hp1 >= candidate.hp2) continue; // keep the two high-passes ordered
          const sse = residuals(candidate).sse;
          if (sse < best) {
            best = sse;
            model = candidate;
            improved = true;
          }
        }
      }
    }
  }
  const { gainDb } = residuals(model);
  return { ...model, gainDb, rmsDb: Math.sqrt(best / points.length) };
}

/**
 * A best-effort, secondary corner estimate straight from the step segment's
 * decay, for a sanity cross-check against the spectral fit - not the fit
 * itself, since one step cannot cleanly separate two cascaded high-pass
 * time constants the way eighteen tones spread across the band can. Returns
 * the corner a single first-order decay fitted to the fast part of the edge
 * would have.
 */
export function estimateStepCorner(samples, sampleRate, edgeSample) {
  const settle = Math.round(sampleRate * 0.0005);
  const winLen = Math.round(sampleRate * 0.01);
  const start = edgeSample + settle;
  const end = Math.min(samples.length, start + winLen);
  if (end - start < 8) return null;
  const baseline = samples[end - 1];
  const xs = [];
  const ys = [];
  for (let i = start; i < end; i++) {
    const v = Math.abs(samples[i] - baseline);
    if (v > 1e-6) {
      xs.push((i - start) / sampleRate);
      ys.push(Math.log(v));
    }
  }
  if (xs.length < 4) return null;
  const n = xs.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  const b = den > 0 ? num / den : 0;
  if (b >= 0) return null;
  const tau = -1 / b;
  return 1 / (2 * Math.PI * tau);
}

// ------------------------------------------------------------ analysis ----

function segmentWindow(sampleRate, startCycle, endCycle, trimStartS, trimEndS) {
  return {
    start: Math.round((startCycle / CPU_HZ + trimStartS) * sampleRate),
    end: Math.round((endCycle / CPU_HZ - trimEndS) * sampleRate),
  };
}

function segmentLevelDb(samples, sampleRate, window, band) {
  const len = window.end - window.start;
  if (len < 32) return null;
  const size = nextPow2(len);
  const { mag, binHz } = magnitudeSpectrum(samples, window.start, size, sampleRate);
  return dB(bandLevel(mag, binHz, band.lo, band.hi));
}

/**
 * The full analysis, importable so the CI self-test can run it directly on
 * in-memory synthetic captures without going through a file or a subprocess.
 *
 * `capture` is `{ samples, sampleRate }` (a mono, [-1, 1] float capture, as
 * `wav.mjs`'s `readWav` returns it). `romPath` defaults to the committed
 * bench ROM; passing the script's own build lets the self-test skip the
 * 6502 run entirely when it already has one.
 */
export function analyzeCapture(capture, { romPath = path.join(ROOT, 'roms', 'bench', 'nes-analog-script.nes'), reference = null, searchWindowS = 5 } = {}) {
  const script = buildScript();
  const ref = reference ?? renderScript(romPath, capture.sampleRate);
  const { profile, flat, sampleRate: refRate } = ref;

  const syncStart = script.segments.find((s) => s.id === 'sync-start');
  const syncEnd = script.segments.find((s) => s.id === 'sync-end');
  const totalSeconds = (script.totalFrames * NTSC_FRAME) / CPU_HZ;

  const startSearch = [0, (syncStart.endCycle / CPU_HZ + searchWindowS) * capture.sampleRate];
  const startEdge = findSyncMarker(capture.samples, capture.sampleRate, startSearch[0], startSearch[1]);
  if (startEdge === null) throw new Error('could not find the start sync marker - is this a capture of the bench script, at 96 kHz?');

  const endSearchFrom = Math.max(0, capture.samples.length - (totalSeconds - syncEnd.startCycle / CPU_HZ + searchWindowS * 2) * capture.sampleRate);
  const endEdge = findSyncMarker(capture.samples, capture.sampleRate, endSearchFrom, capture.samples.length);
  if (endEdge === null) throw new Error('could not find the end sync marker - the capture may have been cut short');

  const drift = fitDrift(startEdge, endEdge, script, capture.sampleRate);

  // Tones: one third-octave-wide band centred on the tone's own frequency,
  // measured against both renders, at every frequency either channel plays.
  const toneRows = [];
  for (const seg of script.segments) {
    if (seg.kind !== 'tone') continue;
    const band = { lo: seg.freq / 2 ** (1 / 6), hi: seg.freq * 2 ** (1 / 6) };
    const trim = 0.008; // settle past the period/phase-reset transient
    const capWindow = { start: Math.round(toSample(drift, seg.startCycle) + trim * capture.sampleRate), end: Math.round(toSample(drift, seg.endCycle) - trim * capture.sampleRate) };
    const refWindow = segmentWindow(refRate, seg.startCycle, seg.endCycle, trim, trim);
    const capDb = segmentLevelDb(capture.samples, capture.sampleRate, capWindow, band);
    const flatDb = segmentLevelDb(flat, refRate, refWindow, band);
    const profileDb = segmentLevelDb(profile, refRate, refWindow, band);
    if (capDb === null || flatDb === null || profileDb === null) continue;
    toneRows.push({ freq: seg.freq, channel: seg.channel, capDb, flatDb, profileDb, vsFlatDb: capDb - flatDb, vsProfileDb: capDb - profileDb });
  }

  // Noise: broadband, so every third-octave band in range gets its own row.
  const bands = thirdOctaveBands(40, 15000);
  const noiseRows = [];
  for (const seg of script.segments) {
    if (seg.kind !== 'noise') continue;
    const trim = 0.05;
    const capWindow = { start: Math.round(toSample(drift, seg.startCycle) + trim * capture.sampleRate), end: Math.round(toSample(drift, seg.endCycle) - 0.01 * capture.sampleRate) };
    const refWindow = segmentWindow(refRate, seg.startCycle, seg.endCycle, trim, 0.01);
    for (const band of bands) {
      const capDb = segmentLevelDb(capture.samples, capture.sampleRate, capWindow, band);
      const flatDb = segmentLevelDb(flat, refRate, refWindow, band);
      const profileDb = segmentLevelDb(profile, refRate, refWindow, band);
      if (capDb === null || flatDb === null || profileDb === null) continue;
      noiseRows.push({ freq: band.center, mode: seg.mode, capDb, flatDb, profileDb, vsFlatDb: capDb - flatDb, vsProfileDb: capDb - profileDb });
    }
  }

  // The level offset a capture can't avoid (line level, cable, gain staging):
  // the mean of the tones' level against the profile render, applied before
  // judging band error against it, exactly as a calibrated gain would be.
  const levelDb = toneRows.reduce((s, r) => s + r.vsProfileDb, 0) / Math.max(1, toneRows.length);
  const bandErrors = [...toneRows, ...noiseRows].map((r) => ({ ...r, bandErrorDb: r.vsProfileDb - levelDb }));
  const maxBandError = bandErrors.reduce((m, r) => Math.max(m, Math.abs(r.bandErrorDb)), 0);

  // Corner fit: the tones, plus the two noise segments' own third-octave
  // bands, against the profile-free render, per frequency (every row that
  // shares a frequency - both channels' tones at the same pitch, or a
  // band the noise shares with a tone - is averaged first). The tones
  // alone stop at 14 kHz (the triangle's own edge; the pulse mutes past
  // roughly 12.4 kHz - see `PULSE_FREQS`), too close to a low-pass corner
  // anywhere near there to pin it down; noise is broadband up to the
  // capture's own Nyquist rate, and is what actually constrains the
  // low-pass fit above the tone ladder's own top.
  const byFreq = new Map();
  for (const r of [...toneRows, ...noiseRows]) {
    const e = byFreq.get(r.freq) ?? { freq: r.freq, sum: 0, n: 0 };
    e.sum += r.vsFlatDb;
    e.n += 1;
    byFreq.set(r.freq, e);
  }
  const fitPoints = [...byFreq.values()].map((e) => ({ freq: e.freq, measuredDb: e.sum / e.n }));
  const corners = fitCorners(fitPoints, capture.sampleRate);

  const stepSeg = script.segments.find((s) => s.id === 'step');
  const stepEdgeUp = toSample(drift, stepSeg.startCycle);
  const stepEdgeDown = toSample(drift, stepSeg.startCycle + (stepSeg.frames / 2) * NTSC_FRAME);
  const stepCornerUp = estimateStepCorner(capture.samples, capture.sampleRate, Math.round(stepEdgeUp));
  const stepCornerDown = estimateStepCorner(capture.samples, capture.sampleRate, Math.round(stepEdgeDown));

  return {
    drift: { ppm: drift.ppm, startSample: startEdge, endSample: endEdge },
    levelDb,
    maxBandError,
    tolerance: TOLERANCE_DB,
    ok: maxBandError <= TOLERANCE_DB,
    bandErrors,
    corners,
    stepCornerCrossCheck: { up: stepCornerUp, down: stepCornerDown },
  };
}

// ------------------------------------------------------------------ CLI ----

function parseArgs(argv) {
  const options = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      options[a.slice(2)] = argv[i + 1];
      i++;
    } else positional.push(a);
  }
  return { options, positional };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { options, positional } = parseArgs(process.argv.slice(2));
  const capturePath = positional[0];
  if (!capturePath) {
    console.error('usage: node src/bench/compare.mjs <capture.wav> [--rom <file>] [--json <file>] [--sheet <file>]');
    process.exit(2);
  }
  const romPath = options.rom ? path.resolve(options.rom) : path.join(ROOT, 'roms', 'bench', 'nes-analog-script.nes');
  const searchWindowS = options['search-window'] ? Number(options['search-window']) : 5;

  const capture = readWav(fs.readFileSync(path.resolve(capturePath)));
  if (capture.sampleRate < 44100) throw new Error(`${capturePath} is at ${capture.sampleRate} Hz; capture at 96 kHz/24-bit per CONFORMANCE.md`);
  // Remove any DC offset the interface or the console's own output added,
  // before any of the above ever looks at a level.
  let mean = 0;
  for (let i = 0; i < capture.samples.length; i++) mean += capture.samples[i];
  mean /= capture.samples.length;
  for (let i = 0; i < capture.samples.length; i++) capture.samples[i] -= mean;

  const result = analyzeCapture(capture, { romPath, searchWindowS });

  console.log(`sync: drift ${result.drift.ppm.toFixed(1)} ppm against 1.789773 MHz`);
  console.log(`level: capture reads ${result.levelDb.toFixed(2)} dB against the profile render's tones`);
  console.log(`corners fitted: high-pass ${result.corners.hp1.toFixed(0)} Hz and ${result.corners.hp2.toFixed(0)} Hz, low-pass ${result.corners.lp.toFixed(0)} Hz (fit rms ${result.corners.rmsDb.toFixed(2)} dB)`);
  if (result.stepCornerCrossCheck.up || result.stepCornerCrossCheck.down) {
    console.log(`step cross-check (fast time constant only): rising ${result.stepCornerCrossCheck.up?.toFixed(0) ?? 'n/a'} Hz, falling ${result.stepCornerCrossCheck.down?.toFixed(0) ?? 'n/a'} Hz`);
  }
  console.log(`${result.ok ? 'PASS' : 'FAIL'}  max band error ${result.maxBandError.toFixed(2)} dB against the profile render (tolerance ${TOLERANCE_DB} dB, 40 Hz-15 kHz)`);

  const jsonPath = options.json;
  if (jsonPath) {
    fs.mkdirSync(path.dirname(path.resolve(jsonPath)), { recursive: true });
    fs.writeFileSync(path.resolve(jsonPath), JSON.stringify({ date: new Date().toISOString().slice(0, 10), capture: path.resolve(capturePath), ...result }, null, 2) + '\n');
  }

  const sheetPath = options.sheet;
  if (sheetPath) {
    const resolvedSheet = path.resolve(sheetPath);
    const text = fs.readFileSync(resolvedSheet, 'utf8');
    const begin = text.indexOf('<!-- bench:begin -->');
    const end = text.indexOf('<!-- bench:end -->');
    if (begin < 0 || end < 0) throw new Error(`${sheetPath} has no bench markers`);
    const lines = [
      '<!-- bench:begin -->',
      `Written by \`conform\` on ${new Date().toISOString().slice(0, 10)}, from \`${path.basename(capturePath)}\`. See docs/HARDWARE-BENCH.md for the unit and the capture.`,
      '',
      '| | |',
      '| --- | --- |',
      `| Clock drift measured | ${result.drift.ppm.toFixed(1)} ppm |`,
      `| Level offset | ${result.levelDb.toFixed(2)} dB |`,
      `| Corners fitted | high-pass ${result.corners.hp1.toFixed(0)} Hz and ${result.corners.hp2.toFixed(0)} Hz, low-pass ${result.corners.lp.toFixed(0)} Hz |`,
      `| Fit residual | ${result.corners.rmsDb.toFixed(2)} dB rms |`,
      `| Maximum band error | ${result.maxBandError.toFixed(2)} dB, against the \`nesdev\` profile |`,
      '<!-- bench:end -->',
    ];
    fs.writeFileSync(resolvedSheet, text.slice(0, begin) + lines.join('\n') + text.slice(end + '<!-- bench:end -->'.length));
  }

  process.exit(result.ok ? 0 : 1);
}
