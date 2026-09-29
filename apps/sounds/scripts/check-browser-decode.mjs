#!/usr/bin/env node
// GS-07: verifies every catalogue ogg and mp3 decodes WHOLE in a real
// browser via Web Audio's own `decodeAudioData` - the ground truth this
// catalogue actually ships to, which ffmpeg's own CLI decoder (what
// scripts/lib/checks.mjs's checkFormatLengths reads) is proven NOT to be a
// faithful proxy for: on the 1080 live catalogue oggs, the ffmpeg CLI's
// decoded length matched Chromium's on only 1004 of them (see
// scripts/lib/audio.mjs, OGG_TAIL_GUARD_FRAMES's own header, for the full
// measured story). This script is that missing, independent gate.
//
// Usage:
//   node scripts/check-browser-decode.mjs [--catalog <path>] [--files <dir>]
//     Defaults: generated/catalog.json, public/f (this app's own shipped
//     catalogue and content-addressed files).
//   pnpm sounds:check-decode        the same, from the repo root, against
//     the locally built/shipped catalogue - run this before pushing.
//
// What it checks, per shipped ogg AND mp3, in both Chromium and Firefox:
//   1. No decode error.
//   2. Decoded length >= the wav's own frame count (never shorter than the
//      source; longer is fine and expected).
//   3. Ogg only: content agreement - the browser's own decode of the file is
//      compared, sample by sample over [0, sourceFrames), against sox's OWN
//      reference decode (libvorbisfile) of those exact same bytes; a
//      disagreement past DECODER_AGREEMENT_TOLERANCE (scripts/lib/decode-
//      judge.mjs) fails the build. GS-07 v2.1: an earlier version of this
//      gate compared the browser's decode against the SOURCE WAV instead,
//      which conflated the codec's own lossy quantization of an
//      already-quiet decaying tail with an actual decoder cut - it flagged
//      96 of 1080 oggs on the rebuilt catalogue, but every one of those 96
//      showed the identical gap in BOTH Chromium and Firefox (which is
//      independently proven to decode all 1080 whole), meaning the two
//      decoders AGREED with each other and disagreed only with a wav the
//      lossy codec had already legitimately requantized - not a decoder
//      cut. The wav-based rule was deleted along with
//      CONTENT_LOSS_MARGIN_FRAMES and REAL_CONTENT_THRESHOLD; see
//      decode-judge.mjs's own header and [Decision 54](../../docs/DECISIONS.md)'s
//      GS-07 v2.1 amendment for the full measurement.
//      Not checked for mp3: mp3's leading-delay defect (point 4, below) is
//      a different rule with its own tolerance, not this ogg content
//      agreement check.
//   4. Mp3 only: the leading delay between the wav and the decoded mp3, per
//      engine, found by a cross-correlation lag search
//      (scripts/lib/decode-judge.mjs's `crossCorrelationLag`, GS-07 v2.2).
//      GS-08 (below): this used to be informational only. As of GS-08's mp3
//      encoding fix (the real `lame` CLI, which writes a correct LAME/Xing
//      gapless tag - encoder delay and padding - instead of ffmpeg's own mp3
//      muxer, which never populated those exact tag fields with real values)
//      this is now a GATE: lag must be exactly 0 in both engines. Before the
//      fix, measured against the full 1080-variant catalogue with the
//      cross-correlation search: Chromium sat at lag 0 on all 1080, Firefox
//      sat at lag +576 on all 1080 (one mp3 granule, 13.06ms at 44.1kHz,
//      also LAME's own fixed encoder delay - see crossCorrelationLag's own
//      header for the fifth-of-the-catalogue measurement, 155 of 1080,
//      minimum correlation 0.89 both engines, that full-catalogue run
//      confirmed, minimum correlation 0.888 in both engines across all
//      1080). After the fix, the same full-catalogue run lands Firefox at
//      lag 0 too (see docs/DECISIONS.md, decision 60, for the exact numbers
//      this gate's own threshold was set from).
//
// Measured max |browser - reference| after this fix, across every ogg in
// the rebuilt catalogue (1080 files, both engines; see this script's own
// `pnpm sounds:check-decode` output for the exact run this was taken from):
// chromium 1.54e-5, firefox 1.54e-5 - both comfortably (about 65x) below
// DECODER_AGREEMENT_TOLERANCE (1e-3), which was fixed BEFORE this
// measurement was taken (decode-judge.mjs's own header). Sample alignment
// was checked directly: index 0 lines up with index 0 in both engines (no
// resampling at 44.1kHz, no lag to search for) - every real catalogue file
// agreed from index 0, and the only disagreements ever observed were the
// negative fixtures built specifically to disagree.
//
// Before checking anything real, this script builds and checks THREE
// negative fixtures, each proving one rule fires on its own (not "any
// failure"), in both engines:
//   a. Length: an ogg whose content truly ends 1024 frames short of what it
//      claims to be. Must fail the LENGTH rule specifically.
//   b. Content (full amplitude): an ogg encoded from an 8192-frame 0.4 tone
//      with its last 1024 frames zeroed (same length, same
//      OGG_TAIL_GUARD_FRAMES guard as production), compared against the sox
//      reference decode of the UNZEROED tone's own encode. Must fail the
//      AGREEMENT rule specifically (and pass the length rule - the zeroing
//      does not shorten anything).
//   c. Content (quiet, 2e-3 / -54 dBFS): the same construction as (b) at a
//      much quieter tone level, proving there is no hidden level floor above
//      the stated tolerance.
// This script refuses to run the real catalogue at all unless all three
// fail, with their specific rule, in every engine - a checker that cannot
// catch a deliberately broken file is not trustworthy to pass anything else.
// scripts/lib/decode-judge.mjs's own tests prove the pure compare/judge
// functions on synthetic arrays with no browser at all; these fixtures prove
// the same logic end to end through a real browser decode.
//
// Playwright hygiene (this repo's own global rule, restated here because
// this is the one script under apps/sounds that launches a real browser):
// ONE browser per engine, ONE page, reused for every file; each browser
// closed in a `finally` no matter how the run ends; never `waitUntil:
// 'networkidle'` (nothing here navigates a real page - decodeAudioData
// needs no navigation, `page.setContent` with `'load'` is enough); a hard,
// unref'd process-level timeout force-kills the run if it ever hangs, so a
// stuck decode can never leave an orphaned chrome-headless-shell/firefox
// process spinning on this machine.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox } from "playwright";
import { toWavBytes, OGG_TAIL_GUARD_FRAMES } from "./lib/audio.mjs";
import { DECODER_AGREEMENT_TOLERANCE, judge, crossCorrelationLag } from "./lib/decode-judge.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const argv = process.argv.slice(2);
function flagValue(name, fallback) {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : (argv[i + 1] ?? fallback);
}
const catalogPath = flagValue("--catalog", join(root, "generated", "catalog.json"));
const filesDir = flagValue("--files", join(root, "public", "f"));
// Local-only escape hatch for a fast smoke run (not used by CI or
// `pnpm sounds:check-decode`, both of which check every variant): caps how
// many variants are decoded, so a quick manual timing/sanity check does not
// have to wait for all 1080.
const limitFlag = flagValue("--limit", null);
const limit = limitFlag ? parseInt(limitFlag, 10) : null;

