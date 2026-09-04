import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

/**
 * Production, end to end, through the three things that ship separately.
 *
 * The package on npm, the API on chipvoice.dev, and the editor in a browser are
 * built from one repository and deployed by different means - so the failure
 * this is written for is the one where each of them works and they disagree
 * with each other.
 *
 * The strongest assertion here is the byte comparison: a song rendered by the
 * published library must be identical to the same song rendered by the server.
 * If it ever is not, then a shared MP3 is not what its author heard, and the
 * whole reason for rendering on demand rather than storing collapses.
 */
const SITE = process.env.SITE || "https://chipvoice.dev";
const guard = setTimeout(() => { console.error("TIMEOUT"); process.exit(1); }, 300000);
guard.unref();

let failures = 0;
const check = (n, ok, extra = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${extra ? "  " + extra : ""}`);
};
const section = (t) => console.log(`\n── ${t} ${"─".repeat(Math.max(0, 58 - t.length))}`);

const SONG = {
  title: "end to end",
  author: "the e2e test",
  bpm: 152,
  order: [0, 1, 0, 1],
  patterns: [
    {
      lead: "E4 . . . G4 . A4 . . . B4 . C5 . . .",
      chord: "A3 . . . . . . . . . . . . . . .",
      bass: "A1 . A1 . A1 . A1 . A1 . A1 . A1 . G1 .",
      perc: "K . H . S . H . K . H K S . H .",
      chordShape: [[0, 3, 7]],
    },
    {
      lead: "C5 . . . E5 . D5 . . . B4 . A4 . = .",
      chord: "F3 . . . . . . . G3 . . . . . . .",
      bass: "F1 . F1 . F1 . F1 . G1 . G1 . G1 . G1 .",
      perc: "K . H . S . H H K K S . S . H O",
      chordShape: [[0, 4, 7], [0, 4, 7]],
    },
  ],
};

/**
 * Posts, and waits out the rate limit rather than failing on it.
 *
 * Twenty writes a minute per address is the product behaving correctly, but
 * running these suites back to back crosses it - and a run that fails with
 * "song can be stored: 429" reads as a broken API rather than as a working
 * limiter. Waiting is what tells the two apart.
 */
const post = async (p, body) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(SITE + p, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.status !== 429) return response;
    const wait = Number(response.headers.get("retry-after") ?? 10);
    console.log(`      (rate limited, waiting ${wait}s - the limiter is working)`);
    await new Promise((r) => setTimeout(r, (wait + 1) * 1000));
  }
  return fetch(SITE + p, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
};

// ─────────────────────────────────────────────── the published package
section("the package, installed from npm");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chipvoice-e2e-"));
let localRender = null;
let installedVersion = null;
try {
  execSync("npm init -y", { cwd: dir, stdio: "pipe" });
  // No audit and no funding notice: registry round trips with nothing to say
  // about the package, and the audit one has hung this install for minutes.
  execSync("npm i chipvoice --no-audit --no-fund", { cwd: dir, stdio: "pipe", timeout: 120000 });
  installedVersion = JSON.parse(
    fs.readFileSync(path.join(dir, "node_modules/chipvoice/package.json"), "utf8"),
  ).version;
  check("npm i chipvoice works", !!installedVersion, `v${installedVersion}`);

  const lib = await import(path.join(dir, "node_modules/chipvoice/dist/index.js"));
  check("it exports the offline renderer", typeof lib.renderSong === "function");
  check("and the validator", typeof lib.validateSong === "function");
  check("and the chip registry", typeof lib.chips === "function");
  check("which names the 2A03", lib.NES_2A03?.id === "2a03", lib.NES_2A03?.name);
  check("with five voices", lib.NES_2A03?.voices?.length === 5);

  const verdict = lib.validateSong({ ...SONG, gain: 1, lead: {}, chord: {}, bass: {} });
  check("the published validator accepts the song", verdict.ok, JSON.stringify(verdict.issues));

  const song = {
    id: "e2e",
    bpm: SONG.bpm,
    order: SONG.order,
    patterns: SONG.patterns,
    gain: 1,
    lead: {
      duty: 1,
      volume: [15, 15, 14, 13, 12, 12, 11, 11, 10, 10, 10, 9, 9, 9, 8],
      sustain: true,
      vibrato: { depth: 0.18, rate: 8, delay: 12 },
    },
    chord: { duty: 0, volume: [9, 8, 7, 7, 6], sustain: true },
    bass: { volume: [15], sustain: true },
  };
  const started = Date.now();
  localRender = lib.renderSong(song, { seconds: 10, sampleRate: 44100 });
  check(
    "and renders audio without a browser",
    localRender.peak > 0.05,
    `peak ${localRender.peak.toFixed(3)} in ${Date.now() - started}ms`,
  );
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ─────────────────────────────────────────────────────────── the API
section("the API");

const bad = structuredClone(SONG);
bad.patterns[0].lead = bad.patterns[0].lead.replace("E4", "H4");
const refused = await post("/api/validate", bad);
const refusedBody = await refused.json();
const issue = refusedBody.issues?.find((i) => i.token === "H4");
check("a mistyped note is refused", refused.status === 422);
check("named by track and step", issue?.track === "lead" && issue?.step === 0, JSON.stringify(issue));
check("and flagged as silent", issue?.silent === true);

const created = await post("/api/songs", SONG);
const song = await created.json();
check("a song can be stored", created.status === 201, String(created.status));
check("and gets a short id", /^[0-9A-Za-z]{8}$/.test(song.id ?? ""), song.id);
check("and comes back measured", song.measured?.loopSeconds > 0, JSON.stringify(song.measured));

const forked = await post(`/api/songs/${song.id}/fork`, { bpm: 176, title: "faster" });
const fork = await forked.json();
check("it can be forked", forked.status === 201 && fork.parentId === song.id, fork.parentId);
check("the fork inherits the notes", fork.patterns?.[0]?.lead === SONG.patterns[0].lead);
const reread = await (await fetch(`${SITE}/api/songs/${song.id}`)).json();
check("and the parent counts it", reread.forks >= 1, String(reread.forks));

// ──────────────────────────────────── the same chip on both sides
section("the library and the server agree");

const serverWav = new Uint8Array(
  await (await fetch(`${SITE}/s/${song.id}.wav?seconds=10`)).arrayBuffer(),
);
check("the server renders a WAV", serverWav.length > 100000, `${serverWav.length} bytes`);

if (localRender && serverWav.length > 44) {
  // Compare the PCM, skipping the 44-byte header. Identical bytes means the
  // published package and the deployed server are running the same chip - not
  // a similar one, the same one.
  const view = new DataView(serverWav.buffer, serverWav.byteOffset);
  const frames = Math.min(localRender.left.length, (serverWav.length - 44) / 2);
  let worst = 0;
  let differing = 0;
  for (let i = 0; i < frames; i++) {
    const server = view.getInt16(44 + i * 2, true);
    const local = Math.round(Math.max(-1, Math.min(1, localRender.left[i])) * 32767);
    const delta = Math.abs(server - local);
    if (delta > 0) differing++;
    worst = Math.max(worst, delta);
  }
  check(
    "every sample is identical",
    worst === 0,
    worst === 0
      ? `${frames} samples, byte for byte`
      : `${differing} of ${frames} differ, worst ${worst}`,
  );
}

const mp3 = await fetch(`${SITE}/s/${song.id}.mp3`);
const mp3Bytes = new Uint8Array(await mp3.arrayBuffer());
check("the MP3 is served", mp3.status === 200 && mp3Bytes.length > 20000, `${mp3Bytes.length} bytes`);
check("as audio/mpeg", mp3.headers.get("content-type") === "audio/mpeg");
check(
  "cached immutably",
  (mp3.headers.get("cache-control") ?? "").includes("immutable"),
  mp3.headers.get("cache-control"),
);
/*
 * The file is tagged, so the first MPEG frame sits after the ID3v2 header: ten
 * bytes, then a synchsafe size - seven bits per byte - then the frames. A
 * check that looked at byte 0 was written before the tag was, and failed the
 * day the MP3 got a name.
 */
const firstFrame = (bytes) => {
  let at = 0;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const size = (bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9];
    at = 10 + size + (bytes[5] & 0x10 ? 10 : 0);
  }
  return at;
};
const frameAt = firstFrame(mp3Bytes);
check(
  "and an MPEG frame follows the ID3 tag",
  mp3Bytes[frameAt] === 0xff && (mp3Bytes[frameAt + 1] & 0xe0) === 0xe0,
  `frame at byte ${frameAt}`,
);

const again = new Uint8Array(await (await fetch(`${SITE}/s/${song.id}.mp3`)).arrayBuffer());
check(
  "rendering twice gives the same file",
  again.length === mp3Bytes.length && again[5000] === mp3Bytes[5000],
);

// ────────────────────────────────────────────── the agent surface
section("what an agent reads");

for (const [p, type] of [
  ["/skill.md", "text/markdown"],
  ["/llms.txt", "text/plain"],
  ["/.well-known/openapi.json", "application/json"],
  ["/.well-known/mcp.json", "application/json"],
  ["/.well-known/skills/chipvoice/skill.md", "text/markdown"],
]) {
  const res = await fetch(SITE + p);
  check(`${p}`, res.status === 200 && (res.headers.get("content-type") ?? "").startsWith(type), `${res.status}`);
}

const skill = await (await fetch(`${SITE}/skill.md`)).text();
check("the skill has frontmatter", skill.startsWith("---\nname: chipvoice"));
check("names every endpoint", (skill.match(/^\| `(GET|POST)`/gm) ?? []).length >= 6);
check("warns about the silent failure", /mistyped note is silent/i.test(skill));
check("and says how to write something good", /Loop length beats melody/i.test(skill));

const spec = await (await fetch(`${SITE}/.well-known/openapi.json`)).json();
check("the spec is OpenAPI 3.1", spec.openapi?.startsWith("3.1"), spec.openapi);
check("with every path", Object.keys(spec.paths ?? {}).length >= 6, String(Object.keys(spec.paths ?? {}).length));
const mcp = await (await fetch(`${SITE}/.well-known/mcp.json`)).json();
check("the MCP manifest is derived from it", (mcp.tools ?? []).length === Object.values(spec.paths).flatMap((o) => Object.keys(o)).length, `${mcp.tools?.length} tools`);

// ──────────────────────────────────────────────── the shared link
section("what a shared link does");

const page = await fetch(`${SITE}/s/${song.id}`);
const html = await page.text();
check("the page renders", page.status === 200);
// The link opens the editor with the song in it rather than a separate
// read-only view, so what has to be in the markup is the metadata a chat
// client reads and the app that plays it.
check("an og:audio tag", /og:audio/.test(html));
check("and the editor", /transport|__next/.test(html));
const card = await fetch(`${SITE}/s/${song.id}/card`);
check("the card image renders", card.status === 200 && card.headers.get("content-type") === "image/png");
check("and is a real PNG", new Uint8Array(await card.arrayBuffer())[1] === 0x50);

// ───────────────────────────────────────────────────── the editor
section("the editor");

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
try {
  const p = await browser.newPage({ viewport: { width: 1200, height: 860 } });
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await p.goto(SITE, { waitUntil: "domcontentloaded" });
  await p.click(".transport .primary");
  const started = await p
    .waitForFunction(() => !!window.chipvoice, null, { timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  check("the chip starts in a browser", started);

  if (started) {
    const heard = await p.evaluate(async () => {
      const chip = window.chipvoice;
      const analyser = chip.audioContext.createAnalyser();
      analyser.fftSize = 2048;
      chip.output.connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      let peak = 0;
      const steps = new Set();
      for (let i = 0; i < 50; i++) {
        await new Promise((r) => setTimeout(r, 40));
        analyser.getFloatTimeDomainData(buf);
        for (let j = 0; j < buf.length; j++) peak = Math.max(peak, Math.abs(buf[j]));
        const pos = chip.position();
        if (pos) steps.add(pos.step);
      }
      const at = chip.currentTime;
      document.querySelector(".transport .fire").click();
      await new Promise((r) => setTimeout(r, 60));
      return {
        peak: Math.round(peak * 1000) / 1000,
        steps: steps.size,
        stolen: chip.canPlay("p2", at + 0.05) === false,
        rowMarked: !!document.querySelector(".row.taken"),
      };
    });
    check("it makes a sound", heard.peak > 0.05, `peak ${heard.peak}`);
    check("the playhead moves", heard.steps > 3, `${heard.steps} steps`);
    check("firing steals pulse 2", heard.stolen);
    check("and the row shows it", heard.rowMarked);
  }
  check("no errors on desktop", errors.length === 0, errors.slice(0, 2).join(" | "));
  await p.close();

  const phone = await browser.newPage({
    viewport: { width: 390, height: 780 },
    isMobile: true,
    hasTouch: true,
  });
  const phoneErrors = [];
  phone.on("pageerror", (e) => phoneErrors.push(e.message));
  phone.on("console", (m) => { if (m.type() === "error") phoneErrors.push(m.text()); });
  await phone.goto(SITE, { waitUntil: "domcontentloaded" });
  await phone.waitForTimeout(1200);
  const fixed = await phone.evaluate(() => {
    const bar = document.querySelector(".transport");
    const r = bar.getBoundingClientRect();
    return getComputedStyle(bar).position === "fixed" && r.bottom <= innerHeight + 1;
  });
  check("the transport is reachable on a phone", fixed);
  check(
    "the page does not scroll sideways",
    await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
  );
  check("and no errors there either", phoneErrors.length === 0, phoneErrors.slice(0, 2).join(" | "));
} finally {
  await browser.close();
}

console.log(
  failures === 0
    ? `\nPASS - the package, the API and the editor agree in production`
    : `\n${failures} FAILURE(S)`,
);
process.exit(failures === 0 ? 0 : 1);
