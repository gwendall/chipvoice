// A preparation prototype, not a realtime playback implementation.
import { build } from "../../../packages/chipvoice/node_modules/esbuild/lib/main.js";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
await mkdir("../../.artifacts/interaction-latency", { recursive: true });
await build({ entryPoints: ["scripts/interaction-preview-worker.ts"], outfile: "generated/profile-preview-worker.js", bundle: true, format: "iife", platform: "browser", logLevel: "silent" });
const browser = await chromium.launch();
const page = await browser.newPage();
try {
  await page.route("**/__latency-preview.js", (route) => route.fulfill({ path: "generated/profile-preview-worker.js", contentType: "application/javascript" }));
  await page.goto(process.env.SITE || "https://chipvoice.dev");
  const results = await page.evaluate(async () => {
    const response = await fetch("/arrangement-data/mario.json");
    if (!response.ok) throw Error("Source fixture unavailable");
    const score = await response.json();
    return new Promise((resolve, reject) => {
      const worker = new Worker("/__latency-preview.js");
      const timer = setTimeout(() => { worker.terminate(); reject(Error("Preview preparation timed out")); }, 30000);
      worker.onmessage = (e) => {
        clearTimeout(timer); worker.terminate();
        resolve(e.data);
      };
      worker.onerror = (e) => { clearTimeout(timer); worker.terminate(); reject(Error(e.message)); };
      worker.postMessage(score);
    });
  });
  await writeFile("../../.artifacts/interaction-latency/preview-proof.json", JSON.stringify(results, null, 2));
  console.log(results);
  assert.equal(results.length, 4, "Every visible console was measured");
  for (const result of results) assert.equal(result.maxError, 0, `${result.chip}: block boundaries changed PCM`);
} finally {
  await browser.close();
}
