// Audio processing for the catalogue build: decode any source file to PCM,
// cut it clean, level it to the site's loudness convention, encode the three
// shipped formats, and measure what actually got built. Every measurement
// here is taken on the final bytes, never assumed from an upstream gain.
//
// Loudness convention (docs/GAMESOUNDS.md has the full rationale): momentary
// loudness (BS.1770-4 K-weighted, 400 ms window) at most -18 LUFS, true peak
// at most -1 dBTP, the peak cap wins when the two disagree. This is
// research.md section 6's own finding restated: no per-asset industry target
// exists, so -18 LUFS borrows the closest sourced figure (the Vita handheld
// console-certification target) and -1 dBTP is the standard broadcast true-peak
// ceiling. It is a stated, documented choice, not a number picked to pass.
//
// Measurement uses ffmpeg's `ebur128` filter (libebur128, an independent
// BS.1770 implementation - not code this build owns) so the loudness numbers
// in the catalogue are not the build grading its own homework. See
// `test/loudness.test.mjs` for the reference-signal check against a value
// this file's own math had no part in choosing.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const LOUDNESS_TARGET_LUFS = -18;
export const TRUE_PEAK_CEILING_DBTP = -1;

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function peakOf(left, right) {
  let peak = 0;
  for (let i = 0; i < left.length; i++) {
    const l = Math.abs(left[i]);
    if (l > peak) peak = l;
    if (right) {
      const r = Math.abs(right[i]);
      if (r > peak) peak = r;
    }
  }
  return peak;
}

/** Like `peakOf`, but kept per channel instead of collapsed to one number -
 * this catalogue's own build log reports each shipped format's decoded peak
 * against the wav's own peak, per channel, purely as informational data (see
 * `collectFormatPeakDeltas` in checks.mjs). It is not the build's actual
 * loudness gate any more: sample peak is too fragile under a lossy codec
 * (a legitimate, non-buggy encode can lose double-digit dB of peak to a
 * single sharp attack while its real total energy stays intact, and
 * conversely a preset whose energy sits mostly above the codec's own
 * passband can look fine on peak while losing most of its actual loudness -
 * see `energyPerChannel`, which is what `checkFormatEnergies` in checks.mjs
 * actually gates on). */
function peakPerChannel(left, right) {
  let l = 0;
  for (let i = 0; i < left.length; i++) {
    const a = Math.abs(left[i]);
    if (a > l) l = a;
  }
  if (!right) return { left: l, right: null };
  let r = 0;
  for (let i = 0; i < right.length; i++) {
    const a = Math.abs(right[i]);
    if (a > r) r = a;
  }
  return { left: l, right: r };
}

/** Total energy per channel (the sum of each sample squared - deliberately
 * NOT divided by sample count). A round-2 review shipped this as a MEAN
 * first, on the theory that a sum would bias the ratio `checkFormatEnergies`
 * computes whenever a codec's decoded PCM comes back a different length than
 * the wav it was encoded from. That was backwards, caught by a round-3
 * review before it ever shipped: this repo's dev-machine ffmpeg has no
 * libvorbis (see `vorbisEncoderArgs`'s own header), so its native vorbis
 * encoder is used, which does not trim the ogg's own end granule - the
 * decoded ogg routinely comes back padded with up to ~1023 samples of
 * TRAILING SILENCE, rounded up to the next 1024-sample block. Silence
 * contributes exactly zero to a SUM no matter how much of it there is, so
 * the sum is unaffected by this padding; but it grows the sample COUNT a
 * MEAN divides by, so a mean-square metric reports a bogus loss that gets
 * worse the shorter the real signal is relative to one block - a ~1029-
 * sample click padded to 2048 samples measured -3.02 dB of "lost" mean-
 * square energy with its actual (summed) energy unchanged to within 0.03 dB.
 * 36 real catalogue variants failed the build's tolerance this way before
 * the metric was fixed (all ogg; mp3/lame's own padding is already trimmed
 * by ffmpeg, so mp3 never showed this). A uniform gain bug (the old ogg
 * fallback path's `-ac 2` upmix) still shows up in the sum exactly as it did
 * in the mean - `10*log10(k**2)` for a uniform amplitude scale `k` does not
 * depend on sample count - so the sum keeps this function's whole purpose
 * (see `checkFormatEnergies` in checks.mjs) while losing the padding bias
 * the mean had. This is the signal `checkFormatEnergies` gates the build on:
 * total energy survives a lossy re-encode even when a single sharp sample's
 * own peak does not (see `peakPerChannel`'s own header), so energy is the
 * honest measure of "does this format still sound as loud", and peak is
 * not. */
function energyPerChannel(left, right) {
  const totalEnergy = (samples) => {
    if (!samples || samples.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    return sum;
  };
  const l = totalEnergy(left);
  if (!right) return { left: l, right: null };
  return { left: l, right: totalEnergy(right) };
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { maxBuffer: 1024 * 1024 * 512, ...options });
  if (result.error) throw new Error(`${cmd} failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited ${result.status}: ${(result.stderr ?? "").toString().slice(0, 2000)}`);
  }
  return result;
}

