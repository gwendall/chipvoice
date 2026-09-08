import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { build } from "../../packages/chipvoice/node_modules/esbuild/lib/main.js";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { installOutputProbe, outputPhraseRms } from "./test/audio-probe.mjs";
const base = process.env.SITE ?? "http://127.0.0.1:3080";
assert.ok(
  /^http:\/\/(127\.0\.0\.1|localhost):/.test(base),
  "Disposable local targets only",
);
assert.ok(process.env.TURSO_DEV_DATABASE_URL, "Use the test server database");
const out = resolve("../../.artifacts/creation/e2e");
await mkdir(out, { recursive: true });
const file = resolve("generated/test-creation-fixture.mjs");
await build({
  stdin: {
    contents:
      "export * from './src/lib/auth';export * from './src/lib/db';export * from './src/create/starter';",
    resolveDir: process.cwd(),
  },
  outfile: file,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  logLevel: "silent",
});
const api = await import(pathToFileURL(file));
const token = await api.redeemMagicLink(
  await api.createSignInLink(`creator-${Date.now()}@example.test`),
);
const browser = await chromium.launch({
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  recordVideo: { dir: out, size: { width: 1280, height: 900 } },
});
await context.addCookies([
  { name: api.SESSION_COOKIE, value: token, url: base },
]);
await context.addInitScript(installOutputProbe);
const page = await context.newPage(),
  errors = [],
  evidence = {};
page.on("pageerror", (e) => errors.push(e.message));
const button = (name) => page.getByRole("button", { name, exact: true });
const waitNotice = (text) =>
  page.waitForFunction(
    (text) =>
      document.querySelector(".create-notice")?.textContent.includes(text),
    text,
    { timeout: 30000 },
  );
const source = () =>
  page.evaluate(
    () => JSON.parse(localStorage.getItem("chipvoice.project.v1")).source,
  );
