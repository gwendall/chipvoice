import { chromium } from "playwright";
import { installOutputProbe, outputPhraseRms } from "./test/audio-probe.mjs";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  writeFile,
  symlink,
  mkdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { build } from "../../packages/chipvoice/node_modules/esbuild/lib/main.js";
import {
  renderProject,
  toWav,
  projectCapabilities,
  getChip,
  validateProject,
} from "chipvoice";
import { buildAgentCatalog } from "./scripts/agent-catalog.mjs";
const base = process.env.SITE;
assert.ok(
  /^http:\/\/(127\.0\.0\.1|localhost):/.test(base),
  "Disposable local target only",
);
assert.ok(process.env.TURSO_DEV_DATABASE_URL, "Disposable database required");
const directory = await mkdtemp(join(tmpdir(), "chipvoice-agent-"));
const out = resolve("../../.artifacts/agent-guide");
await mkdir(out, { recursive: true });
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = async (path, options = {}) => {
  const response = await fetch(base + path, options);
  const body = await response.json();
  return { status: response.status, body };
};
const post = (body, headers = {}) => ({
  method: "POST",
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify(body),
});
const observations = [];
try {
  const skill = await (await fetch(base + "/skill.md")).text();
  const llms = await (await fetch(base + "/llms.txt")).text();
  const capabilities = (await json("/api/v1/capabilities")).body;
  assert.deepEqual(
    capabilities,
    buildAgentCatalog(),
    "published capabilities come from engine",
  );
  assert.ok(llms.indexOf("MusicProject") < llms.indexOf("tracker"));
  assert.ok(skill.includes("raw project"));
  assert.ok(skill.includes("mistyped note is silent"));
  assert.deepEqual(
    capabilities.targets.map((t) => t.id),
    projectCapabilities().map((t) => t.id),
  );
  // The discovery builder has no fixed target count or independent machine list.
  const existing = projectCapabilities(),
    extra = { ...existing[0], id: "future-fixture" };
  const expanded = buildAgentCatalog([...existing, extra], (id) =>
    getChip(id === "future-fixture" ? existing[0].id : id),
  );
  assert.equal(expanded.targets.at(-1).id, "future-fixture");
  assert.equal(expanded.targets.length, existing.length + 1);
  const manifest = (await json("/.well-known/mcp.json")).body;
  assert.equal(manifest.transport, "http-discovery");
  const validateTool = manifest.tools.find((t) => t.name === "validateProject");
  const publishTool = manifest.tools.find((t) => t.name === "publishProject");
  assert.deepEqual(
    validateTool.inputSchema.properties.body,
    capabilities.projectSchema,
  );
  assert.ok(
    publishTool.inputSchema.properties.headers.required.includes(
      "Idempotency-Key",
    ),
  );
  assert.ok(
    publishTool.inputSchema.properties.body.required.includes("project"),
  );
  assert.ok(publishTool.security.length > 0);
  for (const name of ["listKeys", "revokeKey", "listMySongs", "deleteSong"])
    assert.ok(
      manifest.tools.find((tool) => tool.name === name).security.length > 0,
      name + " authentication",
    );
  function checkReferences(value) {
    if (!value || typeof value !== "object") return;
    if (typeof value.$ref === "string" && value.$ref.startsWith("#/")) {
      let target = manifest;
      for (const key of value.$ref.slice(2).split("/"))
        target = target?.[key.replace(/~1/g, "/").replace(/~0/g, "~")];
      assert.ok(target, "Resolvable manifest reference: " + value.$ref);
    }
    for (const child of Object.values(value)) checkReferences(child);
  }
  checkReferences(manifest);
  const spec = (await json("/.well-known/openapi.json")).body;
  assert.deepEqual(
    spec.paths["/api/v1/projects/{id}"].get.responses["200"].content[
      "application/json"
    ].schema.properties.chip.enum,
    capabilities.targets.map((target) => target.id),
  );
  const source = skill.match(/```js\n([\s\S]*?)\n```/)[1];
  await writeFile(join(directory, "compose.mjs"), source);
  await symlink(
    resolve("node_modules"),
    join(directory, "node_modules"),
    "dir",
  );
  let canonical;
  for (const target of capabilities.targets) {
    // Execute the public instructions verbatim; no test-only composition helpers.
    const execution = spawnSync(process.execPath, ["compose.mjs", target.id], {
      cwd: directory,
      encoding: "utf8",
      timeout: 120000,
    });
    assert.equal(execution.status, 0, execution.stderr);
    const project = JSON.parse(
      await readFile(join(directory, "project.json"), "utf8"),
    );
    canonical ??= project;
    assert.deepEqual(
      project.source,
      canonical.source,
      "canonical notes survive target changes",
    );
    assert.equal((await json("/api/v1/validate", post(project))).status, 200);
    assert.equal(
      (await json("/api/v1/validate", post({ project }))).status,
      422,
      "wrong wrapper rejected",
    );
    assert.equal(
      (await json("/api/v1/validate", post({ ...project, unknown: 1 }))).status,
      422,
    );
    const wav = await readFile(join(directory, "preview.wav"));
    const { audio, plan } = renderProject(project, { sampleRate: 44100 });
    assert.equal(
      hash(wav),
      hash(toWav(audio)),
      "same source/engine/sample rate repeats exactly",
    );
    let energy = 0;
    for (const sample of audio.left) {
      assert.ok(Number.isFinite(sample));
      energy += sample * sample;
    }
    const rms = Math.sqrt(energy / audio.left.length);
    assert.ok(rms > 0.001 && audio.peak < 1, "non-silent, unclipped PCM");
    assert.equal(audio.seconds, 16);
    const row = {
      chip: target.id,
      seconds: audio.seconds,
      rms,
      peak: audio.peak,
      sha256: hash(wav),
      sourceNotes: project.source.performance.parts.reduce(
        (n, p) => n + p.notes.length,
        0,
      ),
      playedNotes: plan.notes.length,
      losses: plan.losses,
      mix: plan.mix,
    };
    observations.push(row);
    await writeFile(join(out, target.id + ".wav"), wav);
    await writeFile(
      join(out, target.id + ".json"),
      JSON.stringify(row, null, 2),
    );
  }
  const constrained = capabilities.targets.find((t) => t.id === "2a03");
  assert.ok(constrained, "the reduction fixture targets the qualified NES");
  const reduced = structuredClone(canonical);
  reduced.settings.chip = constrained.id;
  reduced.source.performance.parts = reduced.source.performance.parts.filter(
    (p) => !["brass", "countermelody"].includes(p.id),
  );
  const strings = reduced.source.performance.parts.find(
    (p) => p.id === "strings",
  );
  strings.notes.forEach((note, i) => {
    note.tick += (i % 3) * 480;
    note.endTick = note.tick + 400;
  });
  reduced.settings.allowLoss = false;
  const result = renderProject(reduced);
  assert.equal(
    result.plan.losses.filter((l) => l.kind === "voice-omitted").length,
    0,
  );
  const melody = reduced.source.performance.parts.find(
    (p) => p.id === "melody",
  );
  assert.deepEqual(
    result.plan.notes
      .filter((n) => n.part === "melody")
      .map((n) => n.id)
      .sort(),
    melody.notes.map((n) => n.id).sort(),
  );
  await writeFile(join(out, "reduced-2a03.wav"), toWav(result.audio));
  const overload = structuredClone(reduced);
  overload.source.performance.parts[0].notes = Array.from(
    { length: 32 },
    (_, i) => ({
      id: `overload-${i}`,
      tick: 0,
      endTick: 480,
      pitch: 60 + (i % 12),
      velocity: 90,
    }),
  );
  assert.equal(
    validateProject(overload).ok,
    true,
    "structural validity is not playability",
  );
  assert.throws(() => renderProject(overload), /exceeds hardware voices/);
  overload.settings.allowLoss = true;
  assert.ok(
    renderProject(overload).plan.losses.some((l) => l.kind === "voice-omitted"),
  );

  // Same HTTP shapes and lifecycle as the skill; key provision is local only.
  await build({
    stdin: {
      contents: "export * from './src/lib/auth'; export * from './src/lib/db';",
      resolveDir: process.cwd(),
    },
    outfile: "generated/test-agent-auth.mjs",
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    logLevel: "silent",
  });
  const auth = await import("./generated/test-agent-auth.mjs");
  const key = await auth.createKey(
    `agent-${Date.now()}@example.test`,
    "agent rehearsal",
  );
  // Execute the served shell example too, rather than maintaining a second recipe.
  await writeFile(join(directory, "project.json"), JSON.stringify(reduced));
  const shell = skill.match(/```bash\n([\s\S]*?)\n```/)[1];
  await writeFile(join(directory, "publish.sh"), shell);
  const publishedScript = spawnSync("bash", ["publish.sh"], {
    cwd: directory,
    env: { ...process.env, CHIPVOICE_URL: base, CHIPVOICE_API_KEY: key.key },
    encoding: "utf8",
    timeout: 180000,
  });
  assert.equal(publishedScript.status, 0, publishedScript.stderr);
  assert.equal(
    hash(await readFile(join(directory, "published.wav"))),
    hash(toWav(result.audio)),
  );
  const publishedMp3 = await readFile(join(directory, "published.mp3"));
  assert.equal(
    publishedMp3.subarray(0, 3).toString(),
    "ID3",
    "served recipe downloads tagged MP3",
  );
  assert.ok(publishedMp3.length > 1000);
  const headers = {
    Authorization: `Bearer ${key.key}`,
    "Idempotency-Key": "agent-guide-rehearsal",
  };
  const body = { project: reduced, visibility: "unlisted" };
  assert.equal((await json("/api/v1/projects", post(body))).status, 401);
  const published = await json("/api/v1/projects", post(body, headers));
  assert.equal(published.status, 201);
  assert.equal(
    (await json("/api/v1/projects", post(body, headers))).body.id,
    published.body.id,
  );
  assert.equal(
    (
      await json(
        "/api/v1/projects",
        post({ ...body, visibility: "public" }, headers),
      )
    ).status,
    409,
  );
  const fetched = await json(`/api/v1/projects/${published.body.id}`);
  assert.deepEqual(fetched.body.project, reduced);
  let job = await json(
    `/api/v1/projects/${published.body.id}/render`,
    post({ kind: "preview" }, headers),
  );
  assert.ok([200, 202].includes(job.status));
  const jobId = job.body.id;
  for (
    let i = 0;
    i < 240 && !["ready", "failed", "cancelled"].includes(job.body.status);
    i++
  ) {
    await new Promise((r) => setTimeout(r, 500));
    job = await json(`/api/v1/jobs/${jobId}`, { headers });
  }
  assert.equal(job.body.status, "ready", JSON.stringify(job.body));
  const downloaded = await fetch(new URL(job.body.audio, base), { headers });
  assert.equal(downloaded.status, 200);
  const bytes = Buffer.from(await downloaded.arrayBuffer());
  assert.equal(hash(bytes), hash(toWav(result.audio)));
  const remix = await json(
    "/api/v1/projects",
    post(
      { ...body, parentId: published.body.id },
      { ...headers, "Idempotency-Key": "agent-guide-remix" },
    ),
  );
  assert.equal(remix.status, 201);
  assert.equal(remix.body.parentId, published.body.id);
  await (await auth.db()).close();
  await writeFile(
    join(out, "observations.json"),
    JSON.stringify(
      {
        targets: observations,
        reduction: {
          chip: constrained.id,
          omitted: 0,
          melodyNotes: melody.notes.length,
        },
        http: {
          publication: published.body.id,
          job: jobId,
          bytes: bytes.length,
          remix: remix.body.id,
        },
      },
      null,
      2,
    ),
  );
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    await context.addInitScript(installOutputProbe);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base + "/create", { waitUntil: "domcontentloaded" });
    const imported = {
      ...canonical,
      settings: { ...canonical.settings, chip: "snes" },
    };
    await page.locator("input[type=file]").setInputFiles({
      name: "ensemble.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(imported)),
    });
    await page
      .getByRole("option", { name: "GM program 73", exact: true })
      .waitFor({ state: "attached" });
    assert.equal(
      await page
        .getByRole("combobox", { name: "Timbre", exact: true })
        .inputValue(),
      "73",
      "unknown preset keeps the actual GM program visible",
    );
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await page
      .getByRole("button", { name: "Pause", exact: true })
      .waitFor({ timeout: 120000 });
    const rms = await outputPhraseRms(page);
    assert.ok(rms > 0.001);
    await page.screenshot({
      path: join(out, "ensemble-desktop.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: join(out, "ensemble-mobile.png"),
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    await writeFile(
      join(out, "browser.json"),
      JSON.stringify({ rms, errors }, null, 2),
    );
  } finally {
    await browser.close();
  }
  console.log(
    "PASS executable served skill on every target; deterministic audio; overload/reduction; exact HTTP publication/retry/conflict/render/remix; future-target discovery",
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
