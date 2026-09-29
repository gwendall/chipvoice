// Decision 56 (NEXT-21): unit tests for the melodic-similarity measure and
// the calibration that set KNOWN_MELODY_THRESHOLD. Bundles the pure TS
// module the same way test-whole-song-checks.mjs does, so this needs no
// separate build step. No network, no chip, no driver - deterministic
// synthetic note data only, seeded so a run always reproduces the same
// confusion matrix.
import assert from "node:assert/strict";
import { build } from "../../packages/chipvoice/node_modules/esbuild/lib/main.js";

const built = await build({
  entryPoints: ["src/lib/composition/similarity.ts"],
  bundle: true, platform: "node", format: "esm", write: false,
});
const {
  melodicLine, tokenize, referenceTokens, bestMatch,
  knownMelodySimilarity, isKnownMelody, KNOWN_MELODY_THRESHOLD,
} = await import(
  "data:text/javascript;base64," + Buffer.from(built.outputFiles[0].text).toString("base64")
);
const builtMelodies = await build({
  entryPoints: ["src/lib/composition/known-melodies.ts"],
  bundle: true, platform: "node", format: "esm", write: false,
});
const { KNOWN_MELODIES } = await import(
  "data:text/javascript;base64," + Buffer.from(builtMelodies.outputFiles[0].text).toString("base64")
);

let passed = 0;
function check(name, fn) { fn(); passed++; }

// ---- basic unit behavior ---------------------------------------------------

check("melodicLine reduces simultaneous notes to the highest pitch, sorted by tick", () => {
  const line = melodicLine([
    { tick: 480, pitch: 60 }, { tick: 0, pitch: 64 }, { tick: 0, pitch: 67 }, { tick: 240, pitch: 62 },
  ]);
  assert.deepEqual(line, [{ tick: 0, pitch: 67 }, { tick: 240, pitch: 62 }, { tick: 480, pitch: 60 }]);
});

check("tokenize needs at least 3 notes (2 intervals, 1 duration ratio)", () => {
  assert.deepEqual(tokenize([{ tick: 0, pitch: 60 }, { tick: 480, pitch: 64 }]), []);
  const tokens = tokenize([{ tick: 0, pitch: 60 }, { tick: 480, pitch: 64 }, { tick: 960, pitch: 67 }]);
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].interval, 3); // 67 - 64
});

check("tokenize is exactly transposition-invariant", () => {
  const notes = [{ tick: 0, pitch: 60 }, { tick: 480, pitch: 64 }, { tick: 720, pitch: 67 }, { tick: 1200, pitch: 65 }];
  const transposed = notes.map((n) => ({ tick: n.tick, pitch: n.pitch + 17 }));
  assert.deepEqual(tokenize(notes), tokenize(transposed));
});

check("tokenize is exactly tempo-invariant under uniform scaling", () => {
  const notes = [{ tick: 0, pitch: 60 }, { tick: 480, pitch: 64 }, { tick: 720, pitch: 67 }, { tick: 1200, pitch: 65 }];
  const retimed = notes.map((n) => ({ tick: Math.round(n.tick * 2.5), pitch: n.pitch }));
  assert.deepEqual(tokenize(notes), tokenize(retimed));
});

check("bestMatch is 1.0 for an exact copy of a reference's own tokens", () => {
  const reference = KNOWN_MELODIES.find((m) => m.id === "twinkle-twinkle");
  const tokens = referenceTokens(reference);
  assert.equal(bestMatch(tokens, tokens), 1);
});

check("bestMatch finds a reference quoted inside a longer, unrelated line", () => {
  const reference = KNOWN_MELODIES.find((m) => m.id === "korobeiniki");
  const tokens = referenceTokens(reference);
  const padding = Array.from({ length: 20 }, (_, i) => ({ interval: (i % 5) - 2, rhythm: 0 }));
  const embedded = [...padding, ...tokens, ...padding];
  assert.equal(bestMatch(embedded, tokens), 1);
});

check("knownMelodySimilarity skips percussion parts and drum notes", () => {
  const match = knownMelodySimilarity([
    { id: "drums", role: "perc", notes: [{ tick: 0, pitch: 36 }, { tick: 240, pitch: 38 }, { tick: 480, pitch: 36 }, { tick: 720, pitch: 38 }] },
  ]);
  assert.equal(match, null);
});

