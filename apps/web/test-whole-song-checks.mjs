import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "../../packages/chipvoice/node_modules/esbuild/lib/main.js";
import {
  nesChip, gbChip, mdChip, snesChip,
  planPerformance, renderPerformance,
} from "../../packages/chipvoice/dist/index.js";

// Bundles the pure TS module the same way test-audio-range.mjs does, so this
// script never depends on a separate build step or a checked-in artifact.
const built = await build({
  entryPoints: ["src/lib/composition/checks.ts"],
  bundle: true, platform: "node", format: "esm", write: false,
});
const { decodeWav, wholeSongChecks } = await import(
  "data:text/javascript;base64," + Buffer.from(built.outputFiles[0].text).toString("base64")
);

// ---- synthetic PCM helpers -------------------------------------------------
// SR=1000 keeps every window-frame count below an exact integer (LOOP_WINDOW_
// SECONDS=0.3 -> 300 frames, LEVEL_WINDOW_SECONDS=1 -> 1000, ENDING_WINDOW_
// SECONDS=0.5 -> 500, CLIP_MERGE_SECONDS=0.05 -> 50), so fixtures line up with
// checks.ts's own windowing exactly instead of fighting rounding.
const SR = 1000;
const amp = (db) => Math.pow(10, db / 20);
// Alternating +/-amplitude: RMS and peak both equal the amplitude exactly, so
// a "tone" measures identically under every check's RMS- or peak-based math.
function tone(seconds, db) {
  const a = amp(db);
  const left = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < left.length; i++) left[i] = i % 2 === 0 ? a : -a;
  return { left, right: null, sampleRate: SR };
}
function silentClip(seconds) {
  return { left: new Float32Array(Math.round(seconds * SR)), right: null, sampleRate: SR };
}
function concat(...clips) {
  const left = new Float32Array(clips.reduce((n, c) => n + c.left.length, 0));
  let offset = 0;
  for (const c of clips) { left.set(c.left, offset); offset += c.left.length; }
  return { left, right: null, sampleRate: SR };
}
const durationOf = (audio) => audio.left.length / audio.sampleRate;
const context = (audio, overrides = {}) => ({ durationSeconds: durationOf(audio), loop: true, ...overrides });
const codes = (findings) => findings.map((f) => f.code);
let passed = 0;
function check(name, fn) { fn(); passed++; }

// ---- decodeWav --------------------------------------------------------------
function encodeWav(samples, sampleRate, channels = 1) {
  const dataBytes = samples.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0, "ascii"); buf.writeUInt32LE(36 + dataBytes, 4); buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii"); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * channels * 2, 28);
  buf.writeUInt16LE(channels * 2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii"); buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

check("decodeWav round-trips mono and stereo pinned PCM", () => {
  const samples = [0, 0.5, -0.5, 1, -1, 0.25, -0.75, 0.1];
  const decoded = decodeWav(encodeWav(samples, 8000, 1));
  assert.equal(decoded.sampleRate, 8000);
  assert.equal(decoded.right, null);
  assert.equal(decoded.left.length, samples.length);
  samples.forEach((s, i) => assert.ok(Math.abs(decoded.left[i] - s) < 1 / 3000, `sample ${i}`));

  const stereo = [0.5, -0.5, 0.25, -0.25];
  const decodedStereo = decodeWav(encodeWav(stereo, 8000, 2));
  assert.equal(decodedStereo.left.length, 2);
  assert.ok(Math.abs(decodedStereo.left[0] - 0.5) < 1e-3);
  assert.ok(Math.abs(decodedStereo.right[0] - -0.5) < 1e-3);
});

check("decodeWav rejects anything but the one pinned shape", () => {
  assert.throws(() => decodeWav(new Uint8Array(10)), /too short/);
  const corruptRiff = encodeWav([0, 0], 8000, 1); corruptRiff[0] = 0;
  assert.throws(() => decodeWav(corruptRiff), /Unsupported WAV/);
  const notPcm = encodeWav([0, 0], 8000, 1); notPcm.set([2, 0], 20);
  assert.throws(() => decodeWav(notPcm), /Unsupported WAV/);
  const eightBit = encodeWav([0, 0], 8000, 1); eightBit.set([8, 0], 34);
  assert.throws(() => decodeWav(eightBit), /Unsupported WAV/);
  const badTag = encodeWav([0, 0], 8000, 1); badTag.set(Buffer.from("junk"), 36);
  assert.throws(() => decodeWav(badTag), /Unsupported WAV/);
  const truncated = encodeWav([0, 0, 0, 0], 8000, 1).slice(0, -1);
  assert.throws(() => decodeWav(truncated), /Invalid WAV frame count/);
});

// ---- clipping ---------------------------------------------------------------
check("checkClipping: clean tone has no findings", () => {
  const audio = tone(3, -20);
  assert.deepEqual(codes(wholeSongChecks(audio, context(audio))), []);
});

check("checkClipping: one full-scale sample is one finding", () => {
  // -6dBFS keeps the level-jump check's 12dB margin unbroken when one sample
  // clips (0 - (-6) = 6dB), isolating this to a single "clipping" finding.
  const audio = tone(3, -6);
  audio.left[1500] = 1;
  const findings = wholeSongChecks(audio, context(audio));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, "clipping");
  assert.equal(findings[0].level, "error");
  assert.equal(findings[0].measured, 1);
});

