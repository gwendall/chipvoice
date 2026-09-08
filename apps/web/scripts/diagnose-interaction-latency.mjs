// Read-only browser diagnostic: listening and disposable local drafts only.
// SITE defaults to production. MODE selects landing, live, create or lab.
// ENFORCE_WARM=1 enables the deliberately failing warm-selection budget.
// AudioBufferSource.start is scheduling time, not sound measured at a speaker.
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
const mode = process.env.MODE || "landing";
if (!["landing", "live", "create", "lab"].includes(mode)) throw Error("MODE must be landing, live, create or lab");
const out = new URL(`../../../.artifacts/interaction-latency/${mode}/`, import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1e3 } });
const results = [];
await page.addInitScript(() => {
  window.probes = [];
  window.starts = 0;
  const log = (kind, data = {}) => window.probes.push({ kind, t: performance.now(), ...data });
  document.addEventListener("click", (e) => log("click", { label: e.target.closest("button")?.getAttribute("aria-label") || e.target.textContent?.slice(0, 70) }), true);
  document.addEventListener("input", (e) => log("input", { label: e.target.getAttribute("aria-label"), value: e.target.value }), true);
  const decode = AudioContext.prototype.decodeAudioData;
  AudioContext.prototype.decodeAudioData = function(...args) {
    const at = performance.now();
    log("decode-start", { bytes: args[0].byteLength });
    return decode.apply(this, args).then((b) => {
      log("decode-end", { ms: performance.now() - at, seconds: b.duration });
      return b;
    });
  };
  const groups = new WeakSet();
  const create = AudioContext.prototype.createBufferSource;
  AudioContext.prototype.createBufferSource = function() {
    const source = create.call(this), start = source.start.bind(source), context = this;
    let group;
    const connect = source.connect.bind(source);
    source.connect = (...args) => { group = args[0]; return connect(...args); };
    source.start = (at = 0, ...args) => {
      // Streaming schedules many chunks into one group. Only a new group is
      // a selection, so old ahead-rendering cannot satisfy an edit trial.
      if (group && groups.has(group)) return start(at, ...args);
      if (group) groups.add(group);
      window.starts++;
      log("audio-start", { at, contextTime: context.currentTime, scheduleMs: (at - context.currentTime) * 1e3, outputLatency: context.outputLatency, seconds: source.buffer?.duration });
      return start(at, ...args);
    };
    return source;
  };
  const fetch0 = window.fetch;
  window.fetch = async (...args) => {
    const url = String(args[0]), at = performance.now();
    log("fetch-start", { url });
    try {
      const r = await fetch0(...args);
      log("fetch-headers", { url, ms: performance.now() - at, status: r.status });
      return r;
    } catch (e) {
      log("fetch-error", { url });
      throw e;
    }
  };
  const Worker0 = window.Worker;
  window.Worker = class extends Worker0 {
    constructor(...args) {
      super(...args);
      log("worker-create", { url: String(args[0]) });
      this.addEventListener("message", (e) => log("worker-message", { type: e.data?.type, progress: e.data?.progress }));
    }
    postMessage(...args) {
      log("worker-post", { type: args[0]?.type });
      return super.postMessage(...args);
    }
    terminate() {
      log("worker-terminate");
      return super.terminate();
    }
  };
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) log("longtask", { duration: e.duration });
  }).observe({ type: "longtask", buffered: true });
});
try {
  await page.goto((process.env.SITE || "https://chipvoice.dev") + (mode === "live" ? "/?mode=compose" : mode === "create" ? "/create" : mode === "lab" ? "/lab" : ""));
  await page.getByRole("button", { name: "Play", exact: true }).waitFor();
  async function trial(label, act) {
    await page.evaluate(() => {
      window.probes = [];
      window.baselineStarts = window.starts;
      window.baselineChip = window.chipvoice;
      window.trialAt = performance.now();
    });
    await act();
    let timeout = false;
    try {
      await page.waitForFunction(() => window.starts > window.baselineStarts || window.chipvoice && window.chipvoice !== window.baselineChip, {}, { timeout: 9e4 });
    } catch {
      timeout = true;
    }
    const readyMs = await page.evaluate(() => performance.now() - window.trialAt);
    await page.waitForTimeout(250);
    const result = await page.evaluate(() => ({ probes: window.probes, resources: performance.getEntriesByType("resource").filter((e) => e.startTime > window.trialAt).map((e) => ({ url: e.name, ms: e.duration, bytes: e.transferSize })), text: document.querySelector(".arrangement-status")?.textContent }));
    const trigger = result.probes.find((e) => e.kind === "click" || e.kind === "input"), start = result.probes.find((e) => e.kind === "audio-start");
    results.push({ label, timeout, readyMs, latencyMs: start && trigger ? Math.round(start.t - trigger.t) : null, ...result });
    console.log(label, results.at(-1).latencyMs ?? Math.round(readyMs), timeout ? "TIMEOUT" : "");
    await writeFile(new URL("measurements.json", out), JSON.stringify(results, null, 2));
  }
  if (mode === "live") {
    await trial("live first play", () => page.getByRole("button", { name: "Play", exact: true }).click());
    await trial("live tempo 160", () => page.getByRole("spinbutton", { name: "Tempo", exact: true }).fill("160"));
    await trial("live Game Boy", () => page.getByRole("button", { name: "Game Boy", exact: true }).click());
    await page.getByRole("button", { name: "Share your tune", exact: false }).click();
    await page.evaluate(() => {
      window.probes = [];
      window.baselineChip = window.chipvoice;
    });
    await page.getByLabel("Song title", { exact: true }).fill("Latency audit local draft");
    await page.waitForTimeout(600);
    results.push({ label: "rename only", engineReplaced: await page.evaluate(() => window.chipvoice !== window.baselineChip), probes: await page.evaluate(() => window.probes) });
  } else if (mode === "create") {
    await trial("composer first play", () => page.getByRole("button", { name: "Play", exact: true }).click());
    await trial("composer tempo 160", () => page.getByRole("spinbutton", { name: "Tempo", exact: true }).fill("160"));
    await trial("composer transpose", () => page.getByRole("spinbutton", { name: "Transpose", exact: true }).fill("2"));
    await trial("composer part level", () => page.getByRole("spinbutton", { name: "Part level", exact: true }).fill("-6"));
    await trial("composer Game Boy", () => page.getByRole("button", { name: "Game Boy", exact: true }).click());
    await page.evaluate(() => {
      window.probes = [];
      window.baselineStarts = window.starts;
    });
    await page.getByLabel("Song title", { exact: true }).fill("Latency audit local draft");
    await page.waitForTimeout(600);
    results.push({ label: "rename only", audioRestarted: await page.evaluate(() => window.starts > window.baselineStarts), probes: await page.evaluate(() => window.probes) });
  } else if (mode === "lab") {
    await trial("lab first play", () => page.getByRole("button", { name: "Play", exact: true }).click());
    await trial("lab Game Boy cold", () => page.getByRole("button", { name: "Game Boy", exact: true }).click());
    await trial("lab Super Famicom warm", () => page.getByRole("button", { name: "Super Famicom", exact: true }).click());
  } else {
    await trial("first play", () => page.getByRole("button", { name: "Play", exact: true }).click());
    await trial("Game Boy cold", () => page.getByRole("button", { name: "Game Boy", exact: true }).click());
    await trial("Famicom warm", () => page.getByRole("button", { name: "Famicom", exact: true }).click());
    await trial("Game Boy warm", () => page.getByRole("button", { name: "Game Boy", exact: true }).click());
    if (process.env.WARM_ONLY !== "1") {
      await trial("tempo 125", () => page.getByRole("spinbutton", { name: "Tempo", exact: true }).fill("125"));
      await trial("Zelda cold", () => page.getByRole("button", { name: "Zelda 4 parts", exact: true }).click());
      await trial("Sonic cold", () => page.getByRole("button", { name: "Sonic 8 parts", exact: true }).click());
      await trial("Zelda warm", () => page.getByRole("button", { name: "Zelda 4 parts", exact: true }).click());
    }
  }
  await page.screenshot({ path: new URL("end.png", out).pathname, fullPage: true });
  await writeFile(new URL("measurements.json", out), JSON.stringify(results, null, 2));
  if (results.some((result) => result.timeout)) throw Error("An interaction did not complete; see measurements.json");
  if (process.env.ENFORCE_WARM === "1" && mode === "landing" && results.some((result) => result.label.endsWith("warm") && (result.latencyMs === null || result.latencyMs >= 100))) throw Error("Warm selection exceeds the 100 ms application budget");
} finally {
  await browser.close();
}