check("isKnownMelody flags a near-exact quote and clears an unrelated short line", () => {
  const reference = KNOWN_MELODIES.find((m) => m.id === "mario-ground-theme");
  const notes = reconstruct(reference);
  const quote = isKnownMelody([{ id: "lead", role: "lead", notes: notes.map((n, i) => ({ id: `n${i}`, ...n })) }]);
  assert.ok(quote, "an unmodified reference incipit should flag");
  assert.equal(quote.referenceId, "mario-ground-theme");

  const original = isKnownMelody([{ id: "lead", role: "lead", notes: [
    { id: "n0", tick: 0, pitch: 60 }, { id: "n1", tick: 500, pitch: 62 }, { id: "n2", tick: 900, pitch: 58 }, { id: "n3", tick: 1500, pitch: 65 },
  ] }]);
  assert.equal(original, null, "a short original line should not flag");
});

console.log(`PASS unit: ${passed} checks`);

// ---- calibration (decision 56): reproduces the confusion matrix that set --
// KNOWN_MELODY_THRESHOLD, deterministically, from two disjoint seeded sets. -

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h >>> 0; }

// Reconstructs concrete notes from a reference's interval/duration-ratio
// sequences (the inverse of ./similarity.ts's tokenize) - a seed pitch and a
// seed inter-onset gap are arbitrary, since the measure is invariant to both.
function reconstruct(melody, seedPitch = 60, seedIoi = 480) {
  const n = melody.intervals.length + 1;
  const pitches = [seedPitch];
  for (let i = 0; i < melody.intervals.length; i++) pitches.push(pitches[i] + melody.intervals[i]);
  const iois = [seedIoi];
  for (let i = 0; i < melody.durationRatios.length; i++) iois.push(iois[i] * melody.durationRatios[i]);
  const ticks = [0];
  for (let i = 0; i < iois.length; i++) ticks.push(ticks[i] + iois[i]);
  const notes = [];
  for (let i = 0; i < n; i++) notes.push({ tick: Math.round(ticks[i]), pitch: pitches[i] });
  return notes;
}
function transpose(notes, semitones) {
  return notes.map((n) => ({ tick: n.tick, pitch: n.pitch + semitones }));
}
function retime(notes, factor) {
  return notes.map((n) => ({ tick: Math.round(n.tick * factor), pitch: n.pitch }));
}
// "Lightly varied" per decision 3's exact language: change 1-2 interior
// notes by a semitone or two, and/or insert one ornament (a passing note)
// between two existing notes. Never touches the first/last note.
function vary(notes, rng, { changeCount = 1, insertOrnament = true } = {}) {
  let out = notes.map((n) => ({ ...n }));
  for (let c = 0; c < changeCount; c++) {
    const idx = 1 + Math.floor(rng() * (out.length - 2));
    const delta = (rng() < 0.5 ? -1 : 1) * (1 + Math.floor(rng() * 2));
    out[idx] = { ...out[idx], pitch: out[idx].pitch + delta };
  }
  if (insertOrnament && out.length > 3) {
    const idx = 1 + Math.floor(rng() * (out.length - 2));
    const a = out[idx], b = out[idx + 1];
    const midTick = Math.round((a.tick + b.tick) / 2);
    const ornamentPitch = a.pitch + (rng() < 0.5 ? 1 : -1) * (1 + Math.floor(rng() * 2));
    out = [...out.slice(0, idx + 1), { tick: midTick, pitch: ornamentPitch }, ...out.slice(idx + 1)];
  }
  return out;
}
function randomTune(rng, length) {
  const notes = [{ tick: 0, pitch: 60 + Math.floor(rng() * 12) }];
  let tick = 0;
  const durations = [120, 180, 240, 360, 480, 720];
  for (let i = 1; i < length; i++) {
    tick += durations[Math.floor(rng() * durations.length)];
    const step = Math.floor(rng() * 15) - 7;
    notes.push({ tick, pitch: notes[i - 1].pitch + step });
  }
  return notes;
}
// Embeds a (possibly varied) reference copy inside random surrounding
// material - a generation rarely IS the incipit start-to-end, it quotes one
// inside a longer part - and exercises bestMatch's windowed local search.
function embed(notes, rng, padBefore, padAfter) {
  const before = randomTune(rng, padBefore);
  const beforeEnd = before.length ? before[before.length - 1].tick + 480 : 0;
  const shifted = notes.map((n) => ({ tick: n.tick + beforeEnd, pitch: n.pitch }));
  const after = randomTune(rng, padAfter).map((n) => ({ tick: n.tick + shifted[shifted.length - 1].tick + 480, pitch: n.pitch }));
  return [...before, ...shifted, ...after];
}
function partsOf(notes) {
  return [{ id: "part-1", role: "lead", notes: notes.map((n, i) => ({ id: `n${i}`, tick: n.tick, endTick: n.tick + 1, pitch: n.pitch })) }];
}

