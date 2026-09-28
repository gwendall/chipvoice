/**
 * Browser smoke test (Phase 1 acceptance: "home loads, 'jump' finds
 * results, play starts an AudioBufferSourceNode, the download's bytes
 * match the SHA-256, keyboard shortcuts work"), plus the player features
 * added in the PR review: preload on visibility (data-preload-state),
 * the sticky mini-player, the waveform's playhead (data-playhead-progress)
 * and the spam guard (data-active-voices never exceeds 1 per sound). One
 * flat script, playwright launched directly and closed in a `finally` -
 * mirrors apps/web's own test-*.mjs convention (see apps/web/test-arrival.mjs),
 * not a @playwright/test suite, so it needs no separate runner config.
 *
 * Assumes a server is already running at SITE (default
 * http://127.0.0.1:3020) with a built catalogue - CI/dev starts it, this
 * script only drives a browser against it.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chromium } from "playwright";

const SITE = process.env.SITE ?? "http://127.0.0.1:3020";

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ acceptDownloads: true });
  await context.addInitScript(() => {
    window.__audioStarted = false;
    const proto = window.AudioBufferSourceNode?.prototype;
    if (proto) {
      const start = proto.start;
      proto.start = function start_(...args) {
        window.__audioStarted = true;
        return start.apply(this, args);
      };
    }
  });
  const errors = [];
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));

  // Home loads.
  await page.goto(`${SITE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("h1");
  assert.match(await page.locator("h1").first().textContent(), /sound-effects bank/i);
  assert.ok(await page.locator('[data-testid="search-input"]').count(), "search input is present");

  // "jump" finds results, instantly (no navigation).
  await page.locator('[data-testid="search-input"]').fill("jump");
  await page.waitForSelector('[data-testid="search-results"] [data-testid="sound-row"]');
  const rowCount = await page.locator('[data-testid="search-results"] [data-testid="sound-row"]').count();
  assert.ok(rowCount > 0, "typing 'jump' returns at least one result");

  // Preload on visibility: the IntersectionObserver in SoundList preloads a
  // visible row without any click, observable as data-preload-state="ready"
  // (lib/player.tsx's decode cache actually filled, not just a UI flag).
  await page.waitForSelector('[data-testid="search-results"] [data-testid="sound-row"][data-preload-state="ready"]', { timeout: 5000 });

  // Play starts a real AudioBufferSourceNode, not just a UI state flip.
  await page.locator('[data-testid="search-results"] [data-testid="play-button"]').first().click();
  await page.waitForFunction(() => window.__audioStarted === true, undefined, { timeout: 5000 });
  await page.waitForSelector('[data-testid="search-results"] [data-testid="play-button"][data-playing="true"]');

  // A sticky mini-player names what is playing (title comes through as the
  // row's own sound id) and a playhead rides over its waveform, driven by
  // the AudioContext clock, not a UI flag.
  await page.waitForSelector('[data-testid="mini-player"][data-playing="true"]');
  const firstSoundId = await page.locator('[data-testid="search-results"] [data-testid="sound-row"]').first().getAttribute("data-sound-id");
  assert.equal(await page.locator('[data-testid="mini-player"]').getAttribute("data-sound-id"), firstSoundId, "the mini-player names the sound actually playing");
  assert.ok(await page.locator('[data-testid="mini-player-source"]').count(), "the mini-player shows a source link");
  // Some chipvoice sounds are very short (a UI tick can be ~30ms), so this
  // only asserts the playhead mechanism actually moved off zero at least
  // once while sounding - not that it is still sounding moments later,
  // which a short clip cannot promise.
  const playhead = page.locator('[data-testid="search-results"] [data-testid="sound-row"]').first().locator('[data-testid="waveform"]');
  await page.waitForFunction(
    (el) => el && parseFloat(el.getAttribute("data-playhead-progress") ?? "0") > 0,
    await playhead.elementHandle(),
    { timeout: 5000 },
  );

  // Spam guard: rapid-fire retriggering the SAME sound never stacks voices -
  // the mini-player's own data-active-voices count stays at 1, not growing
  // with every keypress (the exact bug this guard exists to fix).
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.locator('[data-testid="search-results"] [data-testid="sound-row"]').first().locator('[data-testid="play-button"]').click();
  for (let i = 0; i < 6; i++) {
    await page.locator('[data-testid="search-results"] [data-testid="sound-row"]').first().locator('[data-testid="play-button"]').click();
  }
  const activeVoices = Number(await page.locator('[data-testid="mini-player"]').getAttribute("data-active-voices"));
  assert.ok(activeVoices <= 1, `retriggering the same sound repeatedly must never stack voices (saw ${activeVoices} active)`);

  // The download's bytes match the catalogue's own recorded SHA-256.
  const soundId = await page.locator('[data-testid="search-results"] [data-testid="sound-row"]').first().getAttribute("data-sound-id");
  const soundResponse = await page.request.get(`${SITE}/api/v1/sounds/${soundId}`);
  assert.equal(soundResponse.status(), 200);
  const { sound } = await soundResponse.json();
  const variant = sound.variants[0];
  const fileResponse = await page.request.get(`${SITE}${variant.files.wav.url}`);
  assert.equal(fileResponse.status(), 200);
  const bytes = await fileResponse.body();
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  assert.equal(actualSha256, variant.files.wav.sha256, "the served .wav's bytes hash to its own recorded SHA-256 (per-file content addressing)");

  // Keyboard shortcuts: `/` focuses search, `j`/`k` move selection, `space`
  // plays the selected row, `d` downloads it.
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.keyboard.press("/");
  await page.waitForFunction(() => document.activeElement?.getAttribute("data-testid") === "search-input");

  // Move focus off the search field so `j`/`k`/`space`/`d` reach the list
  // (SoundList ignores them while a text field has focus, on purpose - see
  // src/components/SoundList.tsx).
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());

  const rows = page.locator('[data-testid="search-results"] [data-testid="sound-row"]');
  await assertSelected(rows, 0);
  await page.keyboard.press("j");
  await assertSelected(rows, 1);
  await page.keyboard.press("k");
  await assertSelected(rows, 0);

  await page.keyboard.press(" ");
  await page.waitForSelector('[data-testid="search-results"] [data-testid="sound-row"][data-selected="true"] [data-testid="play-button"][data-playing="true"]');

  const [download] = await Promise.all([page.waitForEvent("download"), page.keyboard.press("d")]);
  assert.match(download.url(), /\.zip$/);

  assert.deepEqual(errors, [], "no uncaught page errors");
  await context.close();
  console.log(
    `PASS: home loads, search finds ${rowCount} 'jump' result(s), play starts a real AudioBufferSourceNode, ` +
      `preload-on-visibility fills the decode cache, the mini-player and playhead track playback, the spam guard ` +
      `caps active voices at 1, download bytes match each file's own SHA-256, keyboard shortcuts (/ j k space d) work`,
  );
} finally {
  await browser.close();
}

async function assertSelected(rows, index) {
  await rows.nth(index).waitFor();
  const attrs = await rows.evaluateAll((elements) => elements.map((el) => el.getAttribute("data-selected")));
  assert.equal(attrs[index], "true", `row ${index} is selected`);
  assert.ok(
    attrs.every((value, i) => i === index || value === "false"),
    "exactly one row is selected",
  );
}
