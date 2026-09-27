import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AnalogStage } from './dsp-lite.mjs';
import { renderScript } from './render.mjs';
import { analyzeCapture } from './compare.mjs';
import { runRom } from './run-rom.mjs';
import { buildScript } from './script.mjs';
import fs from 'node:fs';

/**
 * Proves `compare.mjs` without a unit: synthesises fake "captures" by
 * running the profile-free render through deliberately different filter
 * corners, plus the distortions a real capture actually has - gain, a
 * latency before the signal starts, a clock offset, DC, noise - and checks
 * that `analyzeCapture` recovers the corners and the drift within stated
 * tolerances, and that its band-error number tracks how far off the guessed
 * `nesdev` profile actually is.
 *
 *   node src/bench/selftest.mjs
 *
 * Registered in CI's `conformance` job as `bench:nes:selftest`. It renders
 * the ROM once (the only slow part, a few seconds - the same render every
 * case reuses) and every synthetic case after that is a cheap per-sample
 * filter and a resample, so the whole thing runs in well under half a
 * minute.
 */
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// The bench's own shipping rate. A lower rate would still clear the 40 Hz-15
// kHz band's own Nyquist, but it puts that band's top edge too close to
// Nyquist for the cubic interpolator below to stay flat while resampling for
// drift - 96 kHz is what a real capture is asked for anyway, so testing at
// it is also the more honest self-test.
const SAMPLE_RATE = 96000;

function synthesizeCapture(flat, sampleRate, { hp1, hp2, lp, gainDb = 0, latencySamples = 0, driftPpm = 0, dcOffset = 0, noiseFloorDb = -80, seed = 12345 }) {
  const stage = new AnalogStage({ highPassHz: [hp1, hp2], lowPassHz: lp, gain: 10 ** (gainDb / 20) }, sampleRate);
  const filtered = new Float32Array(flat.length);
  for (let i = 0; i < flat.length; i++) filtered[i] = stage.process(flat[i]);

  // Clock drift: resample by (1 + ppm/1e6). Cubic (Catmull-Rom) rather than
  // linear interpolation - linear interpolation's own frequency response is
  // a sinc^2 with a first null at the sample rate, which is already down a
  // few dB by 16 kHz at 48 kHz and would show up as spurious low-pass error
  // having nothing to do with the corners under test; a few hundred ppm of
  // drift moves every sample by a small, near-constant fraction, so a cubic
  // through the four nearest points tracks the true waveform far closer than
  // a straight line between two of them does.
  const ratio = 1 + driftPpm / 1e6;
  const outLen = Math.floor((filtered.length - 1) / ratio);
  const drifted = new Float32Array(outLen);
  const at = (i) => filtered[Math.max(0, Math.min(filtered.length - 1, i))];
  for (let i = 0; i < outLen; i++) {
    const srcPos = i * ratio;
    const i1 = Math.floor(srcPos);
    const t = srcPos - i1;
    const p0 = at(i1 - 1);
    const p1 = at(i1);
    const p2 = at(i1 + 1);
    const p3 = at(i1 + 2);
    drifted[i] = 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
  }

  const withLatency = new Float32Array(drifted.length + latencySamples);
  withLatency.set(drifted, latencySamples);

  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return (s / 0x7fffffff) * 2 - 1;
  };
  const noiseAmp = 10 ** (noiseFloorDb / 20);
  const out = new Float32Array(withLatency.length);
  for (let i = 0; i < out.length; i++) out[i] = withLatency[i] + dcOffset + rand() * noiseAmp;
  return out;
}

const CASES = [
  {
    name: 'far from nesdev, long lead-in, positive drift',
    hp1: 150,
    hp2: 700,
    lp: 10000,
    gainDb: -2,
    latencySamples: 2 * SAMPLE_RATE,
    driftPpm: 300,
    dcOffset: 0.02,
    noiseFloorDb: -65,
    expectOk: false,
  },
  {
    name: 'matches nesdev, short lead-in, negative drift',
    hp1: 90,
    hp2: 440,
    lp: 14000,
    gainDb: 1,
    latencySamples: 500,
    driftPpm: -150,
    dcOffset: -0.01,
    noiseFloorDb: -88, // a clean capture: this case demonstrates the PASS branch
    expectOk: true,
  },
  {
    name: 'far from nesdev, clean, no drift',
    hp1: 200,
    hp2: 800,
    lp: 8000,
    gainDb: -6,
    latencySamples: 0,
    driftPpm: 0,
    dcOffset: 0,
    noiseFloorDb: -90,
    expectOk: false,
  },
];

// The two high-pass corners sit well inside the tone ladder (58 Hz-14 kHz)
// and fit tightly. The low-pass corner does not: nothing in this script
// carries energy past 15 kHz (CONFORMANCE.md's own upper edge), so a
// low-pass corner at or above roughly 12 kHz is only weakly constrained by
// what is left of the band above it - a real limit of this bench, not a
// defect in the fit, and the reason the tolerance widens there.
const CORNER_TOLERANCE = (truth) => Math.max(10, truth * 0.12);
const LP_TOLERANCE = (truth) => Math.max(1500, truth * 0.4);
const DRIFT_TOLERANCE_PPM = 25;
const FIT_RESIDUAL_TOLERANCE_DB = 0.35;