/** Probes a file's channel count with ffprobe, defaulting to mono on failure. */
function channelsOf(filePath) {
  const result = spawnSync("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=channels", "-of", "csv=p=0", filePath]);
  const n = parseInt((result.stdout ?? "").toString().trim(), 10);
  return n === 2 ? 2 : 1;
}

/**
 * Decodes any file ffmpeg can read into a `RenderResult`-shaped PCM buffer
 * (chipvoice's own shape), so every function below - and chipvoice's own
 * `trimRender`/`levelRender`/`scaleRender` - work on curated audio exactly as
 * they work on a chipvoice render.
 */
export function decodeToRender(filePath, { sampleRate = 44100 } = {}) {
  const channels = channelsOf(filePath);
  const result = run("ffmpeg", ["-y", "-v", "error", "-i", filePath, "-ac", String(channels), "-ar", String(sampleRate), "-f", "f32le", "-"]);
  const bytes = result.stdout;
  const aligned = new ArrayBuffer(bytes.length - (bytes.length % 4));
  new Uint8Array(aligned).set(bytes.subarray(0, aligned.byteLength));
  const floats = new Float32Array(aligned);
  if (channels === 1) return { sampleRate, left: floats, right: null, seconds: floats.length / sampleRate, peak: peakOf(floats, null) };
  const n = floats.length / 2;
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    left[i] = floats[i * 2];
    right[i] = floats[i * 2 + 1];
  }
  return { sampleRate, left, right, seconds: n / sampleRate, peak: peakOf(left, right) };
}

/** Finds the nearest zero crossing to `from`, searching in `direction` (+1 or -1) up to `maxSteps`. Falls back to `from` unchanged if none is found. */
function nearestZeroCrossing(left, right, from, direction, maxSteps) {
  const last = left.length - 1;
  const at = (i) => (right ? Math.max(Math.abs(left[i]), Math.abs(right[i])) : Math.abs(left[i]));
  const sign = (i) => (i < 0 || i > last ? 0 : left[i] >= 0 ? 1 : -1);
  let best = from;
  let bestMag = at(Math.min(Math.max(from, 0), last));
  for (let step = 0; step <= maxSteps; step++) {
    const i = from + step * direction;
    if (i < 0 || i > last) break;
    if (sign(i) !== sign(i - direction) || at(i) < 1e-4) {
      return i;
    }
    const mag = at(i);
    if (mag < bestMag) {
      bestMag = mag;
      best = i;
    }
  }
  return best;
}

/** How far ahead (or behind, for the trailing edge) `firstAboveFloor` and
 * `lastAboveFloor` look before deciding a sample is real content, not noise.
 * Shared with `checks.mjs`'s `checkLeadingSilence` so the trim and the audit
 * of what got shipped can never disagree about what "the onset" means -
 * see those functions' own header for why a single sample cannot decide it
 * alone. 2ms echoes this file's own `snapWindow` (the zero-crossing snap
 * radius just below), not a figure chosen for this purpose specifically.
 */
export const ONSET_WINDOW_MS = 2;

function buildSquarePrefix(left, right) {
  const n = left.length;
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    let sq = left[i] * left[i];
    if (right) sq += right[i] * right[i];
    prefix[i + 1] = prefix[i] + sq;
  }
  return prefix;
}

function windowRmsRange(prefix, channels, lo, hi, n) {
  lo = Math.max(0, lo);
  hi = Math.min(n, hi);
  if (hi <= lo) return 0;
  const sumSq = prefix[hi] - prefix[lo];
  return Math.sqrt(sumSq / ((hi - lo) * channels));
}

/**
 * The first sample index (scanning forward from 0) whose short forward-
 * looking RMS window clears `floor`. A single sample - or a handful -
 * sitting right at a silence floor is not a perceptible onset: it can be a
 * stray, sub-audible blip riding on top of a signal that stays genuinely
 * quiet for many more milliseconds. This was a real bug: several curated
 * sources with a slow, gradual attack (an arcade "power-up" sweep, a
 * digital notification tone) had one early sample clear an instantaneous
 * per-sample floor test; `trimToZeroCrossing`'s fade-in then suppressed
 * that one sample back toward 0, and the real onset - by any definition
 * that would actually sound like where the sound starts - was 10-40ms
 * later, past the site's own 10ms leading-silence budget. A short (2ms)
 * RMS window absorbs a lone spike while still catching a genuine instant
 * transient (a click, a hit) at essentially its first sample, since a real
 * transient's own short-window RMS clears the floor immediately too.
 */
export function firstAboveFloor(left, right, floor, sampleRate, windowMs = ONSET_WINDOW_MS) {
  const n = left.length;
  const channels = right ? 2 : 1;
  const windowSamples = Math.max(1, Math.round((windowMs / 1000) * sampleRate));
  const prefix = buildSquarePrefix(left, right);
  for (let i = 0; i < n; i++) {
    if (windowRmsRange(prefix, channels, i, i + windowSamples, n) >= floor) return i;
  }
  return n;
}

