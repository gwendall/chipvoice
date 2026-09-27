import fs from 'node:fs';
import path from 'node:path';
import { vgmToWrites } from '../vgm.mjs';
import { formatLog } from '../log.mjs';

/**
 * VGM files into the corpus.
 *
 *   node src/corpus/import-vgm.mjs <file.vgm|file.vgz>... [--chip 2a03|dmg] [--out corpus/2a03] [--seconds 30]
 *
 * Each file becomes one log, named after the file, capped at `--seconds` so
 * a ten-minute rip does not become a ten-minute test. The log's `source` line
 * names the file, and nothing else about it is kept: a rip of a commercial
 * game is corpus material on a developer's machine and not in this
 * repository, which holds only what it may. `--chip` defaults to `2a03`; a
 * 2A03 file's DPCM data blocks (VGM data-block type 0xC2) become the log's
 * `# memory` lines, for the DMC to read.
 */
const CLOCKS = { '2a03': 1789773, dmg: 4194304 };
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const chip = option('chip', '2a03');
if (!CLOCKS[chip]) { console.error(`unsupported --chip ${chip} (expected 2a03 or dmg)`); process.exit(2); }
const clock = CLOCKS[chip];
const out = option('out', `corpus/${chip}`);
const cap = Number(option('seconds', '30'));
const files = args.filter((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--')));
if (files.length === 0) {
  console.error('usage: import-vgm <file.vgm>... [--chip 2a03|dmg] [--out dir] [--seconds n]');
  process.exit(2);
}

fs.mkdirSync(out, { recursive: true });
for (const file of files) {
  const { writes, cycles, loopAtCycle, memory } = vgmToWrites(new Uint8Array(fs.readFileSync(file)), chip);
  const limit = Math.min(cycles, Math.round(cap * clock));
  const name = 'vgm-' + path.basename(file).replace(/\.(vgm|vgz)$/i, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const kept = writes.filter((w) => w.at < limit);
  const text = formatLog(
    {
      name,
      chip,
      clock,
      cycles: limit,
      source: path.basename(file),
      notes: `imported from VGM; ${writes.length} writes, ${(cycles / clock).toFixed(1)} s in the file${loopAtCycle >= 0 ? `, loop at cycle ${loopAtCycle}` : ''}`,
      memory,
    },
    kept,
  );
  fs.writeFileSync(path.join(out, `${name}.log`), text);
  console.log(`${name.padEnd(30)} ${String(kept.length).padStart(6)} writes, ${(limit / clock).toFixed(1)} s`);
}