try {
  await page.goto(`${base}/create`, {
    waitUntil: "networkidle",
    timeout: 120000,
  });
  await button("Play").click();
  await page.waitForFunction(
    () =>
      document
        .querySelector(".create-status")
        ?.textContent.includes("Your music stays local"),
    null,
    { timeout: 120000 },
  );
  evidence.rms = await outputPhraseRms(page);
  assert.ok(evidence.rms > 0.001);
  await button("Pause").waitFor();
  await page
    .getByRole("slider", { name: "Song position", exact: true })
    .fill("8");
  await page.waitForFunction(
    () => document.querySelector(".create-transport .song-time")?.textContent.includes("0:08"),
    null,
    { timeout: 10000 },
  );
  await page.getByRole("spinbutton").first().fill("160");
  await button("Pause").waitFor();
  await page.waitForFunction(
    () =>
      !document
        .querySelector(".create-status")
        ?.textContent.includes("Preparing"),
    null,
    { timeout: 120000 },
  );
  evidence.updatedRms = await outputPhraseRms(page);
  assert.ok(evidence.updatedRms > 0.001);
  await button("Pause").click();
  await button("Code").click();
  await button("JavaScript").click();
  await page.getByRole("spinbutton", { name: "Seed", exact: true }).fill("123");
  await button("Apply changes").click();
  await waitNotice("Applied");
  const generated = await source();
  await button("Apply changes").click();
  await button("Apply changes").waitFor();
  assert.deepEqual(await source(), generated);
  const archivedCode = await page
    .getByRole("textbox", { name: "JavaScript generator", exact: true })
    .inputValue();
  await page.reload({ waitUntil: "networkidle" });
  await button("Code").click();
  await button("JavaScript").click();
  assert.equal(
    await page
      .getByRole("textbox", { name: "JavaScript generator", exact: true })
      .inputValue(),
    archivedCode,
  );
  assert.equal(
    await page
      .getByRole("spinbutton", { name: "Seed", exact: true })
      .inputValue(),
    "123",
  );
  await page
    .getByRole("textbox", { name: "JavaScript generator", exact: true })
    .fill("while (true) {}");
  await button("Apply changes").click();
  await waitNotice("exceeded 2 seconds");
  assert.equal(await page.locator("iframe[sandbox]").count(), 0);
  assert.deepEqual(await source(), generated);
  await page
    .getByRole("textbox", { name: "JavaScript generator", exact: true })
    .fill("return parent.document.cookie;");
  await button("Apply changes").click();
  await button("Apply changes").waitFor();
  assert.deepEqual(await source(), generated);
  await button("Notes").click();
  await button("Repeat section").click();
  assert.ok(
    (await source()).performance.endTick > generated.performance.endTick,
  );
  await button("Undo").click();
  assert.equal(
    (await source()).performance.endTick,
    generated.performance.endTick,
  );
  const oldDraft = await page.evaluate(() =>
    localStorage.getItem("chipvoice.project.v1:active"),
  );
  if (process.env.CREATION_MIDI) {
    await page
      .locator("input[type=file]")
      .setInputFiles(process.env.CREATION_MIDI);
    await waitNotice("Imported locally");
    const imported = await source();
    assert.ok(imported.performance.parts.length > 1);
    evidence.midiParts = imported.performance.parts.length;
    evidence.midiNotes = imported.performance.parts.reduce(
      (sum, p) => sum + p.notes.length,
      0,
    );
    await page.screenshot({ path: `${out}/midi-import.png`, fullPage: true });
  }
  const short = api.starterProject();
  short.title = "E2E pocket orbit";
  short.source.performance.endTick = 1920;
  for (const p of short.source.performance.parts)
    p.notes = p.notes
      .filter((n) => n.tick < 1920)
      .map((n) => ({ ...n, endTick: Math.min(1920, n.endTick) }));
  await page.locator("input[type=file]").setInputFiles({
    name: "complete.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(short)),
  });
  await waitNotice("Imported locally");
  assert.equal(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)).generator.seed,
      oldDraft,
    ),
    123,
    "Import cannot overwrite the older named draft",
  );
  const pending = page.waitForEvent("download", { timeout: 120000 });
  await button("Download WAV").click();
  await (await pending).saveAs(`${out}/local.wav`);
  await button("Share").click();
  await button("Publish song").click();
  await page
    .getByRole("link", { name: "Open publication" })
    .waitFor({ timeout: 60000 });
  const href = await page
      .getByRole("link", { name: "Open publication" })
      .getAttribute("href"),
    id = href.split("/").pop();
  evidence.publication = href;
  let publication;
  for (let n = 0; n < 120; n++) {
    publication = await (
      await context.request.get(`${base}/api/v1/projects/${id}`)
    ).json();
    if (publication.renditions?.some((r) => r.status === "ready")) break;
    await page.waitForTimeout(500);
  }
  assert.ok(
    publication.renditions.some((r) => r.status === "ready"),
    JSON.stringify(publication.renditions),
  );
  assert.deepEqual(publication.project, short);
  const audio = await context.request.get(
    `${base}/api/v1/jobs/${publication.renditions[0].id}/audio`,
  );
  assert.equal(audio.status(), 200);
  evidence.pinnedBytes = (await audio.body()).length;
  await page.screenshot({ path: `${out}/desktop.png`, fullPage: true });
  const fresh = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    visitor = await fresh.newPage();
  await visitor.goto(`${base}${href}`, {
    waitUntil: "networkidle",
    timeout: 120000,
  });
  await visitor.getByRole("button",{name:"Play",exact:true}).waitFor();
  assert.equal(
    await visitor.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await visitor
    .getByRole("button", { name: "Open / remix this project" })
    .click();
  await visitor
    .getByRole("textbox", { name: "Song title", exact: true })
    .waitFor();
  assert.equal(
    await visitor
      .getByRole("textbox", { name: "Song title", exact: true })
      .inputValue(),
    short.title,
  );
  await visitor.screenshot({ path: `${out}/mobile.png`, fullPage: true });
  await visitor
    .getByRole("textbox", { name: "Song title", exact: true })
    .fill("Recovered remix");
  await visitor.waitForFunction(id=>JSON.parse(localStorage.getItem(`chipvoice.project.v1:${id}`)??"null")?.title==="Recovered remix",id);
  await visitor.reload({ waitUntil: "networkidle" });
  await visitor
    .getByRole("button", { name: "Open / remix this project" })
    .click();
  assert.equal(
    await visitor
      .getByRole("textbox", { name: "Song title", exact: true })
      .inputValue(),
    "Recovered remix",
  );
  await visitor.goto(`${base}/ja/create`, {
    waitUntil: "networkidle",
    timeout: 120000,
  });
  assert.equal(await visitor.locator("html").getAttribute("lang"), "ja");
  await visitor.screenshot({ path: `${out}/mobile-ja.png`, fullPage: true });
  for (const width of [320,390,768,1440]) {
    await visitor.setViewportSize({width,height:900});
    assert.equal(await visitor.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`workspace overflow at ${width}`);
    if(width===320||width===1440)await visitor.screenshot({path:`${out}/japanese-${width}.png`,fullPage:true});
  }
  await fresh.close();
  const r = await context.request.put(`${base}/api/v1/profile`, {
    data: {
      handle: `eval_${Date.now()}`,
      displayName: "Pocket pilot",
      bio: "Original miniature soundtracks",
    },
  });
  assert.equal(r.status(), 200);
  await page.goto(`${base}/explore`, {
    waitUntil: "networkidle",
    timeout: 120000,
  });
  await page.locator(".song-card").first().waitFor();
  await page.screenshot({ path: `${out}/explore.png`, fullPage: true });
  assert.equal(errors.length, 0, JSON.stringify(errors));
  console.log(
    "PASS audible creation, seek/update, seed, timeout/isolation, sections/undo, pinned publication, fresh browser and EN/JA mobile",
  );
} finally {
  evidence.errors = errors;
  await writeFile(
    `${out}/observations.json`,
    JSON.stringify(evidence, null, 2),
  );
  await context.close();
  await browser.close();
  (await api.db()).close();
}
