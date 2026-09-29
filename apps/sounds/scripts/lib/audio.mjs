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
 * review before it ever shipped: at the time, this repo's dev-machine ffmpeg
 * had no libvorbis, so its native vorbis encoder was used (see
 * docs/DECISIONS.md, decision 54 - that machine-dependent encoder choice is
 * gone since GS-06/GS-07, below), which does not trim the ogg's own end
 * granule - the
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

// Neither shipped lossy format goes through ffmpeg's own encoder any more
// (ogg: GS-06/GS-07, `sox -R`, below; mp3: GS-08, the real `lame` CLI, in
// encodeVariant) - both are deterministic on their own terms, verified the
// same way (two encodes of the same input, byte-identical sha256; see
// test/audio.test.mjs). This used to need an explicit `-fflags +bitexact
// -flags:a +bitexact` on every ffmpeg encode call: without it, ffmpeg's
// mp3/ogg muxers embedded a build-machine-dependent encoder/version tag on
// every encode, so byte-identical audio re-encoded on a later run (or a
// fresh checkout) hashed differently even though nothing about the sound
// changed - exactly what scripts/check-determinism.mjs exists to catch.
// Verified experimentally at the time: a test tone encoded twice with plain
// ffmpeg args (no bitexact) produced same-size, different-sha256 files; with
// the bitexact flags added as OUTPUT options (after `-i`, before the output
// path - the placement mattered, the same flags placed as INPUT/demuxer
// options before `-i` did not fix it), repeated encodes of the same input
// produced byte-identical output. That fixture is kept as a standalone
// regression record in test/audio.test.mjs (it calls ffmpeg's old args
// directly, not through encodeVariant, which has no ffmpeg-encoder path left
// to call at all) even though the constant itself (`BITEXACT_ARGS`) is gone
// from production code along with the last ffmpeg encode call it guarded.

