/**
 * What a sound chip is, from the outside.
 *
 * Five machines implement these contracts. ChipSpec describes voice kinds,
 * role allocation and clocks; instruments can use tables, FM or samples.
 * The portable score retains four roles even when physical voices are shared.
 *
 * What does not differ, and is why this abstraction is worth having at all:
 * every chip is a thing that takes timestamped register writes and fills a
 * buffer.
 */

/** How a voice makes sound, which decides what an instrument for it looks like. */
export type VoiceKind =
  | "pulse"
  | "triangle"
  | "noise"
  | "wavetable"
  | "fm"
  | "sample";

export interface VoiceSpec {
  /** Short id used in songs and in `sfx`. Stable: songs are stored with it. */
  id: string;
  label: string;
  kind: VoiceKind;
  /**
   * Note names, a noise period index, or nothing at all.
   *
   * A caller needs this to know whether `"A4"` or `9` is the right thing to
   * hand a voice, and a validator needs it to say so when it is wrong.
   */
  notes: "pitch" | "period" | "sample";
}

/**
 * What a song's four lines are, before they are voices: a lead, a chord, a
 * bass, and percussion. Every chip maps them onto its own voices, and that
 * map is the first, smallest form of the arranger the roadmap describes.
 */
export type Role = "lead" | "chord" | "bass" | "perc";

export interface ChipSpec {
  /** Stable id. Songs record it, so it is part of the data format. */
  id: string;
  /** The chip. */
  name: string;
  /** The machine it is best known from. */
  system: string;
  voices: VoiceSpec[];
  /** Which voice each of a song's roles lands on. */
  roles: Record<Role, string>;
  /**
   * The shape an instrument takes for this chip. `table` is the FamiTracker
   * model: per-frame arrays for volume, duty, arpeggio and pitch.
   */
  instruments: "table" | "fm" | "sample";
  /** Native sample rate, when the chip has one. Null means it follows the host. */
  nativeSampleRate: number | null;
  /**
   * The clock `RegisterEvent.at` counts in, in Hz.
   *
   * For the 2A03 it is the CPU clock, 1789773 on NTSC. A driver stamps its
   * writes with it, and a log of writes captured from a real machine is in the
   * same unit - which is what makes the two comparable, and what an oracle
   * needs to replay one against the other.
   */
  clockHz: number;
}

/**
 * A running chip.
 *
 * Both the worklet and the offline renderer drive one of these; they differ
 * only in where the sample clock comes from.
 */
export interface ChipCore {
  /** Queues register writes, each stamped with the cycle it applies at. */
  schedule(events: RegisterEvent[]): void;
  /** Removes future owned writes from the scheduler, before register decoding. */
  cancel?(owner: string, from: number): void;
  /**
   * Puts bytes into the chip's memory, for a voice that plays samples: the
   * 2A03's DMC reads the CPU's address space from `$8000` up. A chip with no
   * such voice ignores it.
   */
  load(address: number, bytes: Uint8Array): void;
  /**
   * Fills a buffer. `startSample` is the absolute position of `left[0]` on
   * the sample clock; the core derives its own cycle position from it.
   */
  render(left: Float32Array, right: Float32Array | null, startSample: number): void;
  setGain(value: number): void;
  reset(): void;
}

/** Scheduling ownership never changes a hardware address or byte. */
export interface ScheduledEvent extends RegisterEvent { owner?: string }

/**
 * One register write, as the CPU would make it, stamped with the cycle it
 * lands on.
 *
 * A byte to an address, and nothing else, because that is what every chip is
 * from the outside and what every log of one contains. An earlier shape
 * carried decoded fields - `duty`, `period`, `trigger` - and let the driver do
 * two things the hardware cannot: change a pulse's period high bits without
 * restarting its phase, and skip the sweep register, which on a NES mutes any
 * low note until it is written. A byte cannot skip anything.
 */
export interface RegisterEvent {
  /**
   * Absolute cycle on the chip's clock, `ChipSpec.clockHz` of them a second,
   * counted from the same origin as the sample clock: sample 0 is cycle 0.
   *
   * Cycles rather than samples because the chip is a cycle machine and the
   * sample rate is the host's business. A write lands on its cycle wherever
   * that falls inside a sample, the same event stream renders the same way at
   * any rate, and a VGM file is this list with a different header.
   */
  at: number;
  /** The register, as the CPU addresses it: `$4000` to `$4017` on the 2A03. */
  addr: number;
  /** The byte. */
  value: number;
}

/**
 * The digital chip on its own: the part that can be right or wrong.
 *
 * Register writes in, the value of each voice out, cycle by cycle, and no
 * sample rate anywhere. This is what a harness compares with an oracle, and
 * what a netlist simulation or a logic capture of the real chip would give.
 * The analog stage - the mixing curves, the filters - is deliberately not
 * here: two real consoles disagree about it, so it gets a profile and a
 * tolerance rather than a bit-for-bit comparison.
 */
export interface DigitalChip {
  /** Voice names, in the order `trace` reports them. */
  readonly voices: readonly string[];
  /** Queues register writes, each stamped with the cycle it applies at. */
  schedule(events: RegisterEvent[]): void;
  /** Puts bytes into the chip's memory, for a voice that plays samples. */
  load(address: number, bytes: Uint8Array): void;
  /**
   * Runs `cycles` cycles and reports each change of a voice's value as it
   * happens. Every voice starts from 0. A list of changes says the same as
   * the per-cycle output and is what parity is measured on.
   */
  trace(cycles: number, onChange: (cycle: number, voice: number, value: number) => void): void;
  reset(): void;
}