check("checkClipping: samples within CLIP_MERGE_SECONDS merge into one run", () => {
  const audio = tone(3, -6);
  audio.left[1000] = 1; audio.left[1030] = -1; // 30 frames apart, under the 50-frame (0.05s) merge gap
  const clip = wholeSongChecks(audio, context(audio)).filter((f) => f.code === "clipping");
  assert.equal(clip.length, 1);
  assert.equal(clip[0].measured, 2);
});

check("checkClipping: samples past CLIP_MERGE_SECONDS stay separate runs", () => {
  const audio = tone(3, -6);
  audio.left[1000] = 1; audio.left[1060] = -1; // 60 frames apart, over the 50-frame merge gap
  const clip = wholeSongChecks(audio, context(audio)).filter((f) => f.code === "clipping");
  assert.equal(clip.length, 2);
});

// ---- level jumps --------------------------------------------------------------
check("checkLevelJumps: a window just past the 12dB margin fires, just under does not", () => {
  // +-0.1dB either side of the exact 12dB margin, rather than exactly on it,
  // so this proves the boundary without also asserting bit-exact float log10.
  const fire = tone(5, -20);
  for (let i = 2000; i < 3000; i++) fire.left[i] = i % 2 === 0 ? amp(-7.9) : -amp(-7.9); // 12.1dB, and -7.9dBFS clears the -9dBFS floor
  const fireFindings = wholeSongChecks(fire, context(fire)).filter((f) => f.code === "level_jump");
  assert.equal(fireFindings.length, 1);
  assert.equal(fireFindings[0].measured, -7.9);

  const safe = tone(5, -20);
  for (let i = 2000; i < 3000; i++) safe.left[i] = i % 2 === 0 ? amp(-8.1) : -amp(-8.1); // 11.9dB, just under the margin
  assert.deepEqual(wholeSongChecks(safe, context(safe)).filter((f) => f.code === "level_jump"), []);
});

check("checkLevelJumps: the floor keeps a quiet song's own outlier window from firing", () => {
  const audio = tone(5, -40);
  for (let i = 2000; i < 3000; i++) audio.left[i] = i % 2 === 0 ? amp(-21) : -amp(-21); // 19dB past median, but still under the -9dBFS floor
  assert.deepEqual(wholeSongChecks(audio, context(audio)).filter((f) => f.code === "level_jump"), []);
});

// ---- silence gaps ---------------------------------------------------------------
check("checkSilenceGaps: 9s of silence passes, 10s fires (MIN_SILENCE_SECONDS)", () => {
  const short = concat(tone(5, -20), silentClip(9), tone(6, -20));
  assert.deepEqual(wholeSongChecks(short, context(short)).filter((f) => f.code === "silence_gap"), []);

  const long = concat(tone(5, -20), silentClip(10), tone(6, -20));
  const findings = wholeSongChecks(long, context(long)).filter((f) => f.code === "silence_gap");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].measured, 10);
  assert.equal(findings[0].startSeconds, 5);
  assert.equal(findings[0].endSeconds, 15);
});

