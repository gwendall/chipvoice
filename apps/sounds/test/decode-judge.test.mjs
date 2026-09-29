// Unit tests for scripts/lib/decode-judge.mjs's pure compare/judge functions
// (GS-07 v2.1) - exercised directly here, with no browser, so the actual
// comparison arithmetic is proven independently of Playwright ever running.
// See check-browser-decode.mjs for the end-to-end negative fixtures that
// prove the same logic catches a real content difference through an actual
// browser decode.
import assert from "node:assert/strict";
import { compareToReference, judge, DECODER_AGREEMENT_TOLERANCE } from "../scripts/lib/decode-judge.mjs";

function tone(n, amp = 0.4) {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = amp * Math.sin((2 * Math.PI * 880 * i) / 44100);
  return a;
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
