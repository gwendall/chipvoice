/**
 * A small algorithmic reverb, Freeverb-style (Jezar's public-domain
 * algorithm description: eight parallel lowpass-feedback comb filters
 * summed, then four series allpass filters for diffusion). Purely
 * algorithmic - no recorded impulse response anywhere in this file, per the
 * brief. Delay lengths below are Freeverb's own tuned constants, converted
 * from samples-at-44100-Hz to milliseconds so they scale to any
 * `sampleRate`.
 */

export interface ReverbParams {
  kind: 'reverb';
  /** 0..1, maps to comb feedback (room size / decay length). */
  size?: number;
  /** 0..1, how much high frequency the comb loops lose per pass. */
  damping?: number;
  /** 0..1, dry/wet. */
  mix?: number;
}

const COMB_DELAYS_MS = [1116, 1188, 1277, 1356, 1422, 1477, 1617, 1557].map((s) => (s / 44100) * 1000);
const ALLPASS_DELAYS_MS = [556, 441, 341, 225].map((s) => (s / 44100) * 1000);
const ALLPASS_FEEDBACK = 0.5;

class LowpassFeedbackComb {
  private readonly line: Float64Array;
  private writeHead = 0;
  private filterStore = 0;
  constructor(private readonly delaySamples: number, private readonly feedback: number, private readonly damping: number) {
    this.line = new Float64Array(Math.max(1, delaySamples));
  }
  process(x: number): number {
    const out = this.line[this.writeHead];
    this.filterStore = out * (1 - this.damping) + this.filterStore * this.damping;
    this.line[this.writeHead] = x + this.filterStore * this.feedback;
    this.writeHead = (this.writeHead + 1) % this.delaySamples;
    return out;
  }
}

class AllpassDiffuser {
  private readonly line: Float64Array;
  private writeHead = 0;
  constructor(private readonly delaySamples: number, private readonly feedback: number) {
    this.line = new Float64Array(Math.max(1, delaySamples));
  }
  process(x: number): number {
    const bufOut = this.line[this.writeHead];
    const out = -x + bufOut;
    this.line[this.writeHead] = x + bufOut * this.feedback;
    this.writeHead = (this.writeHead + 1) % this.delaySamples;
    return out;
  }
}

export function renderReverb(input: Float64Array, sampleRate: number, params: ReverbParams): Float64Array {
  const size = Math.max(0, Math.min(1, params.size ?? 0.5));
  const damping = Math.max(0, Math.min(1, params.damping ?? 0.5));
  const mix = Math.max(0, Math.min(1, params.mix ?? 0.3));
  // Freeverb maps room size to comb feedback roughly over [0.7, 0.98].
  const combFeedback = 0.7 + size * 0.28;

  const combs = COMB_DELAYS_MS.map((ms) => new LowpassFeedbackComb(Math.max(1, Math.round((ms / 1000) * sampleRate)), combFeedback, damping));
  const allpasses = ALLPASS_DELAYS_MS.map((ms) => new AllpassDiffuser(Math.max(1, Math.round((ms / 1000) * sampleRate)), ALLPASS_FEEDBACK));

  const out = new Float64Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const x = input[i];
    let combSum = 0;
    for (const comb of combs) combSum += comb.process(x);
    combSum /= combs.length;
    let wet = combSum;
    for (const ap of allpasses) wet = ap.process(wet);
    out[i] = (1 - mix) * x + mix * wet;
  }
  return out;
}
