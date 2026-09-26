import type { FmPatch, RegisterEvent } from "../../chip.js";
import { MASTER_HZ, YM_INPUT_HZ } from "./dsp.js";
import { PSG_CLOCK_HZ } from "./sn76489.js";

/**
 * The Mega Drive's native driver: a game's voices to the machine's register
 * writes, as a 68000 or Z80 sound driver of the early nineties wrote them.
 *
 * `MdDriver` beside it serves the portable score: four roles, frames read
 * from instrument tables, one FM patch per role. This one serves a game that
 * writes for the machine itself (decision 32). It reaches what the portable
 * path leaves out: all six FM channels, hard stereo per channel, the DAC on
 * the sixth streaming PCM drums, three PSG tones, the noise clocked by tone 3
 * at a rate of its own, guitar bends, legato slides with no new attack,
 * delayed vibrato, and effects that sweep a frame at a time.
 *
 * Everything is updated once a frame, sixty times a second, as those drivers
 * did. The output is plain `RegisterEvent`s stamped on the master clock, the
 * input every Mega Drive core takes: `renderEvents` plays them on this
 * package's YM2612 and SN76489, `toVgm` writes them to a file.
 *
 * The bus is modelled as two chips on one bus: writes are grouped in
 * transactions (a frequency's two registers must not be split, the chip
 * latches the high byte), the YM2612's transactions queue behind its busy
 * flag, the PSG's behind its own. When a frame asks for more writes than the
 * busy flag lets through, they land late, and `lateCycles` says by how much.
 */

/** Master cycles between a YM2612 address byte and its data byte: one internal cycle. */
const PAIR = 42;
/** Master cycles between two YM2612 writes: the busy flag's thirty-two internal cycles. */
const YM_GAP = 42 * 32;
/** Master cycles between two PSG bytes. */
const PSG_GAP = 60;
const YM_PORT = 0xa04000;
const PSG_PORT = 0xc00011;
const FRAME = 1 / 60;

/** The DAC's pace: one write every this many master cycles, about 13.3 kHz, a Z80 loop's. */
export const MD_DAC_CYCLES = 4037;
/** The DAC's sample rate, for a stream written for it. */
export const MD_DAC_HZ = MASTER_HZ / MD_DAC_CYCLES;

/** Operator register offsets for OP1 to OP4: the chip numbers its slots 1, 3, 2, 4. */
const OP_OFFSET = [0, 8, 4, 12];
/** Which operators reach the output, per algorithm, as OP1 to OP4 indices. */
export const MD_CARRIERS: readonly (readonly number[])[] = [[3], [3], [3], [3], [1, 3], [1, 2, 3], [1, 2, 3], [0, 1, 2, 3]];
const PAN_BITS = { L: 0x80, R: 0x40, C: 0xc0 } as const;

/** Hard left, hard right, or both: the YM2612's two pan bits per channel. */
export type MdPan = keyof typeof PAN_BITS;

/** A vibrato that starts `delay` frames into the note and ramps in over twelve. */
export interface MdVibrato {
  /** Frames before it starts. */
  delay: number;
  /** Cycles a second. */
  hz: number;
  /** Semitones either side. */
  depth: number;
}

/** What an FM note and a PSG note share: a pitch and how it moves. Times in seconds. */
export interface MdNote {
  at: number;
  until: number;
  /** MIDI semitones; fractions detune. */
  pitch: number;
  /** Linear, 0 to 1. Default 1. */
  volume?: number;
  /** Scooped: starts this many semitones below and bends up over `bendFrames`. */
  bend?: number;
  bendFrames?: number;
  /** Frames to slide from the previous note's pitch. On FM, a note that starts where the previous one ends is also played legato: no new attack. */
  glide?: number;
  /** Falls this many semitones from frame `fallAt`, over six frames. */
  fall?: number;
  fallAt?: number | null;
  vibrato?: MdVibrato | null;
  /** Semitones a frame, for an effect that slides. */
  sweep?: number;
}

export interface MdFmNote extends MdNote {
  patch: FmPatch;
  /** A linear gain per frame on top of `volume`; the last value holds. */
  levels?: number[];
}

