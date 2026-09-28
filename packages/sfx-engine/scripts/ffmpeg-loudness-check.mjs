#!/usr/bin/env node
/**
 * Cross-checks this package's own BS.1770/EBU R128 implementation
 * (loudness/loudness.ts, loudness/truepeak.ts) against ffmpeg's `ebur128`
 * filter, a widely-used, independently-written reference implementation of
 * the same standard.
 *
 * For every named preset: render it, take the final normalized mono signal
 * (`rendered.loudness.signal` - exactly what `integratedLoudness`/
 * `truePeakDb` measured internally, before the one-time equal-power pan to
 * stereo that `dsp/mix.ts` applies afterward), write it to a mono 32-bit
 * float WAV, and run `ffmpeg -filter_complex ebur128=peak=true` on it.
 * ffmpeg's Summary block reports Integrated loudness (I) and True peak
 * (Peak) for the whole clip - compared directly against this package's own
 * `integratedLoudness()` and `truePeakDb()` on the identical signal.
 *
 * True peak is compared for every preset (it is an instantaneous
 * over-the-signal statistic, meaningful at any length). Integrated loudness
 * is only compared for presets at least `MIN_DURATION_FOR_INTEGRATED`
 * seconds long: BS.1770's gated Integrated measurement is defined over
 * 400ms blocks, and ffmpeg's `ebur128` filter has no accommodation for a
 * clip shorter than one full block - it simply never accumulates a gated
 * block and reports its absolute-gate floor (-70.0 LUFS) regardless of
 * what the clip actually contains. (This package's own
 * `momentaryLoudnessMax` explicitly falls back to a single whole-signal
 * block for exactly this reason - see loudness/loudness.ts - which is why
 * the house convention check in test/presets.test.mjs compares against
 * *momentary* loudness, not Integrated: most gamesounds presets are well
 * under 400ms.) Measured directly (see the constants' doc comments below
 * for the concrete numbers this script's tolerances were derived from):
 * every preset at exactly 0.400s or longer already agreed with ffmpeg to
 * within 0.06 LU, while every preset under 0.400s reads -70.0 LUFS from
 * ffmpeg no matter its real content - a structural limitation of comparing
 * against ffmpeg on short clips, not a defect in either implementation.
 *
 *   pnpm loudness:ffmpeg-check
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PRESETS, recipeForPreset, renderRecipe, integratedLoudness, truePeakDb } from '../dist/index.js';

/** ffmpeg's `ebur128` never produces a valid Integrated reading below this -
 * see this file's module doc comment. */
const MIN_DURATION_FOR_INTEGRATED = 0.4;

/** Measured max |delta| across the 23 presets >= 0.4s was 0.058 LU (mean
 * 0.025 LU) between this package's `integratedLoudness` and ffmpeg's own
 * Integrated reading on the identical signal. This tolerance is that
 * measured max with roughly 4x margin, for normal cross-implementation
 * K-weighting/gating rounding, not a loosened requirement. */
const INTEGRATED_TOLERANCE_LU = 0.25;

/** Measured max |delta| across all 53 presets was 0.100 dB (mean 0.015 dB)
 * between this package's windowed-sinc 4x-oversampled `truePeakDb` and
 * ffmpeg's own true-peak reading. This tolerance is that measured max with
 * roughly 2.5x margin - true peak is an approximation of ITU Annex 2's
 * exact filter table either way (see loudness/truepeak.ts's doc comment),
 * so exact agreement isn't the bar; staying within a few tenths of a dB of
 * an independent implementation is. */
const TRUE_PEAK_TOLERANCE_DB = 0.25;

