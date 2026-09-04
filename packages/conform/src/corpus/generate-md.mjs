import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { arrange, recordSong } from 'chipvoice';
import { formatLog } from '../log.mjs';

/**
 * The Mega Drive corpus, generated.
 *
 * Songs through the real driver, in the machine's idiom - FM lead and bass,
 * the chord on the PSG, the kit on the noise - and scripts of hand-written
 * writes that reach what the driver does not: every algorithm, feedback,
 * detune, the envelope's every stage and key scaling, SSG-EG, the LFO with
 * both sensitivities, channel 3's special mode, the DAC, and the PSG's tones
 * and both noises. A log is in master cycles; a YM2612 register is an
 * address byte then a data byte one internal cycle later, registers spaced
 * by the busy flag's thirty-two cycles, as a program that waits on it.
 */
const MASTER = 53693175;
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'corpus', 'md');

const YM = 0xa04000;
const PSG = 0xc00011;
const PAIR = 42;
const GAP = 42 * 32;

const PREROLL = 0.1;
const second = (s) => Math.round((PREROLL + s) * MASTER);

/** A register writer with a cursor: each register costs a pair and a gap. */
function writer() {
  const writes = [];
  let t = 0;
  return {
    writes,
    at(time) { t = time; },
    reg(port, address, value) {
      writes.push([t, YM + port, address], [t + PAIR, YM + port + 1, value & 0xff]);
      t += GAP;
    },
    psg(value) {
      writes.push([t, PSG, value & 0xff]);
      t += 60;
    },
  };
}

const OP_OFFSET = [0, 8, 4, 12];

/** A patch onto a channel: four operators, then the algorithm and the pan. */
function patch(w, channel, { algorithm, feedback, ops, ams = 0, pms = 0 }) {
  const port = channel < 3 ? 0 : 2;
  const sub = channel % 3;
  ops.forEach((op, i) => {
    const base = OP_OFFSET[i] + sub;
    w.reg(port, 0x30 + base, ((op.dt ?? 0) << 4) | op.mul);
    w.reg(port, 0x40 + base, op.tl);
    w.reg(port, 0x50 + base, ((op.ks ?? 0) << 6) | op.ar);
    w.reg(port, 0x60 + base, ((op.am ? 1 : 0) << 7) | op.dr);
    w.reg(port, 0x70 + base, op.sr);
    w.reg(port, 0x80 + base, (op.sl << 4) | op.rr);
    w.reg(port, 0x90 + base, op.ssg ?? 0);
  });
  w.reg(port, 0xb0 + sub, (feedback << 3) | algorithm);
  w.reg(port, 0xb4 + sub, 0xc0 | (ams << 4) | pms);
}

/** Block and F-number for a pitch, and the key-on index of a channel. */
function pitch(w, channel, hz) {
  const port = channel < 3 ? 0 : 2;
  const sub = channel % 3;
  let block = 0;
  let fnum = (144 * hz * 2 ** 21) / (MASTER / 7);
  while (fnum >= 2048 && block < 7) { fnum /= 2; block++; }
  fnum = Math.round(fnum);
  w.reg(port, 0xa4 + sub, (block << 3) | (fnum >> 8));
  w.reg(port, 0xa0 + sub, fnum & 0xff);
}
const keyIndex = (channel) => (channel < 3 ? channel : channel + 1);
const keyOn = (w, channel, ops = 0xf) => w.reg(0, 0x28, (ops << 4) | keyIndex(channel));
const keyOff = (w, channel) => w.reg(0, 0x28, keyIndex(channel));

const op = (mul, tl, ar, dr, sr, sl, rr, extra = {}) => ({ mul, tl, ar, dr, sr, sl, rr, ...extra });
const note = (n) => 440 * 2 ** ((n - 69) / 12);

const SINE = { algorithm: 7, feedback: 0, ops: [op(1, 0, 31, 0, 0, 0, 15), op(1, 127, 31, 0, 0, 0, 15), op(1, 127, 31, 0, 0, 0, 15), op(1, 127, 31, 0, 0, 0, 15)] };
const TWO_OP = { algorithm: 4, feedback: 3, ops: [op(1, 38, 31, 10, 0, 2, 8), op(1, 0, 31, 12, 3, 3, 8), op(2, 44, 31, 10, 0, 3, 8), op(1, 0, 31, 12, 3, 3, 8)] };