/** The mirror of `firstAboveFloor` for the trailing edge: the last sample
 * index (scanning backward from the end) whose short backward-looking RMS
 * window clears `floor`. Returns -1 when nothing in the file does. */
export function lastAboveFloor(left, right, floor, sampleRate, windowMs = ONSET_WINDOW_MS) {
  const n = left.length;
  const channels = right ? 2 : 1;
  const windowSamples = Math.max(1, Math.round((windowMs / 1000) * sampleRate));
  const prefix = buildSquarePrefix(left, right);
  for (let i = n - 1; i >= 0; i--) {
    if (windowRmsRange(prefix, channels, i - windowSamples + 1, i + 1, n) >= floor) return i;
  }
  return -1;
}

/**
 * Cuts silence off both ends at a zero crossing, then fades the last
 * `fadeSeconds` on each remaining end to zero. The fade always drives the
 * output's first and last samples to exactly 0; the zero-crossing snap is
 * what keeps the fade from having to ramp down a mid-wave discontinuity, per
 * research.md section 6's sourced convention (cut at a zero crossing, or fade
 * over the final cycles - this does both).
 */
export function trimToZeroCrossing(render, { floorDb = -60, fadeSeconds = 0.003, edge = "both" } = {}) {
  const { sampleRate, left, right } = render;
  const floor = peakOf(left, right) * 10 ** (floorDb / 20);
  const snapWindow = Math.max(1, Math.round(sampleRate * 0.002));
  // The fade below ramps gain from 0 to 1 across the first/last `fadeSamples`
  // of the OUTPUT. If the cut lands exactly on the detected onset/offset,
  // that ramp multiplies down the real signal it is supposed to protect, not
  // the silence before/after it - which reappears as extra apparent leading
  // silence (checkLeadingSilence re-measures the shipped, already-faded
  // audio, so it sees this). The fix is to cut `fadeSamples` earlier/later
  // than the detected edge, into material that was already below the floor,
  // so the ramp finishes crossing zero-to-one before/after the real content
  // starts/ends, not on top of it. See test/audio.test.mjs's regression test
  // (this was a real, reproducible bug on genuinely slow-attack sources -
  // sci-fi laser sweeps, spoken voice lines - not a threshold problem).
  const fadeSamples = Math.round(fadeSeconds * sampleRate);
  let start = 0;
  let end = left.length;
  if (edge === "both" || edge === "trailing") {
    const last = lastAboveFloor(left, right, floor, sampleRate);
    const target = last < 0 ? 1 : Math.min(left.length, last + 1 + fadeSamples);
    end = Math.min(left.length, nearestZeroCrossing(left, right, target, 1, snapWindow) + 1);
  }
  if (edge === "both" || edge === "leading") {
    const first = firstAboveFloor(left, right, floor, sampleRate);
    const target = Math.max(0, first - fadeSamples);
    start = Math.min(target, Math.max(0, end - 1));
    start = Math.max(0, nearestZeroCrossing(left, right, start, -1, snapWindow));
  }
  if (start >= end) { start = 0; end = Math.min(left.length, 1); }
  const outLeft = left.slice(start, end);
  const outRight = right ? right.slice(start, end) : null;
  const fade = Math.min(Math.round(fadeSeconds * sampleRate), Math.floor(outLeft.length / 2));
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    outLeft[i] *= k;
    if (outRight) outRight[i] *= k;
    outLeft[outLeft.length - 1 - i] *= k;
    if (outRight) outRight[outRight.length - 1 - i] *= k;
  }
  return { sampleRate, left: outLeft, right: outRight, seconds: outLeft.length / sampleRate, peak: peakOf(outLeft, outRight), cutStart: start, cutEnd: end };
}

/**
 * How clean a loop point is. The loop plays samples `[startSample,
 * endSample)` and then wraps back to `startSample`; it sounds seamless when
 * sample `endSample` (the sample that would have played next, had the file
 * not looped) is itself indistinguishable from `startSample` - equal value,
 * equal local slope. Both are normalized by the render's own peak so the
 * metric means the same thing at any volume. A loop is "clean" (see
 * LOOP_SEAM_MAX_STEP below) when that value step is under 1% of the file's
 * own peak amplitude - the smallest discontinuity conventionally treated as
 * inaudible in an 8-bit-style waveform, chosen before any real sound was
 * measured against it, not fitted to one. No loop-flagged sound ships in
 * this build yet (see docs/BACKLOG.md); this utility and its test exist so
 * the day one does, the seam is provably not a click.
 */
export function measureLoopSeam(render, startSample, endSample) {
  const { left, right } = render;
  const scale = peakOf(left, right) || 1;
  const at = (i) => (right ? (left[i] + right[i]) / 2 : left[i]);
  const valueStep = Math.abs(at(endSample) - at(startSample)) / scale;
  const slopeAtEnd = at(endSample) - at(endSample - 1);
  const slopeAtStart = at(startSample + 1) - at(startSample);
  const slopeStep = Math.abs(slopeAtEnd - slopeAtStart) / scale;
  return { valueStep, slopeStep };
}

