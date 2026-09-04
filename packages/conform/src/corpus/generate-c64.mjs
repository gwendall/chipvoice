import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { arrange, recordSong } from 'chipvoice';
import { formatLog } from '../log.mjs';

/**
 * The C64 corpus, generated.
 *
 * Songs through the real driver, in the machine's idiom - three voices for
 * four lines, the drums cutting the chord - and scripts of hand-written
 * writes that reach what the driver does not: every waveform at several
 * pitches and pulse widths, the combined waveforms, the noise at its rates
 * and its reset by the test bit, every attack, decay and release rate, the
 * sustain levels, the ADSR delay bug, gate changes a few cycles apart, sync
 * and ring modulation at several ratios, the test bit on a sync source, the
 * floating output. A log is in PAL cycles; writes are four apart, as a 6510
 * makes them.
 */
const CLOCK = 985248;
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'corpus', 'c64');

const PREROLL = 0.1;
const second = (s) => Math.round((PREROLL + s) * CLOCK);
const V = (v) => 0xd400 + 7 * v;
const F = (hz) => Math.max(0, Math.min(0xffff, Math.round((hz * 16777216) / CLOCK)));
const note = (n) => 440 * 2 ** ((n - 69) / 12);

/** A register writer with a cursor: each write costs a store's four cycles. */
function writer() {
  const writes = [];
  let t = 0;
  return {
    writes,
    at(time) { t = time; },
    w(addr, value) {
      writes.push([t, addr, value & 0xff]);
      t += 4;
    },
    /** A voice's whole register set, the control last. */
    voice(v, { f, pw = 0x800, ad = 0x00, sr = 0xf0, control }) {
      this.w(V(v), f & 0xff);
      this.w(V(v) + 1, f >> 8);
      this.w(V(v) + 2, pw & 0xff);
      this.w(V(v) + 3, pw >> 8);
      this.w(V(v) + 5, ad);
      this.w(V(v) + 6, sr);
      this.w(V(v) + 4, control);
    },
  };
}

/*
 * A sawtooth or a triangle at an audible pitch changes its twelve bits on
 * nearly every cycle, and the harness holds every change of every stream in
 * memory: the scripts use pulses, which change twice a period, wherever the
 * waveform is not what is under test, and keep the dense ones short.
 */
