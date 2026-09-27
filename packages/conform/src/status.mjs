import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, CHIPS, PLANNED, parity, roms, mixer, pct, millions, mark } from './status-data.mjs';

/**
 * The board: one row per machine, in the README, dense.
 *
 *   node src/status.mjs
 *
 * A cell is a mark and a number, nothing more, so the table reads at a
 * glance; the words go in the notes under it, one paragraph per machine. The
 * chip roster and the numbers themselves live in `status-data.mjs`, shared
 * with `accuracy-data.mjs`, which writes the same numbers to the public
 * accuracy page. Machines not started have a row with the roadmap's plan, so
 * the table is the whole plan and not only the part that has numbers.
 *
 * Written between `<!-- status:begin -->` and `<!-- status:end -->` in the
 * repository's README by every script that changes a number.
 */
const README = path.join(ROOT, '..', '..', 'README.md');

function row(chip) {
  const p = parity(chip);
  const r = roms(chip);
  const driver = chip.driver.reached / chip.driver.voices;
  const done = ((p?.fraction ?? 0) + (r?.fraction ?? 0) + chip.analog.done + driver) / 4;
  const cells = [
    chip.machine,
    chip.chip,
    `**${pct(done)}**`,
    p ? `${mark(p.fraction)} ${pct(p.fraction)}` : '⬜',
    r ? `${mark(r.fraction)} ${r.passed}/${r.total}` : '⬜',
    `${mark(chip.analog.done)} ${chip.analog.label}`,
    `${mark(driver)} ${chip.driver.reached}/${chip.driver.voices}`,
    `[${chip.id}](${chip.sheet})`,
  ];
  const notes = [];
  if (p) notes.push(`Digital: ${p.oracle}, ${p.files} logs, ${millions(p.cycles)} cycles; runs aligned on step times ${pct(p.fraction, 1)} (${p.aligned} of ${p.runs}); identical cycles ${pct(p.identical, 1)}, the rest the oracle's own conventions, read on the sheet.`);
  if (r) notes.push(`ROMs: ${chip.romsSource ?? "blargg's"} ${r.suites.map((s) => `\`${s}\``).join(', ')}, ${r.passed} of ${r.total} pass.`);
  const m = mixer(chip);
  notes.push(...chip.notes.map((n) => (n.startsWith('Analog:') && m ? `${n} Cancellation against the DMC: ${m.join(', ')}.` : n)));
  return { line: `| ${cells.join(' | ')} |`, note: `**${chip.machine}** (${chip.chip}, since ${chip.since}). ${notes.join(' ')}` };
}

/** Renders and writes the README's status board. The only side effect in this file. */
export function writeReadmeBoard() {
  const rows = CHIPS.map(row);
  const planned = PLANNED.map((p) => ({
    line: `| ${p.machine} | ${p.chip} | 0 % | ⬜ | ⬜ | ⬜ | ⬜ | ${p.phase ? `phase ${p.phase}` : 'later'} |`,
    note: `**${p.machine}** (${p.chip}). ${p.phase ? `Planned, phase ${p.phase}: ` : ''}${p.plan}`,
  }));

  const block = [
    '<!-- status:begin -->',
    '| Machine | Chip | Done | Digital | ROMs | Analog | Driver | Sheet |',
    '| --- | --- | ---: | --- | --- | --- | --- | --- |',
    ...rows.map((r) => r.line),
    ...planned.map((p) => p.line),
    '',
    `Written by \`conform\` on ${new Date().toISOString().slice(0, 10)}. The columns:`,
    '',
    '- **Machine**: the console or computer, and **Chip**: its sound chip, as the package names it.',
    '- **Done**: the mean of the four measures that follow, as a rough single number. The sheet, not this, is the contract.',
    '- **Digital**: how much of the chip\'s digital output matches the reference emulator it is compared with, as the share of runs of edges that line up on step times, a measure that survives an oracle\'s own conventions. 100 % describes this corpus and oracle, not exhaustive hardware accuracy.',
    '- **ROMs**: the community\'s test ROMs for the chip passing on a CPU the harness carries; a dash when none exist.',
    '- **Analog**: how much of the stage after the chip\'s DACs - mixing, filters, the console\'s output - is measured against a real unit.',
    '- **Driver**: the voices the driver plays, of the chip\'s; the rest exist and are verified but no song reaches them.',
    '- **Sheet**: the chip\'s conformance sheet, with the detail behind every cell; or the roadmap phase a machine is planned for.',
    '',
    [...rows, ...planned].map((r) => r.note).join('\n\n'),
    '<!-- status:end -->',
  ].join('\n');

  const text = fs.readFileSync(README, 'utf8');
  const begin = text.indexOf('<!-- status:begin -->');
  const end = text.indexOf('<!-- status:end -->');
  if (begin < 0 || end < 0) throw new Error('README.md has no status markers');
  fs.writeFileSync(README, text.slice(0, begin) + block + text.slice(end + '<!-- status:end -->'.length));
  console.log(`README status board written: ${CHIPS.length} chips, ${PLANNED.length} planned`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeReadmeBoard();
  // The same numbers, for chipvoice.dev's public accuracy page (NEXT-12):
  // one command regenerates both, since every baseline/ROMs/mixer script
  // already ends with `node src/status.mjs`.
  const { writeAccuracyData } = await import('./accuracy-data.mjs');
  writeAccuracyData();
}