export const LOOP_SEAM_MAX_STEP = 0.01;

/** 96-point peak envelope, 0 to 1, for an instant waveform before any audio decodes. */
export function computePeaks(render, points = 96) {
  const { left, right } = render;
  const n = left.length;
  const scale = peakOf(left, right) || 1;
  const out = new Array(points).fill(0);
  for (let b = 0; b < points; b++) {
    const s = Math.floor((b * n) / points);
    const e = Math.max(s + 1, Math.floor(((b + 1) * n) / points));
    let m = 0;
    for (let i = s; i < e && i < n; i++) {
      const l = Math.abs(left[i]);
      if (l > m) m = l;
      if (right) {
        const r = Math.abs(right[i]);
        if (r > m) m = r;
      }
    }
    out[b] = Math.round((m / scale) * 1000) / 1000;
  }
  return out;
}

function withTempWav(render, fn) {
  const dir = mkdtempSync(join(tmpdir(), "gamesounds-"));
  const path = join(dir, "probe.wav");
  try {
    writeFileSync(path, toWavBytes(render));
    return fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Duplicated from chipvoice's `toWav` on purpose: this module must stay
// independent of the exact chipvoice build/dist layout so the curated
// (non-chipvoice) half of the pipeline never needs the engine at all. The
// chipvoice-origin path calls the real `toWav` from the package and hands
// this module a `RenderResult`; this local copy is byte-for-byte the same
// 44-byte-header PCM16 writer, used only for measurement/encode round-trips.
function toWavBytes(render) {
  const { sampleRate, left, right } = render;
  const channels = right ? 2 : 1;
  const frames = left.length;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataSize = frames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    const l = Math.max(-1, Math.min(1, left[i]));
    view.setInt16(offset, Math.round(l * 32767), true);
    offset += 2;
    if (right) {
      const r = Math.max(-1, Math.min(1, right[i]));
      view.setInt16(offset, Math.round(r * 32767), true);
      offset += 2;
    }
  }
  return new Uint8Array(buffer);
}

/**
 * Momentary-max loudness (BS.1770-4, 400 ms window, the loudest window in the
 * file) and true peak, via ffmpeg's `ebur128`. Clips under 400 ms are padded
 * with trailing silence for this measurement only (BS.1770 has no momentary
 * reading before a full window has elapsed) - the padding never touches the
 * file that ships.
 */
export function measureLoudness(wavPath) {
  const probe = run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wavPath]);
  const duration = parseFloat(probe.stdout.toString().trim()) || 0;
  let measurePath = wavPath;
  let cleanupDir = null;
  if (duration < 0.4) {
    cleanupDir = mkdtempSync(join(tmpdir(), "gamesounds-pad-"));
    measurePath = join(cleanupDir, "padded.wav");
    run("ffmpeg", ["-y", "-v", "error", "-i", wavPath, "-af", "apad=whole_dur=0.45", measurePath]);
  }
  try {
    const result = run("ffmpeg", ["-hide_banner", "-nostats", "-i", measurePath, "-filter_complex", "ebur128=peak=true", "-f", "null", "-"]);
    const log = result.stderr.toString();
    const momentary = [...log.matchAll(/\bM:\s*(-?\d+(?:\.\d+)?)/g)].map((m) => parseFloat(m[1])).filter((v) => v > -100);
    const maxMomentary = momentary.length ? Math.max(...momentary) : -70;
    // The per-frame "TPK:" field prints one number per channel on the same
    // line (e.g. "TPK:  -3.0  -1.1 dBFS" for stereo, or one number for
    // mono); a regex that captures only the first number after "TPK:" reads
    // just the left channel and silently drops a louder right channel. The
    // end-of-run summary's "Peak:" line already reports ffmpeg's own max
    // across every channel and every frame as a single number, so it is
    // used directly instead of re-deriving that max from the per-frame log
    // (this was a real bug: it under-read the true peak of some stereo
    // curated sources, under-computing levelToConvention's peak-ceiling gain
    // and shipping a few sounds over -1 dBTP - see test/audio.test.mjs).
    const summaryMatch = log.match(/True peak:\s*\n\s*Peak:\s*(-?\d+(?:\.\d+)?|-inf)\s*dBFS/);
    const truePeak = summaryMatch ? (summaryMatch[1] === "-inf" ? -70 : parseFloat(summaryMatch[1])) : -70;
    return { lufs: Math.round(maxMomentary * 10) / 10, peakDb: Math.round(truePeak * 10) / 10 };
  } finally {
    if (cleanupDir) rmSync(cleanupDir, { recursive: true, force: true });
  }
}

function scaleFloat32(arr, scale) {
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = arr[i] * scale;
  return out;
}