const SCRIPTS = [
  {
    name: 'script-waveforms',
    notes: 'Voice 1 through the triangle, the sawtooth and three pulse widths at three pitches; voice 2 the noise at eight rates; voice 3 a waveform switched mid-note, then none at all.',
    cycles: second(3.6),
    writes: (() => {
      const w = writer();
      let i = 0;
      for (const [control, pw] of [[0x11, 0x800], [0x21, 0x800], [0x41, 0x200], [0x41, 0x800], [0x41, 0xe00]]) {
        for (const n of [36, 57, 81]) {
          w.at(second(i * 0.22));
          w.voice(0, { f: F(note(n)), pw, control });
          w.at(second(i * 0.22 + 0.12));
          w.w(V(0) + 4, control & 0xfe);
          i++;
        }
      }
      for (let k = 0; k < 8; k++) {
        w.at(second(k * 0.44));
        w.voice(1, { f: [0x0100, 0x0400, 0x1000, 0x2000, 0x4000, 0x8000, 0xc000, 0xffff][k], control: 0x81 });
        w.at(second(k * 0.44 + 0.4));
        w.w(V(1) + 4, 0x80);
      }
      w.at(second(0));
      w.voice(2, { f: F(note(52)), control: 0x41 });
      for (let k = 0; k < 6; k++) {
        w.at(second(0.4 + k * 0.4));
        w.w(V(2) + 4, [0x11, 0x41, 0x81, 0x21, 0x01, 0x41][k]);
        if (k === 0 || k === 3) {
          w.at(second(0.4 + k * 0.4 + 0.15));
          w.w(V(2) + 4, 0x41);
        }
      }
      w.at(second(3.0));
      w.w(V(2) + 4, 0x00);
      return w.writes;
    })(),
  },
  {
    name: 'script-envelopes',
    notes: 'Every attack rate on voice 1, every decay rate to a sustain on voice 2, every sustain level then every release rate on voice 3, all on pulses; then gates a few cycles apart in every phase, and a rate set below the counter mid-attack, the ADSR delay bug.',
    cycles: second(8),
    writes: (() => {
      const w = writer();
      for (let r = 0; r < 16; r++) {
        w.at(second(r * 0.4));
        w.voice(0, { f: F(note(60)), ad: (r << 4) | 0x00, sr: 0x82, control: 0x41 });
        w.at(second(r * 0.4 + 0.3));
        w.w(V(0) + 4, 0x40);
        w.at(second(r * 0.4));
        w.voice(1, { f: F(note(64)), pw: 0x400, ad: 0x00 | r, sr: 0x48, control: 0x41 });
        w.at(second(r * 0.4 + 0.35));
        w.w(V(1) + 4, 0x40);
        w.at(second(r * 0.2));
        w.voice(2, { f: F(note(67)), pw: 0xc00, ad: 0x00, sr: (r << 4) | 0x00, control: 0x41 });
        w.at(second(r * 0.2 + 0.15));
        w.w(V(2) + 4, 0x40);
        w.at(second(3.2 + r * 0.25));
        w.voice(2, { f: F(note(67)), pw: 0xc00, ad: 0x00, sr: 0xf0 | r, control: 0x41 });
        w.at(second(3.2 + r * 0.25 + 0.01));
        w.w(V(2) + 4, 0x40);
      }
      // Gates a few cycles apart, in every phase.
      let t = second(6.5);
      for (const gap of [1, 2, 3, 4, 5, 8, 13]) {
        w.at(t);
        w.voice(0, { f: F(note(60)), ad: 0x22, sr: 0x86, control: 0x41 });
        for (const offset of [4000, 9000, 30000]) w.writes.push([t + offset, V(0) + 4, 0x40], [t + offset + gap, V(0) + 4, 0x41]);
        w.writes.push([t + 60000, V(0) + 4, 0x40]);
        t += 70000;
      }
      // The delay bug: a slow attack, then the fastest rate once the register has passed it.
      w.at(second(7.2));
      w.voice(1, { f: F(note(64)), pw: 0x400, ad: 0xa0, sr: 0xf0, control: 0x41 });
      w.at(second(7.2) + 1500);
      w.w(V(1) + 5, 0x00);
      w.at(second(7.7));
      w.w(V(1) + 4, 0x40);
      return w.writes;
    })(),
  },
  {
    name: 'script-sync-ring',
    notes: 'Voice 2 synced by voice 1 at four ratios on a pulse, then ring-modulated on a triangle, then both; voice 3 synced by voice 2 while voice 2 is synced itself; the test bit on the source, and a source at frequency zero.',
    cycles: second(3.2),
    writes: (() => {
      const w = writer();
      w.at(second(0));
      w.voice(0, { f: F(440), control: 0x41 });
      let i = 0;
      for (const ratio of [1.5, 2.37, 0.5, 1]) {
        for (const control of [0x43, 0x15, 0x17]) {
          w.at(second(i * 0.2));
          w.voice(1, { f: F(440 * ratio), control });
          w.at(second(i * 0.2 + (control === 0x43 ? 0.2 : 0.08)));
          w.w(V(1) + 4, 0x40);
          i++;
        }
      }
      w.at(second(0));
      w.voice(2, { f: F(330), control: 0x43 });
      // The source in test, then released, then at zero.
      w.at(second(2.5));
      w.w(V(0) + 4, 0x49);
      w.at(second(2.6));
      w.w(V(0) + 4, 0x41);
      w.at(second(2.7));
      w.w(V(0), 0);
      w.w(V(0) + 1, 0);
      w.at(second(2.9));
      w.w(V(0) + 1, 0x10);
      return w.writes;
    })(),
  },
  {
    name: 'script-combined',
    notes: 'The four combined waveforms on voice 1 at three pulse widths and three pitches; the noise combinations on voice 2 with the register reset between them by the test bit; the triangle swapped for the sawtooth under the test bit on voice 3.',
    cycles: second(3.7),
    writes: (() => {
      const w = writer();
      let i = 0;
      for (const control of [0x31, 0x51, 0x61, 0x71]) {
        for (const pw of [0x200, 0x800, 0xe00]) {
          w.at(second(i * 0.15));
          w.voice(0, { f: F(note(48 + (i % 3) * 12)), pw, control });
          w.at(second(i * 0.15 + 0.1));
          w.w(V(0) + 4, 0x40);
          i++;
        }
      }
      for (const [k, control] of [0x91, 0xa1, 0xc1, 0xf1, 0xb1, 0xe1].entries()) {
        w.at(second(k * 0.6));
        w.w(V(1) + 4, 0x08);
        w.at(second(k * 0.6 + 0.25));
        w.voice(1, { f: F(note(60)), pw: 0x600, control });
        w.at(second(k * 0.6 + 0.45));
        w.w(V(1) + 4, 0x40);
      }
      for (let k = 0; k < 8; k++) {
        w.at(second(0.2 + k * 0.4));
        w.voice(2, { f: F(note(55)), control: [0x31, 0x39, 0x29, 0x19, 0xb1, 0xb9, 0xd1, 0xd9][k] });
        w.at(second(0.2 + k * 0.4 + 0.1));
        w.w(V(2) + 4, [0x21, 0x21, 0x11, 0x11, 0xd1, 0xa1, 0x81, 0xb1][k]);
        w.at(second(0.2 + k * 0.4 + 0.2));
        w.w(V(2) + 4, 0x40);
      }
      return w.writes;
    })(),
  },
  {
    name: 'script-noise',
    notes: 'The noise on voice 1 at eight rates with the register reset by a long test bit between two of them; noise with the pulse on voice 2; the same note on all three voices, which start from the same register.',
    cycles: second(4),
    writes: (() => {
      const w = writer();
      for (const [k, f] of [0x0080, 0x0800, 0x1800, 0x3000, 0x6000, 0x9000, 0xd000, 0xffff].entries()) {
        w.at(second(k * 0.4));
        if (k === 4) {
          w.w(V(0) + 4, 0x88);
          w.at(second(k * 0.4 + 0.25));
        }
        w.voice(0, { f, control: 0x81 });
      }
      w.at(second(0.5));
      w.voice(1, { f: 0x2000, pw: 0x800, control: 0xc1 });
      w.at(second(1.5));
      w.w(V(1) + 3, 0x0f);
      w.at(second(2.5));
      w.w(V(1) + 4, 0x81);
      w.at(second(1));
      w.voice(2, { f: 0x2000, control: 0x81 });
      return w.writes;
    })(),
  },
];

