import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { arrange, renderSong } from '../dist/index.js';

/**
 * The SNES render, locked: the golden score arranged for the third
 * chip, hashed and compared with the hash on file. Everything `golden.mjs`
 * says applies; the file is written on the first run.
 */
const FILE = new URL('./golden-c64.json', import.meta.url);

const SCORE = {
  id: 'golden', bpm: 152, order: [0], gain: 1,
  patterns: [{
    bass:  'A1 . A1 . A1 . A1 . A1 . A1 . A1 . G1 .',
    lead:  'E4 . . . G4 . A4 . . . B4 . C5 . . .',
    chord: 'A3 . . . . . . . . . . . . . . .',
    chordShape: [[0, 3, 7]],
    perc:  'K . H . S . H . K . H K S . H .',
  }],
};
const SECONDS = 4;

const result = renderSong(arrange(SCORE, 'c64'), { seconds: SECONDS, chip: 'c64', stereo: false });
const hash = createHash('sha256');
hash.update(Buffer.from(result.left.buffer));
const sha256 = hash.digest('hex');
let rms = 0;
for (let i = 0; i < result.left.length; i++) rms += result.left[i] * result.left[i];
rms = Math.sqrt(rms / result.left.length);
const current = { sha256, rms: Number(rms.toFixed(4)), peak: Number(result.peak.toFixed(4)) };

if (process.argv.includes('--update') || !existsSync(FILE)) {
  writeFileSync(FILE, JSON.stringify(current, null, 2) + '\n');
  console.log(`golden-c64.json written: ${sha256.slice(0, 16)}  rms ${current.rms}  peak ${current.peak}`);
  process.exit(0);
}

const expected = JSON.parse(readFileSync(FILE, 'utf8'));
const ok = expected.sha256 === sha256;
console.log(`${ok ? 'PASS' : 'FAIL'}  the SNES render is byte for byte what it was  ${sha256.slice(0, 16)}${ok ? '' : `, expected ${expected.sha256.slice(0, 16)}`}  rms ${current.rms} (was ${expected.rms})  peak ${current.peak} (was ${expected.peak})`);
if (!ok) console.log('If this was meant, run with --update and say in the commit what moved and why.');
process.exit(ok ? 0 : 1);
