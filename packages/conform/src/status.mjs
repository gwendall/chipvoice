import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The board: one row per machine, in the README.
 *
 *   node src/status.mjs
 *
 * The numbers come from what the harness keeps in `corpus/<chip>`: the parity
 * baseline, the ROM verdicts, the mixer measurement. The words next to them -
 * what the driver reaches, what remains - are kept here by hand, because no
 * number says "the filters want a unit's line-out". Machines not started yet
 * have a row too, with what the roadmap plans for them, so the table is the
 * whole plan and not only the part that has numbers.
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
    status: 'in progress',
    driver: 'Every voice but the DMC, which no instrument reaches yet',
    analog: 'The mixer, measured against blargg\'s recordings of his console. The filters and the DAC after them: unmeasured, and want a unit\'s line-out',
    remains: 'A second oracle for the envelope, the sweep and the triangle near a clock; a corpus from real games; a unit for the filters',
  },
  {
    id: 'dmg',
    machine: 'Game Boy',
    chip: 'DMG APU',
    sheet: 'docs/chips/dmg.md',
    since: '0.8.0',
    status: 'in progress',
    driver: 'All four voices: bass on the wave channel, drums as the hardware envelope',
    analog: 'Unmeasured. The output stage is a placeholder built to be replaced by a measurement',
    remains: 'A stronger oracle than Gb_Snd_Emu (SameBoy); a unit\'s line-out; the sweep and the length counters, which no instrument reaches',
  },
];

const PLANNED = [
  { machine: 'Mega Drive, Genesis', chip: 'YM2612 + SN76489', phase: 5, plan: 'Nuked-OPN2, derived from the die, and MAME\'s `sn76496`, both compiled to WebAssembly; parity with Nuked is parity with the silicon' },
  { machine: 'Super Nintendo', chip: 'S-DSP', phase: 6, plan: 'snes_spc or ares compiled to WebAssembly; captures of the DSP\'s serial stream to the DAC exist and are the oracle' },
  { machine: 'Commodore 64', chip: 'SID 6581, 8580', phase: 7, plan: 'reSID-fp per chip profile, or a rewrite from the documents; analog, so a tolerance rather than a bit-for-bit sheet. Licence open, decision B' },
  { machine: 'Later', chip: 'PC Engine, Game Boy Advance, Amiga Paula, POKEY, YM2151, YM2610', phase: null, plan: 'After the five, by demand' },
];

const read = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null);
const pct = (a, b) => (b > 0 ? ((100 * a) / b).toFixed(1) : '0.0');
const millions = (n) => `${(n / 1e6).toFixed(1)}M`;

/** The parity baseline, read for the board: identical cycles, runs aligned, voices identical throughout. */
function parityCell(chip) {
  const parity = read(path.join(ROOT, 'corpus', chip.id, 'parity.json'));
  if (!parity) return 'no baseline yet';
  let runs = 0;
  let aligned = 0;
  const identicalOn = new Map();
  for (const r of parity.results) {
    for (const e of r.edges) {
      runs += e.runs.ours;
      aligned += e.runs.alignedTimes;
      const whole = e.identical === r.cycles && e.onlyA === 0 && e.onlyB === 0;
      identicalOn.set(e.voice, (identicalOn.get(e.voice) ?? 0) + (whole ? 1 : 0));
    }
  }
  const whole = [...identicalOn.entries()].filter(([, n]) => n === parity.files).map(([v]) => `\`${v}\``);
  const parts = [
    `${parity.oracle.name}, ${parity.files} logs, ${millions(parity.cycles)} cycles`,
    `runs aligned on step times ${pct(aligned, runs)} % (${aligned} of ${runs})`,
    `identical cycles ${pct(parity.identical, parity.cycles)} %, the rest being the oracle's own conventions, read on the sheet`,
  ];
  if (whole.length > 0) parts.push(`${whole.join(', ')} identical on every log`);
  return parts.join('; ');
}

function romsCell(chip) {
  const roms = read(path.join(ROOT, 'corpus', chip.id, 'roms.json'));
  if (!roms) return 'not run';
  const suites = [...new Set(roms.results.map((r) => r.name.split('/')[0]))].map((s) => `\`${s}\``).join(', ');
  return `blargg's ${suites}: **${roms.passed} of ${roms.total} pass**`;
}

function analogCell(chip) {
  const mixer = read(path.join(ROOT, 'corpus', chip.id, 'mixer.json'));
  if (!mixer) return chip.analog;
  const measured = mixer.results
    .filter((r) => r.hardware)
    .map((r) => `${r.name} ${r.ours.residual.toFixed(1)} dB (console ${r.hardware.residual.toFixed(1)})`)
    .join(', ');
  return `${chip.analog}. Cancellation against the DMC: ${measured}`;
}

function rows() {
  const out = [];
  for (const chip of CHIPS) {
    out.push(
      `| ${chip.machine} | [${chip.chip}](${chip.sheet}) | ${chip.status}, since ${chip.since} | ${parityCell(chip)} | ${romsCell(chip)} | ${analogCell(chip)} | ${chip.driver} | ${chip.remains} |`,
    );
  }
  for (const p of PLANNED) {
    const status = p.phase ? `planned, phase ${p.phase}` : 'not planned yet';
    out.push(`| ${p.machine} | ${p.chip} | ${status} | ${p.plan} | | | | not started |`);
  }
  return out;
}

const block = [
  '<!-- status:begin -->',
  `Written by \`conform\` on ${new Date().toISOString().slice(0, 10)}. "Runs aligned" is the measure that survives an oracle's own conventions: a run of edges lines up when its step times match under one shift; see each sheet for the reading.`,
  '',
  '| Machine | Chip | Status | Digital parity | Test ROMs | Analog stage | Driver | What remains |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ...rows(),
  '<!-- status:end -->',
].join('\n');

const text = fs.readFileSync(README, 'utf8');
const begin = text.indexOf('<!-- status:begin -->');
const end = text.indexOf('<!-- status:end -->');
if (begin < 0 || end < 0) throw new Error('README.md has no status markers');
fs.writeFileSync(README, text.slice(0, begin) + block + text.slice(end + '<!-- status:end -->'.length));
console.log(`README status board written: ${CHIPS.length} chips, ${PLANNED.length} planned`);