export interface MdPsgNote extends MdNote {
  /** Decibels per frame, 0 is full; the PSG steps in 2 dB. */
  envelope?: number[];
  /** Decibels after the envelope runs out. Default: its last value. */
  hold?: number;
}

export interface MdNoiseHit {
  at: number;
  until: number;
  /** Linear, 0 to 1. Default 1. */
  volume?: number;
  /** Decibels per frame, 0 is full; silent after the last. */
  envelope: number[];
  /** Tone 3's period, 1 to 1023, which then clocks the noise: small is a bright hiss, large a dark rumble. */
  rate?: number;
  /** Without `rate`, one of the noise's own rates: 0, 1, 2 for the clock over 512, 1024, 2048. */
  fixed?: 0 | 1 | 2;
  /** White noise (the default) or the periodic buzz. */
  white?: boolean;
}

export type MdFmVoiceId = "fm1" | "fm2" | "fm3" | "fm4" | "fm5" | "fm6";
export type MdPsgVoiceId = "psg1" | "psg2" | "psg3";

export interface MdFmVoice {
  voice: MdFmVoiceId;
  pan?: MdPan;
  /** Scales every note's volume. */
  gain?: number;
  notes: MdFmNote[];
}
export interface MdPsgVoice {
  voice: MdPsgVoiceId;
  gain?: number;
  notes: MdPsgNote[];
}
export interface MdNoiseVoice {
  voice: "noise";
  gain?: number;
  hits: MdNoiseHit[];
}
/** FM 6 as the DAC: a premixed PCM stream at `MD_DAC_HZ`, -1 to 1, from time zero. */
export interface MdDacVoice {
  voice: "dac";
  pan?: MdPan;
  stream: Float32Array;
}
export type MdVoice = MdFmVoice | MdPsgVoice | MdNoiseVoice | MdDacVoice;

export interface MdCompiled {
  /** Every write, in time order, stamped on the master clock. */
  events: RegisterEvent[];
  /** The most a write waited behind the busy flag, in master cycles. */
  lateCycles: number;
}

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
/** A linear volume to an attenuation in steps of `step` dB. */
const atten = (volume: number, step: number) => (volume <= 0 ? 999 : Math.round((-20 * Math.log10(volume)) / step));

function fmFrequency(freq: number): number {
  let block = 0;
  let fnum = (144 * freq * 2 ** 21) / YM_INPUT_HZ;
  while (fnum >= 2048 && block < 7) {
    fnum /= 2;
    block++;
  }
  fnum = Math.max(0, Math.min(2047, Math.round(fnum)));
  return (block << 11) | fnum;
}
const psgPeriod = (freq: number) => Math.max(1, Math.min(1023, Math.round(PSG_CLOCK_HZ / (32 * freq))));

/** One YM2612 register write: port 0 for channels 1 to 3 and the globals, 1 for 4 to 6. */
type YmWrite = [port: number, register: number, value: number];
interface Transaction {
  at: number;
  seq: number;
  ym: boolean;
  writes: YmWrite[] | number[];
}

function createBus() {
  const tx: Transaction[] = [];
  let seq = 0;
  return {
    ym(at: number, writes: YmWrite[]) {
      tx.push({ at: Math.round(at), seq: seq++, ym: true, writes });
    },
    psg(at: number, bytes: number[]) {
      tx.push({ at: Math.round(at), seq: seq++, ym: false, writes: bytes });
    },
    finish(): MdCompiled {
      tx.sort((a, b) => a.at - b.at || a.seq - b.seq);
      const out: RegisterEvent[] = [];
      let freeYm = 0;
      let freePsg = 0;
      let late = 0;
      for (const t of tx) {
        if (t.ym) {
          let c = Math.max(t.at, freeYm);
          late = Math.max(late, c - t.at);
          for (const [port, reg, value] of t.writes as YmWrite[]) {
            out.push({ at: c, addr: YM_PORT + port * 2, value: reg });
            out.push({ at: c + PAIR, addr: YM_PORT + port * 2 + 1, value: value & 0xff });
            c += YM_GAP;
          }
          freeYm = c;
        } else {
          let c = Math.max(t.at, freePsg);
          for (const b of t.writes as number[]) {
            out.push({ at: c, addr: PSG_PORT, value: b & 0xff });
            c += PSG_GAP;
          }
          freePsg = c;
        }
      }
      out.sort((a, b) => a.at - b.at);
      return { events: out, lateCycles: late };
    },
  };
}
type Bus = ReturnType<typeof createBus>;

