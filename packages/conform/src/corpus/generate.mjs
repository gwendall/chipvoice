import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerChip, renderSong } from 'chipvoice';
import { formatLog } from '../log.mjs';

/**
 * The 2A03 corpus, generated.
 *
 * Two kinds of log. *Songs* are this project's own music, run through the
 * real driver and sequencer with a core that records what they write instead
 * of playing it - real register traffic, with the arpeggios, vibratos and
 * note-offs a driver actually produces. *Scripts* are hand-written writes that
 * reach what the driver never does: envelope decay, length counters running
 * out, both sweep directions, the 5-step sequence, the noise's two modes,
 * the sweep-unit mute, a phase restart.
 *
 * Real games are not here yet: that needs a player with a CPU (P1-12). The
 * logs are committed, so a run compares against the same bytes every time;
 * this regenerates them when the driver or the scripts change.
 */
const CPU_HZ = 1789773;
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'corpus', '2a03');

// ---- songs, through the real driver

const LEAD = {
  duty: 1,
  volume: [15, 15, 14, 13, 12, 12, 11, 11, 10, 10, 10, 9, 9, 9, 8],
  sustain: true,
  vibrato: { depth: 0.18, rate: 8, delay: 12 },
};
const CHORD = { duty: 0, volume: [9, 8, 7, 7, 6], sustain: true };
const BASS = { volume: [15], sustain: true };

