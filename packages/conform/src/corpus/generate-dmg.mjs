import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordSong } from 'chipvoice';
import { formatLog } from '../log.mjs';

/**
 * The DMG corpus, generated.
 *
 * Two kinds of log, as for the 2A03. *Songs* are this project's own music,
 * run through the real driver and sequencer on this chip with a core that
 * records what they write: real register traffic, in the Game Boy's idiom -
 * retriggers on every volume change, the bass on the wave channel, drums as
 * envelopes. *Scripts* are hand-written writes that reach every voice - duties and frequencies, envelopes in both directions,
 * the wave channel with three waveforms at its three levels, the noise
 * register in both widths across its divisors and shifts, the sweep both
 * ways, lengths on every voice. Each starts by powering the chip and setting
 * the master volume to 7 on both sides and every voice to both sides, which
 * the oracle's conversion to DAC values relies on.
 *
 * The logs are committed, so a run compares against the same bytes every
 * time; this regenerates them when the scripts change.
 */
const CLOCK = 4194304;
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'corpus', 'dmg');

const PREROLL = 0.1;
const second = (s) => Math.round((PREROLL + s) * CLOCK);
const T0 = second(0);

/** Power, master volume 7 both sides, every voice to both sides. */
const POWER = [[0, 0xff26, 0x80], [0, 0xff24, 0x77], [0, 0xff25, 0xff]];

/** The 11-bit period register for a pitch, from the DMG's formula. */
const freq = (hz) => Math.max(0, Math.min(2047, Math.round(2048 - CLOCK / (32 * hz))));
const waveFreq = (hz) => Math.max(0, Math.min(2047, Math.round(2048 - CLOCK / (64 * hz))));
const note = (n) => 440 * 2 ** ((n - 69) / 12);

/** A pulse note on channel 1 or 2: duty, envelope, frequency, trigger. */
function pulse(t, ch, { duty = 2, envelope = 0xf0, hz, length = 0, lengthOn = false }) {
  const base = ch === 1 ? 0xff10 : 0xff15;
  const f = freq(hz);
  return [
    [t, base + 1, (duty << 6) | (64 - length) & 0x3f],
    [t, base + 2, envelope],
    [t, base + 3, f & 0xff],
    [t, base + 4, 0x80 | (lengthOn ? 0x40 : 0) | (f >> 8)],
  ];
}

/** Silence a pulse or the noise by switching its DAC off. */
const dacOff = (t, addr) => [[t, addr, 0x00]];

const WAVEFORMS = {
  triangle: Array.from({ length: 32 }, (_, i) => (i < 16 ? i : 31 - i)),
  saw: Array.from({ length: 32 }, (_, i) => i >> 1),
  square: Array.from({ length: 32 }, (_, i) => (i < 16 ? 15 : 0)),
};

/** Load a waveform: sixteen bytes, two samples each, high nibble first. */
function loadWave(t, samples) {
  const writes = [];
  for (let i = 0; i < 16; i++) writes.push([t, 0xff30 + i, (samples[2 * i] << 4) | samples[2 * i + 1]]);
  return writes;
}

function wave(t, { hz, level = 1, length = 0, lengthOn = false }) {
  const f = waveFreq(hz);
  return [
    [t, 0xff1a, 0x80],
    [t, 0xff1b, (256 - length) & 0xff],
    [t, 0xff1c, level << 5],
    [t, 0xff1d, f & 0xff],
    [t, 0xff1e, 0x80 | (lengthOn ? 0x40 : 0) | (f >> 8)],
  ];
}

function noise(t, { envelope = 0xf0, divisor = 0, shift = 4, narrow = false, length = 0, lengthOn = false }) {
  return [
    [t, 0xff20, (64 - length) & 0x3f],
    [t, 0xff21, envelope],
    [t, 0xff22, (shift << 4) | (narrow ? 0x08 : 0) | divisor],
    [t, 0xff23, 0x80 | (lengthOn ? 0x40 : 0)],
  ];
}

// ---- songs, through the real driver

const SONGS = [
  {
    name: 'song-golden',
    source: 'packages/chipvoice/test/golden-dmg.mjs',
    seconds: 4,
    song: {
      id: 'golden', bpm: 152, order: [0], gain: 1,
      patterns: [{
        bass: 'A1 . A1 . A1 . A1 . A1 . A1 . A1 . G1 .',
        lead: 'E4 . . . G4 . A4 . . . B4 . C5 . . .',
        chord: 'A3 . . . . . . . . . . . . . . .',
        chordShape: [[0, 3, 7]],
        perc: 'K . H . S . H . K . H K S . H .',
      }],
      lead: { duty: 1, volume: [15, 14, 13, 12, 11], sustain: true, vibrato: { depth: 0.18, rate: 8, delay: 6 } },
      chord: { duty: 0, volume: [9, 8, 7], sustain: true },
      bass: { volume: [15], sustain: true },
    },
  },
];

function songLog({ name, source, seconds, song }) {
  const { events, cycles } = recordSong(song, { seconds, chip: 'dmg' });
  return { name, text: formatLog({ name, chip: 'dmg', clock: CLOCK, cycles, source, notes: `${song.bpm} bpm, ${seconds} s, through the driver` }, events) };
}

// ---- scripts

