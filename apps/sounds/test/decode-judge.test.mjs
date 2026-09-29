// Unit tests for scripts/lib/decode-judge.mjs's pure compare/judge functions
// (GS-07 v2.1) - exercised directly here, with no browser, so the actual
// comparison arithmetic is proven independently of Playwright ever running.
// See check-browser-decode.mjs for the end-to-end negative fixtures that
// prove the same logic catches a real content difference through an actual
// browser decode.
import assert from "node:assert/strict";
import { compareToReference, judge, crossCorrelationLag, DECODER_AGREEMENT_TOLERANCE } from "../scripts/lib/decode-judge.mjs";

function tone(n, amp = 0.4) {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = amp * Math.sin((2 * Math.PI * 880 * i) / 44100);
  return a;
}

/** A linear chirp (sweeping frequency), not a fixed-frequency tone: a pure
 * tone's autocorrelation has a peak at every multiple of its own period, so a
 * lag search over it could report a wrong-but-plausible multiple of 880Hz's
 * period instead of the real delay. A chirp's shape never repeats within the
 * search range, so its cross-correlation has one unambiguous peak - the same
 * property real, non-tonal chiptune attacks have that makes this search
 * reliable on the genuine catalogue. */
function chirp(n, amp = 0.5, sampleRate = 44100) {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const freq = 200 + (2000 - 200) * (i / n);
    a[i] = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  }
  return a;
}

/** `decoded[i + delay] = reference[i]` - a real decoder's delayed output
 * doesn't just start `delay` samples later, it CONTAINS the same signal
 * shifted later in time, which is what a lag search actually has to
 * recover. */
function delayedBy(reference, delay, extra = 2000) {
  const out = new Float32Array(reference.length + delay + extra);
  out.set(reference, delay);
  return out;
}

{
  const ref = tone(4096);
  const browser = ref.slice();
  const cmp = compareToReference(browser, ref, ref.length);
  assert.equal(cmp.agrees, true, "identical arrays must agree");
  console.log("PASS compareToReference: equal arrays agree");
}

{
  // 1.5e-5 is the reviewer's own measured ffmpeg-vs-sox reference-decoder
  // disagreement on a real file - two orders of magnitude below
  // DECODER_AGREEMENT_TOLERANCE, so alternating noise at this size must
  // never trip the gate.
  const ref = tone(4096);
  const browser = ref.map((v, i) => v + (i % 2 === 0 ? 1.5e-5 : -1.5e-5));
  const cmp = compareToReference(browser, ref, ref.length);
  assert.equal(cmp.agrees, true, "noise at 1.5e-5, far below the 1e-3 tolerance, must still agree");
  console.log("PASS compareToReference: reference plus 1.5e-5 noise still agrees");
}

{
  const n = 8192;
  const ref = tone(n);
  const browser = ref.slice();
  for (let i = n - 1024; i < n; i++) browser[i] = 0;
  const cmp = compareToReference(browser, ref, n);
  assert.equal(cmp.agrees, false, "a zeroed last-1024-frame tail must disagree");
  assert.equal(cmp.firstIndex, n - 1024, "the first differing index must be exactly where the zeroing starts");
  assert.equal(cmp.lastIndex, n - 1, "the last differing index must be the final sample");
  assert.ok(cmp.maxDiff > DECODER_AGREEMENT_TOLERANCE, "the max diff on a fully zeroed loud tail must exceed the tolerance");
  console.log(`PASS compareToReference: zeroed tail fails, naming index ${cmp.firstIndex} to ${cmp.lastIndex} (maxDiff ${cmp.maxDiff.toFixed(5)})`);
}

{
  const n = 8192;
  const ref = tone(n);
  const browser = ref.slice();
  for (let i = 3000; i < 3200; i++) browser[i] = 0;
  const cmp = compareToReference(browser, ref, n);
  assert.equal(cmp.agrees, false, "a zeroed block in the middle must disagree");
  assert.equal(cmp.firstIndex, 3000, "the first differing index must be where the middle block starts");
  assert.equal(cmp.lastIndex, 3199, "the last differing index must be where the middle block ends");
  console.log(`PASS compareToReference: one zeroed block in the middle fails, naming index ${cmp.firstIndex} to ${cmp.lastIndex}`);
}