const SONGS = [
  {
    name: 'song-golden',
    source: 'packages/chipvoice/test/golden.mjs',
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
  {
    name: 'song-e2e',
    source: 'test-e2e.mjs, as chipvoice.dev renders it',
    seconds: 10,
    song: {
      id: 'e2e', bpm: 152, order: [0, 1, 0, 1], gain: 1,
      patterns: [
        {
          lead: 'E4 . . . G4 . A4 . . . B4 . C5 . . .',
          chord: 'A3 . . . . . . . . . . . . . . .',
          bass: 'A1 . A1 . A1 . A1 . A1 . A1 . A1 . G1 .',
          perc: 'K . H . S . H . K . H K S . H .',
          chordShape: [[0, 3, 7]],
        },
        {
          lead: 'C5 . . . E5 . D5 . . . B4 . A4 . = .',
          chord: 'F3 . . . . . . . G3 . . . . . . .',
          bass: 'F1 . F1 . F1 . F1 . G1 . G1 . G1 . G1 .',
          perc: 'K . H . S . H H K K S . S . H O',
          chordShape: [[0, 4, 7], [0, 4, 7]],
        },
      ],
      lead: LEAD, chord: CHORD, bass: BASS,
    },
  },
  {
    name: 'song-studio',
    source: 'apps/web/src/studio/song.ts, the default piece in the editor',
    seconds: 12,
    song: {
      id: 'studio', bpm: 152, order: [0], gain: 1,
      patterns: [{
        lead:
          'E4 . . . G4 . A4 . . . B4 . C5 . . . ' +
          'B4 . A4 . . . . . E4 . . . . . . . ' +
          'F4 . . . A4 . C5 . . . D5 . C5 . . . ' +
          'B4 . . . G4 . . . A4 . . . . . = .',
        chord:
          'A3 . . . . . . . . . . . . . . . ' +
          'A3 . . . . . . . E3 . . . . . . . ' +
          'F3 . . . . . . . . . . . . . . . ' +
          'G3 . . . . . . . . . . . . . . .',
        bass:
          'A1 . A1 . A1 . A1 . A1 . A1 . A1 . G1 . ' +
          'A1 . A1 . A1 . A1 . E1 . E1 . E1 . E1 . ' +
          'F1 . F1 . F1 . F1 . F1 . F1 . F1 . F1 . ' +
          'G1 . G1 . G1 . G1 . G1 . G1 . B1 . B1 .',
        perc:
          'K . H . S . H . K . H K S . H . ' +
          'K . H . S . H . K . H K S . H H ' +
          'K . H . S . H . K . H K S . H . ' +
          'K . H . S . H . K K S . S . H O',
        chordShape: [[0, 3, 7], [0, 3, 7], [0, 3, 7], [0, 4, 7], [0, 4, 7]],
      }],
      lead: LEAD, chord: CHORD, bass: BASS,
    },
  },
];

/** A chip that records what the driver writes and plays nothing. */
function recorder() {
  const writes = [];
  const core = {
    schedule: (events) => { for (const e of events) writes.push({ at: e.at, addr: e.addr, value: e.value }); },
    render() {},
    setGain() {},
    reset() {},
  };
  registerChip({
    spec: { id: 'record', name: 'recorder', system: '', instruments: 'table', nativeSampleRate: null, clockHz: CPU_HZ, voices: [] },
    create: () => core,
    digital: () => { throw new Error('the recorder has no digital chip'); },
    workletSource: '',
    processorName: '',
  });
  return writes;
}

function songLog({ name, source, seconds, song }) {
  const writes = recorder();
  renderSong(song, { chip: 'record', seconds, sampleRate: 44100 });
  return { name, source, cycles: seconds * CPU_HZ, writes, notes: 'through the driver and the sequencer' };
}

// ---- scripts, by hand

const ENABLE = [0, 0x4015, 0x0f];
const pulse1 = (t, control, sweep, lo, hi) => [[t, 0x4000, control], [t, 0x4001, sweep], [t, 0x4002, lo], [t, 0x4003, hi]];
/**
 * Scripts start a tenth of a second in, not at power-on. Nes_Snd_Emu's
 * reset() writes $4003 to every voice, which leaves its envelope start flag
 * set; its first frame clock then loads every decay level with 15, and a
 * voice put in envelope mode before that has decayed sounds at 15 in the
 * oracle and at 0 here. By a tenth of a second the artefact has decayed to
 * nothing and the two agree on what an envelope does.
 */
const PREROLL = 0.1;
const second = (s) => Math.round((PREROLL + s) * CPU_HZ);
const T0 = second(0);

const SCRIPTS = [
  {
    name: 'script-sweep-up',
    notes: 'pulse 1 sweeps up from period $100 with shift 2 until the mute at $7FF; pulse 2 sweeps down from $100 with negate and shift 3',
    cycles: second(2),
    writes: [ENABLE, ...pulse1(T0, 0xbf, 0x8a, 0x00, 0xf9), [T0, 0x4004, 0xbf], [T0, 0x4005, 0x9b], [T0, 0x4006, 0x00], [T0, 0x4007, 0xf9]],
  },
  {
    name: 'script-sweep-down',
    notes: 'both pulses sweep down from period $600 with negate, shift 1; pulse 1 lands one lower each step',
    cycles: second(2),
    writes: [ENABLE, ...pulse1(T0, 0xbf, 0x89, 0x00, 0xfe), [T0, 0x4004, 0xbf], [T0, 0x4005, 0x89], [T0, 0x4006, 0x00], [T0, 0x4007, 0xfe]],
  },
  {
    name: 'script-envelope',
    notes: 'envelope decay on both pulses and the noise: period 3 on pulse 1, looping period 0 on pulse 2, period 15 on the noise, restarted twice',
    cycles: second(3),
    writes: [
      ENABLE,
      ...pulse1(T0, 0x83, 0x08, 0xfd, 0xf8),
      [T0, 0x4004, 0xa0], [T0, 0x4005, 0x08], [T0, 0x4006, 0x80], [T0, 0x4007, 0xf8],
      [T0, 0x400c, 0x0f], [T0, 0x400e, 0x05], [T0, 0x400f, 0xf8],
      [second(1), 0x4003, 0xf8], [second(1), 0x400f, 0xf8],
      [second(2), 0x4003, 0xf8], [second(2), 0x400f, 0xf8],
    ],
  },
  {
    name: 'script-length',
    notes: 'length counters count down and end notes: loads of 2, 20, 254 on pulse 1, the triangle and the noise, with halt clear',
    cycles: second(3),
    writes: [
      ENABLE,
      ...pulse1(T0, 0x9f, 0x08, 0xfd, 0x18),
      [T0, 0x4008, 0x7f], [T0, 0x400a, 0xf8], [T0, 0x400b, 0x13],
      [T0, 0x400c, 0x1f], [T0, 0x400e, 0x07], [T0, 0x400f, 0x08],
      [second(1), 0x4003, 0x10], [second(1), 0x400b, 0x13], [second(1), 0x400f, 0x10],
      [second(2), 0x4003, 0x08], [second(2), 0x400b, 0x0b], [second(2), 0x400f, 0x08],
    ],
  },
  {
    name: 'script-linear',
    notes: 'the triangle with the control flag clear: linear counter loads of 10, 60 and 127 run out',
    cycles: second(3),
    writes: [
      ENABLE,
      [T0, 0x4008, 0x0a], [T0, 0x400a, 0xf8], [T0, 0x400b, 0xfb],
      [second(1), 0x4008, 0x3c], [second(1), 0x400b, 0xfb],
      [second(2), 0x4008, 0x7f], [second(2), 0x400b, 0xfb],
    ],
  },
  {
    name: 'script-five-step',
    notes: '$4017 = $80, then a hundred cycles later envelopes and length counters running under the 5-step sequence',
    cycles: second(3),
    writes: [
      ENABLE,
      [T0, 0x4017, 0x80],
      ...pulse1(T0 + 100, 0x82, 0x08, 0xfd, 0x18),
      [T0 + 100, 0x4004, 0x93], [T0 + 100, 0x4005, 0x08], [T0 + 100, 0x4006, 0x80], [T0 + 100, 0x4007, 0x28],
      [T0 + 100, 0x4008, 0x30], [T0 + 100, 0x400a, 0xf8], [T0 + 100, 0x400b, 0x1b],
      [second(1.5), 0x4003, 0xf8], [second(1.5), 0x4007, 0xf8], [second(1.5), 0x400b, 0xfb],
    ],
  },
  {
    name: 'script-noise',
    notes: 'the noise in long mode then short mode at rates 4, 9 and 15, constant volume',
    cycles: second(3),
    writes: [
      ENABLE,
      [T0, 0x400c, 0x3f], [T0, 0x400e, 0x04], [T0, 0x400f, 0xf8],
      [second(0.5), 0x400e, 0x09],
      [second(1), 0x400e, 0x0f],
      [second(1.5), 0x400e, 0x84],
      [second(2), 0x400e, 0x89],
      [second(2.5), 0x400e, 0x8f],
    ],
  },
  {
    name: 'script-low-pulse',
    notes: 'pulse 1 at period $400 with $4001 = $00, muted by the sweep unit, then $08 a second later, sounding',
    cycles: second(2),
    writes: [ENABLE, ...pulse1(T0, 0xbf, 0x00, 0x00, 0xfc), [second(1), 0x4001, 0x08]],
  },
  {
    name: 'script-restart',
    notes: '$4003 rewritten every 1000 cycles on a sounding pulse: the phase restarts, the timer does not',
    cycles: second(0.5),
    writes: [ENABLE, ...pulse1(T0, 0xbf, 0x08, 0xfd, 0xf8), ...Array.from({ length: 20 }, (_, i) => [T0 + 1000 * (i + 1), 0x4003, 0xf8])],
  },
];

function scriptLog({ name, notes, cycles, writes }) {
  return { name, source: 'packages/conform/src/corpus/generate.mjs', cycles, notes, writes: writes.map(([at, addr, value]) => ({ at, addr, value })) };
}

// ---- write them out

fs.mkdirSync(OUT, { recursive: true });
const logs = [...SONGS.map(songLog), ...SCRIPTS.map(scriptLog)];
for (const log of logs) {
  const text = formatLog({ name: log.name, chip: '2a03', clock: CPU_HZ, cycles: log.cycles, source: log.source, notes: log.notes }, log.writes);
  fs.writeFileSync(path.join(OUT, `${log.name}.log`), text);
  console.log(`${log.name.padEnd(20)} ${String(log.writes.length).padStart(6)} writes, ${(log.cycles / CPU_HZ).toFixed(1)} s`);
}
