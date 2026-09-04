import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { renderSong } from '../dist/index.js';

/**
 * The Game Boy render, locked: the same song as `golden.mjs`, on the DMG,
 * hashed and compared with the hash on file. Everything `golden.mjs` says
 * applies; this is the second chip's copy of it, and it writes the file on
 * the first run rather than failing, because on a fresh chip there is
 * nothing yet to protect.
 */
const FILE = new URL('./golden-dmg.json', import.meta.url);

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

const result = renderSong(SONG, { seconds: SECONDS, chip: 'dmg', stereo: true });
const hash = createHash('sha256');
hash.update(Buffer.from(result.left.buffer));
hash.update(Buffer.from(result.right.buffer));
const sha256 = hash.digest('hex');
let rms = 0;
for (let i = 0; i < result.left.length; i++) rms += result.left[i] * result.left[i];
rms = Math.sqrt(rms / result.left.length);
const current = { sha256, rms: Number(rms.toFixed(4)), peak: Number(result.peak.toFixed(4)) };

if (process.argv.includes('--update') || !existsSync(FILE)) {
  writeFileSync(FILE, JSON.stringify(current, null, 2) + '\n');
  console.log(`golden-dmg.json written: ${sha256.slice(0, 16)}  rms ${current.rms}  peak ${current.peak}`);
  process.exit(0);
}

const expected = JSON.parse(readFileSync(FILE, 'utf8'));
const ok = expected.sha256 === sha256;
console.log(`${ok ? 'PASS' : 'FAIL'}  the Game Boy render is byte for byte what it was  ${sha256.slice(0, 16)}${ok ? '' : `, expected ${expected.sha256.slice(0, 16)}`}  rms ${current.rms} (was ${expected.rms})  peak ${current.peak} (was ${expected.peak})`);
if (!ok) console.log('If this was meant, run with --update and say in the commit what moved and why.');
process.exit(ok ? 0 : 1);