// GS-08: mp3's leading-delay lag (crossCorrelationLag against the wav) must
// land exactly here, in every engine, on every live variant, after the mp3
// encoding fix (the real `lame` CLI, scripts/lib/audio.mjs) - see this
// file's own header, point 4, and docs/DECISIONS.md decision 60 for the
// measured before/after numbers this gate replaces an informational report
// with.
const MP3_LAG_TOLERANCE_FRAMES = 0;

function log(...m) { console.log("[check-browser-decode]", ...m); }

// Whole run, both engines, every file, transferring full decoded PCM for
// every ogg (GS-07 v2.1's reference-decode comparison needs the browser's
// actual samples back, not just an index) and every mp3 (GS-07 v2.2's
// cross-correlation lag search needs the same) - measured 65 seconds to
// about 4 minutes for all 1080 variants locally depending on machine load
// (`time node scripts/check-browser-decode.mjs`;
// v2.1 alone, before the lag search's own CPU cost, measured about 38
// seconds - the lag search's `O(lag range x window)` search per mp3 per
// engine is real work, not I/O, and accounts for the difference); generous
// margin kept regardless, for a slower CI runner and for sox's own per-file
// reference-decode subprocess cost on a colder disk cache.
const HARD_TIMEOUT_MS = 30 * 60 * 1000;
const timeoutHandle = setTimeout(() => {
  console.error("[check-browser-decode] hard timeout exceeded - forcing exit so no browser process is left running");
  process.exit(1);
}, HARD_TIMEOUT_MS);
timeoutHandle.unref();

