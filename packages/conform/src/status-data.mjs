import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The chip roster and the numbers behind it: read once here, written to the
 * README board by `status.mjs` and to the public accuracy page's data file by
 * `accuracy-data.mjs`. Neither of those files types a number; both call the
 * helpers below, which read what the harness already wrote to `corpus/<chip>`.
 *
 * "Done" is the mean of four fractions: runs aligned with the oracle, test
 * ROMs passing, the analog stage measured, voices the driver reaches. It is a
 * rough number by design, and CONFORMANCE.md says what each part means.
 */
export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export const CHIPS = [
  {
    id: '2a03',
    machine: 'NES, Famicom',
    chip: 'Ricoh 2A03',
    sheet: 'docs/chips/2a03.md',
    since: '0.1.0',
    romsSource: "blargg's",
    /** The analog stage: how much of it is measured, and the word for the cell. */
    analog: { done: 0.5, label: 'mixer' },
    /** Voices the driver reaches, of the chip's. */
    driver: { reached: 4, voices: 5 },
    /** In trace order, matching the chip's own voices array in `chips/2a03.mjs`. */
    voices: ['p1', 'p2', 'tri', 'noi', 'dmc'],
    notes: [
      'Analog: the mixer measured against blargg\'s recordings of his console; the filters and the DAC after them unmeasured, and want a unit\'s line-out.',
      'Driver: every voice but the DMC, which no instrument reaches yet.',
      'Remains: a corpus from real games; a unit for the filters.',
    ],
  },
  {
    id: 'dmg',
    machine: 'Game Boy',
    chip: 'DMG APU',
    sheet: 'docs/chips/dmg.md',
    since: '0.8.0',
    romsSource: "blargg's",
    analog: { done: 0, label: 'none' },
    driver: { reached: 4, voices: 4 },
    voices: ['ch1', 'ch2', 'ch3', 'ch4'],
    notes: [
      'Analog: unmeasured; the output stage is a placeholder built to be replaced by a measurement.',
      'Driver: all four voices, the bass on the wave channel, drums as the hardware envelope.',
      'Remains: where the noise clock stands when a note is triggered, which the documents disagree on and SameBoy, the second oracle, reads the other way; a unit\'s line-out; the sweep and the length counters, which no instrument reaches.',
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
    voices: ['fm1', 'fm2', 'fm3', 'fm4', 'fm5', 'fm6', 'psg1', 'psg2', 'psg3', 'noise'],
    notes: [
      'The YM2612 is Nuked-OPN2 ported line for line and compared with it: parity with the reference on this corpus, not a direct silicon capture. The PSG is also compared against MAME\'s sn76496, with three diagnosed divergences: a tone period of 0 or 1, the polarity a channel starts at before its first reload, and tone 3\'s noise rate.',
      'Analog: unmeasured; Nuked\'s own DAC model is marked unverified, the mix and the Model 1 filter are placeholders.',
      'Driver: the lead and the bass on FM, the chord on the PSG, the kit on the noise (or channel 6\'s own FM drums, perc: "punchy"); four voices of ten. The LFO sounds in both drivers now; channel 3\'s special mode in the native one.',
      'Remains: SSG-EG and the DAC in the arranger; a unit\'s line-out.',
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
    voices: ['left', 'right'],
    notes: [
      'The S-DSP is snes_spc ported line for line and compared with it on the output stream: parity sample for sample, including the echo and its FIR.',
      'Analog: unmeasured; the DAC and the console\'s filter are a placeholder. A capture of the DSP\'s output would compare directly with the stream.',
      'Driver: a build-time BRR sample bank with hardware envelopes; lead, bass and percussion plus up to five simultaneous chord voices, with a shared chord volume budget.',
      'Remains: a unit\'s line-out; SPC export.',
    ],
  },
  {
    id: 'c64',
    machine: 'Commodore 64',
    chip: 'MOS 6581 SID',
    sheet: 'docs/chips/c64.md',
    since: '0.13.0',
    romsSource: "VICE's `testprogs/SID` on a 6510:",
    analog: { done: 0, label: 'profile' },
    driver: { reached: 3, voices: 3 },
    voices: ['osc1', 'osc2', 'osc3', 'env1', 'env2', 'env3'],
    notes: [
      'The SID is written from the documents and compared with reSID-fp, which stays in the harness (GPL): parity on both digital values of every voice, the waveform before its DAC and the envelope counter. Also compared with reSID-fp configured as an 8580: 99.3 % identical, diverging only in the two logs that select a combined waveform, where the model\'s own fit to that chip falls short of the 6581\'s exact match.',
      'Analog: a profile from the documents, unmeasured: the 6581\'s non-linear DAC ladders, the filter on a measured cutoff curve, the output stage\'s corners; the 8580\'s own near-linear DACs and filter curve, from reSID-fp\'s Dac docs and reSID\'s filter.cc, also unmeasured.',
      'Driver: all three voices, the chord and the kit sharing the third, the drums cutting the chord as C64 tunes did; the filter reachable from the arranger, a lead\'s sweep and a bass\'s resonance, on either model.',
      'Remains: a unit\'s line-out, for either model.',
    ],
  },
  {
    id: 'vrc6',
    machine: 'NES, Famicom (Konami VRC6 cartridges)',
    chip: 'Konami VRC6',
    sheet: 'docs/chips/vrc6.md',
    since: '0.19.1',
    analog: { done: 0, label: 'none' },
    /** Voices the driver reaches, of the chip's. None yet: decision 38 keeps VRC6 out of the studio picker and the arranger. */
    driver: { reached: 0, voices: 3 },
    voices: ['vp1', 'vp2', 'vsaw'],
    notes: [
      'The VRC6 is written from the nesdev wiki and Konami\'s own VRC6 documents, compared against two independent oracles: Game_Music_Emu\'s Nes_Vrc6_Apu and, since round 2, Mesen 2\'s own vendored VRC6 audio (both LGPL, stay in the harness). The corpus is split by what each script exercises: `core` scripts gate at a literal 100 % against both oracles; `edge` scripts (disable/re-enable, `$9003`, tiny periods) gate exactly against Mesen 2, which models all three, and report-only against Game_Music_Emu, which does not (read from `Nes_Vrc6_Apu.cpp`, not a guess). The original eight-script corpus stays on its own no-regression baseline: 38.1 % against Game_Music_Emu, 23.6 % against Mesen 2 - the per-run, shift-tolerant fraction this board reads instead is 79.0 % of 105 runs, the same way the 2A03\'s own triangle stays trusted despite a 0 % raw match in some of its logs.',
      'Analog: unmeasured; the mixing stage is a duplicate of the 2A03\'s own filter math (proven bit-identical to it when the VRC6 side is silent), the documented pulse-polarity inversion modelled in the mixer, and the three extra voices\' own gain a documented formula, not an independent measurement.',
      'Driver: none yet - the studio picker and the arranger do not reach VRC6 (decision 38); NSF export and the conformance harness are its only public paths today.',
      'Remains: a studio/arranger integration; a real test ROM (none exists to automate - see the sheet); a unit\'s line-out.',
    ],
  },
  {
    id: 'ay8910',
    machine: 'NES, Famicom (Sunsoft 5B mapper: Gimmick!)',
    chip: 'AY-3-8910 / YM2149, first hosted as the Sunsoft 5B',
    sheet: 'docs/chips/sunsoft5b.md',
    since: '0.19.1',
    analog: { done: 0, label: 'none' },
    /** Voices the driver reaches, of the chip's. None yet: decision 38 keeps this chip out of the studio picker and the arranger. */
    driver: { reached: 0, voices: 3 },
    voices: ['a', 'b', 'c'],
    notes: [
      'Written from nesdev\'s "Sunsoft 5B audio" page and General Instrument\'s AY-3-8910/8912/8913 datasheet, compared against two independent oracles: Peter Sovietov\'s Ayumi (MIT) and Game_Music_Emu\'s Ay_Apu (LGPL, stays in the harness). The corpus is split by what each script exercises: `core` (DAC mode, both generators bypassed) gates at a literal 100 % against both oracles; `edge` (tone/noise/envelope running) gates exactly against Ayumi wherever it has no known disagreement, and is report-only elsewhere. The two oracles\' own noise generators use provably different 17-bit LFSR constructions (Galois vs Fibonacci feedback, decision 47) - the first time this project\'s two oracles for one chip have disagreed with each other on a specific feature rather than one being trusted over the other for the whole chip.',
      'Analog: unmeasured; the DAC curve is nesdev\'s own documented 1.5 dB/step logarithmic table, the mix gain into the composite render a placeholder reusing VRC6\'s own anchor point for lack of a better documented one.',
      'Driver: none yet - the studio picker and the arranger do not reach this chip (decision 38); NSF export and the conformance harness are its only public paths today.',
      'Remains: a studio/arranger integration; a real test ROM (none found to automate - see the sheet); a unit\'s line-out; other AY/YM hosts (MSX, the YM2203/YM2608 SSG half).',
    ],
  },
];

export const PLANNED = [
  { machine: 'Later', chip: 'PC Engine, GBA, Amiga, POKEY, YM2151, YM2610', phase: null, plan: 'After the five, by demand.' },
];

export const read = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null);
export const pct = (x, digits = 0) => `${(100 * x).toFixed(digits)} %`;
export const millions = (n) => `${(n / 1e6).toFixed(1)}M`;
/** A mark for a fraction: done, part way, nothing. */
export const mark = (x) => (x >= 0.95 ? '✅' : x > 0 ? '🟡' : '❌');

/** The parity baseline, read for the board, from `corpus/<chip>/parity.json` (the primary oracle). */
export function parity(chip) {
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

export function roms(chip) {
  const r = read(path.join(ROOT, 'corpus', chip.id, 'roms.json'));
  if (!r) return null;
  const suites = [...new Set(r.results.map((x) => x.name.split('/')[0]))];
  return { passed: r.passed, total: r.total, suites, fraction: r.total > 0 ? r.passed / r.total : 0 };
}

export function mixer(chip) {
  const m = read(path.join(ROOT, 'corpus', chip.id, 'mixer.json'));
  if (!m) return null;
  return m.results.filter((r) => r.hardware).map((r) => `${r.name} ${r.ours.residual.toFixed(1)} dB (console ${r.hardware.residual.toFixed(1)})`);
}