// GS-06/GS-07: ogg encoding switched to libvorbis via sox, everywhere, plus
// a fixed tail guard so no decoder's own end-trim ever eats real content ---
//
// Decision 54 (and the GS-07 v1 amendment that briefly replaced it) blamed
// this repo's own ogg ENCODER for dropped/truncated audio: first as harmless
// end-of-block padding, then - wrongly - as the native "experimental" vorbis
// encoder outright dropping a final 1024-sample block on certain input
// lengths. Neither was the real story. Reviewer measurement (granule
// positions read directly off the ogg stream, and a decode through the
// reference libvorbis decoder via `sox`/libvorbisfile) proved the encoder,
// native OR libvorbis, was never at fault: a native-encoder ogg's own final
// granule position is always >= the source frame count (n=1023 -> granule
// 1024, 3071 -> 3072, 4096 -> 4096, 10035 -> 10048), and the reference
// decoder plays every one of those files whole. What actually cuts audio is
// DECODERS - plural, and not the same amount:
//
//   - ffmpeg's own CLI decoder (what `decodeToRender` below uses, and so
//     what CI's `checkFormatLengths` gate was reading) drops up to 128
//     frames off the END of ANY ogg, libvorbis-encoded ones included - not
//     just the old native-encoder path. Measured on the real
//     movement-jump-8bit-2a03 v1 wav (10035 frames): a `sox -R ... -C 5`
//     libvorbis ogg of it decodes to 9907 frames in the ffmpeg CLI, 128
//     short. The first 9907 samples match the reference decoder to within
//     1.5e-5; the missing tail peaks at 0.00024 - real content, just quiet.
//     This is why the GS-07 v1 fix (a retry that only ran on the native
//     path) could never pass CI: CI's ffmpeg has libvorbis, so it never took
//     that branch, and libvorbis oggs get cut by this same CLI decoder too -
//     333 of 1080 live variants failed CI's length gate this way, every one
//     exactly 128 frames short.
//   - Real browsers (Playwright 1.62.1, `decodeAudioData` into an
//     `OfflineAudioContext`, "last sample whose short RMS-adjacent value
//     exceeds 1e-3" as the content-loss threshold - see
//     scripts/check-browser-decode.mjs) are worse, and disagree with the
//     ffmpeg CLI: across all 1080 live catalogue oggs on `main` (commit
//     3b40c16, native-encoder-produced), Chromium 151 fails to decode 5 of
//     them at all, decodes 1013 shorter than the wav, and loses audible
//     content on 747 relative to what Firefox plays (mean 465 samples lost,
//     max 1024, about 23ms at 44.1kHz) - while Firefox 153 decodes all 1080
//     whole. The same 1010 unique wavs re-encoded with `sox -R in.wav -C 5
//     out.ogg` (libvorbis, mono) fare much better in Chromium - 0 decode
//     errors, 686 shorter than the wav but by at most 128 frames (matching
//     the ffmpeg-CLI figure above) - but not perfectly: the last audible
//     sample matches Firefox exactly on 917 of 1080, and on the other 163 it
//     sits up to 179 frames earlier (partly the 128-frame buffer trim,
//     partly each decoder's own different rounding of an already-near-zero
//     fade tail). Firefox again decodes all 1080 whole. The ffmpeg CLI's own
//     decoded length matches Chromium's on only 1004 of 1080 - it is NOT a
//     faithful proxy for what a browser does, which is why
//     scripts/check-browser-decode.mjs exists as its own, separate gate
//     (real browsers, not a CLI decode) rather than trusting a wider
//     `checkFormatLengths` tolerance.
//   - mp3 has no equivalent content-loss problem: Chromium is gapless-exact
//     (1042 of 1080 live mp3s decode to exactly the wav's own frame count,
//     the other 38 longer by 4 to 46 samples, none shorter). Firefox decodes
//     every mp3 whole too, but does not fully trim the LAME encoder's own
//     priming delay, so its decode is shifted later by a median of 578
//     samples relative to Chromium's decode of the same file (about 13.1ms
//     at 44.1kHz, close to one mp3 granule of 576 samples; minimum 531).
//     That figure is the actual leading delay (last-audible-sample
//     difference between the two engines' decodes of the same bytes, which
//     cancels out the encoder's own pre-echo since both engines decode the
//     identical bitstream). The 623-to-1774-sample range (mean ~1172) some
//     earlier notes here called "latency" is a DIFFERENT quantity - decoded
//     length minus the wav's own frame count - which is the leading delay
//     PLUS whatever trailing padding Firefox also leaves untrimmed; it was
//     mislabeled as latency in GS-07 v2 and corrected in GS-07 v2.1. Either
//     way this is a real, separate defect (leading silence, not lost
//     content) - see docs/BACKLOG.md's GS-08. `check-browser-decode.mjs`
//     reports both numbers as information, never fails on them.
//
// The catalogue has no loop sounds (docs/BACKLOG.md), so trailing silence -
// from padding, from a guard, from either decoder's own trim eating into
// it - is never audible as a seam.
//
// The fix has two parts:
//   1. Stop using ffmpeg's own vorbis encoders (native OR libvorbis)
//      entirely - encode every ogg with `sox -R <wav> -C 5 <ogg>` on every
//      machine (`-R`: deterministic pseudo-random state, proven
//      byte-repeatable across two encodes of the same input; `-C 5`: sox's
//      own documented quality knob for a lossy format, fed straight to
//      libvorbis's own quality API exactly as ffmpeg's `-q:a 5` is - same
//      encoder, same scale, same target quality, different front end). This
//      is the one tool this build ships with AND the one CI exercises, so
//      there is no dev-machine-only code path left to diverge (GS-06). Sox
//      keeps the source's own channel count, so the ogg is mono like the
//      wav and mp3 now - the old native-fallback path's dual-mono stereo
//      upmix (and its own unity-gain pan filter, `encodeVariant`'s former
//      header) no longer exists on any machine.
//   2. Since even a complete, correctly-encoded libvorbis ogg still gets its
//      last ~128 frames trimmed by ffmpeg's CLI decoder and by Chromium,
//      append `OGG_TAIL_GUARD_FRAMES` zero samples to the ogg encoder's
//      INPUT only (never the wav or mp3 that ship) before every encode, so
//      that trim always eats manufactured silence, never the real signal.
//      `checkFormatLengths` keeps comparing against the true, unpadded
//      source frame count - only the ogg's own encoder input changes.
const OGG_TAIL_GUARD_FRAMES = 256;

