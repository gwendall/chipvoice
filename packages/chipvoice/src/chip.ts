/**
 * What a sound chip is, from the outside.
 *
 * There is one implementation today - the Ricoh 2A03 - and this exists so the
 * second one does not require rewriting everything above it. It is deliberately
 * thin: the parts that genuinely differ between chips are named here, and
 * nothing is invented for machines that have not been built yet.
 *
 * What the survey of other chips says will actually differ, and is therefore
 * described rather than assumed:
 *
 *  - **the voices**, in number and in kind. Four here; a YM2612 has six FM
 *    channels, three PSG and a DAC; an SPC700 has eight sample voices
 *  - **what an instrument is**. Here it is per-frame tables, which is what a
 *    driver wrote every NMI. An FM patch is four operators with an envelope
 *    each, an algorithm and a feedback level, and does not fit that shape
 *  - **the note space**. Pulse and triangle take pitches; noise takes one of
 *    sixteen periods; a sample voice takes a sample and a rate
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

export interface ChipSpec {
  /** Stable id. Songs record it, so it is part of the data format. */
  id: string;
  /** The chip. */
  name: string;
  /** The machine it is best known from. */
  system: string;
  voices: VoiceSpec[];
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
  /**
   * Fills a buffer. `startSample` is the absolute position of `left[0]` on
   * the sample clock; the core derives its own cycle position from it.
   */
  render(left: Float32Array, right: Float32Array | null, startSample: number): void;
  setGain(value: number): void;
  reset(): void;
}

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

export interface ChipDefinition {
  spec: ChipSpec;
  /** Builds a core at a sample rate. */
  create(sampleRate: number): ChipCore;
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
  | { type: "events"; events: RegisterEvent[] }
  | { type: "gain"; value: number }
  | { type: "reset" };

const registry = new Map<string, ChipDefinition>();

export function registerChip(definition: ChipDefinition) {
  registry.set(definition.spec.id, definition);
}

export function getChip(id: string): ChipDefinition | null {
  return registry.get(id) ?? null;
}

/** Every chip this build knows about. One, for now. */
export function chips(): ChipSpec[] {
  return [...registry.values()].map((d) => d.spec);
}
