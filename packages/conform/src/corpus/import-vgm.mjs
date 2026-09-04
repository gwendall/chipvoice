import fs from 'node:fs';
import path from 'node:path';
import { vgmToWrites } from '../vgm.mjs';
import { formatLog } from '../log.mjs';

/**
 * VGM files into the corpus.
 *
 *   node src/corpus/import-vgm.mjs <file.vgm|file.vgz>... [--out corpus/2a03] [--seconds 30]
 *
 * Each file becomes one log, named after the file, capped at `--seconds` so
 * a ten-minute rip does not become a ten-minute test. The log's `source` line
 * names the file, and nothing else about it is kept: a rip of a commercial
 * game is corpus material on a developer's machine and not in this
 * repository, which holds only what it may.
 */
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const out = option('out', 'corpus/2a03');
const cap = Number(option('seconds', '30'));
const files = args.filter((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--')));
if (files.length === 0) {
  console.error('usage: import-vgm <file.vgm>... [--out dir] [--seconds n]');
  process.exit(2);
}

fs.mkdirSync(out, { recursive: true });
for (const file of files) {
  const { writes, cycles, loopAtCycle } = vgmToWrites(new Uint8Array(fs.readFileSync(file)));
  const limit = Math.min(cycles, Math.round(cap * 1789773));
  const name = 'vgm-' + path.basename(file).replace(/\.(vgm|vgz)$/i, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const kept = writes.filter((w) => w.at < limit);
  const text = formatLog(
    {
      name,
      chip: '2a03',
      clock: 1789773,
      cycles: limit,
      source: path.basename(file),
      notes: `imported from VGM; ${writes.length} writes, ${(cycles / 1789773).toFixed(1)} s in the file${loopAtCycle >= 0 ? `, loop at cycle ${loopAtCycle}` : ''}`,
    },
    kept,
  );
  fs.writeFileSync(path.join(out, `${name}.log`), text);
  console.log(`${name.padEnd(30)} ${String(kept.length).padStart(6)} writes, ${(limit / 1789773).toFixed(1)} s`);
}
