/** A measured projection of a source patch onto the portable palette.
 * Produced during preparation, never by the player or AudioWorklet. */
export interface PortableTimbre {
  /** Exact source instrument identity; stale descriptors are rejected. */
  sourceSignature: string;
  /** Semitones from the source register frequency to the measured fundamental. */
  pitchOffset: number;
  /** Generic MIDI family approximation, independent of the source patch ID. */
  program: number;
  /** Normalized amplitude at 60 Hz, held at its final value. */
  envelope: number[];
  /** Peak window RMS of the source probe at unity output gain. */
  rms: number;
  /** Minimum normalized autocorrelation across the source probes. */
  confidence: number;
}

export function validatePortableTimbre(t: PortableTimbre): void {
  if (!t || typeof t.sourceSignature !== 'string' || t.sourceSignature.length > 65536 ||
      !Number.isFinite(t.pitchOffset) || Math.abs(t.pitchOffset) > 48 ||
      !Number.isInteger(t.program) || t.program < 0 || t.program > 127 ||
      !Array.isArray(t.envelope) || !t.envelope.length || t.envelope.length > 120 ||
      t.envelope.some(v => !Number.isFinite(v) || v < 0 || v > 1) ||
      !Number.isFinite(t.rms) || t.rms < 0 || t.rms > 1 ||
      !Number.isFinite(t.confidence) || t.confidence < 0 || t.confidence > 1) throw new Error('Invalid portable timbre');
}
