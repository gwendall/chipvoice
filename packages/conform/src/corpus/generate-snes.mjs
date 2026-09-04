import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { arrange, encodeBrr, recordSong } from 'chipvoice';
import { formatLog } from '../log.mjs';

/**
 * The SNES corpus, generated.
 *
 * Songs through the real driver, with the driver's bank of samples in the
 * log's memory lines, and scripts of hand-written writes that reach what the
 * driver does not: every envelope mode, GAIN in each of its shapes, the noise
 * at several rates, pitch modulation, the echo at several delays and
 * feedbacks with two FIRs, and BRR in each of its filters. A log is on the
 * SPC700's clock; a DSP register is a byte to `$F2` then a byte to `$F3`.
 */
const CLOCK = 1024000;
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'corpus', 'snes');

const PREROLL = 0.1;
const second = (s) => Math.round((PREROLL + s) * CLOCK);

/** A register writer with a cursor. */
function writer() {
  const writes = [];
  let t = 0;
  return {
    writes,
    at(time) { t = time; },
    reg(address, value) {
      writes.push([t, 0xf2, address], [t + 5, 0xf3, value & 0xff]);
      t += 10;
    },
  };
}

/** A few samples for the scripts: a sine loop, a saw loop, a decaying burst, in BRR at $0400 with a directory at $0200. */
function samples() {
  const cycle = (n, f) => { const o = new Int16Array(n); for (let i = 0; i < n; i++) o[i] = Math.round(f(i / n) * 26000); return o; };
  const burst = new Int16Array(2048);
  let s = 12345;
  for (let i = 0; i < burst.length; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; burst[i] = Math.round(((s / 2 ** 32) * 2 - 1) * Math.exp(-i / 500) * 28000); }
  const entries = [
    encodeBrr(cycle(32, (p) => Math.sin(2 * Math.PI * p)), true),
    encodeBrr(cycle(64, (p) => 2 * p - 1), true),
    encodeBrr(burst, false),
  ];
  const image = new Uint8Array(0x0400 + entries.reduce((n, e) => n + e.length, 0));
  let at = 0x0400;
  entries.forEach((e, i) => {
    image.set(e, at);
    image[0x0200 + i * 4] = at & 0xff; image[0x0200 + i * 4 + 1] = at >> 8;
    image[0x0200 + i * 4 + 2] = at & 0xff; image[0x0200 + i * 4 + 3] = at >> 8;
    at += e.length;
  });
  return [{ address: 0x0200, bytes: image.subarray(0x0200) }];
}

const FIR_FLAT = [0x7f, 0, 0, 0, 0, 0, 0, 0];
const FIR_LOWPASS = [0x0c, 0x21, 0x2b, 0x2b, 0x13, 0xfe, 0xf3, 0xf9];

/**
 * Echo writes stay off unless asked for: the DSP measures its buffer when the
 * old one wraps, and the register it powers on with means 28 KB from ESA,
 * round the top of RAM and over the samples. A script that wants the echo
 * enables writes only after that buffer has wrapped, as a program did.
 */
function setup(w, { echo = false, fir = FIR_FLAT, edl = 2, efb = 0x40, evol = 0x20 } = {}) {
  w.reg(0x6c, 0x20);
  // Every voice released first, as the IPL ROM did: the DSP powers on with
  // voices keyed on and the noise, its clock stopped, routed to some of them.
  w.reg(0x5c, 0xff);
  w.reg(0x4c, 0x00);
  w.reg(0x2d, 0x00);
  w.reg(0x3d, 0x00);
  w.reg(0x5d, 0x02);
  w.reg(0x0c, 0x60);
  w.reg(0x1c, 0x60);
  w.reg(0x2c, echo ? evol : 0);
  w.reg(0x3c, echo ? evol : 0);
  w.reg(0x0d, echo ? efb : 0);
  w.reg(0x6d, 0xe0);
  w.reg(0x7d, edl);
  w.reg(0x4d, echo ? 0xff : 0);
  fir.forEach((c, i) => w.reg(0x0f + i * 0x10, c));
  for (let v = 0; v < 8; v++) { w.reg(v * 0x10, 0); w.reg(v * 0x10 + 1, 0); }
  w.reg(0x5c, 0x00);
}

function voice(w, v, { source = 0, pitch = 0x1000, vol = 0x60, adsr0 = 0xff, adsr1 = 0xe0, gain = 0 }) {
  const b = v * 0x10;
  w.reg(b + 0x04, source);
  w.reg(b + 0x05, adsr0);
  w.reg(b + 0x06, adsr1);
  w.reg(b + 0x07, gain);
  w.reg(b + 0x02, pitch & 0xff);
  w.reg(b + 0x03, pitch >> 8);
  w.reg(b + 0x00, vol);
  w.reg(b + 0x01, vol);
}
const keyOn = (w, mask) => w.reg(0x4c, mask);
const keyOff = (w, mask) => w.reg(0x5c, mask);
const note = (n) => 440 * 2 ** ((n - 69) / 12);
/** The pitch register for a 32-sample loop at 1000 Hz base. */
const pitch32 = (hz) => Math.round((hz * 0x1000) / 1000);

