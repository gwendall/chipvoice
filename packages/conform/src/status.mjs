import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The board: one row per machine, in the README, dense.
 *
 *   node src/status.mjs
 *
 * A cell is a mark and a number, nothing more, so the table reads at a
 * glance; the words go in the notes under it, one paragraph per machine. The
 * numbers come from what the harness keeps in `corpus/<chip>`: the parity
 * baseline, the ROM verdicts, the mixer measurement. The words - what the
 * driver reaches, what remains - are kept here by hand, because no number
 * says "the filters want a unit's line-out". Machines not started have a row
 * with the roadmap's plan, so the table is the whole plan and not only the
 * part that has numbers.
 *
 * "Done" is the mean of four fractions: runs aligned with the oracle, test
 * ROMs passing, the analog stage measured, voices the driver reaches. It is a
 * rough number by design, and CONFORMANCE.md says what each part means.
 *
 * Written between `<!-- status:begin -->` and `<!-- status:end -->` in the
 * repository's README by every script that changes a number.
 */
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const README = path.join(ROOT, '..', '..', 'README.md');

const CHIPS = [
  {
    id: '2a03',
    machine: 'NES, Famicom',
    chip: 'Ricoh 2A03',
    sheet: 'docs/chips/2a03.md',
    since: '0.1.0',
    /** The analog stage: how much of it is measured, and the word for the cell. */
    analog: { done: 0.5, label: 'mixer' },
    /** Voices the driver reaches, of the chip's. */
    driver: { reached: 4, voices: 5 },
    notes: [
      'Analog: the mixer measured against blargg\'s recordings of his console; the filters and the DAC after them unmeasured, and want a unit\'s line-out.',
      'Driver: every voice but the DMC, which no instrument reaches yet.',
      'Remains: a second oracle for the envelope, the sweep and the triangle near a clock; a corpus from real games; a unit for the filters.',
    ],
  },
  {
    id: 'dmg',
    machine: 'Game Boy',
    chip: 'DMG APU',
    sheet: 'docs/chips/dmg.md',
    since: '0.8.0',
    analog: { done: 0, label: 'none' },
    driver: { reached: 4, voices: 4 },
    notes: [
      'Analog: unmeasured; the output stage is a placeholder built to be replaced by a measurement.',
      'Driver: all four voices, the bass on the wave channel, drums as the hardware envelope.',
      'Remains: a stronger oracle than Gb_Snd_Emu (SameBoy); a unit\'s line-out; the sweep and the length counters, which no instrument reaches.',
    ],
  },
];

const PLANNED = [
  { machine: 'Mega Drive, Genesis', chip: 'YM2612 + SN76489', phase: 5, plan: 'Nuked-OPN2, derived from the die, and MAME\'s `sn76496`, both compiled to WebAssembly; parity with Nuked is parity with the silicon.' },
  { machine: 'Super Nintendo', chip: 'S-DSP', phase: 6, plan: 'snes_spc or ares compiled to WebAssembly; captures of the DSP\'s serial stream to the DAC exist and are the oracle.' },
  { machine: 'Commodore 64', chip: 'SID 6581, 8580', phase: 7, plan: 'reSID-fp per chip profile, or a rewrite from the documents; analog, so a tolerance rather than a bit-for-bit sheet. Licence open, decision B.' },
  { machine: 'Later', chip: 'PC Engine, GBA, Amiga, POKEY, YM2151, YM2610', phase: null, plan: 'After the five, by demand.' },
];

const read = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null);
const pct = (x, digits = 0) => `${(100 * x).toFixed(digits)} %`;
const millions = (n) => `${(n / 1e6).toFixed(1)}M`;
/** A mark for a fraction: done, part way, nothing. */
const mark = (x) => (x >= 0.95 ? '✅' : x > 0 ? '🟡' : '❌');

/** The parity baseline, read for the board. */
function parity(chip) {
  const p = read(path.join(ROOT, 'corpus', chip.id, 'parity.json'));
  if (!p) return null;
  let runs = 0;
  let aligned = 0;
  for (const r of p.results) {
    for (const e of r.edges) {
      runs += e.runs.ours;
      aligned += e.runs.alignedTimes;
    }
  }
  return { oracle: p.oracle.name, files: p.files, cycles: p.cycles, runs, aligned, fraction: runs > 0 ? aligned / runs : 0, identical: p.cycles > 0 ? p.identical / p.cycles : 0 };
}

function roms(chip) {
  const r = read(path.join(ROOT, 'corpus', chip.id, 'roms.json'));
  if (!r) return null;
  const suites = [...new Set(r.results.map((x) => x.name.split('/')[0]))];
  return { passed: r.passed, total: r.total, suites, fraction: r.total > 0 ? r.passed / r.total : 0 };
}

function mixer(chip) {
  const m = read(path.join(ROOT, 'corpus', chip.id, 'mixer.json'));
  if (!m) return null;
  return m.results.filter((r) => r.hardware).map((r) => `${r.name} ${r.ours.residual.toFixed(1)} dB (console ${r.hardware.residual.toFixed(1)})`);
}

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
  if (r) notes.push(`ROMs: blargg's ${r.suites.map((s) => `\`${s}\``).join(', ')}, ${r.passed} of ${r.total} pass.`);
  const m = mixer(chip);
  notes.push(...chip.notes.map((n) => (n.startsWith('Analog:') && m ? `${n} Cancellation against the DMC: ${m.join(', ')}.` : n)));
  return { line: `| ${cells.join(' | ')} |`, note: `**${chip.machine}** (${chip.chip}, since ${chip.since}). ${notes.join(' ')}` };
}

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
  `Written by \`conform\` on ${new Date().toISOString().slice(0, 10)}. **Digital**: runs of edges that line up with the oracle on step times, which survives an oracle's own conventions. **ROMs**: blargg's test ROMs passing on the harness's own CPU. **Analog**: how much of the stage after the DACs is measured against a real unit. **Driver**: voices the driver reaches. **Done**: the mean of the four; rough by design.`,
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
