import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { nesChip } from 'chipvoice';
import { Nes } from '../roms/nes.mjs';

/**
 * The mixer, against blargg's cancellation tests and his recordings.
 *
 *   node src/mixer/run.mjs [--json <file>] [--sheet <file>] [--floor <dB>]
 *
 * Each of blargg's four `apu_mixer` ROMs plays a short tone, then has one
 * channel play a waveform while the DMC's DAC plays its inverse, then plays a
 * tone again. If the mixer's non-linearity is the hardware's, the two cancel
 * and the middle is nearly silent; if it is not, a tone remains. He recorded
 * the four on a real NES, and those recordings are the reference the sheet's
 * analog section has been waiting for: not a filter measurement, but the
 * DAC curves, which is where most of the identity of the sound is.
 *
 * The number is the residual: the level of the middle relative to the level
 * of the tone, in dB, on our render and on his recording. Ours is measured
 * by running the ROM on the harness's 6502, keeping every register write,
 * and rendering the writes through the full core - chip, curves, filters.
 * His is measured the same way on the recording, when a decoder is at hand
 * to turn the MP3 into samples; the MP3s are committed, the decoder is not.
 */
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'roms');
const CPU_HZ = 1789773;
const RATE = 44100;
const TESTS = ['square', 'triangle', 'noise', 'dmc'];

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
/**
 * On the three cancellation tests, ours has to sit at least this far below
 * the tone, or the mixer regressed. The noise test is not a cancellation -
 * noise fades in and out, and what is checked is its level against the
 * DMC's - so it is judged against the recording, within this many dB, when
 * the recording can be decoded, and only reported when it cannot.
 */
const FLOOR = Number(option('floor', '-25'));
const NOISE_TOLERANCE = 4;

const dB = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);

function rms(samples, from, to) {
  const a = Math.max(0, Math.floor(from));
  const b = Math.min(samples.length, Math.floor(to));
  if (b <= a) return 0;
  let sum = 0;
  for (let i = a; i < b; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / (b - a));
}

/**
 * The tones and the middle, from where the tones are.
 *
 * `tones` are the seconds at which tones start, in groups: a group is the
 * tones within two seconds of each other. The middle runs from a little
 * after the first group's last tone to a little before the last group's
 * first tone. The tone level is the first tone's first half second.
 */
function segments(tones) {
  const groups = [];
  for (const t of tones) {
    const g = groups[groups.length - 1];
    if (g && t - g[g.length - 1] < 2) g.push(t);
    else groups.push([t]);
  }
  const first = groups[0];
  const last = groups[groups.length - 1];
  return {
    tone: [first[0], first[0] + 0.5],
    middle: [first[first.length - 1] + 0.8, last[0] - 0.3],
  };
}

function analyse(samples, tones) {
  const s = segments(tones);
  const tone = rms(samples, s.tone[0] * RATE, s.tone[1] * RATE);
  const middle = rms(samples, s.middle[0] * RATE, s.middle[1] * RATE);
  return { tone: dB(tone), middle: dB(middle), residual: dB(middle) - dB(tone), segments: s };
}

/** Where the tones are in a recording: the loud stretches, found by their envelope. */
function tonesInRecording(samples) {
  const frame = Math.round(RATE * 0.05);
  const levels = [];
  for (let i = 0; i + frame <= samples.length; i += frame) levels.push(rms(samples, i, i + frame));
  const peak = Math.max(...levels);
  const loud = levels.map((l) => l > peak * 0.3);
  const tones = [];
  for (let i = 0; i < loud.length; i++) {
    if (loud[i] && !(i > 0 && loud[i - 1])) tones.push((i * frame) / RATE);
  }
  return tones;
}

/** A 16-bit PCM WAV, mono or the first channel of more. */
function readWav(file) {
  const buf = fs.readFileSync(file);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let at = 12;
  let channels = 1;
  let rate = RATE;
  while (at + 8 <= buf.length) {
    const id = buf.toString('ascii', at, at + 4);
    const size = view.getUint32(at + 4, true);
    if (id === 'fmt ') {
      channels = view.getUint16(at + 10, true);
      rate = view.getUint32(at + 12, true);
    } else if (id === 'data') {
      const n = Math.floor(size / 2 / channels);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = view.getInt16(at + 8 + i * 2 * channels, true) / 32768;
      if (rate !== RATE) throw new Error(`${file} is at ${rate} Hz, not ${RATE}`);
      return out;
    }
    at += 8 + size + (size & 1);
  }
  throw new Error(`${file} has no data chunk`);
}