/**
 * Measures a render's momentary loudness and true peak without ever
 * silently clipping it first. `toWavBytes` hard-clamps every sample to
 * +-1.0 before quantizing to 16-bit PCM - correct for a file that actually
 * ships (a WAV cannot hold a sample past full scale) but wrong for a
 * *measurement*: a handful of curated sources decode to a float peak just
 * over 1.0 (a hot lossy master's own inter-sample overshoot, baked into the
 * source file, surfacing on decode), and measuring the clamped, flat-topped
 * version of that peak reads a corrupted, too-quiet number. That was a real
 * bug: it let `levelToConvention` under-compute the peak-ceiling gain from
 * an artificially low raw peak, and ship a sound over -1 dBTP despite
 * believing it had capped it (a handful of curated sounds did exactly this
 * before this function existed). When the render's peak is over 1.0, this
 * measures a scaled-down copy instead - guaranteed not to clip - and adds
 * the scale back onto the result, so nothing above full scale is ever
 * quietly discarded before it gets measured.
 */
export function measureLoudnessOfRender(render) {
  const peak = peakOf(render.left, render.right);
  const scale = peak > 1 ? 1 / peak : 1;
  const scaleDb = 20 * Math.log10(scale);
  const scaled = scale === 1 ? render : {
    sampleRate: render.sampleRate,
    left: scaleFloat32(render.left, scale),
    right: render.right ? scaleFloat32(render.right, scale) : null,
  };
  return withTempWav(scaled, (wavPath) => {
    const m = measureLoudness(wavPath);
    return { lufs: Math.round((m.lufs - scaleDb) * 10) / 10, peakDb: Math.round((m.peakDb - scaleDb) * 10) / 10 };
  });
}

/**
 * Levels a render to the site's loudness convention by a single linear gain:
 * BS.1770 K-weighting is a linear filter, so scaling a signal by a constant
 * factor shifts its measured LUFS and true peak by exactly the same dB amount
 * - no iterative search needed. Measures the raw render once (via
 * `measureLoudnessOfRender`, so a hot source's own float peak over 1.0 is
 * never lost to clipping before it is measured), computes the gain each
 * ceiling would require, and applies whichever is quieter, so the true-peak
 * ceiling always wins over the loudness target when they conflict.
 */
export function levelToConvention(render, { targetLufs = LOUDNESS_TARGET_LUFS, peakCeilingDb = TRUE_PEAK_CEILING_DBTP } = {}) {
  const raw = measureLoudnessOfRender(render);
  const gainForLoudness = targetLufs - raw.lufs;
  const gainForPeak = peakCeilingDb - raw.peakDb;
  const gainDb = Math.min(gainForLoudness, gainForPeak);
  const gain = 10 ** (gainDb / 20);
  const left = new Float32Array(render.left.length);
  for (let i = 0; i < left.length; i++) left[i] = render.left[i] * gain;
  const right = render.right ? new Float32Array(render.right.length) : null;
  if (right) for (let i = 0; i < right.length; i++) right[i] = render.right[i] * gain;
  return { sampleRate: render.sampleRate, left, right, seconds: render.seconds, peak: peakOf(left, right), rawMeasure: raw, appliedGainDb: Math.round(gainDb * 100) / 100 };
}

// Picked once per process: most ffmpeg builds (Ubuntu's apt package, which
// CI installs) ship libvorbis, which encodes a source's own channel count
// (mono stays mono) at good quality. A handful of minimal builds (observed
// on a local dev machine's Homebrew ffmpeg) omit libvorbis and only have
// ffmpeg's own native, "experimental" vorbis encoder, which refuses mono
// input - `-strict -2` is only needed on that fallback path, so the common
// case never pays for a flag it does not need.
//
// The fallback path's channel layout is NOT the same as the libvorbis
// path's: it must upmix to stereo (the native encoder's own requirement),
// so a fallback-built ogg is dual-mono stereo where a libvorbis-built ogg
// of the same sound stays mono - see encodeVariant's own header for why
// this matters for loudness. That upmix uses an explicit unity-gain pan
// filter (`-af pan=stereo|c0=c0|c1=c0`, i.e. copy the mono input to both
// output channels unchanged), not ffmpeg's own default `-ac 2` upmix:
// ffmpeg's default applies -3.01 dB (1/sqrt(2)) to each channel, which is
// correct for panning a mono source into a stereo field but wrong here,
// since every browser's own mono decode plays a mono file at unity in both
// channels - `-ac 2` alone would ship this fallback path's oggs about 3 dB
// quieter than every other shipped format of the same sound. Verified
// experimentally on this machine (ffmpeg 8.0.1, no libvorbis): a 440 Hz
// test tone measured max_volume -20.0 dB in the source mono wav, -22.9 dB
// after the old `-ac 2` encode (a ~2.9 dB loss, matching the expected
// -3.01 dB attenuation), and -19.9 dB after this pan-filter encode
// (matching the source, modulo ordinary lossy-codec noise).
//
// `oggEncoder` (`"auto" | "native" | "libvorbis"`, default `"auto"`)
// overrides the auto-detection above - added for GS-07's own tests, so the
// native fallback path (and its tail-drop retry, see the comment above
// `encodeVariant` below) can be exercised deliberately even on a machine
// whose ffmpeg has libvorbis too (true of CI's Ubuntu apt package - both
// encoders are present there; `"auto"` just never picks the native one on
// its own when libvorbis is available). Detection of what the machine
// actually HAS stays cached and machine-wide (`hasLibvorbisCache`) - only
// which branch a given call TAKES is overridable, never re-probed.
let hasLibvorbisCache = null;
function hasLibvorbis() {
  if (hasLibvorbisCache === null) {
    const result = spawnSync("ffmpeg", ["-hide_banner", "-encoders"], { maxBuffer: 1024 * 1024 * 8 });
    hasLibvorbisCache = /libvorbis/.test((result.stdout ?? "").toString());
  }
  return hasLibvorbisCache;
}

