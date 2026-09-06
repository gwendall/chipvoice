/**
 * BRR, the S-DSP's sample format, and an encoder for it.
 *
 * A BRR block is nine bytes: a header with a shift, a filter and the end and
 * loop flags, then sixteen 4-bit samples. Each sample is a difference from
 * what one of four fixed predictors makes of the two samples before it,
 * scaled by the shift. The decoder here is the DSP's own arithmetic, taken
 * from `sdsp.ts`, so the encoder's search measures the error the chip will
 * actually make: for every block it tries every filter and shift, decodes
 * what it encoded, and keeps the pair with the least error. A first block
 * uses filter 0, which predicts nothing, and so does the block a loop
 * returns to, so a looped sample decodes the same way round every time.
 */

const int16 = (x: number) => (x << 16) >> 16;
const clamp16 = (io: number) => (int16(io) !== io ? (io >> 31) ^ 0x7fff : io);

/** One nibble through the DSP's decoder, given the two samples before it. */
function decodeNibble(nibble: number, shift: number, filter: number, p1: number, p2half: number): number {
  let s = ((nibble << 28) >> 28);
  s = (s << shift) >> 1;
  if (shift >= 0xd) s = (s >> 25) << 11;
  if (filter >= 2) {
    s += p1;
    s -= p2half;
    if (filter === 2) {
      s += p2half >> 4;
      s += (p1 * -3) >> 6;
    } else {
      s += (p1 * -13) >> 7;
      s += (p2half * 3) >> 4;
    }
  } else if (filter) {
    s += p1 >> 1;
    s += -p1 >> 5;
  }
  s = clamp16(s);
  return int16(s * 2);
}

/** The predictor's estimate for a sample, to subtract before quantising. */
function predict(filter: number, p1: number, p2half: number): number {
  switch (filter) {
    case 1:
      return (p1 >> 1) + (-p1 >> 5);
    case 2:
      return p1 - p2half + (p2half >> 4) + ((p1 * -3) >> 6);
    case 3:
      return p1 - p2half + ((p1 * -13) >> 7) + ((p2half * 3) >> 4);
    default:
      return 0;
  }
}

/**
 * Encodes 16-bit samples as BRR. The length is padded to a multiple of
 * sixteen with silence unless it already is one. loopStart is a PCM sample
 * offset aligned to a block; the sample directory must point at that BRR block.
 */
export function encodeBrr(pcm: Int16Array, loop: boolean, loopStart = 0): Uint8Array {
  if (!Number.isInteger(loopStart) || loopStart < 0 || loopStart % 16 !== 0 || (loopStart > 0 && (!loop || loopStart >= pcm.length))) {
    throw new Error("BRR loop start must be a 16-sample boundary inside a looped sample");
  }
  const blocks = Math.max(1, Math.ceil(pcm.length / 16));
  const out = new Uint8Array(blocks * 9);
  // The decoder's state, carried block to block as the chip carries it: the
  // last two decoded samples. They are stored doubled, as the chip stores them.
  let last1 = 0;
  let last2 = 0;
  // Swap the candidate and winner buffers instead of allocating up to 52
  // candidate arrays per block. Neither scratch buffer escapes this call.
  let nibbles = new Uint8Array(16);
  let bestNibbles = new Uint8Array(16);
  for (let b = 0; b < blocks; b++) {
    let bestError = Infinity;
    let bestShift = 0, bestFilter = 0, best1 = 0, best2 = 0;
    for (let filter = 0; filter < (b === 0 || b * 16 === loopStart ? 1 : 4); filter++) {
      for (let shift = 0; shift <= 12; shift++) {
        let p1 = last1;
        let p2 = last2;
        let error = 0;
        let completed = 0;
        for (let i = 0; i < 16; i++) {
          const target = pcm[b * 16 + i] ?? 0;
          // Quantise the difference from the predictor in the chip's own
          // units. The chip works on half-scale values and doubles the
          // result: a decoded sample is 2 * (nibble * 2^(shift-1) +
          // prediction), so on the scale of the samples a nibble is worth
          // 2^shift and the prediction counts double.
          const guess = 2 * predict(filter, p1, p2 >> 1);
          const unit = 1 << shift;
          let n = Math.round((target - guess) / unit);
          n = Math.max(-8, Math.min(7, n));
          const decoded = decodeNibble(n & 0xf, shift, filter, p1, p2 >> 1);
          const e = decoded - target;
          error += e * e;
          if (error >= bestError) break;
          nibbles[completed++] = n & 0xf;
          p2 = p1;
          p1 = decoded;
        }
        if (completed === 16 && error < bestError) {
          bestError = error;
          bestShift = shift; bestFilter = filter; best1 = p1; best2 = p2;
          const previous = bestNibbles; bestNibbles = nibbles; nibbles = previous;
        }
      }
    }
    const end = b === blocks - 1;
    out[b * 9] = (bestShift << 4) | (bestFilter << 2) | (end && loop ? 2 : 0) | (end ? 1 : 0);
    for (let i = 0; i < 8; i++) out[b * 9 + 1 + i] = (bestNibbles[2 * i] << 4) | bestNibbles[2 * i + 1];
    last1 = best1;
    last2 = best2;
  }
  return out;
}
