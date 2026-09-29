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
//   3. Ogg only: content loss - the decoded audio's own last sample above
//      CONTENT_LOSS_THRESHOLD sitting more than CONTENT_LOSS_MARGIN_FRAMES
//      earlier than the wav's own last sample above the same threshold, AND
//      the wav's own samples in that gap actually reach REAL_CONTENT_THRESHOLD
//      (see those constants' own comments for the derivation - the second
//      condition exists because running this gate against the GS-06/GS-07
//      rebuilt catalogue surfaced 96 of 1080 oggs whose gap was pure
//      near-threshold chatter on a slowly-decaying tail, not lost content;
//      confirmed by hand, then encoded as this gate's own rule rather than
//      left as a one-off exception). Not checked for mp3: Firefox's mp3s are
//      proven whole but SHIFTED LATER (GS-08, a leading-delay defect, not
//      content loss) - reported below as information, never a failure.
//
// Before checking anything real, this script builds and checks its own
// negative fixture - an ogg whose content truly ends 1024 frames short of
// what it claims to be - and refuses to run the real catalogue at all if
// that fixture does not fail. A browser-decode checker that cannot catch a
// deliberately truncated file is not trustworthy to pass anything else.
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
import { toWavBytes } from "./lib/audio.mjs";

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

function log(...m) { console.log("[check-browser-decode]", ...m); }

const HARD_TIMEOUT_MS = 18 * 60 * 1000; // whole run, both engines, every file (measured ~7 minutes for all 1080 variants locally; generous margin for a slower CI runner)
const timeoutHandle = setTimeout(() => {
  console.error("[check-browser-decode] hard timeout exceeded - forcing exit so no browser process is left running");
  process.exit(1);
}, HARD_TIMEOUT_MS);
timeoutHandle.unref();

// Matches the reviewer's own bench (scratchpad ci128/browsers.cjs,
// allbrowsers.cjs) exactly: well above the digital-silence/dither floor
// (±1 LSB of 16-bit PCM is ~3e-5), far below anything a person could hear.
const CONTENT_LOSS_THRESHOLD = 1e-3;

// The pre-fix measured distribution (reviewer's ci128/lv-browsers.json,
// libvorbis-encoded live catalogue, before OGG_TAIL_GUARD_FRAMES existed) is
// bimodal: a browser's own last-audible sample either matches the wav's
// exactly, or differs by 100+ frames (real content trimmed) - nothing
// in between. 16 frames (0.36ms at 44.1kHz) comfortably absorbs an ordinary
// few-sample rounding difference right at the instant a signal crosses the
// threshold, without coming close to masking a real loss.
const CONTENT_LOSS_MARGIN_FRAMES = 16;

// After GS-06/GS-07's fix (sox + OGG_TAIL_GUARD_FRAMES) landed, re-running
// this gate against the rebuilt catalogue surfaced a NEW, different failure
// shape on 96 of 1080 live oggs (gap 17 to 332 frames, mean 42) - every one
// on a modal-synthesis or chip decay whose amplitude lingers and oscillates
// right around CONTENT_LOSS_THRESHOLD for a long stretch (verified: the
// wav's OWN samples inside every one of those 96 gaps peak at 1.68x
// CONTENT_LOSS_THRESHOLD at most - never above -55 dBFS). That is a
// measurement artifact, not lost content: an instantaneous per-sample
// threshold crossing is unstable exactly where a slowly-decaying, oscillating
// signal chatters across it, and lossy re-encoding shifts by a few dB right
// there is expected, not a defect (this is the SAME class of thing
// FORMAT_ENERGY_TOLERANCE_DB and EXCLUDED_PRESETS already account for at the
// energy-gate level - see scripts/lib/checks.mjs and build-catalog.mjs).
// REAL_CONTENT_THRESHOLD draws the line for what counts as content actually
// worth failing the build over: comfortably above every measured chatter
// case (1.68x CONTENT_LOSS_THRESHOLD at most) and still far below anything
// a real drop looks like (the OGG_TAIL_GUARD_FRAMES-era defect this whole
// gate exists to catch cut FULL-amplitude content, not -50 dBFS noise-floor
// wobble - see the negative fixture below, at 0.4 linear, ~400x this
// threshold). A gap beyond CONTENT_LOSS_MARGIN_FRAMES only fails the build
// if the wav's own samples inside that gap actually reach this level.
const REAL_CONTENT_THRESHOLD = 4e-3;

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

function lastAboveThreshold(channels, threshold) {
  const n = channels[0].length;
  let last = -1;
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (const c of channels) { const a = Math.abs(c[i]); if (a > m) m = a; }
    if (m > threshold) last = i;
  }
  return last;
}