const PATTERN = {
  bass: 'A1 . A1 . A1 . A1 . A1 . A1 . A1 . G1 .',
  lead: 'E4 . . . G4 . A4 . . . B4 . C5 . . .',
  chord: 'A3 . . . . . . . . . . . . . . .',
  chordShape: [[0, 3, 7]],
  perc: 'K . H . S . H . K . H K S . H .',
};

const SONGS = [
  {
    name: 'song-golden',
    source: 'packages/chipvoice/test/golden-c64.mjs',
    seconds: 4,
    score: { id: 'golden', bpm: 152, order: [0], gain: 1, patterns: [PATTERN] },
  },
  {
    name: 'song-bright',
    source: 'the same lines with a bright lead, a bright bass and a held chord',
    seconds: 4,
    score: { id: 'bright', bpm: 152, order: [0], gain: 1, intent: { lead: 'bright', bass: 'bright', chord: 'held' }, patterns: [PATTERN] },
  },
];

function songLog({ name, source, seconds, score }) {
  const { events, cycles } = recordSong(arrange(score, 'c64'), { seconds, chip: 'c64' });
  return { name, text: formatLog({ name, chip: 'c64', clock: CLOCK, cycles, source, notes: `${score.bpm} bpm, ${seconds} s, through the driver` }, events) };
}

function scriptLog({ name, notes, cycles, writes }) {
  const all = writes.map(([at, addr, value]) => ({ at, addr, value }));
  return { name, text: formatLog({ name, chip: 'c64', clock: CLOCK, cycles, source: 'src/corpus/generate-c64.mjs', notes }, all) };
}

fs.mkdirSync(OUT, { recursive: true });
for (const log of [...SONGS.map(songLog), ...SCRIPTS.map(scriptLog)]) {
  fs.writeFileSync(path.join(OUT, `${log.name}.log`), log.text);
  console.log(`${log.name}.log`);
}