{
  const n = 8192;
  const ref = tone(n);
  const browser = ref.slice();
  for (let i = n - 1024; i < n; i++) browser[i] = 0;
  const failures = judge("ogg", n, { length: n, error: null }, { referenceChannel: ref, browserChannel: browser });
  assert.equal(failures.length, 1, "judge must report exactly the content-agreement failure");
  assert.match(failures[0], new RegExp(String(n - 1024)), "the message must name the first differing index");
  assert.match(failures[0], new RegExp(String(n - 1)), "the message must name the last differing index");
  assert.match(failures[0], /disagrees with the reference decoder/, "the message must name the specific rule (agreement, not length)");
  console.log("PASS judge: a zeroed tail produces a content-agreement failure naming the exact index range");
}

{
  const failures = judge("ogg", 100, { length: 90, error: null }, {});
  assert.equal(failures.length, 1);
  assert.match(failures[0], /short of the source/, "a short decode with no reference given must fail only the length rule");
  console.log("PASS judge: a short decode fails the length rule on its own, with no reference channel given");
}

{
  const failures = judge("ogg", 100, { length: -1, error: "boom" }, {});
  assert.deepEqual(failures, ["ogg failed to decode: boom"], "a decode error must short-circuit before any other check runs");
  console.log("PASS judge: a decode error short-circuits length and content checks");
}

{
  // A decode that is both long enough AND sample-for-sample identical to the
  // reference must report nothing at all.
  const n = 4096;
  const ref = tone(n);
  const failures = judge("ogg", n, { length: n, error: null }, { referenceChannel: ref, browserChannel: ref.slice() });
  assert.deepEqual(failures, [], "a healthy decode must report no failures");
  console.log("PASS judge: a healthy, reference-matching decode reports no failures");
}

{
  // GS-07 v2.2: crossCorrelationLag replaces the old first-crossing-vs-wav
  // mp3 leading-delay metric, which mp3 pre-echo made not just noisy but
  // wrong. A signal identical to itself (Chromium's own real-catalogue
  // behavior against the wav, per check-browser-decode.mjs's own header)
  // must report lag 0.
  const ref = chirp(6000);
  const decoded = ref.slice();
  const { lag, correlation } = crossCorrelationLag(ref, decoded);
  assert.equal(lag, 0, "an undelayed decode must report lag 0");
  assert.ok(correlation > 0.99, `an undelayed decode's own correlation at its best lag must be near 1 (got ${correlation})`);
  console.log(`PASS crossCorrelationLag: an undelayed decode reports lag 0 (correlation ${correlation.toFixed(4)})`);
}

{
  // The measured, real defect this whole metric exists to report: Firefox's
  // mp3 decode is delayed by exactly one mp3 granule, 576 samples, relative
  // to the wav (see decode-judge.mjs's own header for the full-catalogue
  // measurement this pins). A signal delayed by exactly 576 samples must
  // report lag 576, not some nearby value a noisier metric would produce.
  const ref = chirp(6000);
  const decoded = delayedBy(ref, 576);
  const { lag, correlation } = crossCorrelationLag(ref, decoded);
  assert.equal(lag, 576, "a decode delayed by exactly one mp3 granule must report lag 576");
  assert.ok(correlation > 0.99, `a cleanly delayed decode's correlation at its best lag must be near 1 (got ${correlation})`);
  console.log(`PASS crossCorrelationLag: a decode delayed by 576 samples reports lag 576 (correlation ${correlation.toFixed(4)})`);
}

{
  // A negative lag (decoded arrives EARLIER than the reference, the opposite
  // direction from GS-08's real defect) must also be recovered correctly -
  // proving the search is symmetric, not accidentally biased toward positive
  // delays by how the window or bounds are built.
  const ref = chirp(6000);
  const decoded = delayedBy(ref, 200).slice(300); // shifts everything 100 samples earlier than "no delay"
  const { lag } = crossCorrelationLag(ref, decoded);
  assert.equal(lag, -100, "a decode shifted earlier than the reference must report a negative lag");
  console.log("PASS crossCorrelationLag: a decode arriving earlier than the reference reports a negative lag");
}
