import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { combinedWaveform, COMBINED_6581 } from 'chipvoice';

/**
 * The combined-waveform model against a real 6581's samples, not just against
 * reSID-fp's own table of them.
 *
 *   node src/evidence/c64-combined.mjs [--json <file>] [--sheet <file>]
 *
 * `pnpm --filter chipvoice-conform fit:c64` already checks the model against
 * reSID-fp's twelve-bit table, and matches it on all 4096 entries; but that
 * table is itself a fit to kevtris's samplings of one 6581 R2 (decision 18),
 * so a 100% score there is a 100% score against a fit, not against a second,
 * independent chip. `libsidplayfp/combined-waveforms` publishes an unrelated
 * project's raw OSC3 samplings of named physical SID units - real hardware
 * this codebase has never seen. `pnpm --filter chipvoice-conform evidence:fetch
 * c64` downloads one 6581 R4AR's four files (docs/HARDWARE-EVIDENCE.md has the
 * source and licence); this script reads them and scores our model against
 * that unit directly.
 *
 * OSC3, the register these hardware samplings were taken from, exposes only
 * the top eight of the waveform generator's twelve bits, so `value >> 4` is
 * what a real capture could ever see; `combined-waveforms`' own scoring tool
 * (`src/parameters.h`'s `GetScore8`) does the same shift before comparing.
 * Bytes matching exactly, and the Hamming distance in wrong bits, are what it
 * reports too, so the numbers here are comparable to that project's own.
 */
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = path.join(ROOT, '.artifacts', 'hardware-evidence', 'c64');
const UNIT = '6581R4AR_3789_14';
const WAVEFORMS = [
  { wf: 3, name: 'saw+triangle', file: `${UNIT}-wf30.dat.prg` },
  { wf: 5, name: 'pulse+triangle', file: `${UNIT}-wf50.dat.prg` },
  { wf: 6, name: 'pulse+saw', file: `${UNIT}-wf60.dat.prg` },
  { wf: 7, name: 'pulse+saw+triangle', file: `${UNIT}-wf70.dat.prg` },
];

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

function readSamples(file) {
  const full = path.join(DIR, file);
  if (!fs.existsSync(full)) {
    throw new Error(`${full} is missing; run: pnpm --filter chipvoice-conform evidence:fetch c64`);
  }
  const bytes = fs.readFileSync(full);
  if (bytes.length !== 4098) throw new Error(`${full} is ${bytes.length} bytes, not the expected 4098 (a two-byte PRG header plus 4096 samples)`);
  // The first two bytes are a Commodore PRG load address, not a sample.
  return bytes.subarray(2);
}

function wrongBits(a, b) {
  let x = a ^ b;
  let count = 0;
  while (x) {
    count += x & 1;
    x >>= 1;
  }
  return count;
}

const results = [];
for (const { wf, name, file } of WAVEFORMS) {
  const samples = readSamples(file);
  let exact = 0;
  let bits = 0;
  for (let i = 0; i < 4096; i++) {
    const predicted = (combinedWaveform(COMBINED_6581[wf], wf, i) >> 4) & 0xff;
    const reference = samples[i];
    if (predicted === reference) exact++;
    bits += wrongBits(predicted, reference);
  }
  results.push({ wf, name, exact, bits });
  console.log(`${name.padEnd(18)} ${((exact / 4096) * 100).toFixed(1)}% bytes exact (${exact}/4096), ${bits}/32768 wrong bits`);
}

console.log(`\nAgainst ${UNIT} (libsidplayfp/combined-waveforms), a chip the model was never fitted to; not the analog stage, the pre-DAC waveform generator.`);

const jsonPath = option('json', null);
if (jsonPath) {
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify({ date: new Date().toISOString().slice(0, 10), unit: UNIT, results }, null, 2) + '\n');
}

const sheetPath = option('sheet', null);
if (sheetPath) {
  const text = fs.readFileSync(sheetPath, 'utf8');
  const begin = text.indexOf('<!-- hwcombined:begin -->');
  const end = text.indexOf('<!-- hwcombined:end -->');
  if (begin < 0 || end < 0) throw new Error(`${sheetPath} has no hwcombined markers`);
  const combos = results.map((r) => r.name).join(', ');
  const lines = [
    '<!-- hwcombined:begin -->',
    `Written by \`conform\` on ${new Date().toISOString().slice(0, 10)}, against libsidplayfp/combined-waveforms' sampling of ${UNIT} (OSC3, the top eight of the twelve bits), on ${combos}.`,
    '',
    '| Combination | Bytes matching | Wrong bits |',
    '| --- | --- | --- |',
    ...results.map((r) => `| \`${r.name}\` | ${((r.exact / 4096) * 100).toFixed(1)} % (${r.exact}/4096) | ${r.bits}/32768 |`),
    '<!-- hwcombined:end -->',
  ];
  fs.writeFileSync(sheetPath, text.slice(0, begin) + lines.join('\n') + text.slice(end + '<!-- hwcombined:end -->'.length));
}
