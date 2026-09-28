import { test } from "node:test";
import assert from "node:assert/strict";
import { secret, hashKey, newId } from "../dist/crypto/index.js";

test("secret() returns the requested number of bytes as lowercase hex", () => {
  const value = secret(24);
  assert.equal(value.length, 48);
  assert.match(value, /^[0-9a-f]+$/);
  assert.notEqual(value, secret(24), "two calls must not collide in practice");
});

test("hashKey() is a deterministic, unsalted sha256 of the input", async () => {
  const a = await hashKey("cv_agent_example"),
    b = await hashKey("cv_agent_example");
  assert.equal(a, b);
  assert.equal(a.length, 64);
  assert.match(a, /^[0-9a-f]{64}$/);
  const c = await hashKey("cv_agent_different");
  assert.notEqual(a, c);
});

test("newId() is eight characters drawn only from chipvoice's own alphabet", () => {
  // The exact alphabet chipvoice's original crypto.ts uses: base62 minus
  // lowercase l, uppercase I and uppercase O (digit 1 stays in the digit
  // run). Asserting against this literal alphabet, not a guess at "every
  // lookalike glyph", is what keeps this test honest about the behavior
  // actually being preserved rather than the behavior the doc comment wishes
  // for.
  const alphabet = "0123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const id = newId();
    assert.equal(id.length, 8);
    for (const ch of id) assert.ok(alphabet.includes(ch), `unexpected character ${ch}`);
    assert.doesNotMatch(id, /[lIO]/, "the excluded lookalike glyphs must never appear");
    seen.add(id);
  }
  // Negative gate: this would fail if newId() degenerated into a constant or
  // a tiny cycle instead of drawing from the full alphabet.
  assert.ok(seen.size > 490, "500 draws must not collide more than a handful of times");
});