function resolveOggEncoder(oggEncoder) {
  if (oggEncoder === "native" || oggEncoder === "libvorbis") return oggEncoder;
  return hasLibvorbis() ? "libvorbis" : "native";
}

export function vorbisEncoderArgs(oggEncoder = "auto") {
  return resolveOggEncoder(oggEncoder) === "native"
    ? ["-af", "pan=stereo|c0=c0|c1=c0", "-c:a", "vorbis", "-strict", "-2", "-q:a", "5"]
    : ["-c:a", "libvorbis", "-q:a", "5"];
}

// Both ffmpeg output calls in encodeVariant get these unconditionally (ogg
// AND mp3, libvorbis path and fallback path alike): without them, ffmpeg's
// ogg/vorbis muxer embeds a random stream serial number, and its mp3 stream
// carries an encoder/version tag, on every encode - so byte-identical audio
// re-encoded on a later run (or a fresh checkout) hashes differently even
// though nothing about the sound changed, which is exactly what
// scripts/check-determinism.mjs exists to catch. Verified experimentally: a
// test tone encoded twice with the production fallback ogg args (no
// bitexact) produced same-size, different-sha256 files; with
// `-fflags +bitexact -flags:a +bitexact` added as OUTPUT options (after
// `-i`, before the output path - the placement matters, the same flags
// placed as INPUT/demuxer options before `-i` do not fix it), three repeated
// encodes of the same input produced byte-identical output. mp3 already
// happens to be stable on this machine without bitexact, but only because
// the current ffmpeg/lame version string it embeds does not change between
// runs; adding the same flags there too removes that dependency on the
// build machine's ffmpeg version never changing.
const BITEXACT_ARGS = ["-fflags", "+bitexact", "-flags:a", "+bitexact"];

// GS-07: the native-fallback ogg path drops audio, not just pads it -------
//
// Decision 54 (and the "known, non-blocking issue" section of
// docs/GAMESOUNDS.md) documented the native vorbis encoder's dev-machine-only
// end-of-stream behavior as harmless PADDING: a decoded ogg comes back
// extended with trailing silence out to the next 1024-sample block boundary,
// which a SUM-based energy check (`energyPerChannel`, above) cannot see,
// since silence contributes exactly 0. That was incomplete. Measured
// directly on this machine (ffmpeg 8.0.1, no libvorbis - `hasLibvorbis`
// above returns false) with an 880 Hz, 0.4-linear-amplitude mono tone,
// encoded with exactly `vorbisEncoderArgs("native")` plus BITEXACT_ARGS and
// decoded back:
//   - input lengths whose `n mod 1024` falls in roughly [962, 1023], and
//     any length with residue exactly 0, decode SHORT by the entire final
//     1024-sample block: n=3071 (residue 1023) decodes to 2048 (1023
//     samples of real, non-silent audio gone, not padded), n=5119 to 4096,
//     n=20479 to 19456, n=4096 (residue 0) to 3072, n=2048 (residue 0) to
//     1024.
//   - n=1023 and n=1024 decode to ZERO samples: the whole sound is gone.
//   - every other residue tested (1, 152, 352, 452, 512, 552, 652, 752, 852,
//     904, 952) decodes to `ceil(n/1024)*1024` with no loss - the padding
//     decision 54 already documented, still real and still harmless.
//   - a step-2 scan at base 4096 places the threshold between residue 960
//     (does not truncate) and residue 962 (does); 961 itself was not
//     directly tested.
// Decoding all 1080 shipped live oggs on `main` (commit 3b40c16) found 56 of
// them (5.2%) actually inside the truncating band, mean 999 samples lost
// (~22.7ms at 44.1kHz), max 1023 - invisible to `checkFormatEnergies`
// because the lost tail was, in every one of the 56 cases, a quiet decay
// (near-zero energy) - see docs/DECISIONS.md's dated amendment to decision
// 54 for the full accounting.
//
// The exact ROOT CAUSE inside ffmpeg's native encoder is NOT identified
// here, deliberately: this is an empirically measured threshold on one
// ffmpeg/libavcodec build (8.0.1), not a documented behavior of
// `libavcodec/vorbisenc.c` read and cited - a different ffmpeg version could
// move this threshold, narrow it, or widen it. The fix below does not
// depend on knowing the cause.
//
// The fix: encode as today; if the decoded ogg comes back shorter than the
// source, re-encode from a COPY of the source padded with trailing zero
// samples out to a length whose own residue sits deep inside the measured
// safe band - `ceil(sourceFrames/1024)*1024 + OGG_TAIL_RETRY_PAD_EXTRA`
// always lands on residue 512, comfortably inside the 1..960 safe range
// above - then decode and check again, throwing if even the retry still
// comes back short. Trailing zeros add no energy (the same sum-invariance
// decision 54 already relied on) and the native-fallback ogg is already
// padded to a block boundary regardless of this fix, so nothing audible
// changes for a sound that goes through the retry; only WHICH block
// boundary the encoder lands on changes, from one measured to drop content
// to one measured not to.
//
// This is encode-verify-retry, not a blanket pre-pad: a variant whose first
// encode already decodes whole (1024 of the 1080 live oggs) never triggers
// the retry branch at all, so its ogg bytes and hash are byte-for-byte
// identical to before this fix - zero churn on every ogg that was never
// broken. The libvorbis path is untouched: it never calls this retry logic,
// since `isNativeFallbackOgg` below is only true on the native-encoder
// branch.
const OGG_TAIL_RETRY_PAD_EXTRA = 512;