/** Minimal reader for the exact WAV shape scripts/lib/audio.mjs's own
 * `toWavBytes` writes: a canonical 44-byte PCM16 header (mono or stereo)
 * with no extra chunks - true of every wav this catalogue ships, since this
 * build writes every one of them itself. */
function readWavPcm(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const channels = view.getUint16(22, true);
  const dataSize = view.getUint32(40, true);
  const frameCount = Math.floor(dataSize / (channels * 2));
  const chans = Array.from({ length: channels }, () => new Float32Array(frameCount));
  let offset = 44;
  for (let i = 0; i < frameCount; i++) {
    for (let c = 0; c < channels; c++) {
      chans[c][i] = view.getInt16(offset, true) / 32768;
      offset += 2;
    }
  }
  return { frameCount, channels: chans };
}

/** Decodes sox's own reference PCM for a file already on disk (libvorbisfile
 * under the hood for ogg - the same decoder GS-06/GS-07 encodes with, used
 * here purely as a decoder). Raw `f32` from sox is native-endian on every
 * platform this build runs on (macOS dev, Ubuntu CI - both little-endian),
 * matching `Buffer#readFloatLE`. Truncates to `maxFrames` up front (the
 * content-agreement rule only ever needs `[0, sourceFrames)`), so a file
 * with extra guard-tail content past the source length never costs anything
 * beyond that point. */
function soxReferenceDecode(filePath, maxFrames) {
  const raw = execFileSync("sox", [filePath, "-t", "f32", "-"], { maxBuffer: 1024 * 1024 * 64 });
  const available = Math.floor(raw.length / 4);
  const n = maxFrames == null ? available : Math.min(maxFrames, available);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = raw.readFloatLE(i * 4);
  return out;
}

function base64ToFloat32(b64) {
  const buf = Buffer.from(b64, "base64");
  const out = new Float32Array(buf.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = buf.readFloatLE(i * 4);
  return out;
}

/** Decodes one file's bytes in the given page via `decodeAudioData` and
 * returns its FULL decoded length plus its channel data (base64-encoded raw
 * float32, little-endian), truncated to `maxFrames` samples if given (`null`
 * transfers the whole decode). Ogg passes `sourceFrames` - the
 * reference-agreement comparison never looks past that point. Mp3 passes
 * `null` - the cross-correlation lag search (GS-07 v2.2) needs a comfortable
 * margin past the wav's own length to search lags on both sides of 0, and
 * every variant this catalogue ships is at most a few seconds long, so
 * transferring the whole decode costs nothing worth truncating for.
 * `{length: -1, error, channelB64: null}` on a decode error. */
async function decodeChannelInBrowser(page, bytes, maxFrames) {
  const b64 = bytes.toString("base64");
  return page.evaluate(async ({ b64, maxFrames }) => {
    try {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const ctx = new OfflineAudioContext(1, 44100, 44100);
      const buf = await ctx.decodeAudioData(bin.buffer);
      const d = buf.getChannelData(0);
      const n = maxFrames == null ? d.length : Math.min(d.length, maxFrames);
      const bytesOut = new Uint8Array(n * 4);
      const view = new DataView(bytesOut.buffer);
      for (let i = 0; i < n; i++) view.setFloat32(i * 4, d[i], true);
      let binary = "";
      const chunk = 8192;
      for (let i = 0; i < bytesOut.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytesOut.subarray(i, i + chunk));
      }
      return { length: buf.length, error: null, channelB64: btoa(binary) };
    } catch (e) {
      return { length: -1, error: e && e.message ? e.message : String(e), channelB64: null };
    }
  }, { b64, maxFrames });
}