/**
 * A note's pitch on frame `f`, in semitones: the scoop into it, or the glide
 * from the previous note, then the fall, the vibrato and the sweep.
 */
function pitchAt(n: MdNote, f: number, prev: number | null): number {
  let p = n.pitch;
  if (n.glide && prev != null && f < n.glide) p = prev + (n.pitch - prev) * (f / n.glide);
  else if (n.bend && n.bendFrames && f < n.bendFrames) p = n.pitch - n.bend * (1 - f / n.bendFrames);
  if (n.fall && n.fallAt != null && f >= n.fallAt) p -= n.fall * Math.min(1, (f - n.fallAt) / 6);
  if (n.vibrato && f >= n.vibrato.delay) {
    const ramp = Math.min(1, (f - n.vibrato.delay) / 12);
    p += Math.sin((f - n.vibrato.delay) * FRAME * 2 * Math.PI * n.vibrato.hz) * n.vibrato.depth * ramp;
  }
  if (n.sweep) p += n.sweep * f;
  return p;
}

/** A patch's writes for a channel, pan included. */
function patchWrites(ch: number, patch: FmPatch, pan: number): YmWrite[] {
  const port = ch < 3 ? 0 : 1;
  const sub = ch % 3;
  const carriers = MD_CARRIERS[patch.algorithm & 7];
  const w: YmWrite[] = [];
  patch.ops.forEach((op, i) => {
    const b = OP_OFFSET[i] + sub;
    w.push([port, 0x30 + b, ((op.dt & 7) << 4) | (op.mul & 15)]);
    w.push([port, 0x50 + b, ((op.ks & 3) << 6) | (op.ar & 31)]);
    w.push([port, 0x60 + b, ((op.am ? 1 : 0) << 7) | (op.dr & 31)]);
    w.push([port, 0x70 + b, op.sr & 31]);
    w.push([port, 0x80 + b, ((op.sl & 15) << 4) | (op.rr & 15)]);
    w.push([port, 0x90 + b, op.ssg ?? 0]);
    // A modulator's level is the patch's; a carrier's is written with the note's volume.
    if (!carriers.includes(i)) w.push([port, 0x40 + b, op.tl & 127]);
  });
  w.push([port, 0xb0 + sub, ((patch.feedback & 7) << 3) | (patch.algorithm & 7)]);
  w.push([port, 0xb4 + sub, pan | ((patch.ams ?? 0) << 4) | (patch.pms ?? 0)]);
  return w;
}
function carrierWrites(ch: number, patch: FmPatch, level: number): YmWrite[] {
  const port = ch < 3 ? 0 : 1;
  const sub = ch % 3;
  return MD_CARRIERS[patch.algorithm & 7].map((i): YmWrite => [port, 0x40 + OP_OFFSET[i] + sub, Math.min(127, patch.ops[i].tl + level)]);
}
function freqWrites(ch: number, freq: number): YmWrite[] {
  const port = ch < 3 ? 0 : 1;
  const sub = ch % 3;
  const f = fmFrequency(freq);
  return [[port, 0xa4 + sub, f >> 8], [port, 0xa0 + sub, f & 0xff]];
}
const keyIndex = (ch: number) => (ch < 3 ? ch : ch + 1);

const FM_IDS: readonly string[] = ["fm1", "fm2", "fm3", "fm4", "fm5", "fm6"];
const PSG_IDS: readonly string[] = ["psg1", "psg2", "psg3"];

/**
 * Compiles voices to register writes. Times are seconds from zero, pitches
 * MIDI semitones.
 *
 * ```ts
 * const { events } = compileMdVoices([
 *   { voice: "fm1", pan: "C", notes: [{ at: 0, until: 0.5, pitch: 69, patch: MD_PATCHES.lead }] },
 *   { voice: "dac", stream: mdDrumStream([{ at: 0, drum: "kick" }], MD_DAC_HZ, 0.5) },
 * ]);
 * ```
 */