function isNativeFallbackOgg(oggEncoder) {
  return resolveOggEncoder(oggEncoder) === "native";
}

/** A copy of `render` (see `RenderResult`, this module's own shape) with
 * trailing zero-valued samples appended on every channel out to
 * `targetFrames`. Used only by `encodeVariant`'s native-fallback ogg retry,
 * above - never touches the wav/mp3 that ship, only a re-encode attempt. */
function padRenderTrailingZeros(render, targetFrames) {
  const pad = (samples) => {
    if (!samples) return null;
    const out = new Float32Array(targetFrames);
    out.set(samples);
    return out;
  };
  return { sampleRate: render.sampleRate, left: pad(render.left), right: pad(render.right) };
}

/**
 * Encodes a leveled render to ogg, mp3 and wav under `outDir`. Each format
 * is named by its OWN bytes' SHA-256, not borrowed from a sibling format:
 * an ogg and an mp3 encoded from the same wav compress to different bytes,
 * so a shared filename hash would only ever be provably correct for the
 * wav itself - the bug that motivated this (see docs/DECISIONS.md). Every
 * ffmpeg output is written to a temp name first, hashed from the bytes
 * actually on disk, then renamed to its own content-addressed name - the
 * hash this function returns is always the hash of the exact bytes that
 * ship, never assumed from the encoder's own exit code.
 *
 * Returns the content-addressed file record per format (`{sha256, bytes,
 * name}`) plus the wav's own hash again as `sha256` - the variant's
 * identity, since the wav IS the canonical render every format was encoded
 * from - and the measured loudness of the shipped wav.
 *
 * Channel layout is NOT uniform across a catalogue built on different
 * machines: the wav and mp3 always carry the render's own channel count
 * (mono for every Phase 1 + GS-03 preset, since none pans away from center -
 * see sfx-engine's `panToStereo`). The ogg does too, IF the build machine's
 * ffmpeg has libvorbis (true in CI - Ubuntu's apt package ships it). On a
 * machine without libvorbis (this repo's own dev Homebrew ffmpeg, confirmed
 * missing it), the ogg is upmixed to dual-mono stereo instead, because
 * ffmpeg's native vorbis encoder refuses mono input - see
 * `vorbisEncoderArgs`'s own header for that upmix and why it must use an
 * explicit unity-gain pan filter, not `-ac 2`, to avoid a ~3 dB loudness
 * loss. Both layouts are correct, matched-loudness audio; a build only
 * needs to know which one it is producing, never assume "mono throughout."
 *
 * `oggEncoder` (`"auto" | "native" | "libvorbis"`, default `"auto"`) is
 * forwarded to `vorbisEncoderArgs` - see that function's own header. It also
 * decides whether the native-fallback tail-drop retry above can run at all:
 * only when the resolved encoder is `"native"`.
 */