const romPath = path.join(ROOT, 'roms', 'bench', 'nes-analog-script.nes');
console.log(`rendering the bench ROM once at ${SAMPLE_RATE} Hz for every synthetic case below...`);
const reference = renderScript(romPath, SAMPLE_RATE);

// The ROM-fidelity half of item 1: the harness's own 6502 must run the
// script exactly - same writes, same order, and each one within a small
// jitter of the frame it was scheduled on, or nothing else here means
// anything. `run-rom.mjs` is already what `render.mjs` used above, but
// re-checking the log against the script's intent directly, here, is what
// actually proves it - both to a person and to CI - rather than the render
// alone.
const rom = new Uint8Array(fs.readFileSync(romPath));
const script = buildScript();
const { log } = runRom(rom, script.totalFrames);
let romOk = true;
if (log.length !== script.writes.length) {
  romOk = false;
  console.log(`FAIL  ROM fidelity: harness saw ${log.length} writes, the script has ${script.writes.length}`);
} else {
  let mismatch = -1;
  for (let i = 0; i < log.length; i++) {
    if (log[i].addr !== script.writes[i].addr || log[i].value !== script.writes[i].value) {
      mismatch = i;
      break;
    }
  }
  if (mismatch >= 0) {
    romOk = false;
    console.log(`FAIL  ROM fidelity: write ${mismatch} is $${log[mismatch].addr.toString(16)}=${log[mismatch].value}, the script says $${script.writes[mismatch].addr.toString(16)}=${script.writes[mismatch].value}`);
  } else {
    // Jitter is measured between consecutive writes, against the frame delta
    // the script implies, since the harness's vblank-poll model has a fixed
    // multi-thousand-cycle latency before its very first vblank that is not
    // part of the per-write jitter budget (see script.mjs's own note on this).
    let maxJitter = 0;
    for (let i = 1; i < log.length; i++) {
      const gotDelta = log[i].at - log[i - 1].at;
      const wantDelta = (script.writes[i].frame - script.writes[i - 1].frame) * 29781;
      maxJitter = Math.max(maxJitter, Math.abs(gotDelta - wantDelta));
    }
    const JITTER_TOLERANCE_CYCLES = 200; // observed max ~23 cycles of vblank-poll phase drift; generous headroom
    if (maxJitter > JITTER_TOLERANCE_CYCLES) {
      romOk = false;
      console.log(`FAIL  ROM fidelity: ${maxJitter} cycles of inter-write jitter, over the ${JITTER_TOLERANCE_CYCLES}-cycle budget`);
    } else {
      console.log(`PASS  ROM fidelity: ${log.length} writes match the script exactly; ${maxJitter} cycles of vblank-poll jitter, within ${JITTER_TOLERANCE_CYCLES}`);
    }
  }
}

let allOk = romOk;
for (const c of CASES) {
  const synthetic = synthesizeCapture(reference.flat, SAMPLE_RATE, c);
  let result;
  try {
    result = analyzeCapture({ samples: synthetic, sampleRate: SAMPLE_RATE }, { reference });
  } catch (err) {
    allOk = false;
    console.log(`FAIL  ${c.name}: ${err.message}`);
    continue;
  }

  const checks = [
    ['hp1', result.corners.hp1, c.hp1, CORNER_TOLERANCE(c.hp1)],
    ['hp2', result.corners.hp2, c.hp2, CORNER_TOLERANCE(c.hp2)],
    ['lp', result.corners.lp, c.lp, LP_TOLERANCE(c.lp)],
  ];
  let ok = true;
  const detail = [];
  for (const [label, got, want, tol] of checks) {
    const pass = Math.abs(got - want) <= tol;
    if (!pass) ok = false;
    detail.push(`${label} ${got.toFixed(0)} Hz (truth ${want} Hz, +/-${tol.toFixed(0)})`);
  }
  const driftPass = Math.abs(result.drift.ppm - c.driftPpm) <= DRIFT_TOLERANCE_PPM;
  if (!driftPass) ok = false;
  detail.push(`drift ${result.drift.ppm.toFixed(1)} ppm (truth ${c.driftPpm}, +/-${DRIFT_TOLERANCE_PPM})`);
  const fitPass = result.corners.rmsDb <= FIT_RESIDUAL_TOLERANCE_DB;
  if (!fitPass) ok = false;
  detail.push(`fit residual ${result.corners.rmsDb.toFixed(2)} dB (<= ${FIT_RESIDUAL_TOLERANCE_DB})`);
  const okPass = result.ok === c.expectOk;
  if (!okPass) ok = false;
  detail.push(`band-error verdict ${result.ok ? 'PASS' : 'FAIL'} (expected ${c.expectOk ? 'PASS' : 'FAIL'}, max band error ${result.maxBandError.toFixed(2)} dB)`);

  if (!ok) allOk = false;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}: ${detail.join('; ')}`);
}

console.log(allOk ? '\nall synthetic captures recovered within tolerance.' : '\nat least one synthetic case did not recover within tolerance.');
process.exit(allOk ? 0 : 1);