/** Builds a genuinely-truncated ogg: `sourceFrames` of real, unfaded tone
 * content (so any cut is audibly real, not a fade the encoder trims
 * legitimately), encoded from only the first `sourceFrames - 1024` of it -
 * content that really, truly ends 1024 frames early, exactly the failure
 * mode the LENGTH rule exists to catch. No `OGG_TAIL_GUARD_FRAMES` pad: that
 * guard is `encodeVariant`'s own production fix, irrelevant to proving the
 * CHECKER itself can still catch a file with no such guard, or a guard that
 * was not wide enough. No reference channel is built for this fixture - it
 * is meant to fail the length rule ALONE. */
function buildLengthFixture(dir) {
  const sampleRate = 44100;
  const sourceFrames = 8192;
  const cutFrames = sourceFrames - 1024;
  const tone = (n) => {
    const left = new Float32Array(n);
    for (let i = 0; i < n; i++) left[i] = 0.4 * Math.sin((2 * Math.PI * 880 * i) / sampleRate);
    return { sampleRate, left, right: null };
  };
  const cutWavPath = join(dir, "length-cut.wav");
  const oggPath = join(dir, "length.ogg");
  writeFileSync(cutWavPath, toWavBytes(tone(cutFrames)));
  execFileSync("sox", ["-R", cutWavPath, "-C", "5", oggPath]);
  return { oggPath, sourceFrames };
}

/** Builds a content-agreement fixture at the given tone amplitude: an ogg
 * (`testOggPath`) encoded from an 8192-frame tone whose last 1024 frames
 * were zeroed BEFORE encoding (same length, same OGG_TAIL_GUARD_FRAMES guard
 * production uses - the zeroing changes only what the content actually is,
 * never how long it claims to be), plus a reference decode of the UNZEROED
 * tone's own encode (`referenceChannel`) - what the file would have decoded
 * to had nothing been zeroed. Comparing the zeroed file's real browser
 * decode against that reference must disagree exactly where the zeroing is,
 * proving the agreement rule catches a genuine content difference the
 * length rule cannot see (the zeroed file's own decoded length is
 * unaffected - it is still the guard that gets trimmed, not real content). */
function buildContentFixture(dir, amplitude, tag) {
  const sampleRate = 44100;
  const sourceFrames = 8192;
  const zeroFrom = sourceFrames - 1024;
  const toneAt = (n) => {
    const left = new Float32Array(n);
    for (let i = 0; i < n; i++) left[i] = amplitude * Math.sin((2 * Math.PI * 880 * i) / sampleRate);
    return left;
  };
  const fullLeft = toneAt(sourceFrames);
  const zeroedLeft = fullLeft.slice();
  for (let i = zeroFrom; i < sourceFrames; i++) zeroedLeft[i] = 0;

  const guardedWav = (left) => {
    const padded = new Float32Array(sourceFrames + OGG_TAIL_GUARD_FRAMES);
    padded.set(left);
    return toWavBytes({ sampleRate, left: padded, right: null });
  };

  const fullWavPath = join(dir, `${tag}-full.wav`);
  const zeroedWavPath = join(dir, `${tag}-zeroed.wav`);
  const fullOggPath = join(dir, `${tag}-full.ogg`);
  const testOggPath = join(dir, `${tag}-test.ogg`);
  writeFileSync(fullWavPath, guardedWav(fullLeft));
  writeFileSync(zeroedWavPath, guardedWav(zeroedLeft));
  execFileSync("sox", ["-R", fullWavPath, "-C", "5", fullOggPath]);
  execFileSync("sox", ["-R", zeroedWavPath, "-C", "5", testOggPath]);

  const referenceChannel = soxReferenceDecode(fullOggPath, sourceFrames);
  return { testOggPath, referenceChannel, sourceFrames };
}

