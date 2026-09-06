import type { ChipDriver, NoteFrame, RegisterEvent } from "../../chip.js";
import { encodeBrr } from "./brr.js";

/**
 * The SNES's driver: a note's frames to the DSP's registers through `$F2`
 * and `$F3`, as an SPC700 program wrote them, with the samples it needs
 * copied into RAM first.
 *
 * Everything on this chip is a sample. The driver carries a bank of them,
 * synthesised here and encoded to BRR: single-cycle waveforms that loop, for
 * the pitched voices, and a kit of one-shot drums. A note is a source number,
 * a pitch that scales the sample's rate, the voice's two volumes for the
 * frame's level, and a key-on; the envelope is an ADSR that attacks at once
 * and sustains at full, so the volume table is the whole shape, as on the
 * other chips. A note ends by switching the voice's envelope to a fast
 * exponential decrease in GAIN mode, which is the voice's own register: KOFF
 * is shared by eight voices and a driver that writes it for one would carry
 * the others' state, which this one, writing notes out of time order, does
 * not have.
 *
 * The echo is on for the pitched voices, at a short delay through the FIR
 * most games used: that is the machine's signature, and a song without it
 * does not sound like one.
 */

/** The DSP's registers, as `$F2` selects them. */
const R_MVOLL = 0x0c;
const R_MVOLR = 0x1c;
const R_EVOLL = 0x2c;
const R_EVOLR = 0x3c;
const R_KON = 0x4c;
const R_KOFF = 0x5c;
const R_FLG = 0x6c;
const R_EFB = 0x0d;
const R_PMON = 0x2d;
const R_NON = 0x3d;
const R_EON = 0x4d;
const R_DIR = 0x5d;
const R_ESA = 0x6d;
const R_EDL = 0x7d;
const R_FIR = 0x0f;

const F2 = 0xf2;
const F3 = 0xf3;

/** Cycles between the register select and its byte, and between registers: an SPC700's two moves. */
const PAIR = 5;
const GAP = 10;
/** Each voice's writes start this far into the frame per voice, counted from one. */
const STAGGER = 1500;

/** Where things live in the 64 KB. */
const DIRECTORY = 0x0200;
const SAMPLES = 0x0400;
/** The echo buffer: ESA is a page, EDL a count of 2 KB. */
const ECHO_PAGE = 0xe0;
const ECHO_DELAY = 3;

/** A sample in the bank: its PCM at 32000 Hz, whether it loops, and what pitch $1000 plays it at. */
interface BankEntry {
  name: string;
  pcm: Int16Array;
  loop: boolean;
  /** The frequency the sample plays at with the pitch register at $1000, for a looped waveform. */
  baseHz: number;
}

const RATE = 32000;

/** Tuning shared by bank construction and arrangement diagnostics. Unknown
 * pitched sources use tri, matching the driver's source fallback. */
const SAMPLE_BASE_HZ: Readonly<Record<string, number>> = {
  sine:RATE/32, tri:RATE/32, saw:RATE/32, square:RATE/32,
  sine64:RATE/64, square64:RATE/64, saw64:RATE/64,
  kick:0, snare:0, hat:0, ohat:0, noise:0,
};
export function sampleBaseHz(name: string): number { return Object.hasOwn(SAMPLE_BASE_HZ, name) ? SAMPLE_BASE_HZ[name] : SAMPLE_BASE_HZ.tri; }

/** A single-cycle waveform of `length` samples: one period, looped. */
function cycle(length: number, shape: (phase: number) => number): Int16Array {
  const out = new Int16Array(length);
  for (let i = 0; i < length; i++) out[i] = Math.round(Math.max(-1, Math.min(1, shape(i / length))) * 28000);
  return out;
}

/** A deterministic noise, the same on every machine. */
function noise(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000 * 2 - 1;
  };
}

function kick(): Int16Array {
  const n = Math.round(RATE * 0.25);
  const out = new Int16Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const hz = 40 + 110 * Math.exp(-t * 28);
    phase += (2 * Math.PI * hz) / RATE;
    out[i] = Math.round(Math.sin(phase) * Math.exp(-t * 9) * 30000);
  }
  return out;
}

function snare(): Int16Array {
  const n = Math.round(RATE * 0.2);
  const out = new Int16Array(n);
  const rnd = noise(7);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const tone = Math.sin(2 * Math.PI * 185 * t) * Math.exp(-t * 30) * 0.5;
    const hiss = rnd() * Math.exp(-t * 14) * 0.6;
    out[i] = Math.round(Math.max(-1, Math.min(1, tone + hiss)) * 30000);
  }
  return out;
}

