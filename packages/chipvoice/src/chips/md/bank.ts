import type { FmOperator, FmPatch } from "../../chip.js";
import { MD_CARRIERS } from "./native-driver.js";

/**
 * A bank for the native Mega Drive driver: FM patches, PSG and noise
 * instruments, and a PCM drum kit for the DAC. Written for Punk Force, a
 * shooter in the manner of 1992, and general enough to start anything else
 * from: every entry is plain data a caller can copy, change or replace.
 *
 * A patch is the YM2612's four operators and how they connect: `algorithm`
 * 0 to 7, `feedback` (OP1's), and per operator `ar`/`dr`/`sr`/`rr`/`sl` (the
 * envelope), `tl` (level, 0.75 dB a step, 127 silent), `mul` (frequency
 * multiple, 0 is a half), `dt` (detune, 1 to 3 up, 5 to 7 down) and `ks` (key
 * scaling). A carrier's `tl` is the loudest it gets; the driver adds the
 * note's volume to it.
 */

const op = (o: Partial<FmOperator>): FmOperator => ({ ar: 31, dr: 0, sr: 0, rr: 15, sl: 0, tl: 0, ks: 0, mul: 1, dt: 0, ...o });

export const MD_PATCHES: Record<string, FmPatch> = {
  // The lead guitar: algorithm 3, a feedback stack and a second operator an
  // octave up feeding the carrier together, which screams; the middle
  // operator detuned against the first is a double-picked chorus.
  lead: { algorithm: 3, feedback: 7, ops: [
    op({ mul: 1, tl: 19 }),
    op({ mul: 1, dt: 3, tl: 22, dr: 1, sl: 1 }),
    op({ mul: 2, dt: 7, tl: 28, dr: 6, sl: 3 }),
    op({ mul: 1, tl: 0, dr: 1, sr: 1, sl: 1, rr: 6 }),
  ] },
  // The twin lead, for written harmonies: two stacks detuned against each other, a softer edge.
  twin: { algorithm: 4, feedback: 7, ops: [
    op({ mul: 1, tl: 18 }),
    op({ mul: 1, dt: 3, tl: 2, dr: 1, sr: 1, sl: 1, rr: 6 }),
    op({ mul: 1, dt: 7, tl: 19, dr: 1, sl: 1 }),
    op({ mul: 1, dt: 7, tl: 4, dr: 1, sr: 1, sl: 1, rr: 6 }),
  ] },
  // The slap bass: a x3 click on the attack, then a round body; the carrier
  // decays to a short sustain so sixteenths stay apart.
  bass: { algorithm: 0, feedback: 3, ops: [
    op({ mul: 3, tl: 30, dr: 22, sl: 15 }),
    op({ mul: 1, tl: 34, dr: 10, sl: 6 }),
    op({ mul: 1, tl: 30, dr: 6, sr: 3, sl: 4 }),
    op({ mul: 1, tl: 0, dr: 5, sr: 3, sl: 2, rr: 12 }),
  ] },
  // The rhythm guitar, palm-muted: the lead's grit with a short carrier.
  mute: { algorithm: 0, feedback: 6, ops: [
    op({ mul: 1, tl: 30 }),
    op({ mul: 1, dt: 3, tl: 30, dr: 6, sl: 3 }),
    op({ mul: 2, dt: 7, tl: 28, dr: 8, sl: 4 }),
    op({ mul: 1, tl: 0, dr: 10, sr: 6, sl: 4, rr: 12 }),
  ] },
  // The rhythm guitar let ring, for the held chords.
  crunch: { algorithm: 0, feedback: 6, ops: [
    op({ mul: 1, tl: 30 }),
    op({ mul: 1, dt: 3, tl: 30, dr: 3, sl: 2 }),
    op({ mul: 2, dt: 7, tl: 29, dr: 3, sl: 2 }),
    op({ mul: 1, tl: 0, dr: 2, sr: 2, sl: 2, rr: 7 }),
  ] },
  // Brass: two stacks, the modulators' slower attack is the swell of a blown note.
  brass: { algorithm: 4, feedback: 5, ops: [
    op({ mul: 1, tl: 28, ar: 20, dr: 4, sl: 2 }),
    op({ mul: 1, tl: 0, ar: 26, dr: 3, sr: 1, sl: 1, rr: 7 }),
    op({ mul: 1, dt: 3, tl: 32, ar: 19, dr: 4, sl: 2 }),
    op({ mul: 1, dt: 7, tl: 4, ar: 26, dr: 3, sr: 1, sl: 1, rr: 7 }),
  ] },
  // The orchestra hit: three carriers an octave and a fifth apart, all falling fast.
  hit: { algorithm: 5, feedback: 6, ops: [
    op({ mul: 1, tl: 22 }),
    op({ mul: 1, tl: 2, dr: 8, sr: 6, sl: 3, rr: 9 }),
    op({ mul: 2, dt: 3, tl: 6, dr: 9, sr: 6, sl: 3, rr: 9 }),
    op({ mul: 3, dt: 7, tl: 10, dr: 10, sr: 6, sl: 4, rr: 9 }),
  ] },
  // A glassy bell for the arpeggios the FM plays (the PSG does the rest).
  bell: { algorithm: 4, feedback: 3, ops: [
    op({ mul: 7, tl: 36, dr: 8, sl: 4 }),
    op({ mul: 2, tl: 4, dr: 7, sr: 4, sl: 3, rr: 8 }),
    op({ mul: 3, dt: 3, tl: 38, dr: 8, sl: 4 }),
    op({ mul: 1, tl: 8, dr: 6, sr: 4, sl: 3, rr: 8 }),
  ] },
  // For effects: a bright square-ish zap for the guns.
  zap: { algorithm: 4, feedback: 5, ops: [
    op({ mul: 1, tl: 20 }), op({ mul: 1, tl: 0, dr: 8, sl: 4, rr: 14 }),
    op({ mul: 2, tl: 30 }), op({ mul: 1, tl: 6, dr: 8, sl: 4, rr: 14 }),
  ] },
  // A pure sine, the modulators silent.
  sine: { algorithm: 7, feedback: 0, ops: [op({ tl: 127 }), op({ tl: 127 }), op({ tl: 127 }), op({ mul: 1, tl: 0, rr: 10 })] },
  // A low noisy growl: full feedback through the whole stack.
  growl: { algorithm: 0, feedback: 7, ops: [
    op({ mul: 1, tl: 14 }), op({ mul: 1, dt: 3, tl: 18 }), op({ mul: 1, dt: 7, tl: 16 }), op({ mul: 1, tl: 0, rr: 9 }),
  ] },
  // A tremolo pad: two two-operator stacks like twin, but the carriers' own
  // `am` catches the chip's LFO for a wobble no hand-written envelope could
  // reproduce, and `pms` gives the pitch a light waver alongside it (the LFO
  // is one oscillator for the whole chip; a song that loads this alongside
  // another patch wanting a different rate keeps whichever asked first).
  shimmer: { algorithm: 4, feedback: 2, ops: [
    op({ mul: 1, tl: 24, ar: 18, dr: 2, sl: 1 }),
    op({ mul: 1, tl: 0, ar: 22, dr: 2, sr: 1, sl: 1, rr: 8, am: true }),
    op({ mul: 2, dt: 3, tl: 27, ar: 18, dr: 2, sl: 1 }),
    op({ mul: 1, dt: 7, tl: 4, ar: 22, dr: 2, sr: 1, sl: 1, rr: 8, am: true }),
  ], ams: 3, pms: 2, lfoFrequency: 3 },
};

