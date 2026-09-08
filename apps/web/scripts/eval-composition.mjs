// Explicit, paid live evaluation. Uses a disposable local app/database; never production.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { build } from "../../../packages/chipvoice/node_modules/esbuild/lib/main.js";
import { chromium } from "playwright";
import { compositionServer } from "../test/composition-server.mjs";
try { process.loadEnvFile(".env.local"); } catch (error) { if (error.code !== "ENOENT") throw error; }
const fixture = process.argv[2] === "--fixture";
const args = process.argv.slice(fixture ? 3 : 2);
if (!fixture && !process.env.OPENAI_API_KEY) throw Error("Add OPENAI_API_KEY to apps/web/.env.local; the live test will not run without it");
const prompt = args[0] ?? "Compose an original 60-second space arcade theme with a memorable melody, answering phrases, a contrasting bridge and a resolved ending. Use four complementary parts: lead, arpeggiated harmony, bass and restrained percussion. Keep the melody clearly in front.";
const seconds = Number(args[1] ?? 60);
const target = args[2] ?? "md";
const out = `../../.artifacts/prompt-composition/${fixture ? "fixture" : "live"}-${Date.now()}`;
await mkdir(out, { recursive: true });
const server = await compositionServer({ live: !fixture });
Object.assign(process.env, server.env);
await build({ stdin: { contents: "export * from './src/lib/auth';export * from './src/lib/db';", resolveDir: process.cwd() }, outfile: "generated/eval-composition-auth.mjs", bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent" });
const auth = await import("../generated/eval-composition-auth.mjs");
try {
  const key = await auth.createKey("live-composition-eval@example.test", "temporary local evaluation");
  const headers = { Authorization: `Bearer ${key.key}`, "Content-Type": "application/json" };
  const response = await fetch(server.base + "/api/v1/generations", { method: "POST", headers: { ...headers, "Idempotency-Key": "single-live-composition" }, body: JSON.stringify({ prompt, target, durationSeconds: seconds }) });
  let result = await response.json();
  assert.equal(response.status, 202, JSON.stringify(result));
  let previous = "";
  for (let i = 0; i < 300 && !["ready", "failed", "cancelled"].includes(result.status); i++) {
    if (result.status !== previous) { console.log(`Composition: ${result.status}`); previous = result.status; }
    await new Promise(resolve => setTimeout(resolve, 2000));
    const poll = await fetch(server.base + `/api/v1/generations/${result.id}`, { headers });
    result = await poll.json();
    assert.equal(poll.status, 200, JSON.stringify(result));
  }
  await writeFile(`${out}/generation.json`, JSON.stringify(result, null, 2));
  assert.equal(result.status, "ready", result.error ?? "Composition did not finish");
  await writeFile(`${out}/project.json`, JSON.stringify(result.project.project, null, 2));
  const audio = {};
  for (const format of ["wav", "mp3"]) {
    const download = await fetch(`${server.base}/api/v1/jobs/${result.renderJobId}/audio?format=${format}`, { headers });
    assert.equal(download.status, 200);
    audio[format] = Buffer.from(await download.arrayBuffer());
    await writeFile(`${out}/song.${format}`, audio[format]);
  }
  const wav = audio.wav;
  const channels = wav.readUInt16LE(22), rate = wav.readUInt32LE(24), sampleCount = wav.readUInt32LE(40) / 2;
  let energy = 0, peak = 0, clippedSamples = 0;
  for (let i = 0; i < sampleCount; i++) {
    const sample = wav.readInt16LE(44 + i * 2) / 32768;
    energy += sample * sample; peak = Math.max(peak, Math.abs(sample));
    if (Math.abs(sample) >= 32767 / 32768) clippedSamples++;
  }
  const duration = sampleCount / channels / rate;
  assert.ok(Math.abs(duration - seconds) < 0.25);
  assert.ok(energy > 0); assert.equal(clippedSamples, 0);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const token = await auth.redeemMagicLink(await auth.createSignInLink("live-composition-eval@example.test"));
    await context.addCookies([{ name: auth.SESSION_COOKIE, value: token, url: server.base }]);
    const page = await context.newPage();
    await page.goto(`${server.base}/p/${result.projectId}`);
    await page.getByText("Composition prompt", { exact: true }).click();
    await page.getByText(prompt, { exact: true }).waitFor();
    const decoded = await page.evaluate(async base64 => {
      const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      const ctx = new AudioContext();
      try { const audio = await ctx.decodeAudioData(bytes.buffer); return { seconds: audio.duration, channels: audio.numberOfChannels }; } finally { await ctx.close(); }
    }, audio.mp3.toString("base64"));
    assert.ok(Math.abs(decoded.seconds - seconds) < 0.25);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `${out}/song-mobile.png`, fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: `${out}/song-desktop.png`, fullPage: true });
    const report = { provider: fixture ? "simulated HTTP fixture" : "live configured provider", model: result.model, title: result.project.title, seconds: duration, peak, rms: Math.sqrt(energy / sampleCount), clippedSamples, mp3: decoded, usage: result.usage, auditoryReview: "Not performed; full-duration signal measurements and MP3 decoding only", generationEvaluation: result.evaluation };
    await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ provider: report.provider, model: report.model, title: report.title, seconds: duration, peak, clippedSamples, artifacts: out }, null, 2));
  } finally { await browser.close(); }
} finally { await (await auth.db()).close(); await server.close(); }