function hat(seconds: number, seed: number): Int16Array {
  const n = Math.round(RATE * seconds);
  const out = new Int16Array(n);
  const rnd = noise(seed);
  let last = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const white = rnd();
    // A first difference is a high-pass: the metal, not the sand.
    const bright = (white - last) * 0.5;
    last = white;
    out[i] = Math.round(Math.max(-1, Math.min(1, bright * Math.exp(-t * (6 / seconds)))) * 28000);
  }
  return out;
}

/** The bank: names the arranger uses. */
function makeBank(): BankEntry[] {
  const rnd = noise(3);
  return [
    { name: "sine", loop: true, pcm: cycle(32, (p) => Math.sin(2 * Math.PI * p)) },
    { name: "tri", loop: true, pcm: cycle(32, (p) => (p < 0.5 ? 4 * p - 1 : 3 - 4 * p)) },
    { name: "saw", loop: true, pcm: cycle(32, (p) => 2 * p - 1) },
    { name: "square", loop: true, pcm: cycle(32, (p) => (p < 0.5 ? 0.8 : -0.8)) },
    { name: "sine64", loop: true, pcm: cycle(64, (p) => Math.sin(2 * Math.PI * p)) },
    { name: "square64", loop: true, pcm: cycle(64, (p) => (p < 0.5 ? 0.7 : -0.7)) },
    { name: "saw64", loop: true, pcm: cycle(64, (p) => 2 * p - 1) },
    { name: "kick", loop: false, pcm: kick() },
    { name: "snare", loop: false, pcm: snare() },
    { name: "hat", loop: false, pcm: hat(0.06, 11) },
    { name: "ohat", loop: false, pcm: hat(0.2, 13) },
    // A noise sample for a percussion voice that names none of the drums.
    { name: "noise", loop: true, pcm: (() => { const o = new Int16Array(256); for (let i = 0; i < 256; i++) o[i] = Math.round(rnd() * 20000); return o; })() },
  ].map(entry => ({ ...entry, baseHz:sampleBaseHz(entry.name) }));
}

const VOICES = ["v0", "v1", "v2", "v3", "v4", "v5", "v6", "v7"];

/** The kit's noise indices on the other chips, mapped onto drums here. */
const DRUM_FOR_INDEX = (index: number) => (index <= 7 ? "kick" : index <= 10 ? "snare" : index === 12 ? "ohat" : "hat");

/** Compile this immutable factory bank once. Reconstructing encoder state for
 * cancellation must not BRR-encode every drum on the UI thread again. */
function compileBank() {
  const bank = makeBank();
  const brr = bank.map(b => encodeBrr(b.pcm, b.loop));
  const image = new Uint8Array(SAMPLES + brr.reduce((n, b) => n + b.length, 0));
  let at = SAMPLES;
  brr.forEach((bytes, i) => {
    image.set(bytes, at);
    const entry = DIRECTORY + i * 4;
    image[entry] = image[entry + 2] = at & 0xff;
    image[entry + 1] = image[entry + 3] = at >> 8;
    at += bytes.length;
  });
  if (at >= ECHO_PAGE * 0x100) throw new Error("the sample bank runs into the echo buffer");
  return { bank, image };
}
let compiledBank: ReturnType<typeof compileBank> | undefined;

export class SnesDriver implements ChipDriver {
  private readonly bank: BankEntry[];
  private readonly image: Uint8Array;
  constructor() {
    const compiled = compiledBank ??= compileBank();
    this.bank = compiled.bank;
    this.image = compiled.image;
  }

  /** The directory and the bank, from `$0200`. */
  memory() {
    return [{ address: DIRECTORY, bytes: this.image.slice(DIRECTORY) }];
  }

  private index(name: string | null, fallback: string): number {
    const i = this.bank.findIndex((b) => b.name === (name ?? fallback));
    return i < 0 ? this.bank.findIndex((b) => b.name === fallback) : i;
  }