function f64ToMonoWav(samples, sampleRate) {
  const dataLen = samples.length * 4;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataLen, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(3, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(32, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < samples.length; i++) buf.writeFloatLE(samples[i], 44 + i * 4);
  return buf;
}

function runFfmpegEbur128(wavPath) {
  const result = spawnSync('ffmpeg', ['-nostats', '-i', wavPath, '-filter_complex', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
  const stderr = result.stderr ?? '';
  const summaryIdx = stderr.lastIndexOf('Summary:');
  const summary = summaryIdx >= 0 ? stderr.slice(summaryIdx) : stderr;
  const integratedMatch = summary.match(/Integrated loudness:\s*\n\s*I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/);
  const peakMatch = summary.match(/True peak:\s*\n\s*Peak:\s*(-?\d+(?:\.\d+)?)\s*dBFS/);
  if (!integratedMatch) throw new Error(`could not parse ffmpeg ebur128 output:\n${summary}`);
  return {
    integratedLufs: Number(integratedMatch[1]),
    truePeakDb: peakMatch ? Number(peakMatch[1]) : null,
  };
}

const ffmpegProbe = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
if (ffmpegProbe.status !== 0) {
  console.log('WARN  ffmpeg not found on PATH; skipping the loudness cross-check (this is local-only tooling, not a CI gate).');
  process.exit(0);
}

let failures = 0;
const check = (name, ok, extra = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };

const tmp = mkdtempSync(join(tmpdir(), 'sfx-engine-ffmpeg-loudness-'));
let integratedChecked = 0;
let peakChecked = 0;
const integratedDeltas = [];
const peakDeltas = [];
try {
  for (const p of PRESETS) {
    const rendered = renderRecipe(recipeForPreset(p.id, p.seed, 48000));
    const signal = rendered.loudness.signal;
    const engineIntegrated = integratedLoudness(signal, rendered.sampleRate);
    const enginePeak = truePeakDb(signal);

    const wavPath = join(tmp, `${p.id}.wav`);
    writeFileSync(wavPath, f64ToMonoWav(signal, rendered.sampleRate));
    const ff = runFfmpegEbur128(wavPath);

    if (ff.truePeakDb !== null) {
      const dPeak = Math.abs(enginePeak - ff.truePeakDb);
      peakDeltas.push(dPeak);
      peakChecked++;
      check(`${p.id}: true peak within ${TRUE_PEAK_TOLERANCE_DB} dB of ffmpeg`, dPeak <= TRUE_PEAK_TOLERANCE_DB, `engine=${enginePeak.toFixed(3)} ffmpeg=${ff.truePeakDb.toFixed(3)} d=${dPeak.toFixed(3)}`);
    }

    if (rendered.durationSeconds >= MIN_DURATION_FOR_INTEGRATED) {
      const dLufs = Math.abs(engineIntegrated - ff.integratedLufs);
      integratedDeltas.push(dLufs);
      integratedChecked++;
      check(`${p.id}: integrated loudness within ${INTEGRATED_TOLERANCE_LU} LU of ffmpeg`, dLufs <= INTEGRATED_TOLERANCE_LU, `engine=${engineIntegrated.toFixed(3)} ffmpeg=${ff.integratedLufs.toFixed(3)} d=${dLufs.toFixed(3)}`);
    } else {
      console.log(`SKIP  ${p.id}: ${rendered.durationSeconds.toFixed(3)}s, shorter than ffmpeg's ${MIN_DURATION_FOR_INTEGRATED}s minimum gating block - integrated loudness not comparable`);
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

const maxOf = (arr) => (arr.length ? Math.max(...arr) : 0);
console.log(`\n${peakChecked} presets' true peak checked, max |delta| ${maxOf(peakDeltas).toFixed(3)} dB (tolerance ${TRUE_PEAK_TOLERANCE_DB} dB)`);
console.log(`${integratedChecked}/${PRESETS.length} presets' integrated loudness checked (>= ${MIN_DURATION_FOR_INTEGRATED}s), max |delta| ${maxOf(integratedDeltas).toFixed(3)} LU (tolerance ${INTEGRATED_TOLERANCE_LU} LU)`);

console.log(failures === 0 ? '\nPASS ffmpeg loudness cross-check' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
