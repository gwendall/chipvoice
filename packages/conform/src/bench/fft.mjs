/**
 * A minimal iterative radix-2 Cooley-Tukey FFT, in place, on parallel real
 * and imaginary arrays whose length is a power of two. That is the one
 * numeric primitive `compare.mjs` needs - a magnitude spectrum per segment,
 * and a fast cross-correlation to find the sync marker - and it is short
 * enough to write and check directly rather than add a dependency for.
 */
export function fft(re, im, invert = false) {
  const n = re.length;
  if (n !== im.length || (n & (n - 1)) !== 0) throw new Error('fft: length must be a power of two');

  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((invert ? 1 : -1) * 2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let start = 0; start < n; start += len) {
      let curWr = 1;
      let curWi = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = start + k;
        const b = start + k + len / 2;
        const ur = re[a];
        const ui = im[a];
        const vr = re[b] * curWr - im[b] * curWi;
        const vi = re[b] * curWi + im[b] * curWr;
        re[a] = ur + vr;
        im[a] = ui + vi;
        re[b] = ur - vr;
        im[b] = ui - vi;
        const nextWr = curWr * wr - curWi * wi;
        curWi = curWr * wi + curWi * wr;
        curWr = nextWr;
      }
    }
  }
  if (invert) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

export function nextPow2(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** A Hann window, computed once and reused. */
export function hannWindow(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

/**
 * The magnitude spectrum of `samples.slice(start, start + size)`, windowed
 * (Hann) and zero-padded to `size` (a power of two), as `size / 2 + 1` bins
 * from 0 Hz to the Nyquist rate.
 */
export function magnitudeSpectrum(samples, start, size, sampleRate) {
  const re = new Float32Array(size);
  const im = new Float32Array(size);
  const window = hannWindow(size);
  let windowSum = 0;
  for (let i = 0; i < size; i++) {
    const s = start + i;
    re[i] = (s >= 0 && s < samples.length ? samples[s] : 0) * window[i];
    windowSum += window[i];
  }
  fft(re, im, false);
  const bins = size / 2 + 1;
  const mag = new Float32Array(bins);
  // Normalise by the window's coherent gain, so a flat input reads back at its own amplitude.
  const norm = 2 / windowSum;
  for (let i = 0; i < bins; i++) mag[i] = Math.hypot(re[i], im[i]) * norm;
  mag[0] /= 2; // DC has no negative-frequency twin to double
  return { mag, binHz: sampleRate / size };
}

/**
 * Third-octave band centres and edges (2^(1/3) spacing, the usual acoustic
 * convention) covering `loHz` to `hiHz`.
 */
export function thirdOctaveBands(loHz, hiHz) {
  const bands = [];
  const step = Math.pow(2, 1 / 3);
  const half = Math.pow(2, 1 / 6);
  let center = 20;
  while (center * half < loHz) center *= step;
  while (center / half < hiHz) {
    bands.push({ center, lo: center / half, hi: center * half });
    center *= step;
  }
  return bands;
}

/** Average power (as a level, not dB) of `mag` within `[lo, hi)` Hz. */
export function bandLevel(mag, binHz, lo, hi) {
  const i0 = Math.max(1, Math.round(lo / binHz));
  const i1 = Math.min(mag.length - 1, Math.round(hi / binHz));
  if (i1 <= i0) {
    const i = Math.min(mag.length - 1, Math.max(1, Math.round(((lo + hi) / 2) / binHz)));
    return mag[i];
  }
  let sum = 0;
  for (let i = i0; i < i1; i++) sum += mag[i] * mag[i];
  return Math.sqrt(sum / (i1 - i0));
}

export const dB = (x) => (x > 1e-12 ? 20 * Math.log10(x) : -240);
