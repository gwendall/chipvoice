import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "../../chipvoice/node_modules/esbuild/lib/main.js";
import {
  audioRange,
  audioStream,
  createRenderCache,
  RenderBusy,
  id3,
  contentDisposition,
  encodeMp3,
} from "../dist/audio/index.js";

test("audioRange parses byte ranges, suffixes and bounds", () => {
  assert.deepEqual(audioRange("bytes=0-1", 100), { start: 0, end: 1 });
  assert.deepEqual(audioRange("bytes=-10", 100), { start: 90, end: 99 });
  assert.deepEqual(audioRange("bytes=90-", 100), { start: 90, end: 99 });
  assert.equal(audioRange("bytes=100-", 100), "unsatisfiable");
  assert.equal(audioRange("bytes=-0", 100), "unsatisfiable");
  assert.equal(audioRange("bytes=2-1", 100), "unsatisfiable");
  assert.equal(audioRange("bytes=0-1,4-5", 100), null, "multipart ranges fall back to a complete response");
  assert.equal(audioRange(null, 100), null);
});

test("audioStream reads bounded chunks and stops on cancellation", async () => {
  const source = Uint8Array.from({ length: 800000 }, (_, i) => i % 251);
  const calls = [];
  const read = async (chunk, offset, length) => {
    calls.push({ chunk, offset, length });
    return source.slice(chunk * 262144 + offset, chunk * 262144 + offset + length);
  };
  const response = new Response(audioStream(262140, 524300, read));
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), source.slice(262140, 524301));
  assert.equal(calls.length, 3);
  assert.equal(calls[0].length, 4);
  assert.equal(calls.at(-1).length, 13);

  calls.length = 0;
  const reader = audioStream(0, source.length - 1, read).getReader();
  await reader.read();
  await reader.cancel();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(calls.length, 1, "cancellation never fetches the rest of the asset");
});

test("createRenderCache shares in-flight renders and rejects a second key while one is busy", async () => {
  let time = 0,
    calls = 0,
    complete;
  const cache = createRenderCache({ maxBytes: 6, maxEntries: 2, ttl: 10, now: () => time });
  const first = cache("a", () => {
    calls++;
    return new Promise((resolve) => {
      complete = resolve;
    });
  });
  const second = cache("a", () => {
    throw new Error("must share the first render");
  });
  await assert.rejects(cache("b", async () => new Uint8Array(2)), RenderBusy);
  complete(new Uint8Array([1, 2, 3]));
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, b);
  assert.equal(calls, 1);
  assert.equal(await cache("a", () => { throw new Error("cache miss"); }), a);
});

test("createRenderCache evicts by byte/entry limits, age, and never caches a failure", async () => {
  let time = 0;
  const cache = createRenderCache({ maxBytes: 6, maxEntries: 2, ttl: 10, now: () => time });
  await cache("a", async () => new Uint8Array(3));
  await cache("b", async () => new Uint8Array([4, 5, 6]));
  await cache("c", async () => new Uint8Array([7, 8, 9]));
  let rebuilt = false;
  await cache("a", async () => { rebuilt = true; return new Uint8Array(3); });
  assert.ok(rebuilt, "entry limit evicted the oldest key");

  time = 20;
  rebuilt = false;
  await cache("a", async () => { rebuilt = true; return new Uint8Array(3); });
  assert.ok(rebuilt, "expired entries are not served");

  await assert.rejects(cache("failure", async () => { throw new Error("worker failed"); }), /worker failed/);
  assert.ok(await cache("after-failure", async () => new Uint8Array(1)), "a failed render does not keep the admission slot");

  let oversized = 0;
  for (let i = 0; i < 2; i++) await cache("oversized", async () => { oversized++; return new Uint8Array(7); });
  assert.equal(oversized, 2, "an entry too large to ever fit maxBytes is served but never cached");
});