export function compileMdVoices(voices: MdVoice[]): MdCompiled {
  const used = new Set<string>();
  for (const v of voices) {
    if (!FM_IDS.includes(v.voice) && !PSG_IDS.includes(v.voice) && v.voice !== "noise" && v.voice !== "dac") throw new Error(`compileMdVoices: unknown voice ${String((v as { voice: unknown }).voice)}`);
    if (used.has(v.voice)) throw new Error(`compileMdVoices: ${v.voice} is given twice`);
    used.add(v.voice);
  }
  if (used.has("dac") && used.has("fm6")) throw new Error("compileMdVoices: the DAC takes FM 6; fm6 and dac cannot both play");
  if (used.has("psg3") && voices.some((v) => v.voice === "noise" && v.hits.some((h) => h.rate))) throw new Error("compileMdVoices: a noise rate is tone 3's period; psg3 cannot play beside it");

  const bus = createBus();
  // power on: LFO off, channel 3 normal, the DAC on when it plays (it takes FM 6), every key off, the PSG silent
  bus.ym(0, [[0, 0x22, 0], [0, 0x27, 0], [0, 0x2b, used.has("dac") ? 0x80 : 0]]);
  for (let ch = 0; ch < 6; ch++) bus.ym(0, [[0, 0x28, keyIndex(ch)]]);
  bus.psg(0, [0x9f, 0xbf, 0xdf, 0xff]);

  for (const v of voices) {
    if (v.voice === "noise") compileNoise(bus, v);
    else if (v.voice === "dac") compileDac(bus, v);
    else if (v.voice.startsWith("fm")) compileFm(bus, v as MdFmVoice);
    else compilePsg(bus, v as MdPsgVoice);
  }
  return bus.finish();
}

function compileFm(bus: Bus, v: MdFmVoice) {
  const C = MASTER_HZ;
  const ch = FM_IDS.indexOf(v.voice);
  const pan = PAN_BITS[v.pan ?? "C"];
  const gain = v.gain ?? 1;
  let loaded: FmPatch | null = null;
  let prevPitch: number | null = null;
  // What this channel's patch registers hold, so a patch change writes only what differs.
  const regs = new Map<number, number>();
  const changed = (w: YmWrite[]) => w.filter(([port, reg, value]) => {
    const k = port * 256 + reg;
    if (regs.get(k) === value) return false;
    regs.set(k, value);
    return true;
  });
  const notes = v.notes;
  for (let k = 0; k < notes.length; k++) {
    const n = notes[k];
    const next = notes[k + 1];
    const volume = n.volume ?? 1;
    const legato = !!n.glide && prevPitch != null && notes[k - 1].until >= n.at - 1e-6;
    const level = atten(volume * gain, 0.75);
    const t0 = n.at * C;
    if (!legato) {
      const w: YmWrite[] = [[0, 0x28, keyIndex(ch)]];
      if (loaded !== n.patch) {
        w.push(...changed(patchWrites(ch, n.patch, pan)));
        loaded = n.patch;
      }
      w.push(...carrierWrites(ch, n.patch, level));
      w.push(...freqWrites(ch, hz(pitchAt(n, 0, prevPitch))));
      w.push([0, 0x28, 0xf0 | keyIndex(ch)]);
      bus.ym(t0, w);
    } else {
      // Legato: the new pitch and level on the sounding note, no key-off, no attack.
      bus.ym(t0, [...carrierWrites(ch, n.patch, level), ...freqWrites(ch, hz(pitchAt(n, 0, prevPitch)))]);
    }
    let lastF = fmFrequency(hz(pitchAt(n, 0, prevPitch)));
    let lastL = level;
    for (let f = 1; n.at + f * FRAME < n.until - 1e-6; f++) {
      const t = (n.at + f * FRAME) * C;
      const freq = hz(pitchAt(n, f, prevPitch));
      const fw = fmFrequency(freq);
      const env = n.levels ? n.levels[Math.min(f, n.levels.length - 1)] : 1;
      const lv = atten(volume * gain * env, 0.75);
      const w: YmWrite[] = [];
      if (lv !== lastL) {
        w.push(...carrierWrites(ch, n.patch, lv));
        lastL = lv;
      }
      if (fw !== lastF) {
        w.push(...freqWrites(ch, freq));
        lastF = fw;
      }
      if (w.length) bus.ym(t, w);
    }
    // A note that runs into the next one is left keyed on: the next either retriggers it or slides on it.
    if (!(next && next.at <= n.until + 1e-6)) bus.ym(n.until * C, [[0, 0x28, keyIndex(ch)]]);
    prevPitch = n.pitch;
  }
}

