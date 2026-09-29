import type { ChipCreateOptions, ChipDriver, NoteFrame, RegisterEvent } from "../../chip.js";
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
 * The factory default is dry: `space` unset, or `{ space: "dry" }`, writes
 * EVOL/EFB/EON all zero, exactly as this driver always has. Space is an
 * authored effect, not a property of every SNES sound, so it is an explicit
 * choice rather than a hidden constant: `{ space: "room" }` turns on a
 * moderate authored echo (48 ms, feedback `$38`, the low-pass FIR below, on
 * the pitched voices only, the kit voice excluded) once the power-on buffer
 * has wrapped. See `docs/chips/snes.md` and decision 53 in
 * `docs/DECISIONS.md` for the measurements behind both the default and the
 * "room" register values. This is one arrangement choice either way, not
 * proof of a particular game's sound; that also depends on its sample bank,
 * envelopes, tuning and voicing.
 *
 * The kit's hats are the DSP's own noise, not a sample. `NON` (`$3D`) routes
 * a voice's output to the shared noise generator instead of its decoded BRR;
 * the voice's own ADSR and volumes still shape it exactly as they shape a
 * sample, so a closed and an open hat differ in decay through the volume
 * table, the way they already did as BRR bursts. `FLG`'s low five bits
 * (`$6C`) are the noise's clock, and it is one clock for every voice routed
 * to noise at once - a hardware limit, not a driver one. This driver sets it
 * in the very first `FLG` write at power-on, alongside the bit that holds
 * echo writes off, to its fastest rate, and never changes it again: a note
 * can start as early as the song's own time zero, so the clock has to be
 * live before the power-on sequence's first byte, not after its echo buffer
 * has finished settling. The DSP's noise LFSR runs off the same 32-entry
 * rate table as ADSR and GAIN, and a
 * slow clock makes it an audible, discrete buzz rather than a continuous
 * hiss - wrong for a hat at any rate this driver's single kit voice would
 * want. Because only the percussion voice's `notes: "period"` ChipSpec ever
 * carries `noiseMode`, `NON` is written whole, with only that voice's bit,
 * from that voice's own note stream alone; a pitched voice never touches
 * it. That mirrors why note off writes GAIN and not KOFF: `NON`, like KOFF,
 * is one register for eight voices, and a driver that let a second voice
 * carry noise would need to track the others' bits rather than overwrite
 * them, the way this driver already tracks nothing about KOFF's neighbours.
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
// $1f leaves room for rounding a chord budget across up to five voices.
const VOICE_VOLUME = 0x1f;
const PAN_LEFT = [1, 1, 1, 1, .68, .88, 1, .72];
const PAN_RIGHT = [1, .68, 1, 1, 1, .88, .72, 1];
// FLG bits 0-4: an index into the same 32-entry rate table ADSR and GAIN use,
// from about 1 Hz (0) to 32000 Hz (31, every sample). One clock drives every
// voice's noise at once, so this driver sets it once, at the fastest rate:
// the broadest, most sample-rate-limited hiss, with no beat a slower rate
// would add. Set in the first FLG write at power-on, before any note can
// play, and never rewritten after.
const NOISE_CLOCK = 0x1f;

/**
 * Named echo choices for `ChipCreateOptions.space`. `dry` reproduces this
 * driver's own behavior before `space` existed, bit for bit. An unrecognised
 * name (including `undefined`) also falls back to `dry`, the same permissive
 * contract `model` already has on the C64 driver - never a thrown error for
 * an unrecognised string, since a portable caller should not have to know
 * every chip's own vocabulary just to render one at all.
 *
 * `room`'s EDL (echo delay, in 2 KB units, 16 ms each) and EON (echo enable,
 * one bit per voice; the kit's percussion voice, v3, is excluded so drum
 * one-shots stay dry and readable through the echo tail) were chosen so the
 * echo buffer (`ESA*0x100` to `+ EDL*2048`) still lands inside 64 KB above
 * the factory bank: see `docs/chips/snes.md`'s power-on state section for
 * that arithmetic. EFB and EVOL are measured in `docs/SNES-PALETTE.md`'s
 * echo protocol against the three demo scores, a sustained-chord probe and
 * a drum-loop probe, with the 2A03 rendered as a control; decision 53 in
 * `docs/DECISIONS.md` records the result.
 */