async function runEngine(name, launcher, work) {
  const browser = await launcher.launch();
  try {
    const page = await browser.newPage();
    await page.setContent("<!doctype html><title>decode</title>", { waitUntil: "load" });
    return await work(page);
  } finally {
    await browser.close();
  }
}

/** Runs one negative fixture in one engine and asserts it fails with its
 * OWN specific rule (never "any failure"). `expect` is "length" or
 * "agreement" - the other rule must NOT be the (only) one that fired, so a
 * fixture built to test one rule can never quietly pass because the other
 * rule happened to catch something unrelated. */
async function runFixtureCheck(page, engineName, label, expect, { oggPath, sourceFrames, referenceChannel }) {
  const bytes = readFileSync(oggPath);
  const decoded = await decodeChannelInBrowser(page, bytes, sourceFrames);
  const browserChannel = decoded.channelB64 ? base64ToFloat32(decoded.channelB64) : null;
  const failures = judge("ogg", sourceFrames, decoded, referenceChannel ? { referenceChannel, browserChannel } : {});
  const hasLength = failures.some((f) => f.includes("short of the source"));
  const hasAgreement = failures.some((f) => f.includes("disagrees with the reference decoder"));
  if (expect === "length") {
    if (!hasLength) {
      throw new Error(`check-browser-decode's own "${label}" negative fixture did NOT fail the LENGTH rule in ${engineName} (failures: ${JSON.stringify(failures)}) - this checker cannot be trusted, refusing to run the catalogue`);
    }
  } else if (expect === "agreement") {
    if (!hasAgreement) {
      throw new Error(`check-browser-decode's own "${label}" negative fixture did NOT fail the AGREEMENT rule in ${engineName} (failures: ${JSON.stringify(failures)}) - this checker cannot be trusted, refusing to run the catalogue`);
    }
    if (hasLength) {
      throw new Error(`check-browser-decode's own "${label}" negative fixture unexpectedly ALSO failed the LENGTH rule in ${engineName} - the fixture's own guard did not do its job, invalidating the proof that the agreement rule catches what the length rule cannot`);
    }
  }
  log(`negative fixture "${label}" in ${engineName}: correctly failed the ${expect} rule only (${failures[0]})`);
}

