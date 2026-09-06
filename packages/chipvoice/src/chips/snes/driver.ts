import type { ChipDriver, NoteFrame, RegisterEvent } from "../../chip.js";
import { FACTORY_SAMPLES, FACTORY_RAM_HEX } from "./bank-inline.js";

/**
 * The SNES's driver: a note's frames to the DSP's registers through `$F2`
 * and `$F3`, as an SPC700 program wrote them, with the samples it needs
 * copied into RAM first.
 *
 * Everything on this chip is a sample. The driver carries a bank of them,
 * authored and BRR-encoded at build time: instrument attacks and sustain
 * loops, legacy waveforms, and a kit of one-shot drums. A note is a source number,
 * a pitch that scales the sample's rate, the voice's two volumes for the
 * frame's level, and a key-on. Each sample carries its own hardware ADSR;
 * legacy waveforms retain their immediate, full sustain envelope. A note ends by switching the voice's envelope to a fast
 * exponential decrease in GAIN mode, which is the voice's own register: KOFF
 * is shared by eight voices and a driver that writes it for one would carry
 * the others' state, which this one, writing notes out of time order, does
 * not have.
 *
 * The factory palette adds a short filtered echo to the pitched voices.
 * This is one arrangement choice, not proof of a particular game's sound;
 * that also depends on its sample bank, envelopes, tuning and voicing.
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
/** The echo buffer: ESA is a page, EDL a count of 2 KB. */
const ECHO_PAGE = 0xe0;
const ECHO_DELAY = 3;

/** Driver headroom, before the DSP's saturating voice sum. */
const VOICE_VOLUME = 0x20;
type BankEntry = (typeof FACTORY_SAMPLES)[number];
const SAMPLE_BY_NAME = new Map(FACTORY_SAMPLES.map(entry => [entry.name,entry]));
/** One tuning source for both arrangement diagnostics and playback. */
export function sampleBaseHz(name: string): number {
  return (SAMPLE_BY_NAME.get(name) ?? SAMPLE_BY_NAME.get("tri")!).baseHz;
}

const VOICES = ["v0", "v1", "v2", "v3", "v4", "v5", "v6", "v7"];

/** The kit's noise indices on the other chips, mapped onto drums here. */
const DRUM_FOR_INDEX = (index: number) => (index <= 7 ? "kick" : index <= 10 ? "snare" : index === 12 ? "ohat" : "hat");

/** Decode the precompiled RAM image once. No synthesis or BRR search at play. */
let factoryImage: Uint8Array | undefined;
function bankImage(): Uint8Array {
  if (!factoryImage) {
    factoryImage = new Uint8Array(FACTORY_RAM_HEX.length / 2);
    for (let i=0;i<factoryImage.length;i++) {
      const high=FACTORY_RAM_HEX.charCodeAt(i*2),low=FACTORY_RAM_HEX.charCodeAt(i*2+1);
      factoryImage[i]=((high<=57?high-48:high-87)<<4)|(low<=57?low-48:low-87);
    }
  }
  return factoryImage;
}

export class SnesDriver implements ChipDriver {
  private readonly bank: BankEntry[];
  private readonly image: Uint8Array;
  constructor() {
    this.bank = FACTORY_SAMPLES;
    this.image = bankImage();
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
    // Disabling echo writes does not disable reads. The power-on delay can
    // wrap into sample RAM until it expires; do not audibly play those bytes.
    reg(R_EVOLL, 0);
    reg(R_EVOLR, 0);
    reg(R_EFB, 0x38);
    reg(R_ESA, ECHO_PAGE);
    reg(R_EDL, ECHO_DELAY);
    reg(R_EON, 0x07); // the three pitched voices, not the kit
    // Factory low-pass FIR; signed coefficients sum to 128 (unity gain).
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
    reg(R_EVOLL, 0x1c);
    reg(R_EVOLR, 0x1c);
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
      const volume = Math.round((Math.max(0, Math.min(15, s.volume)) * VOICE_VOLUME) / 15);
      // A looped waveform plays its base pitch at $1000; a drum plays as recorded.
      const pitch = entry.loop && entry.baseHz > 0 ? Math.max(1, Math.min(0x3fff, Math.round((s.freq * 0x1000) / entry.baseHz))) : 0x1000;
      if (f === 0) {
        reg(base + 0x04, source);
        reg(base + 0x05, entry.adsr1);
        reg(base + 0x06, entry.adsr2);
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