function compilePsg(bus: Bus, v: MdPsgVoice) {
  const C = MASTER_HZ;
  const ch = PSG_IDS.indexOf(v.voice);
  const gain = v.gain ?? 1;
  let prevPitch: number | null = null;
  const notes = v.notes;
  for (let k = 0; k < notes.length; k++) {
    const n = notes[k];
    const next = notes[k + 1];
    const base = atten((n.volume ?? 1) * gain, 2);
    let lastP = -1;
    let lastA = -1;
    for (let f = 0; n.at + f * FRAME < n.until - 1e-6; f++) {
      const t = (n.at + f * FRAME) * C;
      const p = psgPeriod(hz(pitchAt(n, f, prevPitch)));
      const env = n.envelope ? (f < n.envelope.length ? n.envelope[f] : n.hold ?? n.envelope[n.envelope.length - 1]) : 0;
      const a = Math.max(0, Math.min(15, base + Math.round(-env / 2)));
      const b: number[] = [];
      if (p !== lastP) {
        b.push(0x80 | (ch << 5) | (p & 15), (p >> 4) & 0x3f);
        lastP = p;
      }
      if (a !== lastA) {
        b.push(0x90 | (ch << 5) | a);
        lastA = a;
      }
      if (b.length) bus.psg(t, b);
    }
    if (!(next && next.at <= n.until + 1e-6)) bus.psg(n.until * C, [0x90 | (ch << 5) | 15]);
    prevPitch = n.pitch;
  }
}

/** The noise: clocked by tone 3 for a rate of its own (tone 3 itself stays silent), or at a fixed rate. */
function compileNoise(bus: Bus, v: MdNoiseVoice) {
  const C = MASTER_HZ;
  const gain = v.gain ?? 1;
  const hits = v.hits;
  for (let k = 0; k < hits.length; k++) {
    const n = hits[k];
    const next = hits[k + 1];
    const bytes: number[] = [];
    if (n.rate) bytes.push(0xc0 | (n.rate & 15), (n.rate >> 4) & 0x3f);
    // The noise register resets the shift register, so it is written once a hit.
    bytes.push(0xe0 | ((n.white === false ? 0 : 1) << 2) | (n.rate ? 3 : (n.fixed ?? 0)));
    bus.psg(n.at * C, bytes);
    const base = atten((n.volume ?? 1) * gain, 2);
    let lastA = -1;
    const end = next ? Math.min(n.until, next.at) : n.until;
    for (let f = 0; n.at + f * FRAME < end - 1e-6; f++) {
      const env = f < n.envelope.length ? n.envelope[f] : -60;
      const a = Math.max(0, Math.min(15, base + Math.round(-env / 2)));
      if (a !== lastA) {
        bus.psg((n.at + f * FRAME) * C, [0xf0 | a]);
        lastA = a;
      }
      if (a === 15) break;
    }
    if (!(next && next.at <= n.until + 1e-6)) bus.psg(end * C, [0xff]);
  }
}

/** The DAC: a byte on `$2A` whenever the stream's value changes, at the DAC's pace. */
function compileDac(bus: Bus, v: MdDacVoice) {
  bus.ym(0, [[1, 0xb6, PAN_BITS[v.pan ?? "C"]]]);
  const s = v.stream;
  let last = -1;
  for (let i = 0; i < s.length; i++) {
    const x = Math.max(-1, Math.min(1, s[i]));
    const b = Math.max(0, Math.min(255, 128 + Math.round(x * 127)));
    if (b !== last) {
      bus.ym(i * MD_DAC_CYCLES, [[0, 0x2a, b]]);
      last = b;
    }
  }
}