const SPACES: Record<string, { evol: number; efb: number; eon: number; edl: number }> = {
  dry: { evol: 0, efb: 0, eon: 0, edl: ECHO_DELAY },
  room: { evol: 0x18, efb: 0x38, eon: 0xf7, edl: 3 },
};
function spaceFor(name: string | undefined): { evol: number; efb: number; eon: number; edl: number } {
  return SPACES[name ?? "dry"] ?? SPACES.dry;
}

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
  private readonly space: { evol: number; efb: number; eon: number; edl: number };
  constructor(options?: ChipCreateOptions) {
    this.bank = FACTORY_SAMPLES;
    this.image = bankImage();
    this.space = spaceFor(options?.space);
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
    // The chip's own power-on state, captured from real hardware, is not
    // silence: a nonzero main and echo volume, a key-on bit already set on
    // some voice, and pitch/source registers this driver does not own until
    // its own per-voice loop below writes them. That combination can decode
    // a moment of whatever the bank's own bytes are at whichever address the
    // stray voice's uninitialized source number happens to select - larger
    // or differently laid out than the last bank measured, a louder moment.
    // Muting both volumes before anything else, rather than relying on how
    // many samples a bank happens to keep quiet at that one address, makes
    // the fix independent of the bank's own size or layout: a captured
    // voice can still decode a BRR block for a handful of cycles, but MVOL
    // and EVOL being zero already means neither the voice sum nor the echo
    // path contributes anything to the output before this driver's own
    // setup, below, has silenced it properly.
    reg(R_MVOLL, 0);
    reg(R_MVOLR, 0);
    reg(R_EVOLL, 0);
    reg(R_EVOLR, 0);
    // Echo writes off while the buffer is set up. The DSP measures its buffer
    // when the old one wraps, and the register it powers on with means 28 KB
    // from wherever ESA points, which wraps round the top of RAM into the
    // samples. Every program disabled writes first, set ESA and EDL, and
    // waited the old delay out before enabling them; so does this one. The
    // same write sets the noise clock (bits 0-4): a note can start at the
    // song's own time zero, before the echo buffer below has finished
    // settling, so the clock has to be live from this first byte, not from
    // the later write that turns echo writes back on.
    reg(R_FLG, 0x20 | NOISE_CLOCK);
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
    reg(R_EFB, this.space.efb);
    reg(R_ESA, ECHO_PAGE);
    reg(R_EDL, this.space.edl);
    reg(R_EON, 0); // never on before the buffer has wrapped, in either space
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
    // The noise clock (bits 0-4) has been live since the first FLG write
    // above; this write repeats the same value, with the reset and mute
    // bits (7, 6) staying off, as they were meant to from here on. In the
    // "dry" space (the default) this writes exactly the sequence this
    // driver always has - EVOL stays zero and EON is not written a second
    // time - so its register stream, and every golden built from it, is
    // unchanged. "room" is where the authored echo return comes up, and
    // EON follows, on the pitched voices only.
    t = Math.round(0.25 * 1024000);
    reg(R_EVOLL, this.space.evol);
    reg(R_EVOLR, this.space.evol);
    if (this.space.eon !== 0) reg(R_EON, this.space.eon);
    reg(R_FLG, NOISE_CLOCK);
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
    // Only the percussion voice's frames ever carry noiseMode (its ChipSpec
    // is the one voice with `notes: "period"`); a pitched voice never does,
    // so NON is only ever written from a drum's own note stream, whole, and
    // never clobbers a pitched voice's registers.
    const noise = !pitched && first.noiseMode;
    const name = pitched ? (first.sample ?? "tri") : noise ? "noise" : first.sample ?? DRUM_FOR_INDEX(first.period);
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
      const volume = (Math.max(0, Math.min(15, s.volume)) * VOICE_VOLUME) / 15;
      // A looped waveform plays its base pitch at $1000; a drum plays as recorded.
      const pitch = entry.loop && entry.baseHz > 0 ? Math.max(1, Math.min(0x3fff, Math.round((s.freq * 0x1000) / entry.baseHz))) : 0x1000;
      if (f === 0) {
        reg(base + 0x04, source);
        reg(base + 0x05, entry.adsr1);
        reg(base + 0x06, entry.adsr2);
        reg(base + 0x02, pitch & 0xff);
        reg(base + 0x03, pitch >> 8);
        reg(base + 0x00, Math.round(volume * PAN_LEFT[v]));
        reg(base + 0x01, Math.round(volume * PAN_RIGHT[v]));
        if (!pitched) reg(R_NON, noise ? 1 << v : 0);
        reg(R_KON, 1 << v);
      } else {
        if (pitch !== lastPitch) {
          reg(base + 0x02, pitch & 0xff);
          reg(base + 0x03, pitch >> 8);
        }
        if (volume !== lastVolume) {
          reg(base + 0x00, Math.round(volume * PAN_LEFT[v]));
          reg(base + 0x01, Math.round(volume * PAN_RIGHT[v]));
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
