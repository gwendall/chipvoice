import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { renderSong } from '../dist/index.js';

/**
 * The render, locked.
 *
 * The chip is a pure function of the song and the sample rate, and this is
 * where that stops being a sentence in the README. A fixed song is rendered
 * and hashed, and the hash has to match the one on file. Any change to the
 * DSP, the driver or the sequencer changes the bytes, and this is what says
 * so.
 *
 * When a change is meant - a fix that brings the chip closer to the hardware
 * - run with `--update`, commit golden.json in the same commit as the change,
 * and say in the message what moved and why. A hash that changes without a
 * sentence next to it is a regression until proven otherwise.
 *
 * The per-sample path is arithmetic only, which IEEE 754 makes exact on
 * every machine. Math.exp and Math.pow are reached once per filter and once
 * per frame, and V8 has computed them the same way for years. If this fails
 * on a new Node major with nothing changed, that is where to look first.
 */
const FILE = new URL('./golden.json', import.meta.url);

// The parity song, plus vibrato so the driver's sine path is in the hash.
const SONG = {
  id: 'golden', bpm: 152, order: [0], gain: 1,
  patterns: [{
    bass:  'A1 . A1 . A1 . A1 . A1 . A1 . A1 . G1 .',
    lead:  'E4 . . . G4 . A4 . . . B4 . C5 . . .',
    chord: 'A3 . . . . . . . . . . . . . . .',
    chordShape: [[0, 3, 7]],
    perc:  'K . H . S . H . K . H K S . H .',
  }],
  lead: { duty: 1, volume: [15, 14, 13, 12, 11], sustain: true, vibrato: { depth: 0.18, rate: 8, delay: 6 } },
  chord: { duty: 0, volume: [9, 8, 7], sustain: true },
  bass: { volume: [15], sustain: true },
};
const SECONDS = 4;
const SAMPLE_RATE = 44100;

const audio = renderSong(SONG, { seconds: SECONDS, sampleRate: SAMPLE_RATE });
const bytes = Buffer.from(audio.left.buffer, audio.left.byteOffset, audio.left.byteLength);
const sha256 = createHash('sha256').update(bytes).digest('hex');

let sumSquares = 0;
for (let i = 0; i < audio.left.length; i++) sumSquares += audio.left[i] * audio.left[i];
const rms = Math.round(Math.sqrt(sumSquares / audio.left.length) * 10000) / 10000;
const peak = Math.round(audio.peak * 10000) / 10000;

if (process.argv.includes('--update')) {
  const record = {
    song: 'test/golden.mjs',
    seconds: SECONDS,
    sampleRate: SAMPLE_RATE,
    sha256,
    // Not part of the check. Here so a diff of this file says how the sound
    // moved, not just that it did.
    rms,
    peak,
  };
  writeFileSync(FILE, JSON.stringify(record, null, 2) + '\n');
  console.log(`golden.json updated: ${sha256.slice(0, 16)}  rms ${rms}  peak ${peak}`);
  process.exit(0);
}

const golden = JSON.parse(readFileSync(FILE, 'utf8'));
const ok = golden.sha256 === sha256;
console.log(`${ok ? 'PASS' : 'FAIL'}  the render is byte for byte what it was  ${sha256.slice(0, 16)}`);
if (!ok) {
  console.log(`      on file: ${golden.sha256.slice(0, 16)}  rms ${golden.rms}  peak ${golden.peak}`);
  console.log(`      now:     ${sha256.slice(0, 16)}  rms ${rms}  peak ${peak}`);
  console.log('      If the change is meant, run: node test/golden.mjs --update');
}
console.log(ok ? '\nPASS' : '\n1 FAILURE');
process.exit(ok ? 0 : 1);
