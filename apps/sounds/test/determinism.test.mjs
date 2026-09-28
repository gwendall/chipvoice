// Negative test for scripts/check-determinism.mjs: proves the CI
// determinism gate (item 9 of the PR review, docs/DECISIONS.md) actually
// fires on a hash that drifted from the committed catalog.json, rather than
// passing everything by accident. See check-determinism.mjs's own header.
import assert from "node:assert/strict";
import { compareCatalogs } from "../scripts/check-determinism.mjs";

function sound(id, variants) {
  return { id, origin: "chipvoice", variants };
}
function variant(n, sha256) {
  return { n, sha256 };
}

{
  const committed = { sounds: [sound("jump-8bit-2a03", [variant(1, "aaa"), variant(2, "bbb")])] };
  const fresh = { sounds: [sound("jump-8bit-2a03", [variant(1, "aaa"), variant(2, "bbb")])] };
  const failures = compareCatalogs(fresh, committed);
  assert.deepEqual(failures, [], "identical hashes must produce no failures");
  console.log("PASS compareCatalogs passes when the fresh build's hashes match the committed catalog exactly");
}

{
  // The negative case this check exists for: a rebuild that produced
  // different audio (a drifted ffmpeg, a changed recipe never rebuilt into
  // catalog.json) for one variant of one sound.
  const committed = { sounds: [sound("jump-8bit-2a03", [variant(1, "aaa"), variant(2, "bbb")])] };
  const fresh = { sounds: [sound("jump-8bit-2a03", [variant(1, "aaa"), variant(2, "DRIFTED")])] };
  const failures = compareCatalogs(fresh, committed);
  assert.equal(failures.length, 1, "a single drifted hash must produce exactly one failure");
  assert.match(failures[0], /variant 2/);
  assert.match(failures[0], /does not match committed/);
  console.log("PASS compareCatalogs fails a variant whose hash drifted from the committed catalog");
}

{
  const committed = { sounds: [] };
  const fresh = { sounds: [sound("new-sound", [variant(1, "aaa")])] };
  const failures = compareCatalogs(fresh, committed);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /missing from the committed catalog\.json/);
  console.log("PASS compareCatalogs fails a sound built fresh but absent from the committed catalog");
}

{
  const committed = { sounds: [sound("jump-8bit-2a03", [variant(1, "aaa"), variant(2, "bbb"), variant(3, "ccc")])] };
  const fresh = { sounds: [sound("jump-8bit-2a03", [variant(1, "aaa"), variant(2, "bbb")])] };
  const failures = compareCatalogs(fresh, committed);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /variant count differs|2 variant\(s\), committed catalog\.json has 3/);
  console.log("PASS compareCatalogs fails when the fresh build's variant count differs from committed");
}

{
  // A subset build is expected to omit sounds from other origins - that is
  // not drift, so it must not be flagged.
  const committed = { sounds: [sound("jump-8bit-2a03", [variant(1, "aaa")]), sound("kenney-thud-8bit", [variant(1, "zzz")])] };
  const fresh = { sounds: [sound("jump-8bit-2a03", [variant(1, "aaa")])] };
  const failures = compareCatalogs(fresh, committed);
  assert.deepEqual(failures, [], "a sound absent from the fresh subset (a different origin) must not be flagged");
  console.log("PASS compareCatalogs ignores committed sounds outside the fresh build's own subset");
}