export function encodeVariant(render, outDir, { mkdirSync, oggEncoder = "auto" } = {}) {
  const wavBytes = toWavBytes(render);
  const wavHash = sha256Hex(wavBytes);
  if (mkdirSync) mkdirSync(outDir, { recursive: true });
  const wavName = `${wavHash}.wav`;
  const wavPath = join(outDir, wavName);
  writeFileSync(wavPath, wavBytes);

  const sourceFrames = render.left.length;
  const oggArgs = vorbisEncoderArgs(oggEncoder);

  let tmpOggPath = join(outDir, `.tmp-${wavHash}.ogg`);
  run("ffmpeg", ["-y", "-v", "error", "-i", wavPath, ...oggArgs, ...BITEXACT_ARGS, tmpOggPath]);
  // Decoded once here (rather than after the rename below) so the exact same
  // decode can both drive the tail-drop retry decision AND be reused as
  // `decodedOgg` further down - the file's bytes do not change when it is
  // later renamed to its content-addressed name, so decoding it twice would
  // only cost an extra ffmpeg process, never change the result.
  let decodedOgg = decodeToRender(tmpOggPath);

  if (isNativeFallbackOgg(oggEncoder) && decodedOgg.left.length < sourceFrames) {
    const targetFrames = Math.ceil(sourceFrames / 1024) * 1024 + OGG_TAIL_RETRY_PAD_EXTRA;
    const paddedWavPath = join(outDir, `.tmp-${wavHash}-padded.wav`);
    const retryOggPath = join(outDir, `.tmp-${wavHash}-retry.ogg`);
    writeFileSync(paddedWavPath, toWavBytes(padRenderTrailingZeros(render, targetFrames)));
    try {
      run("ffmpeg", ["-y", "-v", "error", "-i", paddedWavPath, ...oggArgs, ...BITEXACT_ARGS, retryOggPath]);
      const retryDecoded = decodeToRender(retryOggPath);
      if (retryDecoded.left.length < sourceFrames) {
        throw new Error(
          `encodeVariant: native-fallback ogg still decoded short after the tail-drop retry - source ${sourceFrames} frame(s), ` +
            `padded to ${targetFrames} frame(s) (residue ${targetFrames % 1024}), retry decoded ${retryDecoded.left.length} frame(s). ` +
            `The empirically measured safe-residue assumption (see the comment above OGG_TAIL_RETRY_PAD_EXTRA in scripts/lib/audio.mjs) ` +
            `did not hold for this input.`,
        );
      }
      rmSync(tmpOggPath, { force: true });
      tmpOggPath = retryOggPath;
      decodedOgg = retryDecoded;
    } finally {
      rmSync(paddedWavPath, { force: true });
    }
  }

  const oggBytes = readFileSync(tmpOggPath);
  const oggHash = sha256Hex(oggBytes);
  const oggName = `${oggHash}.ogg`;
  renameSync(tmpOggPath, join(outDir, oggName));

  const tmpMp3Path = join(outDir, `.tmp-${wavHash}.mp3`);
  run("ffmpeg", ["-y", "-v", "error", "-i", wavPath, "-c:a", "libmp3lame", "-q:a", "3", ...BITEXACT_ARGS, tmpMp3Path]);
  const mp3Bytes = readFileSync(tmpMp3Path);
  const mp3Hash = sha256Hex(mp3Bytes);
  const mp3Name = `${mp3Hash}.mp3`;
  renameSync(tmpMp3Path, join(outDir, mp3Name));

  const measure = measureLoudness(wavPath);

  // Measure each shipped format's OWN per-channel peak, per-channel energy
  // AND decoded frame count, exactly as a browser or the CLI would decode
  // them - never assumed from the encoder's exit code or from the wav's own
  // numbers. `formatEnergy` (total energy per channel - the sum of each
  // sample squared, not a mean; see `energyPerChannel`'s own header for why
  // a mean is the wrong quantity here) is what `checkFormatEnergies`
  // (checks.mjs) gates on for LOUDNESS; `formatFrames` (GS-07) is what
  // `checkFormatLengths` (checks.mjs) gates on for LENGTH - a systematic
  // loudness bug (the old fallback ogg path's `-ac 2` upmix) and the
  // native-fallback tail-drop this section's own retry exists to fix are two
  // different failure modes, caught by two different measurements, because
  // a dropped quiet decay tail can pass an energy gate outright while still
  // being real, audible content lost. `formatPeaks` is kept too, purely as
  // informational data for the build log (see `peakPerChannel`'s own header
  // for why it is not a gate).
  const sourcePeaks = peakPerChannel(render.left, render.right);
  const sourceEnergy = energyPerChannel(render.left, render.right);
  const decodedMp3 = decodeToRender(join(outDir, mp3Name));
  const formatPeaks = {
    source: sourcePeaks,
    ogg: peakPerChannel(decodedOgg.left, decodedOgg.right),
    mp3: peakPerChannel(decodedMp3.left, decodedMp3.right),
  };
  const formatEnergy = {
    source: sourceEnergy,
    ogg: energyPerChannel(decodedOgg.left, decodedOgg.right),
    mp3: energyPerChannel(decodedMp3.left, decodedMp3.right),
  };
  const formatFrames = {
    source: sourceFrames,
    ogg: decodedOgg.left.length,
    mp3: decodedMp3.left.length,
  };

  return {
    sha256: wavHash,
    files: {
      wav: { sha256: wavHash, bytes: wavBytes.length, name: wavName },
      ogg: { sha256: oggHash, bytes: oggBytes.length, name: oggName },
      mp3: { sha256: mp3Hash, bytes: mp3Bytes.length, name: mp3Name },
    },
    duration: render.seconds,
    measure,
    formatPeaks,
    formatEnergy,
    formatFrames,
  };
}

export { peakOf, peakPerChannel, energyPerChannel, toWavBytes };