// Two disjoint seed groups: seedBase 1 (calibration, used to pick the
// threshold) and seedBase 2 (held out, evaluated only afterward - see
// ./src/lib/composition/similarity.ts's KNOWN_MELODY_THRESHOLD doc comment).
function buildSet(seedBase) {
  const positives = [];
  for (const melody of KNOWN_MELODIES) {
    const rng = mulberry32(seedBase + hash(melody.id));
    for (let v = 0; v < 6; v++) {
      const semitones = Math.floor(rng() * 24) - 12;
      const tempo = 0.5 + rng() * 2;
      const base = retime(transpose(reconstruct(melody), semitones), tempo);
      const varied = vary(base, rng, { changeCount: 1 + (v % 2), insertOrnament: v % 3 !== 0 });
      const embedded = embed(varied, rng, 15 + Math.floor(rng() * 15), 15 + Math.floor(rng() * 15));
      positives.push({ id: `${melody.id}#${v}`, parts: partsOf(embedded) });
    }
  }
  const negatives = [];
  // The starter project's own lead line (src/create/starter.ts).
  const starterLead = [64, 67, 71, 74, 72, 67, 64, 62, 60, 64, 67, 72, 71, 67, 62, 59];
  const starterNotes = [];
  for (let i = 0; i < 64; i++) starterNotes.push({ tick: i * 480, pitch: starterLead[i % 16] });
  negatives.push({ id: "starter-project-lead", parts: partsOf(starterNotes) });
  // The generation benchmark's synthetic mock score (scripts/gen-bench.mjs).
  const benchMockLead = [];
  { const pitches = [60, 64, 67, 65]; let tick = 0; for (let i = 0; i < 40; i++, tick += 480) benchMockLead.push({ tick, pitch: pitches[i % 4] }); }
  negatives.push({ id: "gen-bench-mock-lead", parts: partsOf(benchMockLead) });
  // The composition test server's fixture score (test/composition-server.mjs).
  const fixtureLead = [];
  { const pitches = [72, 76, 79, 74]; let tick = 0; for (let i = 0; i < 19; i++, tick += 480) fixtureLead.push({ tick, pitch: pitches[i % 4] }); }
  negatives.push({ id: "composition-server-fixture-lead", parts: partsOf(fixtureLead) });
  for (let i = 0; i < 20; i++) {
    const rng = mulberry32(seedBase + 90000 + i);
    negatives.push({ id: `random-${i}`, parts: partsOf(randomTune(rng, 40 + Math.floor(rng() * 60))) });
  }
  return { positives, negatives };
}

function evaluate(set) {
  return {
    posScores: set.positives.map((p) => ({ id: p.id, similarity: knownMelodySimilarity(p.parts)?.similarity ?? 0 })),
    negScores: set.negatives.map((n) => ({ id: n.id, similarity: knownMelodySimilarity(n.parts)?.similarity ?? 0 })),
  };
}
function confusion(scores, threshold) {
  const tp = scores.posScores.filter((p) => p.similarity >= threshold).length;
  const fn = scores.posScores.length - tp;
  const fp = scores.negScores.filter((n) => n.similarity >= threshold).length;
  const tn = scores.negScores.length - fp;
  return { tp, fn, fp, tn };
}

const calibration = evaluate(buildSet(1));
const heldOut = evaluate(buildSet(2));

// The exact numbers recorded in decision 56 (DECISIONS.md) and in
// KNOWN_MELODY_THRESHOLD's doc comment. If a change to similarity.ts's
// algorithm or to known-melodies.ts's reference set moves these, decision 56
// and the doc comment need updating together with this test, not just this
// test alone - the number here is a record of what was decided, not an
// independent target to satisfy.
check("threshold (0.40) reproduces decision 56's calibration-set confusion matrix", () => {
  const c = confusion(calibration, KNOWN_MELODY_THRESHOLD);
  assert.deepEqual(c, { tp: 44, fn: 4, fp: 0, tn: 23 });
});
check("threshold (0.40) reproduces decision 56's held-out confusion matrix", () => {
  const c = confusion(heldOut, KNOWN_MELODY_THRESHOLD);
  assert.deepEqual(c, { tp: 45, fn: 3, fp: 0, tn: 23 });
});
check("zero false positives on repo-original and random negatives, both sets", () => {
  for (const { id, similarity } of [...calibration.negScores, ...heldOut.negScores])
    assert.ok(similarity < KNOWN_MELODY_THRESHOLD, `${id} should not flag as a known melody (similarity ${similarity})`);
});

console.log(
  `PASS calibration: threshold=${KNOWN_MELODY_THRESHOLD} ` +
  `calibration TP/FN/FP/TN=${JSON.stringify(confusion(calibration, KNOWN_MELODY_THRESHOLD))} ` +
  `held-out TP/FN/FP/TN=${JSON.stringify(confusion(heldOut, KNOWN_MELODY_THRESHOLD))}`,
);