const SCRIPTS = [
  {
    name: 'script-algorithms',
    notes: 'One channel through the eight algorithms at three feedback levels, a note each.',
    cycles: second(5),
    writes: (() => {
      const w = writer();
      w.at(0);
      w.reg(0, 0x22, 0); w.reg(0, 0x27, 0); w.reg(0, 0x2b, 0);
      let i = 0;
      for (const feedback of [0, 3, 7]) {
        for (let algorithm = 0; algorithm < 8; algorithm++) {
          w.at(second(i * 0.2));
          keyOff(w, 0);
          patch(w, 0, { algorithm, feedback, ops: [op(1, 30, 31, 8, 2, 2, 8), op(2, 20, 31, 10, 2, 3, 8), op(1, 24, 31, 10, 2, 3, 8), op(1, 0, 31, 8, 2, 2, 8)] });
          pitch(w, 0, note(57 + (i % 12)));
          keyOn(w, 0);
          i++;
        }
      }
      w.at(second(4.9));
      keyOff(w, 0);
      return w.writes;
    })(),
  },
  {
    name: 'script-envelopes',
    notes: 'Six channels, one operator each: attack, decay, sustain and release rates, key scaling, a level.',
    cycles: second(5),
    writes: (() => {
      const w = writer();
      w.at(0);
      w.reg(0, 0x22, 0); w.reg(0, 0x27, 0); w.reg(0, 0x2b, 0);
      const cases = [
        op(1, 0, 8, 0, 0, 0, 4), op(1, 0, 31, 6, 0, 4, 6), op(1, 0, 31, 12, 8, 2, 8, { ks: 3 }), op(1, 0, 20, 4, 2, 8, 12, { ks: 1 }),
        op(1, 8, 31, 16, 4, 6, 2), op(1, 0, 31, 31, 0, 15, 15),
      ];
      cases.forEach((carrier, ch) => {
        w.at(second(ch * 0.3));
        patch(w, ch, { algorithm: 7, feedback: 0, ops: [carrier, op(1, 127, 31, 0, 0, 0, 15), op(1, 127, 31, 0, 0, 0, 15), op(1, 127, 31, 0, 0, 0, 15)] });
        pitch(w, ch, note(48 + ch * 5));
        keyOn(w, ch);
      });
      cases.forEach((_, ch) => { w.at(second(2.5 + ch * 0.3)); keyOff(w, ch); });
      return w.writes;
    })(),
  },
  {
    name: 'script-detune-lfo',
    notes: 'Detune in both directions and every multiple; then the LFO at every speed with pitch and amplitude sensitivity.',
    cycles: second(5),
    writes: (() => {
      const w = writer();
      w.at(0);
      w.reg(0, 0x22, 0); w.reg(0, 0x27, 0); w.reg(0, 0x2b, 0);
      let i = 0;
      for (const dt of [0, 1, 3, 5, 7]) {
        w.at(second(i * 0.25));
        keyOff(w, 0);
        patch(w, 0, { algorithm: 7, feedback: 0, ops: [op(1, 0, 31, 4, 0, 1, 8), op(2, 8, 31, 4, 0, 1, 8, { dt }), op(3, 24, 31, 4, 0, 1, 8, { dt }), op(4, 30, 31, 4, 0, 1, 8)] });
        pitch(w, 0, note(60));
        keyOn(w, 0);
        i++;
      }
      for (let mul = 0; mul < 16; mul += 3) {
        w.at(second(i * 0.25));
        keyOff(w, 1);
        patch(w, 1, { algorithm: 7, feedback: 0, ops: [op(mul, 0, 31, 4, 0, 1, 8), op(1, 127, 31, 0, 0, 0, 15), op(1, 127, 31, 0, 0, 0, 15), op(1, 127, 31, 0, 0, 0, 15)] });
        pitch(w, 1, note(50));
        keyOn(w, 1);
        i++;
      }
      for (let freq = 0; freq < 8; freq++) {
        w.at(second(2.6 + freq * 0.28));
        w.reg(0, 0x22, 0x08 | freq);
        keyOff(w, 2);
        patch(w, 2, { algorithm: 4, feedback: 2, ops: [op(1, 30, 31, 6, 0, 2, 8, { am: true }), op(1, 0, 31, 8, 2, 2, 8, { am: true }), op(3, 40, 31, 6, 0, 2, 8), op(1, 0, 31, 8, 2, 2, 8)], ams: 2, pms: 5 });
        pitch(w, 2, note(64));
        keyOn(w, 2);
      }
      return w.writes;
    })(),
  },
  {
    name: 'script-ssg-ch3-dac',
    notes: 'SSG-EG in each of its eight shapes, channel 3 in its special mode with four frequencies, then the DAC playing a ramp.',
    cycles: second(5),
    writes: (() => {
      const w = writer();
      w.at(0);
      w.reg(0, 0x22, 0); w.reg(0, 0x27, 0); w.reg(0, 0x2b, 0);
      for (let ssg = 8; ssg < 16; ssg++) {
        w.at(second((ssg - 8) * 0.25));
        keyOff(w, 0);
        patch(w, 0, { algorithm: 7, feedback: 0, ops: [op(1, 0, 31, 10, 6, 2, 8, { ssg }), op(1, 127, 31, 0, 0, 0, 15), op(1, 127, 31, 0, 0, 0, 15), op(1, 127, 31, 0, 0, 0, 15)] });
        pitch(w, 0, note(52));
        keyOn(w, 0);
      }
      // Channel 3 special: each operator its own pitch.
      w.at(second(2.2));
      w.reg(0, 0x27, 0x40);
      patch(w, 2, { algorithm: 7, feedback: 0, ops: [op(1, 0, 31, 4, 0, 1, 8), op(1, 4, 31, 4, 0, 1, 8), op(1, 8, 31, 4, 0, 1, 8), op(1, 12, 31, 4, 0, 1, 8)] });
      pitch(w, 2, note(57));
      const others = [note(60), note(64), note(67)];
      others.forEach((hz, k) => {
        let block = 0;
        let fnum = (144 * hz * 2 ** 21) / (MASTER / 7);
        while (fnum >= 2048 && block < 7) { fnum /= 2; block++; }
        fnum = Math.round(fnum);
        w.reg(0, 0xac + k, (block << 3) | (fnum >> 8));
        w.reg(0, 0xa8 + k, fnum & 0xff);
      });
      keyOn(w, 2);
      w.at(second(3.6));
      keyOff(w, 2);
      w.reg(0, 0x27, 0);
      // The DAC: enabled, a ramp of bytes.
      w.at(second(3.8));
      w.reg(0, 0x2b, 0x80);
      for (let i = 0; i < 200; i++) {
        w.at(second(3.8 + i * 0.005));
        w.reg(0, 0x2a, (i * 5) & 0xff);
      }
      w.at(second(4.85));
      w.reg(0, 0x2b, 0x00);
      return w.writes;
    })(),
  },
  {
    name: 'script-psg',
    notes: 'The PSG: three tones at every attenuation, a scale, the noise at its three rates and from tone 3, white and periodic.',
    cycles: second(5),
    writes: (() => {
      const w = writer();
      const tone = (ch, hz) => {
        const n = Math.max(2, Math.min(1023, Math.round(3579545 / (32 * hz))));
        w.psg(0x80 | (ch << 5) | (n & 0x0f));
        w.psg((n >> 4) & 0x3f);
      };
      const volume = (ch, att) => w.psg(0x90 | (ch << 5) | att);
      w.at(0);
      for (let ch = 0; ch < 4; ch++) volume(ch, 15);
      const scale = [57, 60, 64, 67, 69, 72, 76, 79];
      for (let i = 0; i < 16; i++) {
        w.at(second(i * 0.15));
        tone(0, note(scale[i % 8]));
        volume(0, i);
        tone(1, note(scale[i % 8] - 12));
        volume(1, 2);
      }
      w.at(second(2.5));
      volume(0, 15); volume(1, 15);
      let k = 0;
      for (const white of [0, 1]) {
        for (let rate = 0; rate < 4; rate++) {
          w.at(second(2.6 + k * 0.28));
          if (rate === 3) tone(2, 800 + k * 100);
          w.psg(0xe0 | (white << 2) | rate);
          volume(3, 2);
          k++;
        }
      }
      w.at(second(4.9));
      volume(3, 15);
      return w.writes;
    })(),
  },
];

const SONGS = [
  {
    name: 'song-golden',
    source: 'packages/chipvoice/test/golden-md.mjs',
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
    source: 'the same lines with a bright lead and a bright bass',
    seconds: 4,
    score: {
      id: 'bright', bpm: 152, order: [0], gain: 1,
      intent: { lead: 'bright', bass: 'bright', chord: 'held' },
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
  const { events, cycles } = recordSong(arrange(score, 'md'), { seconds, chip: 'md' });
  return { name, text: formatLog({ name, chip: 'md', clock: MASTER, cycles, source, notes: `${score.bpm} bpm, ${seconds} s, through the driver` }, events) };
}

function scriptLog({ name, notes, cycles, writes }) {
  const all = writes.map(([at, addr, value]) => ({ at, addr, value }));
  return { name, text: formatLog({ name, chip: 'md', clock: MASTER, cycles, source: 'src/corpus/generate-md.mjs', notes }, all) };
}

fs.mkdirSync(OUT, { recursive: true });
for (const log of [...SONGS.map(songLog), ...SCRIPTS.map(scriptLog)]) {
  fs.writeFileSync(path.join(OUT, `${log.name}.log`), log.text);
  console.log(`${log.name}.log`);
}