const released = new WeakMap<FmPatch, Map<number, FmPatch>>();
/**
 * A patch whose carriers release at least as fast as `rr`. A music patch lets
 * a note ring, a held guitar; a sound effect must stop when it stops. The same
 * object for the same patch and rate every time, since the driver reloads a
 * patch only when it is a different object.
 */
export function mdPatchWithRelease(patch: FmPatch, rr: number): FmPatch {
  let byRate = released.get(patch);
  if (!byRate) released.set(patch, (byRate = new Map()));
  let out = byRate.get(rr);
  if (!out) {
    const carriers = MD_CARRIERS[patch.algorithm & 7];
    out = { ...patch, ops: patch.ops.map((o, i) => (carriers.includes(i) ? { ...o, rr: Math.max(o.rr, rr) } : o)) as FmPatch["ops"] };
    byRate.set(rr, out);
  }
  return out;
}

/** A PSG tone's volume over a note: decibels per frame, 0 is full, then `hold`. */
export interface MdPsgInstrument {
  envelope: number[];
  hold: number;
}
export const MD_PSG_INSTRUMENTS: Record<string, MdPsgInstrument> = {
  arp: { envelope: [0, -2, -4, -6, -8, -10], hold: -10 },
  pluck: { envelope: [0, -2, -4, -6, -8, -10, -12, -14, -16, -18, -20, -24, -28], hold: -60 },
  lead: { envelope: [-2, 0, 0, -1, -2, -3], hold: -4 },
};