// sox and its vorbis format handler are a hard requirement now - there is no
// silent fallback left to slip to. `ensureSoxVorbis` is called once per
// process (cached) before the first ogg encode and throws a specific,
// actionable error naming what to install if either piece is missing, so a
// misconfigured machine fails the build loudly instead of silently shipping
// (or silently skipping) ogg files.
let soxVorbisChecked = false;
function ensureSoxVorbis() {
  if (soxVorbisChecked) return;
  const result = spawnSync("sox", ["--help-format", "vorbis"], { maxBuffer: 1024 * 1024 });
  if (result.error) {
    throw new Error(
      "encodeVariant: `sox` is not installed or not on PATH. Every ogg this catalogue ships is encoded with sox's " +
        "libvorbis handler (GS-06/GS-07, scripts/lib/audio.mjs) - install it: `brew install sox` on macOS, or on " +
        "Ubuntu/Debian CI runners `sudo apt-get install -y sox libsox-fmt-base` (use `libsox-fmt-all` if that package " +
        "does not include vorbis on the runner's release).",
    );
  }
  const out = `${(result.stdout ?? "").toString()}${(result.stderr ?? "").toString()}`;
  if (!/^Format:\s*vorbis/m.test(out)) {
    throw new Error(
      "encodeVariant: `sox` is installed but its vorbis format handler is missing (`sox --help-format vorbis` did not " +
        "report it). Install the format-handler package: `sudo apt-get install -y libsox-fmt-base` (or " +
        "`libsox-fmt-all`) on Ubuntu/Debian, or reinstall `sox` from a build with Vorbis support on macOS (Homebrew's " +
        "`sox` bottle includes it by default).",
    );
  }
  soxVorbisChecked = true;
}