/** The recording as samples, through whichever decoder the machine has. */
function decode(mp3) {
  const wav = path.join(os.tmpdir(), `chipvoice-mixer-${path.basename(mp3, '.mp3')}.wav`);
  const attempts = [
    ['afconvert', ['-f', 'WAVE', '-d', `LEI16@${RATE}`, '-c', '1', mp3, wav]],
    ['ffmpeg', ['-y', '-loglevel', 'error', '-i', mp3, '-ac', '1', '-ar', String(RATE), wav]],
  ];
  for (const [cmd, a] of attempts) {
    const r = spawnSync(cmd, a, { stdio: 'ignore' });
    if (r.status === 0 && fs.existsSync(wav)) {
      const samples = readWav(wav);
      fs.unlinkSync(wav);
      return samples;
    }
  }
  return null;
}

const results = [];
let regressed = false;
for (const name of TESTS) {
  const rom = new Uint8Array(fs.readFileSync(path.join(ROOT, 'apu_mixer', `${name}.nes`)));
  const nes = new Nes(rom);
  nes.powerOn();
  for (let i = 0; i < 400; i++) {
    nes.run(CPU_HZ / 10);
    const r = nes.result();
    if (nes.halted() || (r.valid && r.status < 0x80 && i > 5)) break;
  }
  const cycles = nes.cpu.cycles + CPU_HZ;

  // The writes, rendered through the whole core.
  const core = nesChip.create(RATE);
  core.setGain(1);
  core.load(0x8000, nes.prg.subarray(0, Math.min(nes.prg.length, 0x8000)));
  if (nes.prg.length === 16384) core.load(0xc000, nes.prg);
  core.schedule(nes.log.map((w) => ({ at: w.at, addr: w.addr, value: w.value })));
  const total = Math.round((cycles / CPU_HZ) * RATE);
  const ours = new Float32Array(total);
  for (let at = 0; at < total; at += 4096) core.render(ours.subarray(at, Math.min(total, at + 4096)), null, at);

  const tones = nes.beeps.map((c) => c / CPU_HZ);
  const mine = analyse(ours, tones);

  let theirs = null;
  const mp3 = path.join(ROOT, 'apu_mixer_recordings', `${name}.mp3`);
  if (fs.existsSync(mp3)) {
    const samples = decode(mp3);
    if (samples) theirs = analyse(samples, tonesInRecording(samples));
  }

  const ok =
    name === 'noise'
      ? theirs === null || Math.abs(mine.residual - theirs.residual) <= NOISE_TOLERANCE
      : mine.residual <= FLOOR;
  if (!ok) regressed = true;
  const fmt = (x) => (Number.isFinite(x) ? `${x.toFixed(1)} dB` : 'silence');
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(9)} ours: middle ${fmt(mine.residual)} below the tone` +
      (theirs ? `   hardware: ${fmt(theirs.residual)} below the tone` : '   hardware: no decoder for the recording'),
  );
  results.push({ name, ours: mine, hardware: theirs });
}

console.log(`\ncancellation tests: ours at or below ${FLOOR} dB; noise: within ${NOISE_TOLERANCE} dB of the recording. The recording's own floor is its room and its cable.`);

const jsonPath = option('json', null);
if (jsonPath) {
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify({ date: new Date().toISOString().slice(0, 10), floor: FLOOR, results }, null, 2) + '\n');
}

const sheetPath = option('sheet', null);
if (sheetPath) {
  const text = fs.readFileSync(sheetPath, 'utf8');
  const begin = text.indexOf('<!-- mixer:begin -->');
  const end = text.indexOf('<!-- mixer:end -->');
  if (begin < 0 || end < 0) throw new Error(`${sheetPath} has no mixer markers`);
  const fmt = (x) => (x === null || x === undefined ? 'not decoded' : Number.isFinite(x) ? `${x.toFixed(1)} dB` : 'silence');
  const lines = [
    '<!-- mixer:begin -->',
    `Written by \`conform\` on ${new Date().toISOString().slice(0, 10)}. The middle's level relative to the tone's; lower is a better cancellation.`,
    '',
    '| Test | This core | Blargg\'s NES, his recording |',
    '| --- | --- | --- |',
    ...results.map((r) => `| \`apu_mixer/${r.name}\` | ${fmt(r.ours.residual)} | ${fmt(r.hardware?.residual)} |`),
    '<!-- mixer:end -->',
  ];
  fs.writeFileSync(sheetPath, text.slice(0, begin) + lines.join('\n') + text.slice(end + '<!-- mixer:end -->'.length));
}

process.exit(regressed ? 1 : 0);