test("id3 always writes title/artist and only writes optional frames when supplied", () => {
  const minimal = id3({ title: "Song", artist: "Someone" });
  assert.equal(minimal[0], 0x49);
  assert.equal(minimal[1], 0x44);
  assert.equal(minimal[2], 0x33);
  const text = Buffer.from(minimal).toString("latin1");
  assert.ok(text.includes("TIT2"));
  assert.ok(text.includes("TPE1"));
  assert.ok(!text.includes("TCON"), "no genre frame without a genre");
  assert.ok(!text.includes("TALB"));

  const full = id3({ title: "Song", artist: "Someone", album: "Album", year: "2026", genre: "Chiptune", comment: "hi", url: "https://example.com" });
  const fullText = Buffer.from(full).toString("latin1");
  for (const id of ["TIT2", "TPE1", "TALB", "TYER", "TCON", "COMM", "WOAS"]) assert.ok(fullText.includes(id), `missing ${id}`);
});

test("contentDisposition falls back to the supplied name and encodes both ASCII and unicode forms", () => {
  const named = contentDisposition("My Song", "abc123", "mp3", "chipvoice");
  assert.match(named, /filename="My Song\.mp3"/);
  assert.match(named, /filename\*=UTF-8''My%20Song\.mp3/);

  const fallback = contentDisposition(null, "abc123", "mp3", "chipvoice");
  assert.match(fallback, /filename="chipvoice abc123\.mp3"/);

  const defaulted = contentDisposition(null, "abc123", "mp3");
  assert.match(defaulted, /filename="audio abc123\.mp3"/, "the generic default name is \"audio\", distinct from any app's own fallback");
});

test("id3/contentDisposition are byte-identical to chipvoice's pre-move implementation, called with its exact tags", async () => {
  // Oracle: apps/web/src/lib/id3.ts as it stood at commit 287eff5, the last
  // commit before this file moved here and its genre/fallback name became
  // parameters instead of chipvoice's own hardcoded "Chiptune"/"chipvoice".
  // The requirement being proved is "unchanged", so the pre-move
  // implementation is the right oracle, not a hand-written re-guess of what
  // it used to do. Frozen verbatim (unmodified) at
  // test/fixtures/id3-287eff5.ts, extracted with
  // `git show 287eff5:apps/web/src/lib/id3.ts`, and executed as-is here.
  const fixture = fileURLToPath(new URL("./fixtures/id3-287eff5.ts", import.meta.url));
  const built = await build({ entryPoints: [fixture], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent" });
  const oracle = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);

  // The full field set apps/web/src/app/api/audio/[id]/[format]/route.ts
  // actually sends: title, artist, album "chipvoice", year, genre
  // "Chiptune", comment and url, so every optional frame is exercised.
  const tags = {
    title: "My Song",
    artist: "Someone",
    album: "chipvoice",
    year: "2026",
    comment: "Written on an emulated snes sound chip. https://chipvoice.dev/s/abc123",
    url: "https://chipvoice.dev/s/abc123",
  };
  assert.deepEqual(id3({ ...tags, genre: "Chiptune" }), oracle.id3(tags));

  assert.equal(
    contentDisposition("My Song", "abc123", "mp3", "chipvoice"),
    oracle.contentDisposition("My Song", "abc123", "mp3"),
  );
  assert.equal(
    contentDisposition(null, "abc123", "mp3", "chipvoice"),
    oracle.contentDisposition(null, "abc123", "mp3"),
    "a null title's fallback name, passed explicitly here, matches the oracle's hardcoded \"chipvoice\"",
  );
});

test("encodeMp3 produces a non-empty frame stream with an ID3 header up front when tags are supplied", () => {
  const samples = new Float32Array(4608);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i / 20) * 0.5;
  const bytes = encodeMp3(samples, 44100, { title: "Song", artist: "Someone" });
  assert.ok(bytes.length > 10);
  assert.equal(bytes[0], 0x49);
  assert.equal(bytes[1], 0x44);
  assert.equal(bytes[2], 0x33);

  const untagged = encodeMp3(samples, 44100);
  assert.ok(untagged.length > 0);
  assert.notEqual(untagged[0], 0x49, "no tags means no ID3 header");
});