/**
 * A fixed waveform, for a chip whose voices choose among a few: the SID's
 * four. A chip with pulses alone reads the duty and ignores this.
 */
export type Waveform = "pulse" | "triangle" | "sawtooth" | "noise";

/**
 * One frame of a note, after the instrument has been read: what the voice
 * should be doing for the next sixtieth of a second, in terms no chip owns.
 *
 * The driver expands an instrument into these; a chip's own driver turns them
 * into its registers. A pitch is in hertz and a volume is 0 to 15 because
 * every chip so far takes those or something a formula away from them. The
 * two things that are one chip's are named as such: `period` is the 2A03's
 * noise index, which the songs were written in and other chips map onto their
 * own rates; `pitchOffset` is in 2A03 period units, cumulative, because the
 * instruments' pitch tables are.
 */
export interface FrameState {
  /** 0 to 15. */
  volume: number;
  /** Hertz, for a voice that takes a pitch; 0 otherwise. */
  freq: number;
  /** The 2A03's noise period index, 0 to 15, for a noise voice. */
  period: number;
  /** 0 to 3. */
  duty: number;
  /** The noise's short sequence. */
  noiseMode: boolean;
  /** A cumulative bend from the instrument's pitch table, in 2A03 period units. */
  pitchOffset: number;
  /** For a voice that picks a fixed waveform: which; null for the chip's own default. */
  waveform: Waveform | null;
  /** For a wavetable voice: 32 samples, 0 to 15; null for the chip's own default. */
  wave: number[] | null;
  /** For an FM voice: the patch; null for the chip's own default. */
  fm: FmPatch | null;
  /** For a sample voice: the name of a sample in the chip's bank; null for the chip's own default. */
  sample: string | null;
}

/**
 * One operator of a four-operator FM patch, in the YM2612's own units:
 * detune 0-7, multiple 0-15, total level 0-127 (attenuation), key scale 0-3,
 * attack 0-31, decay 0-31, sustain rate 0-31, sustain level 0-15, release
 * 0-15. Written for the chip that has them; an FM chip's arranger maps the
 * score's words onto these.
 */
export interface FmOperator {
  dt: number;
  mul: number;
  tl: number;
  ks: number;
  ar: number;
  dr: number;
  sr: number;
  sl: number;
  rr: number;
  /** Amplitude modulation by the LFO. */
  am?: boolean;
}

/** A YM2612 patch: an algorithm, a feedback level, four operators in the order OP1 to OP4. */
export interface FmPatch {
  algorithm: number;
  feedback: number;
  ops: [FmOperator, FmOperator, FmOperator, FmOperator];
  /** LFO sensitivities, when the LFO is on. */
  ams?: number;
  pms?: number;
}

/** A frame, stamped with the cycle it starts on. */
export interface NoteFrame extends FrameState {
  at: number;
}

/**
 * A chip's own driver: the part of the driver that knows the registers.
 *
 * Everything above it - reading an instrument's tables, arpeggios, slides,
 * vibrato, the frame clock - is one piece of code for every chip. What a
 * frame's state costs in bytes to which addresses is this. It is stateful,
 * because the cheapest write is the one not made: a held note is one write
 * on a 2A03 and the driver has to remember what it wrote.
 */
export interface ChipDriver {
  /** What a program wrote first: the enables, the master volume. */
  powerOn(): RegisterEvent[];
  /** A whole note, frame by frame. Returns every write it takes. */
  note(voice: string, frames: NoteFrame[]): RegisterEvent[];
  /** Quiet, through the voice's own registers, on that cycle. */
  noteOff(voice: string, at: number): RegisterEvent[];
  /**
   * What a program copied into the chip's memory before playing: samples,
   * for a chip that plays them. Loaded at power-on, before `powerOn`'s
   * writes.
   */
  memory?(): { address: number; bytes: Uint8Array }[];
}

export interface ChipDefinition {
  spec: ChipSpec;
  /** Builds a core at a sample rate. */
  create(sampleRate: number): ChipCore;
  /** Builds the digital chip alone, for a harness. */
  digital(): DigitalChip;
  /** Builds the chip's own driver. */
  driver(): ChipDriver;
  /** The worklet source, ready to be handed to `addModule` as a blob. */
  workletSource: string;
  /** The processor name the worklet registers. */
  processorName: string;
}

/**
 * What the main thread posts to a chip's worklet.
 *
 * One type, imported by both ends of the port, so the driver cannot send a
 * message the processor does not handle. The processor is bundled separately
 * and would otherwise drift from the driver with nothing to say so.
 */
export type WorkletMessage =
  | { type: "events"; events: ScheduledEvent[] }
  | { type: "memory"; address: number; bytes: Uint8Array }
  | { type: "gain"; value: number }
  | { type: "reset" }
  | { type: "cancel"; owner: string; from: number }
  | { type: "dispose" };

const registry = new Map<string, ChipDefinition>();

export function registerChip(definition: ChipDefinition) {
  registry.set(definition.spec.id, definition);
}

export function getChip(id: string): ChipDefinition | null {
  return registry.get(id) ?? null;
}

/** Every chip this build knows about. */
export function chips(): ChipSpec[] {
  return [...registry.values()].map((d) => d.spec);
}