check("checkSilenceGaps: names the one part scheduled through it as a dropout", () => {
  const audio = concat(tone(5, -20), silentClip(10), tone(6, -20));
  const dropout = wholeSongChecks(audio, context(audio, { parts: [{ id: "lead", ranges: [[0, 21]] }] }))
    .find((f) => f.code === "silence_gap");
  assert.equal(dropout.voice, "lead");
});

check("checkSilenceGaps: a written rest with no part scheduled through it is not named", () => {
  const audio = concat(tone(5, -20), silentClip(10), tone(6, -20));
  const rest = wholeSongChecks(audio, context(audio, { parts: [{ id: "lead", ranges: [[0, 5], [15, 21]] }] }))
    .find((f) => f.code === "silence_gap");
  assert.equal(rest.voice, undefined);
  assert.match(rest.message, /no part scheduled there either/);
});

// ---- ending decay (loop:false only) ---------------------------------------------
check("checkEndingDecay: gated off entirely when loop is true", () => {
  const audio = tone(10, -20); // never fades - would fail if the check ran
  assert.deepEqual(wholeSongChecks(audio, context(audio, { loop: true })).filter((f) => f.code === "abrupt_ending"), []);
});

check("checkEndingDecay: a tail below the floor passes even with no decay measured", () => {
  const audio = concat(tone(10, -20), tone(1, -50));
  assert.deepEqual(wholeSongChecks(audio, context(audio, { loop: false })).filter((f) => f.code === "abrupt_ending"), []);
});

check("checkEndingDecay: just past 12dB of decay passes; just under does not", () => {
  // +-0.1dB either side of the exact 12dB decay bar, for the same float-safety
  // reason as the level-jump edge test above.
  const passing = concat(tone(9, -20), tone(1.5, -20), tone(1.5, -32.1));
  assert.deepEqual(wholeSongChecks(passing, context(passing, { loop: false })).filter((f) => f.code === "abrupt_ending"), []);

  const failing = concat(tone(9, -20), tone(1.5, -20), tone(1.5, -31.9));
  const findings = wholeSongChecks(failing, context(failing, { loop: false })).filter((f) => f.code === "abrupt_ending");
  assert.equal(findings.length, 1);
});

check("checkEndingDecay: a constant, unfaded ending fires", () => {
  const audio = tone(10, -20);
  const findings = wholeSongChecks(audio, context(audio, { loop: false })).filter((f) => f.code === "abrupt_ending");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].measured, -20);
});

// ---- loop seam (loop:true only) ---------------------------------------------
check("checkLoopSeam: gated off entirely when loop is false", () => {
  const audio = tone(5, -20);
  audio.left[audio.left.length - 1] = 0.9; // a deliberate click - would fail if the check ran
  assert.deepEqual(wholeSongChecks(audio, context(audio, { loop: false })).filter((f) => f.code.startsWith("loop_")), []);
});

check("checkLoopSeam click: a seam step past the song's own typical step fires; just under does not", () => {
  const base = tone(5, -40); // typical adjacent-sample step here is 2*amp(-40dB)
  const fire = { left: base.left.slice(), right: null, sampleRate: SR };
  fire.left[fire.left.length - 1] = fire.left[0] - 0.13; // well past clickLimit (~0.12 = 6x typical step)
  const fireFindings = wholeSongChecks(fire, context(fire)).filter((f) => f.code === "loop_click");
  assert.equal(fireFindings.length, 1);

  const safe = { left: base.left.slice(), right: null, sampleRate: SR };
  safe.left[safe.left.length - 1] = safe.left[0] - 0.02; // close to the song's own ordinary step
  assert.deepEqual(wholeSongChecks(safe, context(safe)).filter((f) => f.code === "loop_click"), []);
});

check("checkLoopSeam level jump: relative to the song's own movement, not a flat bar", () => {
  // 22 blocks of LOOP_WINDOW_SECONDS (0.3s = 300 frames at SR=1000); blocks
  // 1..20 alternate -20/-10dBFS so 19 of the 21 interior deltas are exactly
  // 10dB (a well-known-good loop, zelda, measured 0-4.6dB seam jumps against
  // a 4.7-6.1dB interior p90 on every chip in the corpus below - safely inside
  // its own ordinary movement). Blocks 0 and 21 are the seam's start/end,
  // set independently to probe the jumpLimit (max(6dB floor, 2x that p90)).
  const block = (db) => tone(0.3, db);
  function seam(startDb, endDb) {
    const blocks = [block(startDb)];
    for (let i = 1; i <= 20; i++) blocks.push(block(i % 2 === 1 ? -20 : -10));
    blocks.push(block(endDb));
    return concat(...blocks);
  }
  const safe = seam(-20, -5); // 15dB seam jump, under the 20dB limit (10dB typical * 2)
  assert.deepEqual(wholeSongChecks(safe, context(safe)).filter((f) => f.code === "loop_level_jump"), []);

  const fire = seam(-30, -5); // 25dB seam jump, past the 20dB limit
  const findings = wholeSongChecks(fire, context(fire)).filter((f) => f.code === "loop_level_jump");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].measured, 25);
  assert.equal(findings[0].limit, 20);
});

