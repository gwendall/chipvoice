import {writeFile, mkdir, readdir, readFile, unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {planPerformance, renderPerformance, toWav} from '../../packages/chipvoice/dist/index.js';
import {measureAudio, spectrum} from '../../packages/conform/src/listening/metrics.mjs';
import {buildPresets} from './presets.mjs';
import {catalogueEngineHash, CATALOGUE_VERSION} from './provenance.mjs';

/**
 * Renders every preset from `presets.mjs` through the real engine and writes
 * what it measures to `apps/web/src/data/instrument-catalogue.json`, with a
 * short FLAC preview per preset in `apps/web/public/instrument-data/`. Every
 * preset gets the same fixed probe - same pitch, duration, velocity - so the
 * only thing that differs between two rows is what the chip actually does
 * with its instrument. `options.mix: false` renders the part's authored
 * envelope directly, the same bypass `scores/mixing/calibrate.mjs` uses,
 * so nothing here reflects cross-instrument balancing.
 */
const root = resolve(import.meta.dirname, '../..');
const distDir = resolve(root, 'packages/chipvoice/dist');
const audioDir = resolve(root, 'apps/web/public/instrument-data');
const dataFile = resolve(root, 'apps/web/src/data/instrument-catalogue.json');

const PROBE = {pitch: 60, velocity: 100, noteOffMs: 700, totalMs: 1200, sampleRate: 44100};
const CHIPS = await (async () => {
  const {nesChip, gbChip, mdChip, snesChip, c64Chip} = await import(resolve(distDir, 'index.js'));
  return {'2a03': nesChip, dmg: gbChip, md: mdChip, snes: snesChip, c64: c64Chip};
})();

function buildPerformance(preset) {
  const percussion = preset.role === 'perc';
  const part = {
    id: 'probe', name: 'probe', role: percussion ? 'perc' : preset.role, priority: 1,
    ...(percussion ? {} : {program: preset.program}),
    notes: [{id: 'n', tick: 0, endTick: PROBE.noteOffMs, pitch: PROBE.pitch, velocity: PROBE.velocity, ...(percussion ? {drum: preset.drum} : {})}],
  };
  return {
    version: 1, title: `probe-${preset.id}`, ticksPerBeat: 1000, endTick: PROBE.totalMs,
    tempos: [{tick: 0, microsecondsPerBeat: 1000000}], parts: [part], notices: [],
  };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

// A finer-grained RMS-over-time trace than `measureAudio`'s 100-bucket
// envelope, whose ~12ms buckets are too coarse for a real hardware release
// tail (the SID's own ADSR, or the FM/PSG channels' fast decays). Windows
// overlap so short bursts are not missed between buckets.
function fineEnvelope({left, right}, sampleRate, windowMs = 3, hopMs = 1.5) {
  const windowSize = Math.max(1, Math.round((sampleRate * windowMs) / 1000));
  const hopSize = Math.max(1, Math.round((sampleRate * hopMs) / 1000));
  const frames = left.length, points = [];
  for (let start = 0; start < frames; start += hopSize) {
    const end = Math.min(frames, start + windowSize);
    let square = 0, count = 0;
    for (let i = start; i < end; i++) {
      const l = left[i], r = right ? right[i] : l;
      square += l * l + r * r;
      count += right ? 2 : 1;
    }
    points.push({ms: ((start + end) / 2 / sampleRate) * 1000, rms: count ? Math.sqrt(square / count) : 0});
  }
  return points;
}

/** Attack, decay, sustain level and release, read off the fine envelope
 * itself - never off the instrument's declared volume table - against the
 * probe's own note-on/note-off times. */
function measureEnvelope(points, noteOnMs, noteOffMs) {
  const peak = points.reduce((max, p) => Math.max(max, p.rms), 0);
  if (peak <= 0) return {attackMs: 0, decayMs: 0, sustainLevel: 0, releaseMs: 0, releaseMeasured: true, peak: 0};
  const attackPoint = points.find(p => p.rms >= peak * 0.9) ?? points.at(-1);
  const attackMs = Math.max(0, attackPoint.ms - noteOnMs);
  const trailStart = noteOffMs - Math.min(80, Math.max(1, (noteOffMs - attackPoint.ms) * 0.3));
  const trail = points.filter(p => p.ms >= trailStart && p.ms <= noteOffMs);
  const sustainLevel = trail.length ? trail.reduce((sum, p) => sum + p.rms, 0) / trail.length : points.at(-1).rms;
  const decayPoint = points.find(p => p.ms >= attackPoint.ms && p.rms <= sustainLevel * 1.1) ?? attackPoint;
  const decayMs = Math.max(0, decayPoint.ms - attackPoint.ms);
  const releaseThreshold = Math.max(peak * 0.02, sustainLevel * 0.1);
  const after = points.filter(p => p.ms >= noteOffMs);
  const releasePoint = after.find(p => p.rms <= releaseThreshold);
  const tailMs = (points.at(-1)?.ms ?? noteOffMs) - noteOffMs;
  return {
    attackMs: round(attackMs, 1), decayMs: round(decayMs, 1), sustainLevel: round(sustainLevel, 5),
    releaseMs: round(releasePoint ? releasePoint.ms - noteOffMs : tailMs, 1),
    releaseMeasured: !!releasePoint, peak: round(peak, 5),
  };
}

// A plottable trace, evenly spaced across the probe's fixed duration so
// every preset's curve lines up on the same axis: linear interpolation
// between the nearest fine-envelope points, never a re-measurement.
function sampleCurve(points, totalMs, steps = 80) {
  const curve = [];
  for (let i = 0; i < steps; i++) {
    const ms = (i / (steps - 1)) * totalMs;
    let next = points.findIndex(p => p.ms >= ms);
    if (next === -1) { curve.push(round(points.at(-1)?.rms ?? 0, 5)); continue; }
    if (next === 0) { curve.push(round(points[0].rms, 5)); continue; }
    const before = points[next - 1], after = points[next];
    const span = after.ms - before.ms;
    const rms = span > 0 ? before.rms + ((ms - before.ms) / span) * (after.rms - before.rms) : after.rms;
    curve.push(round(rms, 5));
  }
  return curve;
}

// Geometric mean over arithmetic mean of each band's power: 1 for flat
// (noise-like) spectra, near 0 for a few dominant partials (tonal).
function spectralFlatness(bands) {
  const power = bands.map(b => b.db).filter(db => db !== null).map(db => 10 ** (db / 10));
  if (!power.length) return 0;
  const mean = power.reduce((sum, p) => sum + p, 0) / power.length;
  if (mean <= 0) return 0;
  const logMean = power.reduce((sum, p) => sum + Math.log(p), 0) / power.length;
  return Math.min(1, Math.max(0, Math.exp(logMean) / mean));
}

const DUTY_PERCENT = [12.5, 25, 50, 75];

/** What kind of sound source the chip is actually reaching for, read off the
 * resolved `Instrument`'s own fields - never off the role/program that chose
 * it - so a wavetable, an FM patch, a sample or a bare pulse duty is named
 * for what it is. */
function describeTimbre(instrument) {
  if (instrument.sample) return {kind: 'sample', sample: instrument.sample};
  if (instrument.fm) return {kind: 'fm', algorithm: instrument.fm.algorithm, operators: instrument.fm.ops.length, feedback: instrument.fm.feedback};
  if (instrument.wave) return {kind: 'wavetable', steps: instrument.wave.length};
  const waveforms = Array.isArray(instrument.waveform) ? instrument.waveform : instrument.waveform ? [instrument.waveform] : [];
  if (waveforms.includes('noise') || instrument.noiseMode) return {kind: 'noise'};
  if (waveforms.includes('sawtooth')) return {kind: 'sawtooth'};
  if (waveforms.includes('triangle')) return {kind: 'triangle'};
  if (typeof instrument.duty === 'number') return {kind: 'pulse', dutyPercent: DUTY_PERCENT[instrument.duty] ?? null};
  return {kind: 'tone'};
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

async function renderPreset(preset) {
  const chip = CHIPS[preset.chip];
  const plan = planPerformance(buildPerformance(preset), chip, {mix: false});
  const audio = renderPerformance(plan, chip, {sampleRate: PROBE.sampleRate});
  const levels = measureAudio(audio);
  if (levels.invalidSamples || levels.clippedSamples) throw new Error(`${preset.id}: invalid or clipped PCM`);
  const points = fineEnvelope(audio, PROBE.sampleRate);
  const envelope = {...measureEnvelope(points, 0, PROBE.noteOffMs), curve: sampleCurve(points, PROBE.totalMs)};
  const {centroidHz, bands} = spectrum(audio);
  const flatness = spectralFlatness(bands);

  const wav = toWav(audio);
  const wavPath = resolve(audioDir, `${preset.id}.wav`);
  await writeFile(wavPath, wav);
  const flacPath = resolve(audioDir, `${preset.id}.flac`);
  const encoded = spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', wavPath, '-c:a', 'flac', flacPath]);
  if (encoded.status) throw new Error(`${preset.id}: ffmpeg failed: ${encoded.stderr.toString()}`);
  const flac = await readFile(flacPath);
  const flacHash = sha256(flac);
  const finalFlacPath = resolve(audioDir, `${preset.id}-${flacHash.slice(0, 12)}.flac`);
  await writeFile(finalFlacPath, flac);
  await unlink(wavPath);
  await unlink(flacPath);

  return {
    id: preset.id, chip: preset.chip, role: preset.role,
    ...(preset.role === 'perc' ? {token: preset.token, drum: preset.drum} : {program: preset.program, programs: preset.programs}),
    timbre: describeTimbre(preset.instrument),
    envelope,
    spectrum: {centroidHz: centroidHz === null ? null : round(centroidHz, 1), flatness: round(flatness, 4), bands: bands.map(b => ({hz: round(b.hz, 1), db: b.db === null ? null : round(b.db, 2)}))},
    levels: {
      samplePeakDbFS: levels.samplePeakDbFS === null ? null : round(levels.samplePeakDbFS, 2),
      rmsDbFS: levels.rmsDbFS === null ? null : round(levels.rmsDbFS, 2),
      crestDb: levels.crestDb === null ? null : round(levels.crestDb, 2),
    },
    audio: {file: `/instrument-data/${preset.id}-${flacHash.slice(0, 12)}.flac`, sha256: flacHash, sourceWavSha256: sha256(wav)},
  };
}

export async function buildCatalogue() {
  await mkdir(audioDir, {recursive: true});
  const presets = buildPresets();
  const rows = [];
  for (const preset of presets) rows.push(await renderPreset(preset));
  return {
    catalogueVersion: CATALOGUE_VERSION,
    engineSha256: await catalogueEngineHash(),
    probe: {pitch: PROBE.pitch, velocity: PROBE.velocity, noteOnMs: PROBE.noteOffMs, totalMs: PROBE.totalMs, sampleRate: PROBE.sampleRate},
    presets: rows,
  };
}

async function pruneStaleAudio(presets) {
  const keep = new Set(presets.map(p => p.audio.file.split('/').pop()));
  for (const name of await readdir(audioDir)) {
    if (!keep.has(name) && /^[a-z0-9-]+-[0-9a-f]{12}\.flac$/.test(name)) await unlink(resolve(audioDir, name));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const catalogue = await buildCatalogue();
  await pruneStaleAudio(catalogue.presets);
  await writeFile(dataFile, `${JSON.stringify(catalogue, null, 2)}\n`);
  console.log(`Wrote ${catalogue.presets.length} presets to ${dataFile}`);
}