const SCRIPTS = [
  {
    name: 'script-envelopes',
    notes: 'Eight voices on a sine loop: ADSR with every attack, decay, sustain level and rate; then GAIN in its five modes.',
    cycles: second(5),
    writes: (() => {
      const w = writer();
      w.at(0);
      setup(w);
      const adsr = [[0xff, 0xe0], [0x80, 0xe0], [0xf7, 0x60], [0xe3, 0x8a], [0xff, 0x1f], [0x88, 0xff], [0xf0, 0x00], [0xfc, 0xa4]];
      adsr.forEach(([a0, a1], v) => { w.at(second(v * 0.2)); voice(w, v, { source: 0, pitch: pitch32(note(48 + v * 3)), adsr0: a0, adsr1: a1 }); keyOn(w, 1 << v); });
      w.at(second(2.2));
      keyOff(w, 0xff);
      const gains = [0x7f, 0x9f, 0xbf, 0xd8, 0xf8, 0x40, 0x10, 0xff];
      gains.forEach((g, v) => { w.at(second(2.5 + v * 0.25)); keyOff(w, 0); voice(w, v, { source: 1, pitch: pitch32(note(43 + v * 4)) / 2, adsr0: 0x00, gain: g }); keyOn(w, 1 << v); });
      return w.writes;
    })(),
  },
  {
    name: 'script-pitch-noise-pmod',
    notes: 'One voice through a scale on each loop, noise at five rates, pitch modulation of voice 1 by voice 0.',
    cycles: second(5),
    writes: (() => {
      const w = writer();
      w.at(0);
      setup(w);
      const scale = [57, 60, 64, 67, 69, 72, 76, 79, 81, 84];
      scale.forEach((n, i) => { w.at(second(i * 0.15)); voice(w, 0, { source: i % 2, pitch: pitch32(note(n)) / (i % 2 ? 2 : 1) }); keyOn(w, 1); });
      w.at(second(1.6)); keyOff(w, 1);
      for (let r = 0; r < 5; r++) {
        w.at(second(1.8 + r * 0.3));
        w.reg(0x6c, 0x08 + r * 5);
        w.reg(0x3d, 0x02);
        voice(w, 1, { source: 0, pitch: 0x1000, vol: 0x40 });
        keyOn(w, 2);
      }
      w.at(second(3.4)); keyOff(w, 2); w.reg(0x3d, 0x00); w.reg(0x6c, 0x00);
      w.at(second(3.6));
      voice(w, 0, { source: 0, pitch: pitch32(110), vol: 0x00 });
      voice(w, 1, { source: 0, pitch: pitch32(440), vol: 0x60 });
      w.reg(0x2d, 0x02);
      keyOn(w, 3);
      return w.writes;
    })(),
  },
  {
    name: 'script-echo',
    notes: 'The burst through the echo, enabled after the power-on buffer has wrapped: several delays and feedbacks, the flat and the low-pass FIR, then echo writes disabled.',
    cycles: second(5),
    writes: (() => {
      const w = writer();
      w.at(0);
      const cases = [
        { edl: 1, efb: 0x30, fir: FIR_FLAT }, { edl: 3, efb: 0x50, fir: FIR_FLAT }, { edl: 6, efb: 0x20, fir: FIR_LOWPASS },
        { edl: 2, efb: 0x70, fir: FIR_LOWPASS }, { edl: 4, efb: 0x40, fir: FIR_LOWPASS },
      ];
      cases.forEach((c, i) => {
        w.at(second(0.3 + i * 0.9));
        setup(w, { echo: true, ...c });
        w.reg(0x6c, 0x00);
        voice(w, 0, { source: 2, pitch: 0x1000, vol: 0x50 });
        keyOn(w, 1);
      });
      w.at(second(4.6));
      w.reg(0x6c, 0x20);
      return w.writes;
    })(),
  },
];

const SONGS = [
  {
    name: 'song-golden',
    source: 'packages/chipvoice/test/golden-snes.mjs',
    seconds: 4,
    score: {
      id: 'golden', bpm: 152, order: [0], gain: 1,
      patterns: [{
        bass: 'A1 . A1 . A1 . A1 . A1 . A1 . A1 . G1 .',
        lead: 'E4 . . . G4 . A4 . . . B4 . C5 . . .',
        chord: 'A3 . . . . . . . . . . . . . . .',
        chordShape: [[0, 3, 7]],
        perc: 'K . H . S . H . K . H K S . H .',
      }],
    },
  },
  {
    name: 'song-bright',
    source: 'the same lines with a bright lead, a hollow bass, a held chord',
    seconds: 4,
    score: {
      id: 'bright', bpm: 152, order: [0], gain: 1,
      intent: { lead: 'bright', bass: 'hollow', chord: 'held' },
      patterns: [{
        bass: 'A1 . A1 . A1 . A1 . A1 . A1 . A1 . G1 .',
        lead: 'E4 . . . G4 . A4 . . . B4 . C5 . . .',
        chord: 'A3 . . . . . . . . . . . . . . .',
        chordShape: [[0, 3, 7]],
        perc: 'K . H . S . H . K . H K S . H .',
      }],
    },
  },
];

function songLog({ name, source, seconds, score }) {
  const { events, cycles, memory } = recordSong(arrange(score, 'snes'), { seconds, chip: 'snes' });
  return { name, text: formatLog({ name, chip: 'snes', clock: CLOCK, cycles, source, notes: `${score.bpm} bpm, ${seconds} s, through the driver`, memory }, events) };
}

function scriptLog({ name, notes, cycles, writes }) {
  const all = writes.map(([at, addr, value]) => ({ at, addr, value }));
  return { name, text: formatLog({ name, chip: 'snes', clock: CLOCK, cycles, source: 'src/corpus/generate-snes.mjs', notes, memory: samples() }, all) };
}

fs.mkdirSync(OUT, { recursive: true });
for (const log of [...SONGS.map(songLog), ...SCRIPTS.map(scriptLog)]) {
  fs.writeFileSync(path.join(OUT, `${log.name}.log`), log.text);
  console.log(`${log.name}.log`);
}