// ---- duration ---------------------------------------------------------------
check("checkDuration: exactly at the 0.25s tolerance passes; past it fires", () => {
  const audio = tone(10, -20);
  assert.deepEqual(wholeSongChecks(audio, context(audio, { durationSeconds: 9.75 })).filter((f) => f.code === "duration_mismatch"), []);
  const findings = wholeSongChecks(audio, context(audio, { durationSeconds: 9.74 })).filter((f) => f.code === "duration_mismatch");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].level, "error");
  assert.equal(findings[0].measured, 10);
  assert.equal(findings[0].limit, 9.74);
});

console.log(`PASS ${passed} synthetic-PCM checks: decodeWav, clipping, level jumps, silence gaps, ending decay (loop-gated), loop seam click and level jump (relative to the song's own movement), duration`);

// ---- corpus: run every hand-authored arrangement and the demo project -----
// through the same checks and confirm the false-positive rate the ticket asks
// for. mario/zelda are native to 2a03, sonic to md (scores/arrangements/
// native-sources.mjs); a chip-adapted excerpt (e.g. mario re-realized on gb)
// carries no declared loop intent of its own (unlike a generation's
// `request.loop`), so a genuine loop_level_jump there is not miscalibration -
// see checks.ts's comment on checkLoopSeam for the corpus numbers behind this.
async function starter() {
  const built = await build({ entryPoints: ["src/create/starter.ts"], bundle: true, platform: "node", format: "esm", write: false });
  const { starterProject } = await import("data:text/javascript;base64," + Buffer.from(built.outputFiles[0].text).toString("base64"));
  const { renderProject } = await import("../../packages/chipvoice/dist/index.js");
  const project = starterProject();
  const result = renderProject(project);
  return { label: "starter/snes", audio: result.audio, findings: wholeSongChecks(result.audio, { durationSeconds: result.audio.seconds, loop: true }) };
}
async function arrangement(id, chip) {
  const score = JSON.parse(await readFile(new URL(`../../scores/arrangements/${id}.json`, import.meta.url)));
  const audio = renderPerformance(planPerformance(score, chip, { allowLoss: true }), chip);
  const findings = wholeSongChecks(audio, { durationSeconds: audio.seconds, loop: true });
  return { label: `${id}/${chip.spec.id}`, audio, findings };
}

const corpus = [await starter()];
for (const id of ["mario", "zelda", "sonic"])
  for (const chip of [nesChip, gbChip, mdChip, snesChip])
    corpus.push(await arrangement(id, chip));

const expectClean = new Set(["starter/snes", "mario/2a03", "zelda/2a03", "zelda/dmg", "zelda/md", "zelda/snes", "sonic/md", "sonic/snes"]);
const expectLoopJumpOnly = new Set(["mario/dmg", "mario/md", "mario/snes", "sonic/2a03", "sonic/dmg"]);
let falsePositives = 0;
for (const { label, findings } of corpus) {
  if (expectClean.has(label)) {
    if (findings.length) falsePositives++;
    assert.deepEqual(codes(findings), [], `${label}: expected clean (native chip or a verified seamless loop)`);
  } else if (expectLoopJumpOnly.has(label)) {
    assert.deepEqual(codes(findings), ["loop_level_jump"], `${label}: expected only a chip-adaptation loop-level jump`);
  } else {
    throw new Error(`unexpected corpus case ${label}`);
  }
}
console.log(`PASS corpus: ${corpus.length} renders (${expectClean.size} on their native chip or a verified loop, ${expectLoopJumpOnly.size} chip-adapted), ${falsePositives} false positives on known-good renders`);