/** A noise hit's shape: decibels per frame, and tone 3's period for its colour (see `MdNoiseHit`). */
export interface MdNoiseInstrument {
  envelope: number[];
  rate?: number;
  fixed?: 0 | 1 | 2;
  white?: boolean;
}
export const MD_NOISE_INSTRUMENTS: Record<string, MdNoiseInstrument> = {
  hat: { envelope: [0, -6, -12, -20, -30], rate: 2 },
  hatAccent: { envelope: [2, -2, -8, -14, -22, -30], rate: 2 },
  open: { envelope: [0, -2, -4, -6, -8, -10, -12, -14, -18, -22, -28], rate: 3 },
  // The snare's wires, for the top end the DAC's 13 kHz cannot carry.
  snr: { envelope: [4, 2, 0, -3, -6, -9, -12, -16, -20, -26], rate: 1 },
  crash: { envelope: Array.from({ length: 70 }, (_, f) => -f * 0.55), rate: 1 },
};

// ── the drums: PCM for the DAC, synthesized, deterministic

/** A drum: its samples at a sample rate, -1 to 1. */
export type MdDrum = (sampleRate: number) => Float32Array;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2147483648 - 1;
  };
}

function tom(sr: number, len: number, f0: number) {
  const n = Math.round(sr * len);
  const out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = f0 * (1 + 0.6 * Math.exp(-t / 0.035));
    ph += (2 * Math.PI * f) / sr;
    out[i] = Math.tanh(Math.sin(ph) * Math.exp(-t / 0.2) * 2);
  }
  return out;
}

/** Noise through a low-pass that closes as it dies, the DAC's crunch doing the rest. */
function boom(sr: number, len: number, decay: number, bright: number, seed: number) {
  const n = Math.round(sr * len);
  const out = new Float32Array(n);
  const r = rng(seed);
  let lp = 0;
  let lp2 = 0;
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const k = bright * Math.exp(-t / (decay * 0.8)) + 0.03;
    lp += k * (r() - lp);
    lp2 += k * (lp - lp2);
    ph += (2 * Math.PI * (40 + 80 * Math.exp(-t / 0.05))) / sr;
    const env = t < 0.01 ? t / 0.01 : Math.exp(-(t - 0.01) / decay);
    out[i] = Math.tanh((lp2 * 3 + Math.sin(ph) * 0.6) * env * 2.2);
  }
  return out;
}

