// Decision 56 (NEXT-21): unit tests for the two prompt-side screens -
// moderation.ts's moderatePrompt (the free OpenAI Moderation API call) and
// knownWorkInPrompt (the denylist check). No live Next server, no database
// (this module's DB-adjacent imports are lazy - see ./src/lib/db.ts - and
// are never called here) and no network: `fetch` is monkey-patched with a
// local mock for the duration of this process only. This is the mock the
// ticket's decision 5 asks for; the real pipeline wiring through jobs.ts is
// additionally exercised end to end in test-generation.mjs.
import assert from "node:assert/strict";
import { build } from "../../packages/chipvoice/node_modules/esbuild/lib/main.js";

process.env.OPENAI_API_KEY = "test-not-a-real-key";
process.env.OPENAI_BASE_URL = "https://mock.invalid/v1/";

await build({
  stdin: { contents: "export * from './src/lib/composition/moderation';", resolveDir: process.cwd() },
  outfile: "generated/test-moderation.mjs",
  bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent",
});
const { moderatePrompt, knownWorkInPrompt, MODERATION_MODEL } = await import("./generated/test-moderation.mjs");

let passed = 0;
function check(name, fn) { fn(); passed++; }

// ---- knownWorkInPrompt: no network, denylist match -------------------------

check("knownWorkInPrompt matches a denylisted name as a whole word/phrase", () => {
  assert.equal(knownWorkInPrompt("a chiptune tribute to Mario"), "mario");
  assert.equal(knownWorkInPrompt("music inspired by THE LEGEND OF ZELDA"), "zelda");
  assert.equal(knownWorkInPrompt("something in the style of John Williams"), "john williams");
});
check("knownWorkInPrompt does not match a substring that only contains a denylisted word", () => {
  assert.equal(knownWorkInPrompt("a contrasting, energetic piece"), null); // "contra" must not match "contrasting"
});
check("knownWorkInPrompt clears an ordinary original prompt", () => {
  assert.equal(knownWorkInPrompt("An upbeat 16-bit adventure theme with a driving bassline"), null);
});

// ---- moderatePrompt: mocked fetch, three outcomes --------------------------

const originalFetch = globalThis.fetch;
function mockFetch(handler) { globalThis.fetch = handler; }
function restoreFetch() { globalThis.fetch = originalFetch; }

// `check` above is synchronous; moderatePrompt is async, so these get their
// own tiny runner rather than complicating `check` with promise handling.
let asyncPassed = 0;
async function asyncCheck(name, fn) { await fn(); asyncPassed++; }

await asyncCheck("moderatePrompt sends the configured credential, model and prompt", async () => {
  let seen;
  mockFetch(async (url, init) => {
    seen = { url: String(url), init };
    return new Response(JSON.stringify({ id: "modr-1", model: MODERATION_MODEL, results: [{ flagged: false, categories: {} }] }), { status: 200 });
  });
  try {
    const outcome = await moderatePrompt("an ordinary prompt");
    assert.equal(seen.url, "https://mock.invalid/v1/moderations");
    assert.equal(seen.init.headers.Authorization, "Bearer test-not-a-real-key");
    assert.equal(JSON.parse(seen.init.body).model, MODERATION_MODEL);
    assert.equal(JSON.parse(seen.init.body).input, "an ordinary prompt");
    assert.deepEqual(outcome, { flagged: false, categories: [], model: MODERATION_MODEL });
  } finally { restoreFetch(); }
});

await asyncCheck("moderatePrompt keeps only flagged category names, never scores", async () => {
  mockFetch(async () => new Response(JSON.stringify({
    id: "modr-2", model: MODERATION_MODEL,
    results: [{ flagged: true, categories: { violence: true, hate: false, "self-harm": true }, category_scores: { violence: 0.91, hate: 0.01, "self-harm": 0.62 } }],
  }), { status: 200 }));
  try {
    const outcome = await moderatePrompt("something flagged");
    assert.equal(outcome.flagged, true);
    assert.deepEqual(new Set(outcome.categories), new Set(["violence", "self-harm"]));
    assert.ok(!JSON.stringify(outcome).includes("0.91"), "scores are never kept, only category names");
  } finally { restoreFetch(); }
});

await asyncCheck("moderatePrompt fails closed (retryable, never generates unchecked) on a non-2xx response", async () => {
  mockFetch(async () => new Response(JSON.stringify({ error: "DO_NOT_LEAK_PROVIDER_BODY" }), { status: 500 }));
  try {
    await assert.rejects(() => moderatePrompt("anything"), (error) => {
      assert.equal(error.status, 503);
      assert.equal(error.code, "moderation_unavailable");
      assert.ok(!error.message.includes("DO_NOT_LEAK_PROVIDER_BODY"));
      return true;
    });
  } finally { restoreFetch(); }
});

await asyncCheck("moderatePrompt fails closed on a network error", async () => {
  mockFetch(async () => { throw new Error("ECONNREFUSED"); });
  try {
    await assert.rejects(() => moderatePrompt("anything"), (error) => {
      assert.equal(error.status, 503);
      assert.equal(error.code, "moderation_unavailable");
      return true;
    });
  } finally { restoreFetch(); }
});

await asyncCheck("moderatePrompt fails closed on a malformed body (no results, or flagged not boolean)", async () => {
  mockFetch(async () => new Response(JSON.stringify({ id: "modr-3" }), { status: 200 }));
  try {
    await assert.rejects(() => moderatePrompt("anything"), (error) => error.code === "moderation_unavailable");
  } finally { restoreFetch(); }
});

await asyncCheck("moderatePrompt propagates an external abort rather than reporting moderation_unavailable", async () => {
  mockFetch(async (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  }));
  const controller = new AbortController();
  try {
    const pending = moderatePrompt("anything", controller.signal);
    controller.abort();
    await assert.rejects(() => pending, (error) => error.name === "AbortError" || /abort/i.test(error.message));
  } finally { restoreFetch(); }
});

console.log(`PASS unit: ${passed} sync checks, ${asyncPassed} async checks`);