// GS-08: mp3 is encoded with the real `lame` CLI, not ffmpeg's own
// libmp3lame wrapper, for the same reason GS-06/GS-07 stopped using ffmpeg's
// vorbis encoders - see the mp3 half of encodeVariant's own header comment,
// below, for the measured cause and fix. `ensureLameCli` mirrors
// `ensureSoxVorbis`: called once per process (cached), throws a specific,
// actionable error if `lame` is missing, so a misconfigured machine fails
// the build loudly instead of silently shipping an mp3 with no real gapless
// tag.
let lameCliChecked = false;
function ensureLameCli() {
  if (lameCliChecked) return;
  const result = spawnSync("lame", ["--version"], { maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(
      "encodeVariant: `lame` is not installed or not on PATH. Every mp3 this catalogue ships is encoded with the real " +
        "LAME CLI, not ffmpeg's own libmp3lame wrapper (GS-08, scripts/lib/audio.mjs) - install it: `brew install lame` " +
        "on macOS, or on Ubuntu/Debian CI runners `sudo apt-get install -y lame`.",
    );
  }
  lameCliChecked = true;
}

/** A copy of `render` (see `RenderResult`, this module's own shape) with
 * trailing zero-valued samples appended on every channel out to
 * `targetFrames`. Used by `encodeVariant`'s tail guard (`OGG_TAIL_GUARD_FRAMES`,
 * above) - only ever builds the ogg encoder's own input, never touches the
 * wav/mp3 that ship. */
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
 * encoder output is written to a temp name first, hashed from the bytes
 * actually on disk, then renamed to its own content-addressed name - the
 * hash this function returns is always the hash of the exact bytes that
 * ship, never assumed from the encoder's own exit code.
 *
 * Returns the content-addressed file record per format (`{sha256, bytes,
 * name}`) plus the wav's own hash again as `sha256` - the variant's
 * identity, since the wav IS the canonical render every format was encoded
 * from - and the measured loudness of the shipped wav.
 *
 * Channel layout IS uniform across every machine now (GS-06): the wav, ogg
 * and mp3 all carry the render's own channel count - mono for every Phase 1
 * + GS-03 preset, since none pans away from center (see sfx-engine's
 * `panToStereo`). Before this fix, a machine whose ffmpeg lacked libvorbis
 * upmixed the ogg to dual-mono stereo instead (this repo's own dev Homebrew
 * ffmpeg was exactly such a machine) - see docs/DECISIONS.md, decision 54,
 * for that now-retired mechanism. `sox` keeps the source's own channel
 * count unconditionally, so there is no longer a machine-dependent layout to
 * know about. The real `lame` CLI (GS-08, below) auto-detects the wav's own
 * channel count the same way and never upmixes either.
 *
 * mp3 is encoded with the real `lame` CLI, not ffmpeg's own libmp3lame
 * wrapper (GS-08). Cause, measured directly: ffmpeg's mp3 muxer writes a
 * Xing/Info header (frame count, byte count, TOC, quality - `write_xing`,
 * on by default) but never populates the LAME-specific info-tag extension
 * that follows it (replaygain, encoder delay, encoder padding, etc.) with
 * real values - it fills those exact bytes with a fixed `0xAA` placeholder
 * instead, on every ffmpeg version/build tried, bitexact flags or not
 * (confirmed by hex-dumping the tag: bytes 9 through 24 after the
 * "LAME3.100" version string, which is where the encoder-delay/padding
 * field lives, read back as `0xAA` repeated - an internally implausible
 * "delay 2730, padding 2730" that no real encoder would produce). Chromium
 * does not appear to trust that tag either way (it is exact regardless), but
 * Firefox does: fed a tag with no real delay/padding info, it does not trim
 * LAME's own fixed 576-sample encoder priming delay at all - exactly GS-08's
 * measured +576-sample lag. The real `lame` CLI writes this tag correctly
 * (verified the same way: delay 576, padding computed from the real output
 * length, both plausible and correct) because it is the reference
 * implementation's own writer, not a muxer that never populates it.
 *
 * Fix, tested empirically (real Chromium AND Firefox, Playwright,
 * `decodeAudioData`, the same cross-correlation lag search
 * check-browser-decode.mjs itself uses): re-encoding a 60-variant sample
 * spanning every category/style family in the catalogue with `lame -V 3`
 * (the same VBR-quality scale as ffmpeg's `-q:a 3` - libmp3lame interprets
 * both identically) landed Firefox at lag 0 on 60/60 (previously +576 on
 * 60/60, matching GS-07/GS-08's own full-catalogue measurement exactly) and
 * left Chromium untouched at lag 0 on 60/60 (identical minimum correlation
 * before and after, 0.9534...), with zero mp3 length excess in Firefox
 * (previously 626 to 1718 samples over the wav's own frame count - the
 * leading delay plus Firefox's own untrimmed trailing pad, both gone).
 * Decoded audio content is unaffected: ffmpeg's own CLI decode of a
 * `lame`-CLI mp3 and of an ffmpeg-encoded mp3 of the same input wav is
 * sample-for-sample identical (max abs diff 0.0 on a synthetic 880Hz tone;
 * true peak measured by ffmpeg's own `ebur128` matched to 0.1dB on a real
 * catalogue wav) - this changes only which tool writes the mp3 container and
 * its own gapless tag, never the audio itself. `lame` is deterministic
 * across repeated encodes of the same input (verified the same way GS-06
 * verified sox: byte-identical sha256 across two runs, both on a synthetic
 * tone and on a real catalogue wav), so no bitexact-style flag is needed -
 * `lame` never embeds a machine- or run-dependent value in the first place.
 * See docs/DECISIONS.md, decision 60, for the full measurement.
 */
export function encodeVariant(render, outDir, { mkdirSync } = {}) {
  ensureSoxVorbis();
  ensureLameCli();
  const wavBytes = toWavBytes(render);
  const wavHash = sha256Hex(wavBytes);
  if (mkdirSync) mkdirSync(outDir, { recursive: true });
  const wavName = `${wavHash}.wav`;
  const wavPath = join(outDir, wavName);
  writeFileSync(wavPath, wavBytes);

  const sourceFrames = render.left.length;

  // GS-07: OGG_TAIL_GUARD_FRAMES of trailing silence, appended to the ogg
  // encoder's INPUT only (see that constant's own header above) - never to
  // the wav or mp3 that ship - so a decoder's own end-trim (ffmpeg's CLI
  // decoder, Chromium, both proven to cut up to ~128 frames even off a
  // complete libvorbis file) eats manufactured silence, not real content.
  const guardedWavPath = join(outDir, `.tmp-${wavHash}-guard.wav`);
  writeFileSync(guardedWavPath, toWavBytes(padRenderTrailingZeros(render, sourceFrames + OGG_TAIL_GUARD_FRAMES)));
  const tmpOggPath = join(outDir, `.tmp-${wavHash}.ogg`);
  try {
    run("sox", ["-R", guardedWavPath, "-C", "5", tmpOggPath]);
  } finally {
    rmSync(guardedWavPath, { force: true });
  }
  const decodedOgg = decodeToRender(tmpOggPath);
  if (decodedOgg.left.length < sourceFrames) {
    throw new Error(
      `encodeVariant: sox-encoded ogg decoded short even with the ${OGG_TAIL_GUARD_FRAMES}-frame tail guard - source ` +
        `${sourceFrames} frame(s), guarded input ${sourceFrames + OGG_TAIL_GUARD_FRAMES} frame(s), ffmpeg CLI decoded ` +
        `${decodedOgg.left.length} frame(s). The measured worst-case end-trim (see OGG_TAIL_GUARD_FRAMES's own header in ` +
        `scripts/lib/audio.mjs) did not hold for this input - widen the guard.`,
    );
  }

  const oggBytes = readFileSync(tmpOggPath);
  const oggHash = sha256Hex(oggBytes);
  const oggName = `${oggHash}.ogg`;
  renameSync(tmpOggPath, join(outDir, oggName));

  const tmpMp3Path = join(outDir, `.tmp-${wavHash}.mp3`);
  // GS-08: the real `lame` CLI, not ffmpeg's own libmp3lame wrapper - see
  // this function's own header comment for the measured cause (ffmpeg's mp3
  // muxer never populates the LAME info tag's encoder delay/padding fields
  // with real values) and the empirical fix this replaces it with.
  // `-V 3` is the same VBR-quality scale as ffmpeg's `-q:a 3` (libmp3lame
  // interprets both identically); `--silent` only suppresses lame's own
  // progress/ReplayGain console output, it does not change the encoded bytes.
  run("lame", ["--silent", "-V", "3", wavPath, tmpMp3Path]);
  const mp3Bytes = readFileSync(tmpMp3Path);
  const mp3Hash = sha256Hex(mp3Bytes);
  const mp3Name = `${mp3Hash}.mp3`;
  renameSync(tmpMp3Path, join(outDir, mp3Name));

  const measure = measureLoudness(wavPath);

  // Measure each shipped format's OWN per-channel peak, per-channel energy
  // AND decoded frame count from ffmpeg's own CLI decode - never assumed
  // from the encoder's exit code or from the wav's own numbers, but also NOT
  // a faithful stand-in for a real browser's own decode (see
  // OGG_TAIL_GUARD_FRAMES's own header above: the ffmpeg CLI and Chromium
  // agree on decoded length for only 1004 of 1080 live oggs) - that gap is
  // exactly why scripts/check-browser-decode.mjs exists as its own,
  // independent gate on real Chromium/Firefox decodes, rather than trusting
  // this measurement, or a wider `checkFormatLengths` tolerance, to stand in
  // for it. `formatEnergy` (total energy per channel - the sum of each
  // sample squared, not a mean; see `energyPerChannel`'s own header for why
  // a mean is the wrong quantity here) is what `checkFormatEnergies`
  // (checks.mjs) gates on for LOUDNESS; `formatFrames` (GS-07) is what
  // `checkFormatLengths` (checks.mjs) gates on for LENGTH against this same
  // ffmpeg CLI decode - a systematic loudness bug (the old fallback ogg
  // path's `-ac 2` upmix, decision 54) and a decoder trimming real, quiet
  // content off the end (this section's own `OGG_TAIL_GUARD_FRAMES` guard)
  // are two different failure modes, caught by two different measurements,
  // because a trimmed quiet decay tail can pass an energy gate outright
  // while still being real, audible content lost. `formatPeaks` is kept too,
  // purely as informational data for the build log (see `peakPerChannel`'s
  // own header for why it is not a gate).
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

export { peakOf, peakPerChannel, energyPerChannel, toWavBytes, OGG_TAIL_GUARD_FRAMES };