export const MD_DRUMS: Record<string, MdDrum> = {
  // A sine falling from about 300 Hz to 48 Hz (the knock, then the low end),
  // a hard click on top, driven into the DAC's full scale.
  kick(sr) {
    const n = Math.round(sr * 0.3);
    const out = new Float32Array(n);
    const r = rng(7);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const f = 48 + 250 * Math.exp(-t / 0.022);
      ph += (2 * Math.PI * f) / sr;
      const click = t < 0.006 ? r() * (1 - t / 0.006) * 0.9 : 0;
      const env = t < 0.004 ? 1 : Math.exp(-(t - 0.004) / 0.2);
      out[i] = Math.tanh((Math.sin(ph) * env * 1.2 + click) * 1.6);
    }
    return out;
  },
  // A body pitched down from 240 Hz, a loud band of noise (the wires), then a
  // long bright tail: the gated room of 1992.
  snare(sr) {
    const n = Math.round(sr * 0.42);
    const out = new Float32Array(n);
    const r = rng(11);
    let lp = 0;
    let prev = 0;
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      ph += (2 * Math.PI * (180 + 60 * Math.exp(-t / 0.02))) / sr;
      const body = Math.sin(ph) * Math.exp(-t / 0.06);
      const w = r();
      lp += 0.7 * (w - lp);
      const hp = w - prev;
      prev = w;
      const gate = t < 0.16 ? 1 : Math.exp(-(t - 0.16) / 0.05);
      const noise = (lp * 0.7 + hp * 0.5) * (0.35 + 0.65 * Math.exp(-t / 0.07)) * gate;
      out[i] = Math.tanh((body * 0.9 + noise * 1.6) * 2.2);
    }
    return out;
  },
  // Toms: a falling sine, three sizes.
  tomHi: (sr) => tom(sr, 0.3, 210),
  tomMid: (sr) => tom(sr, 0.34, 150),
  tomLo: (sr) => tom(sr, 0.4, 105),
  // Explosions, for effects.
  boomS: (sr) => boom(sr, 0.55, 0.16, 0.9, 13),
  boomL: (sr) => boom(sr, 1.1, 0.38, 0.6, 17),
};

const samples = new WeakMap<MdDrum, Map<number, Float32Array>>();
/** A drum's samples at a rate, synthesized once and kept. Do not write to the array. */
export function mdDrumSample(name: string, sampleRate: number, drums: Record<string, MdDrum> = MD_DRUMS): Float32Array {
  const drum = drums[name];
  if (!drum) throw new Error(`mdDrumSample: no drum ${name}`);
  let byRate = samples.get(drum);
  if (!byRate) samples.set(drum, (byRate = new Map()));
  let out = byRate.get(sampleRate);
  if (!out) byRate.set(sampleRate, (out = drum(sampleRate)));
  return out;
}

/** A drum hit: `at` in seconds, `volume` linear (default 1). */
export interface MdDrumHit {
  at: number;
  drum: string;
  volume?: number;
}

/**
 * Drum hits mixed into one stream, `seconds` long, soft-clipped as a Z80
 * summing two samples on the fly did: a kick and a snare overlap rather than
 * cut each other. At `MD_DAC_HZ`, this is the DAC voice's stream.
 */
export function mdDrumStream(hits: MdDrumHit[], sampleRate: number, seconds: number, drums: Record<string, MdDrum> = MD_DRUMS): Float32Array {
  const out = new Float32Array(Math.ceil(seconds * sampleRate));
  for (const h of hits) {
    const s = mdDrumSample(h.drum, sampleRate, drums);
    const i0 = Math.round(h.at * sampleRate);
    const volume = h.volume ?? 1;
    for (let i = 0; i < s.length && i0 + i < out.length; i++) if (i0 + i >= 0) out[i0 + i] += s[i] * volume;
  }
  for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i] * 1.1);
  return out;
}

/** What the tracker reads a song's names and letters from. */
export interface MdBank {
  patches: Record<string, FmPatch>;
  psg: Record<string, MdPsgInstrument>;
  noise: Record<string, MdNoiseInstrument>;
  drums: Record<string, MdDrum>;
  /** A DAC line's letters, one a sixteenth: each plays drums at a volume. `.` and `-` are silence. */
  drumLetters: Record<string, [drum: string, volume: number][]>;
  /** A noise line's letters, one a sixteenth: each names a noise instrument. `.` and `-` are silence. */
  noiseLetters: Record<string, string>;
  /** On a noise channel with `snareWires`, the noise instrument that doubles every hit of this drum. */
  snareWires: { drum: string; noise: string };
}

export const MD_BANK: MdBank = {
  patches: MD_PATCHES,
  psg: MD_PSG_INSTRUMENTS,
  noise: MD_NOISE_INSTRUMENTS,
  drums: MD_DRUMS,
  drumLetters: {
    k: [["kick", 1]], s: [["snare", 0.85]], S: [["snare", 1]], x: [["kick", 1], ["snare", 1]],
    h: [["tomHi", 0.9]], m: [["tomMid", 0.9]], l: [["tomLo", 0.9]],
  },
  noiseLetters: { h: "hat", H: "hatAccent", o: "open", c: "crash" },
  snareWires: { drum: "snare", noise: "snr" },
};
