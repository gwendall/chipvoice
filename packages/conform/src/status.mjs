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
  {
    id: 'md',
    machine: 'Mega Drive, Genesis',
    chip: 'YM2612 + SN76489',
    sheet: 'docs/chips/md.md',
    since: '0.11.0',
    analog: { done: 0, label: 'none' },
    driver: { reached: 4, voices: 10 },
    notes: [
      'The YM2612 is Nuked-OPN2 ported line for line and compared with it: parity with the die. The PSG is from the documents and has no oracle yet.',
      'Analog: unmeasured; Nuked\'s own DAC model is marked unverified, the mix and the Model 1 filter are placeholders.',
      'Driver: the lead and the bass on FM, the chord on the PSG, the kit on the noise; four voices of ten.',
      'Remains: a PSG oracle; the LFO, SSG-EG and the DAC in the arranger; a unit\'s line-out.',
    ],
  },
  {
    id: 'snes',
    machine: 'Super Nintendo',
    chip: 'S-DSP',
    sheet: 'docs/chips/snes.md',
    since: '0.12.0',
    analog: { done: 0, label: 'none' },
    driver: { reached: 4, voices: 8 },
    notes: [
      'The S-DSP is snes_spc ported line for line and compared with it on the output stream: parity sample for sample, including the echo and its FIR.',
      'Analog: unmeasured; the DAC and the console\'s filter are a placeholder. A capture of the DSP\'s output would compare directly with the stream.',
      'Driver: a bank of synthesised samples in BRR, four voices of eight, the echo on the pitched ones.',
      'Remains: real triads across voices; a unit\'s line-out; SPC export.',
    ],
  },
  {
    id: 'c64',
    machine: 'Commodore 64',
    chip: 'MOS 6581 SID',
    sheet: 'docs/chips/c64.md',
    since: '0.13.0',
    analog: { done: 0, label: 'profile' },
    driver: { reached: 3, voices: 3 },
    notes: [
      'The SID is written from the documents and compared with reSID-fp, which stays in the harness (GPL): parity on both digital values of every voice, the waveform before its DAC and the envelope counter.',
      'Analog: a profile from the documents, unmeasured: the 6581\'s non-linear DAC ladders, the filter on a measured cutoff curve, the output stage\'s corners. The 8580 is not modelled.',
      'Driver: all three voices, the chord and the kit sharing the third, the drums cutting the chord as C64 tunes did.',
      'Remains: the filter in the arranger; the 8580; a unit\'s line-out; VICE\'s SID test programs on a 6510.',
    ],
  },
];

const PLANNED = [
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
  `Written by \`conform\` on ${new Date().toISOString().slice(0, 10)}. The columns:`,
  '',
  '- **Machine**: the console or computer, and **Chip**: its sound chip, as the package names it.',
  '- **Done**: the mean of the four measures that follow, as a rough single number. The sheet, not this, is the contract.',
  '- **Digital**: how much of the chip\'s digital output matches the reference emulator it is compared with, as the share of runs of edges that line up on step times, a measure that survives an oracle\'s own conventions. A chip ported from a die-derived core reads 100 %.',
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