async function main() {
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));

  // Every (format, sourceFrames, wavChannel, bytes, id) job to decode, built
  // once and reused for both engines. `referenceChannel` (ogg only) is sox's
  // own reference decode of that exact ogg's bytes, and `wavChannel` (mp3
  // only) is the wav's own mono PCM, computed once here rather than per
  // engine.
  const jobs = [];
  const sounds = limit ? catalog.sounds.slice(0, limit) : catalog.sounds;
  for (const sound of sounds) {
    for (const variant of sound.variants) {
      const wavBytes = readFileSync(join(filesDir, variant.files.wav.url.split("/").pop()));
      const { frameCount, channels } = readWavPcm(wavBytes);
      const oggPath = join(filesDir, variant.files.ogg.url.split("/").pop());
      const oggBytes = readFileSync(oggPath);
      const referenceChannel = soxReferenceDecode(oggPath, frameCount);
      jobs.push({ id: `${sound.id} ${variant.n}`, format: "ogg", sourceFrames: frameCount, bytes: oggBytes, referenceChannel });
      const mp3Bytes = readFileSync(join(filesDir, variant.files.mp3.url.split("/").pop()));
      // Every catalogue wav shipped is mono (checked directly: 0 of 1080 wavs
      // have more than one channel) - channels[0] is the whole signal, not
      // just a left channel of something wider.
      jobs.push({ id: `${sound.id} ${variant.n}`, format: "mp3", sourceFrames: frameCount, bytes: mp3Bytes, wavChannel: channels[0] });
    }
  }
  log(`loaded ${catalog.sounds.length} sound(s), ${jobs.length / 2} variant(s), ${jobs.length} file(s) to decode per engine`);

  const negativeDir = mkdtempSync(join(tmpdir(), "gamesounds-check-browser-decode-"));
  try {
    const lengthFixture = buildLengthFixture(negativeDir);
    const contentFixture = buildContentFixture(negativeDir, 0.4, "content");
    const quietFixture = buildContentFixture(negativeDir, 2e-3, "quiet");

    const failuresByEngine = {};
    const infoByEngine = {};

    for (const [name, launcher] of [["chromium", chromium], ["firefox", firefox]]) {
      await runEngine(name, launcher, async (page) => {
        // Self-test first: three fixtures, each proving its OWN rule fires
        // specifically - a checker that cannot catch a deliberately broken
        // file, with the right diagnosis, is not trustworthy to pass
        // anything else.
        await runFixtureCheck(page, name, "length (truncated 1024 frames, no guard)", "length", { oggPath: lengthFixture.oggPath, sourceFrames: lengthFixture.sourceFrames });
        await runFixtureCheck(page, name, "content (0.4 tone, last 1024 frames zeroed)", "agreement", { oggPath: contentFixture.testOggPath, sourceFrames: contentFixture.sourceFrames, referenceChannel: contentFixture.referenceChannel });
        await runFixtureCheck(page, name, "content (2e-3 quiet tone, last 1024 frames zeroed)", "agreement", { oggPath: quietFixture.testOggPath, sourceFrames: quietFixture.sourceFrames, referenceChannel: quietFixture.referenceChannel });

        const failures = [];
        const mp3LengthExcess = [];
        const mp3Lag = [];
        let mp3MinCorrelation = Infinity;
        let maxAgreementDiff = 0;
        for (const job of jobs) {
          if (job.format === "ogg") {
            const decoded = await decodeChannelInBrowser(page, job.bytes, job.sourceFrames);
            const browserChannel = decoded.channelB64 ? base64ToFloat32(decoded.channelB64) : null;
            const jobFailures = judge("ogg", job.sourceFrames, decoded, { referenceChannel: job.referenceChannel, browserChannel });
            for (const f of jobFailures) failures.push(`${job.id} (${name}): ${f}`);
            if (!decoded.error && browserChannel) {
              let localMax = 0;
              const n = Math.min(job.sourceFrames, browserChannel.length, job.referenceChannel.length);
              for (let i = 0; i < n; i++) {
                const diff = Math.abs(browserChannel[i] - job.referenceChannel[i]);
                if (diff > localMax) localMax = diff;
              }
              if (localMax > maxAgreementDiff) maxAgreementDiff = localMax;
            }
          } else {
            const decoded = await decodeChannelInBrowser(page, job.bytes, null);
            const jobFailures = judge("mp3", job.sourceFrames, decoded, {});
            for (const f of jobFailures) failures.push(`${job.id} (${name}): ${f}`);
            if (!decoded.error && decoded.length >= job.sourceFrames) {
              mp3LengthExcess.push(decoded.length - job.sourceFrames);
            }
            if (!decoded.error && decoded.channelB64) {
              const decodedChannel = base64ToFloat32(decoded.channelB64);
              const { lag, correlation } = crossCorrelationLag(job.wavChannel, decodedChannel);
              mp3Lag.push(lag);
              if (correlation < mp3MinCorrelation) mp3MinCorrelation = correlation;
              // GS-08: this used to be informational only (Firefox sat at a
              // fixed +576-sample lag on every live mp3, ffmpeg's mp3 muxer
              // never having written a real LAME gapless tag). The fix (the
              // real `lame` CLI, scripts/lib/audio.mjs) landed Firefox at
              // lag 0 on the full catalogue, matching Chromium exactly - so
              // this is now a real gate, not just a report.
              if (lag !== MP3_LAG_TOLERANCE_FRAMES) {
                failures.push(`${job.id} (${name}): mp3 leading-delay lag is ${lag} frame(s), expected exactly ${MP3_LAG_TOLERANCE_FRAMES} (cross-correlation ${correlation.toFixed(3)}) - see GS-08, docs/DECISIONS.md decision 60`);
              }
            }
          }
        }
        failuresByEngine[name] = failures;
        infoByEngine[name] = { maxAgreementDiff, mp3LengthExcess, mp3Lag, mp3MinCorrelation };
      });
    }

    function summarizeDelays(values) {
      if (!values.length) return null;
      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      return { min: sorted[0], max: sorted[sorted.length - 1], median, n: sorted.length };
    }

    /** Modal lag (the exact sample count GS-08 actually is, per engine), how
     * many of n variants sit at it, and the full min/max range - a mode, not
     * a median, is the right summary for a quantity a cross-correlation
     * search expects to land on ONE exact integer almost every time (see
     * crossCorrelationLag's own header: 155/155 in the sample measurement
     * this full-catalogue run confirmed). */
    function summarizeLag(values) {
      if (!values.length) return null;
      const counts = new Map();
      for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
      let modalLag = values[0];
      let modalCount = 0;
      for (const [lag, count] of counts) {
        if (count > modalCount) { modalCount = count; modalLag = lag; }
      }
      let min = values[0];
      let max = values[0];
      for (const v of values) { if (v < min) min = v; if (v > max) max = v; }
      return { n: values.length, modalLag, modalCount, min, max };
    }

    let ok = true;
    for (const [name, failures] of Object.entries(failuresByEngine)) {
      log(`${name}: ${failures.length} failure(s) of ${jobs.length} decode(s)`);
      for (const f of failures.slice(0, 50)) log(`  FAIL ${f}`);
      if (failures.length > 50) log(`  ... and ${failures.length - 50} more`);
      if (failures.length) ok = false;
    }
    for (const [name, info] of Object.entries(infoByEngine)) {
      const marginX = info.maxAgreementDiff > 0 ? DECODER_AGREEMENT_TOLERANCE / info.maxAgreementDiff : Infinity;
      log(`${name}: max |browser - reference| across every ogg is ${info.maxAgreementDiff.toExponential(2)} (tolerance ${DECODER_AGREEMENT_TOLERANCE}, ${marginX === Infinity ? "no disagreement observed" : `${marginX.toFixed(0)}x margin`})`);
      if (info.maxAgreementDiff > 0 && marginX < 10) {
        log(`${name}: STOP - the measured max agreement disagreement is not at least 10x below the tolerance; do not widen the tolerance, report these numbers instead`);
        ok = false;
      }
      const lenStats = summarizeDelays(info.mp3LengthExcess);
      if (lenStats) {
        log(`${name}: mp3 length excess info (GS-08, includes trailing padding, not a failure) - n=${lenStats.n}, min +${lenStats.min}, median +${Math.round(lenStats.median)}, max +${lenStats.max} frame(s) longer than the wav`);
      }
      const lagStats = summarizeLag(info.mp3Lag);
      if (lagStats) {
        log(`${name}: mp3 leading-delay by cross-correlation (GS-08, gated - lag must equal ${MP3_LAG_TOLERANCE_FRAMES}) - n=${lagStats.n}, modal lag ${lagStats.modalLag} frame(s) (${lagStats.modalCount}/${lagStats.n} variant(s)), range [${lagStats.min}, ${lagStats.max}], minimum normalized correlation at the best lag ${info.mp3MinCorrelation.toFixed(3)}`);
      }
    }

    if (ok) {
      log("PASS: every ogg and mp3 decoded whole (no error, no shorter-than-wav), every ogg agreed with its own reference decode, and every mp3's leading-delay lag was exactly 0 - in both Chromium and Firefox");
    } else {
      log("FAIL: see failures above");
    }
    process.exitCode = ok ? 0 : 1;
  } finally {
    rmSync(negativeDir, { recursive: true, force: true });
  }
}

main()
  .catch((e) => {
    console.error("[check-browser-decode] fatal:", e && e.stack ? e.stack : e);
    process.exitCode = 1;
  })
  .finally(() => clearTimeout(timeoutHandle));
