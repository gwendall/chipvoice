import { test } from "node:test";
import assert from "node:assert/strict";
import { bestOfN } from "../dist/render/bestOfN.js";
import { recipeForPreset } from "../dist/presets/index.js";

// bestOfN's own doc comment promises determinism: for a fixed base recipe
// and seeds list, the winner and every candidate's scores are always the
// same. These tests hold it to that, plus check the two things that could
// silently break it: seeds must be consumed in the order given (not
// resorted or redrawn), and the external-score blend must use the stated
// default weight (0.6) when no explicit weight is passed.

const baseRecipe = recipeForPreset("ui-click", 1, 48000);

test("bestOfN is deterministic: same recipe + seeds -> identical winner and scores every run", async () => {
  const seeds = [1, 2, 3, 4, 5];
  const a = await bestOfN(baseRecipe, { seeds });
  const b = await bestOfN(baseRecipe, { seeds });

  assert.equal(a.best.seed, b.best.seed);
  assert.equal(a.best.totalScore, b.best.totalScore);
  assert.equal(a.candidates.length, b.candidates.length);
  for (let i = 0; i < a.candidates.length; i++) {
    assert.equal(a.candidates[i].seed, b.candidates[i].seed);
    assert.equal(a.candidates[i].signalScore, b.candidates[i].signalScore);
    assert.equal(a.candidates[i].totalScore, b.candidates[i].totalScore);
    // The PCM itself must also match: bestOfN renders through the same
    // deterministic renderRecipe() every named preset already relies on.
    assert.deepEqual(Array.from(a.candidates[i].rendered.left), Array.from(b.candidates[i].rendered.left));
  }
});

test("bestOfN consumes seeds in the given order, not sorted or deduplicated", async () => {
  const seeds = [5, 1, 5, 3];
  const result = await bestOfN(baseRecipe, { seeds });
  assert.deepEqual(result.candidates.map((c) => c.seed), seeds);
});

test("bestOfN without an external scorer: totalScore equals the signal-check score, and picks the highest", async () => {
  const seeds = [1, 2, 3];
  const result = await bestOfN(baseRecipe, { seeds });
  for (const c of result.candidates) {
    assert.equal(c.externalScore, undefined);
    assert.equal(c.totalScore, c.signalScore);
    assert.ok(c.totalScore >= 0 && c.totalScore <= 1);
  }
  const maxScore = Math.max(...result.candidates.map((c) => c.totalScore));
  assert.equal(result.best.totalScore, maxScore);
  assert.equal(result.best, result.candidates.find((c) => c.totalScore === maxScore));
});

test("bestOfN blends an external score at the default 0.6 weight, and picks it up even when it disagrees with the signal score", async () => {
  const seeds = [1, 2, 3];
  // A synthetic external scorer that strongly prefers seed 2, regardless of
  // that candidate's own signal-check score - proves the external score
  // actually moves the winner, not just rides along. Reads the seed back
  // off the rendered candidate's own recipe rather than a call counter, so
  // it stays correct even if bestOfN's call order ever changes.
  const externalBySeed = { 1: 0.1, 2: 0.95, 3: 0.2 };
  let calls = 0;
  const result = await bestOfN(baseRecipe, {
    seeds,
    score: (rendered) => { calls++; return externalBySeed[rendered.recipe.seed] ?? 0; },
  });

  assert.equal(calls, 3, "score() should be called exactly once per candidate");
  assert.equal(result.best.seed, 2);
  for (const c of result.candidates) {
    const expectedTotal = 0.4 * c.signalScore + 0.6 * c.externalScore;
    assert.ok(Math.abs(c.totalScore - expectedTotal) < 1e-12, `seed ${c.seed}: totalScore should use the default 0.6 external weight`);
  }
});

test("bestOfN honors an explicit externalWeight, and accepts an async scorer", async () => {
  const seeds = [1, 2];
  const result = await bestOfN(baseRecipe, {
    seeds,
    externalWeight: 1,
    score: async (rendered) => {
      await Promise.resolve();
      return rendered.durationSeconds > 0 ? 0.3 : 0;
    },
  });
  for (const c of result.candidates) {
    assert.equal(c.externalScore, 0.3);
    assert.equal(c.totalScore, 0.3, "externalWeight: 1 should make totalScore equal the external score alone");
  }
});

test("bestOfN: negative case, a deliberately silent low-level graph recipe scores 0 via the real signal-check path (not a stub)", async () => {
  const silentGraphRecipe = {
    engine: "sfx-engine@1",
    model: "graph",
    params: {
      duration: 0.2,
      nodes: [{ id: "zero", type: "const", params: { value: 0 } }],
      output: "zero",
    },
    seed: 1,
    sampleRate: 48000,
  };
  const result = await bestOfN(silentGraphRecipe, { seeds: [1, 2] });
  for (const c of result.candidates) {
    assert.equal(c.totalScore, 0, "a silent render should score 0 via scoreReport's isSilent penalty");
  }
  assert.equal(result.best.totalScore, 0);
});