/** Decodes one file's bytes in the given page via `decodeAudioData`, exactly
 * as the reviewer's own bench does (`new OfflineAudioContext(1, 44100,
 * 44100)`, forward scan for the last sample above 1e-3). Returns
 * `{length, last, error}` - `length`/`last` are -1 on a decode error. */
async function decodeInBrowser(page, bytes) {
  const b64 = bytes.toString("base64");
  return page.evaluate(async (b64) => {
    try {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const ctx = new OfflineAudioContext(1, 44100, 44100);
      const buf = await ctx.decodeAudioData(bin.buffer);
      const d = buf.getChannelData(0);
      let last = -1;
      for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > 1e-3) last = i;
      return { length: buf.length, last, error: null };
    } catch (e) {
      return { length: -1, last: -1, error: e && e.message ? e.message : String(e) };
    }
  }, b64);
}

/** The wav's own loudest sample, strictly after `fromIndexExclusive` and up
 * to and including `toIndexInclusive` - used to tell a genuine dropped tail
 * (loud right up to where it is missing) apart from a decaying signal that
 * merely chatters across `CONTENT_LOSS_THRESHOLD` for a while (see
 * `REAL_CONTENT_THRESHOLD`'s own header). */
function maxAbsInRange(channels, fromIndexExclusive, toIndexInclusive) {
  let m = 0;
  for (let i = Math.max(0, fromIndexExclusive + 1); i <= toIndexInclusive; i++) {
    for (const c of channels) { const a = Math.abs(c[i]); if (a > m) m = a; }
  }
  return m;
}

/** Judges one decoded result against the reference wav's own measurements.
 * `checkContentLoss` is false for mp3 (GS-08's leading-delay defect shifts
 * content LATER, never earlier - it is reported, never gated here).
 * `wavChannels` (only needed, and only passed, when `checkContentLoss` is
 * true) is the wav's own decoded PCM, used to tell real lost content apart
 * from harmless near-threshold chatter - see `REAL_CONTENT_THRESHOLD`. */
function judge(format, sourceFrames, wavLast, decoded, { checkContentLoss, wavChannels }) {
  const failures = [];
  if (decoded.error) {
    failures.push(`${format} failed to decode: ${decoded.error}`);
    return failures;
  }
  if (decoded.length < sourceFrames) {
    failures.push(`${format} decoded ${decoded.length} frame(s), ${sourceFrames - decoded.length} short of the wav's own ${sourceFrames} frame(s)`);
  }
  if (checkContentLoss && wavLast >= 0) {
    const gap = wavLast - decoded.last;
    if (gap > CONTENT_LOSS_MARGIN_FRAMES) {
      const peakInGap = wavChannels ? maxAbsInRange(wavChannels, decoded.last, wavLast) : Infinity;
      if (peakInGap >= REAL_CONTENT_THRESHOLD) {
        failures.push(`${format}'s last audible sample (index ${decoded.last}, threshold ${CONTENT_LOSS_THRESHOLD}) sits ${gap} frame(s) earlier than the wav's own (index ${wavLast}, peak ${peakInGap.toFixed(5)} in the gap) - real content lost, not just a decoder's own quiet-tail rounding`);
      }
    }
  }
  return failures;
}

/** Builds a genuinely-truncated ogg: `sourceFrames` of real, unfaded tone
 * content (so any cut is audibly real, not a fade the encoder trims
 * legitimately), encoded from only the first `sourceFrames - 1024` of it -
 * content that really, truly ends 1024 frames early, exactly the failure
 * mode this script exists to catch. No `OGG_TAIL_GUARD_FRAMES` pad: that
 * guard is `encodeVariant`'s own production fix, irrelevant to proving the
 * CHECKER itself can still catch a file with no such guard, or a guard that
 * was not wide enough. */