  powerOn(): RegisterEvent[] {
    const out: RegisterEvent[] = [];
    let t = 0;
    const reg = (address: number, value: number) => {
      out.push({ at: t, addr: F2, value: address });
      out.push({ at: t + PAIR, addr: F3, value: value & 0xff });
      t += GAP;
    };
    // Echo writes off while the buffer is set up. The DSP measures its buffer
    // when the old one wraps, and the register it powers on with means 28 KB
    // from wherever ESA points, which wraps round the top of RAM into the
    // samples. Every program disabled writes first, set ESA and EDL, and
    // waited the old delay out before enabling them; so does this one.
    reg(R_FLG, 0x20);
    // Every voice released. The DSP powers on in a state captured from a
    // console with voices keyed on, the noise routed to some of them and its
    // clock stopped, which is a constant on the output; the IPL ROM keyed
    // everything off before handing over, and so does this.
    reg(R_KOFF, 0xff);
    reg(R_KON, 0x00);
    reg(R_PMON, 0x00);
    reg(R_NON, 0x00);
    reg(R_DIR, DIRECTORY >> 8);
    reg(R_MVOLL, 0x60);
    reg(R_MVOLR, 0x60);
    reg(R_EVOLL, 0x1c);
    reg(R_EVOLR, 0x1c);
    reg(R_EFB, 0x38);
    reg(R_ESA, ECHO_PAGE);
    reg(R_EDL, ECHO_DELAY);
    reg(R_EON, 0x07); // the three pitched voices, not the kit
    // The FIR most games shipped with: a low-pass that sums to unity.
    [0x0c, 0x21, 0x2b, 0x2b, 0x13, 0xfe, 0xf3, 0xf9].forEach((c, i) => reg(R_FIR + i * 0x10, c));
    for (let v = 0; v < 8; v++) {
      reg(v * 0x10 + 0x00, 0);
      reg(v * 0x10 + 0x01, 0);
      reg(v * 0x10 + 0x05, 0xff); // ADSR on, attack at once, decay fast
      reg(v * 0x10 + 0x06, 0xe0); // sustain at the top, forever
      reg(v * 0x10 + 0x07, 0x00);
    }
    // KOFF released, once every voice has seen it, so KON can take again.
    reg(R_KOFF, 0x00);
    // Echo writes on, once the power-on buffer has wrapped: 240 ms of it.
    t = Math.round(0.25 * 1024000);
    reg(R_FLG, 0x00);
    return out;
  }

  note(voice: string, frames: NoteFrame[]): RegisterEvent[] {
    const v = VOICES.indexOf(voice);
    if (v < 0 || frames.length === 0) return [];
    const out: RegisterEvent[] = [];
    const offset = (v + 1) * STAGGER;
    const base = v * 0x10;
    const first = frames[0];
    const pitched = first.freq > 0;
    const name = pitched ? (first.sample ?? "tri") : first.sample ?? DRUM_FOR_INDEX(first.period);
    const source = this.index(name, pitched ? "tri" : "noise");
    const entry = this.bank[source];
    let lastVolume = -1;
    let lastPitch = -1;
    let t = 0;
    const reg = (address: number, value: number) => {
      out.push({ at: t, addr: F2, value: address });
      out.push({ at: t + PAIR, addr: F3, value: value & 0xff });
      t += GAP;
    };
    for (let f = 0; f < frames.length; f++) {
      const s = frames[f];
      t = s.at + offset;
      const volume = Math.round((Math.max(0, Math.min(15, s.volume)) * 127) / 15);
      // A looped waveform plays its base pitch at $1000; a drum plays as recorded.
      const pitch = entry.loop && entry.baseHz > 0 ? Math.max(1, Math.min(0x3fff, Math.round((s.freq * 0x1000) / entry.baseHz))) : 0x1000;
      if (f === 0) {
        reg(base + 0x04, source);
        reg(base + 0x05, 0xff);
        reg(base + 0x06, 0xe0);
        reg(base + 0x02, pitch & 0xff);
        reg(base + 0x03, pitch >> 8);
        reg(base + 0x00, volume);
        reg(base + 0x01, volume);
        reg(R_KON, 1 << v);
      } else {
        if (pitch !== lastPitch) {
          reg(base + 0x02, pitch & 0xff);
          reg(base + 0x03, pitch >> 8);
        }
        if (volume !== lastVolume) {
          reg(base + 0x00, volume);
          reg(base + 0x01, volume);
        }
      }
      lastVolume = volume;
      lastPitch = pitch;
    }
    return out;
  }

  /** The voice's envelope switched to a fast exponential decrease: its own register, so nothing shared. */
  noteOff(voice: string, at: number): RegisterEvent[] {
    const v = VOICES.indexOf(voice);
    if (v < 0) return [];
    const t = at + (v + 1) * STAGGER;
    const base = v * 0x10;
    return [
      { at: t, addr: F2, value: base + 0x07 },
      { at: t + PAIR, addr: F3, value: 0xbf },
      { at: t + GAP, addr: F2, value: base + 0x05 },
      { at: t + GAP + PAIR, addr: F3, value: 0x7f },
    ];
  }
}