const SCRIPTS = [
  {
    name: 'script-pulses',
    notes: 'Both pulses: a scale on each duty, a two-voice interval, a note off by DAC.',
    cycles: second(5),
    writes: (() => {
      const w = [];
      const scale = [60, 62, 64, 65, 67, 69, 71, 72];
      for (let i = 0; i < 16; i++) {
        const t = second(i * 0.25);
        w.push(...pulse(t, 1, { duty: i & 3, hz: note(scale[i % 8]) }));
        w.push(...pulse(t, 2, { duty: (i + 2) & 3, hz: note(scale[i % 8] - 12) }));
      }
      for (let i = 0; i < 4; i++) {
        const t = second(4 + i * 0.25);
        w.push(...pulse(t, 1, { duty: 2, hz: note(72 + i * 2) }));
        w.push(...dacOff(t + Math.round(0.15 * CLOCK), 0xff12));
      }
      w.push(...dacOff(second(4.8), 0xff17));
      return w;
    })(),
  },
  {
    name: 'script-envelopes',
    notes: 'Channel 1: decays at every period, rises from silence, a zombie write mid-note.',
    cycles: second(5),
    writes: (() => {
      const w = [];
      for (let p = 1; p <= 7; p++) w.push(...pulse(second((p - 1) * 0.5), 1, { hz: note(64), envelope: 0xf0 | p }));
      for (let p = 1; p <= 3; p++) w.push(...pulse(second(3.5 + (p - 1) * 0.4), 2, { hz: note(57), envelope: 0x08 | p }));
      // A note, then its envelope register rewritten while it plays.
      w.push(...pulse(second(4.5), 1, { hz: note(67), envelope: 0xa0 }));
      w.push([second(4.7), 0xff12, 0xa1]);
      w.push([second(4.8), 0xff12, 0xa9]);
      return w;
    })(),
  },
  {
    name: 'script-wave',
    notes: 'Channel 3: three waveforms, three levels, a melody, RAM rewritten between notes.',
    cycles: second(5),
    writes: (() => {
      const w = [];
      const forms = ['triangle', 'saw', 'square'];
      const melody = [48, 52, 55, 60, 55, 52, 48, 43];
      let i = 0;
      for (const form of forms) {
        for (let level = 1; level <= 3; level++) {
          const t = second(i * 0.5);
          w.push([t - 4, 0xff1a, 0x00]);
          w.push(...loadWave(t - 4, WAVEFORMS[form]));
          w.push(...wave(t, { hz: note(melody[i % 8]), level }));
          i++;
        }
      }
      w.push([second(4.6), 0xff1a, 0x00]);
      return w;
    })(),
  },
  {
    name: 'script-noise',
    notes: 'Channel 4: the divisors at several shifts, both widths, with and without an envelope.',
    cycles: second(5),
    writes: (() => {
      const w = [];
      let i = 0;
      for (const shift of [2, 4, 6]) {
        for (const divisor of [0, 1, 3, 7]) {
          w.push(...noise(second(i * 0.35), { divisor, shift, narrow: i % 2 === 1, envelope: i % 3 === 0 ? 0xf2 : 0xf0 }));
          i++;
        }
      }
      w.push(...noise(second(4.4), { divisor: 0, shift: 0, narrow: true }));
      w.push(...dacOff(second(4.9), 0xff21));
      return w;
    })(),
  },
  {
    name: 'script-sweep',
    notes: 'Channel 1: sweeps up and down at two shifts and two periods, one to overflow.',
    cycles: second(5),
    writes: (() => {
      const w = [];
      const cases = [[0x11, 110], [0x19, 880], [0x22, 220], [0x2a, 660], [0x74, 330], [0x7c, 440]];
      cases.forEach(([nr10, hz], i) => {
        const t = second(i * 0.8);
        w.push([t, 0xff10, nr10]);
        w.push(...pulse(t, 1, { hz: note(69) * (hz / 440) }));
      });
      return w;
    })(),
  },
  {
    name: 'script-lengths',
    notes: 'Every voice with a length counter: short and long, one re-enabled after it ran out.',
    cycles: second(5),
    writes: (() => {
      const w = [];
      w.push(...pulse(second(0), 1, { hz: note(60), length: 16, lengthOn: true }));
      w.push(...pulse(second(0.5), 2, { hz: note(64), length: 48, lengthOn: true }));
      w.push(...loadWave(second(1) - 4, WAVEFORMS.triangle));
      w.push(...wave(second(1), { hz: note(48), length: 128, lengthOn: true }));
      w.push(...noise(second(1.5), { divisor: 2, shift: 3, length: 24, lengthOn: true }));
      // Length enabled without a trigger, on a voice already playing.
      w.push(...pulse(second(3), 1, { hz: note(67), length: 20 }));
      w.push([second(3.2), 0xff14, 0x40 | (freq(note(67)) >> 8)]);
      // And a long one that outlasts the log.
      w.push(...pulse(second(4), 2, { hz: note(55), length: 63, lengthOn: true }));
      return w;
    })(),
  },
];

function scriptLog({ name, notes, cycles, writes }) {
  const all = [...POWER, ...writes].map(([at, addr, value]) => ({ at, addr, value }));
  return { name, text: formatLog({ name, chip: 'dmg', clock: CLOCK, cycles, source: 'src/corpus/generate-dmg.mjs', notes }, all) };
}

fs.mkdirSync(OUT, { recursive: true });
for (const log of [...SONGS.map(songLog), ...SCRIPTS.map(scriptLog)]) {
  fs.writeFileSync(path.join(OUT, `${log.name}.log`), log.text);
  console.log(`${log.name}.log`);
}