function buildNegativeFixture(dir) {
  const sampleRate = 44100;
  const sourceFrames = 8192;
  const cutFrames = sourceFrames - 1024;
  const tone = (n) => {
    const left = new Float32Array(n);
    for (let i = 0; i < n; i++) left[i] = 0.4 * Math.sin((2 * Math.PI * 880 * i) / sampleRate);
    return { sampleRate, left, right: null };
  };
  const fullWavPath = join(dir, "negative-full.wav");
  const cutWavPath = join(dir, "negative-cut.wav");
  const oggPath = join(dir, "negative.ogg");
  writeFileSync(fullWavPath, toWavBytes(tone(sourceFrames)));
  writeFileSync(cutWavPath, toWavBytes(tone(cutFrames)));
  execFileSync("sox", ["-R", cutWavPath, "-C", "5", oggPath]);
  return { fullWavPath, oggPath, sourceFrames };
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

async function main() {
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));

  // Every (format, sourceFrames, wavLast, bytes, id) tuple to decode, built
  // once and reused for both engines. wavChannels is only kept for the ogg
  // job (checkContentLoss is only ever true for ogg) - judge() uses it to
  // tell real lost content apart from near-threshold chatter, see
  // REAL_CONTENT_THRESHOLD.
  const jobs = [];
  const sounds = limit ? catalog.sounds.slice(0, limit) : catalog.sounds;
  for (const sound of sounds) {
    for (const variant of sound.variants) {
      const wavBytes = readFileSync(join(filesDir, variant.files.wav.url.split("/").pop()));
      const { frameCount, channels } = readWavPcm(wavBytes);
      const wavLast = lastAboveThreshold(channels, CONTENT_LOSS_THRESHOLD);
      for (const format of ["ogg", "mp3"]) {
        const bytes = readFileSync(join(filesDir, variant.files[format].url.split("/").pop()));
        jobs.push({ id: `${sound.id} ${variant.n}`, format, sourceFrames: frameCount, wavLast, bytes, wavChannels: format === "ogg" ? channels : null });
      }
    }
  }
  log(`loaded ${catalog.sounds.length} sound(s), ${jobs.length / 2} variant(s), ${jobs.length} file(s) to decode per engine`);

  const negativeDir = mkdtempSync(join(tmpdir(), "gamesounds-check-browser-decode-"));
  let negative;
  try {
    negative = buildNegativeFixture(negativeDir);
    const negativeWav = readWavPcm(readFileSync(negative.fullWavPath));
    const negativeWavLast = lastAboveThreshold(negativeWav.channels, CONTENT_LOSS_THRESHOLD);
    const negativeBytes = readFileSync(negative.oggPath);

    const failuresByEngine = {};
    const infoByEngine = {};

    for (const [name, launcher] of [["chromium", chromium], ["firefox", firefox]]) {
      await runEngine(name, launcher, async (page) => {
        // Self-test first: content that was genuinely never encoded (not a
        // decoder's own end-trim of a complete stream, an actual absence)
        // must fail in EVERY engine - no decoder can play samples that were
        // never in the file.
        const negativeDecoded = await decodeInBrowser(page, negativeBytes);
        const negativeFailures = judge("ogg", negative.sourceFrames, negativeWavLast, negativeDecoded, { checkContentLoss: true, wavChannels: negativeWav.channels });
        if (negativeFailures.length === 0) {
          throw new Error(
            "check-browser-decode's own negative fixture (an ogg truncated 1024 frames short of its claimed content) " +
              `did NOT fail in ${name} - this checker cannot be trusted to catch real truncation, refusing to run the catalogue`,
          );
        }
        log(`negative fixture in ${name}: correctly failed (${negativeFailures[0]})`);

        const failures = [];
        const mp3Deltas = [];
        for (const job of jobs) {
          const decoded = await decodeInBrowser(page, job.bytes);
          const checkContentLoss = job.format === "ogg";
          const jobFailures = judge(job.format, job.sourceFrames, job.wavLast, decoded, { checkContentLoss, wavChannels: job.wavChannels });
          for (const f of jobFailures) failures.push(`${job.id} (${name}): ${f}`);
          if (job.format === "mp3" && !decoded.error && decoded.length >= job.sourceFrames) {
            mp3Deltas.push(decoded.length - job.sourceFrames);
          }
        }
        failuresByEngine[name] = failures;
        if (mp3Deltas.length) {
          const mean = mp3Deltas.reduce((a, b) => a + b, 0) / mp3Deltas.length;
          const max = Math.max(...mp3Deltas);
          const nonZero = mp3Deltas.filter((d) => d > 0).length;
          infoByEngine[name] = { mp3LeadingDelay: { mean: Math.round(mean * 10) / 10, max, nonZero, total: mp3Deltas.length } };
        }
      });
    }

    let ok = true;
    for (const [name, failures] of Object.entries(failuresByEngine)) {
      log(`${name}: ${failures.length} failure(s) of ${jobs.length} decode(s)`);
      for (const f of failures.slice(0, 50)) log(`  FAIL ${f}`);
      if (failures.length > 50) log(`  ... and ${failures.length - 50} more`);
      if (failures.length) ok = false;
    }
    for (const [name, info] of Object.entries(infoByEngine)) {
      if (info.mp3LeadingDelay) {
        const d = info.mp3LeadingDelay;
        log(`${name}: mp3 leading-delay info (GS-08, not a failure) - ${d.nonZero}/${d.total} decode longer than the wav, mean +${d.mean} frame(s), max +${d.max} frame(s)`);
      }
    }

    if (ok) {
      log(`PASS: every ogg and mp3 decoded whole (no error, no shorter-than-wav, no ogg content loss beyond ${CONTENT_LOSS_MARGIN_FRAMES}-frame margin) in both Chromium and Firefox`);
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
