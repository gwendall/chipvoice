import assert from "node:assert/strict";
import { build } from "../../packages/chipvoice/node_modules/esbuild/lib/main.js";
import { writeFile, mkdir } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { chromium } from "playwright";
const base = process.env.API_URL;
assert.ok(
  base && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base),
  "Only a disposable local server",
);
assert.ok(process.env.TURSO_DEV_DATABASE_URL?.startsWith("file:"));
await build({
  stdin: {
    contents:
      "export * from './src/lib/auth';export * from './src/lib/db';export * from './src/create/starter';",
    resolveDir: process.cwd(),
  },
  outfile: "generated/test-artists.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  logLevel: "silent",
});
const api = await import("./generated/test-artists.mjs"),
  client = await api.db(),
  suffix = randomUUID().slice(0, 8);
const ownerKey = await api.createKey(`artist-${suffix}@example.test`, null),
  owner = await api.identify(
    new Request(base, { headers: { authorization: `Bearer ${ownerKey.key}` } }),
  );
const token = await api.createMagicLink(ownerKey.id),
  redeem = await fetch(`${base}/api/auth/redeem?token=${token}`, {
    redirect: "manual",
  }),
  cookie = redeem.headers.get("set-cookie").split(";")[0];
const http = async (method, path, body, credential = cookie, extra = {}) => {
  const r = await fetch(base + path, {
    method,
    headers: {
      ...(credential?.startsWith("cv_")
        ? { authorization: `Bearer ${credential}` }
        : credential
          ? { cookie: credential }
          : {}),
      ...(body ? { "content-type": "application/json" } : {}),
      ...extra,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = r.headers.get("content-type")?.includes("json")
    ? await r.json()
    : await r.arrayBuffer();
  return { status: r.status, data, headers: r.headers };
};
const ok = async (...args) => {
  const r = await http(...args);
  assert.ok(r.status >= 200 && r.status < 300, JSON.stringify(r));
  return r.data;
};
// Fresh accounts reserve the default before admitting additional artist profiles.
const freshKey = await api.createKey(`fresh-${suffix}@example.test`, null);
const fresh = await api.identify(
  new Request(base, { headers: { authorization: `Bearer ${freshKey.key}` } }),
);
await ok("POST", "/api/v1/profiles", undefined, freshKey.key);
assert.equal(
  (
    await client.execute({
      sql: "select count(*) as n from profiles where user_id=?",
      args: [fresh.userId],
    })
  ).rows[0].n,
  2,
);
await client.batch(
  Array.from({ length: 18 }, (_, i) => ({
    sql: "insert into profiles(id,user_id,created_at) values(?,?,?)",
    args: [`cap-${suffix}-${i}`, fresh.userId, Date.now()],
  })),
  "write",
);
assert.equal(
  (await http("POST", "/api/v1/profiles", undefined, freshKey.key)).status,
  429,
);
if (process.env.CHIPVOICE_ADMIN_KEY) {
  const legacy = await ok(
    "POST",
    "/api/songs",
    {
      title: "Operator fixture",
      bpm: 120,
      patterns: [
        {
          lead: "C4 . . .",
          chord: ". . . .",
          bass: ". . . .",
          perc: ". . . .",
          chordShape: [[0, 4, 7]],
        },
      ],
      order: [0],
    },
    null,
  );
  assert.equal(
    (
      await http("DELETE", `/api/songs/${legacy.id}`, undefined, null, {
        authorization: `Bearer ${process.env.CHIPVOICE_ADMIN_KEY}`,
      })
    ).status,
    200,
    "operator moderation remains available",
  );
}
const profiles = await ok("GET", "/api/v1/profiles");
assert.equal(profiles.items.length, 1);
const artist = await ok("POST", "/api/v1/profiles");
assert.notEqual(artist.id, profiles.items[0].id);
const scopes = [
  "projects:read",
  "projects:write",
  "render",
  "evaluate",
  "profile:write",
];
const pair = await ok(
  "POST",
  "/api/v1/agent-requests",
  { label: "Pocket conductor", scopes },
  null,
);
assert.ok(pair.requestToken);
assert.ok(!pair.verificationUrl.includes(pair.requestToken));
assert.equal(
  (
    await http(
      "POST",
      "/api/v1/agent-requests/decision",
      { code: pair.userCode, profileId: artist.id, days: 7, approve: true },
      ownerKey.key,
    )
  ).status,
  403,
  "Only owner browser sessions approve",
);
assert.equal(
  (
    await http(
      "POST",
      "/api/v1/agent-requests/decision",
      { code: pair.userCode, profileId: artist.id, days: 7, approve: true },
      cookie,
      { origin: "https://other.test" },
    )
  ).status,
  401,
);
const browser = await chromium.launch({ headless: true });
await mkdir("../../.artifacts/artist-lifecycle", { recursive: true });
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const [name, value] = cookie.split("=");
  await context.addCookies([
    { name, value, url: base, httpOnly: true, sameSite: "Lax" },
  ]);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/connect?code=${pair.userCode}`);
  await page
    .getByRole("button", { name: "Review access", exact: true })
    .click();
  await page.getByRole("heading", { name: "Pocket conductor" }).waitFor();
  await page.getByLabel("Artist", { exact: true }).selectOption(artist.id);
  await page.getByLabel("Username", { exact: true }).fill(`bot_${suffix}`);
  await page
    .getByLabel("Display name", { exact: true })
    .fill("Pocket conductor");
  await page.getByLabel("Portrait palette", { exact: true }).selectOption("2");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Profile saved." })
    .waitFor();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "mobile authorization fits",
  );
  await page.screenshot({
    path: "../../.artifacts/artist-lifecycle/connect-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Authorize this agent", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Access authorized." })
    .waitFor();
  const granted = await ok(
      "POST",
      "/api/v1/agent-requests/token",
      { requestToken: pair.requestToken },
      null,
    ),
    agent = granted.accessToken;
  assert.match(agent, /^cv_agent_/);
  assert.ok(granted.expiresAt > Date.now());
  assert.equal(
    (
      await http(
        "POST",
        "/api/v1/agent-requests/token",
        { requestToken: pair.requestToken },
        null,
      )
    ).status,
    409,
    "secret delivered once",
  );
  const identity = await ok("GET", "/api/v1/agent", undefined, agent);
  assert.equal(identity.profile.id, artist.id);
  assert.equal(identity.profile.avatar.palette, 2);
  await client.batch(
    Array.from({ length: 101 }, (_, i) => ({
      sql: "insert into agent_grants(id,user_id,profile_id,hash,label,scopes,created_at,expires_at,revoked_at) values(?,?,?,?,?,?,?,?,?)",
      args: [
        `history-${suffix}-${i}`,
        owner.userId,
        artist.id,
        `history-${suffix}-${i}`,
        "Old",
        "[]",
        Date.now() + i,
        Date.now() + 86400000,
        Date.now(),
      ],
    })),
    "write",
  );
  assert.ok(
    (await ok("GET", "/api/v1/agents")).items.some((g) => g.id === identity.id),
    "active credentials remain discoverable behind history",
  );
  assert.equal(
    (await http("GET", "/api/v1/projects?favourites=1", undefined, agent))
      .status,
    403,
  );
  assert.equal(
    (
      await http("POST", "/api/songs", {}, null, {
        authorization: `bearer ${agent}`,
      })
    ).status,
    403,
  );

  assert.ok(!JSON.stringify(identity).includes(owner.email));
  for (const [method, path, body] of [
    ["GET", "/api/me"],
    ["GET", "/api/keys"],
    ["POST", "/api/songs", {}],
    ["POST", "/api/v1/profiles", {}],
    ["GET", "/api/v1/agents"],
    [
      "POST",
      "/api/v1/agent-requests/decision",
      { code: pair.userCode, profileId: artist.id, days: 30, approve: true },
    ],
  ])
    assert.equal(
      (await http(method, path, body, agent)).status,
      403,
      `${method} ${path}`,
    );
  const project = api.starterProject();
  project.title = "Authorization fixture";
  project.source.performance.endTick = 1920;
  project.source.performance.tempos = project.source.performance.tempos.slice(
    0,
    1,
  );
  delete project.source.performance.loopStartTick;
  for (const p of project.source.performance.parts) {
    p.notes = p.notes
      .filter((n) => n.tick < 1920)
      .map((n) => ({ ...n, endTick: Math.min(n.endTick, 1920) }));
  }
  const report = await ok("POST", "/api/v1/evaluate", project, agent),
    again = await ok("POST", "/api/v1/evaluate", project, agent);
  assert.deepEqual(report, again, "HTTP evaluation deterministic");
  assert.equal(report.chip, project.settings.chip);
  assert.ok(report.audio.rms > 0);
  assert.ok(report.seconds > 0);
  assert.equal(
    (
      await client.execute({
        sql: "select count(*) as n from projects where user_id=?",
        args: [owner.userId],
      })
    ).rows[0].n,
    0,
    "Evaluation did not publish",
  );
  const publish = async (
    profileId,
    chip,
    visibility = "public",
    credential = agent,
  ) =>
    ok(
      "POST",
      "/api/v1/projects",
      {
        project: { ...project, settings: { ...project.settings, chip } },
        profileId,
        visibility,
      },
      credential,
      { "idempotency-key": randomUUID() },
    );
  const privateOwner = await publish(
    profiles.items[0].id,
    "2a03",
    "private",
    cookie,
  );
  assert.equal(
    (await http("GET", `/api/v1/projects/${privateOwner.id}`, undefined, agent))
      .status,
    404,
  );
  assert.equal(
    (
      await http(
        "DELETE",
        `/api/v1/projects/${privateOwner.id}`,
        undefined,
        agent,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await http(
        "POST",
        `/api/v1/projects/${privateOwner.id}/render`,
        { kind: "full" },
        agent,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await http(
        "POST",
        "/api/v1/projects",
        { project, profileId: profiles.items[0].id },
        agent,
        { "idempotency-key": randomUUID() },
      )
    ).status,
    403,
  );
  const song = await publish(artist.id, "2a03"),
    variant = await publish(artist.id, "md"),
    hidden = await publish(artist.id, "snes", "unlisted");
  const newer = await publish(artist.id, "2a03");
  const versions = await ok(
    "GET",
    `/api/v1/projects/${song.id}`,
    undefined,
    null,
  );
  assert.equal(
    versions.variants.find((v) => v.chip === "2a03").id,
    newer.id,
    "old publication links latest console revision",
  );
  const publicView = await ok(
    "GET",
    `/api/v1/projects/${song.id}`,
    undefined,
    null,
  );
  assert.equal(publicView.variants.length, 2);
  assert.ok(!JSON.stringify(publicView).includes(hidden.id));
  assert.equal(
    (await ok("GET", "/api/v1/projects?mine=1", undefined, agent)).items.length,
    4,
  );
  assert.equal(
    (
      await ok(
        "GET",
        `/api/v1/projects?group=1&handle=bot_${suffix}`,
        undefined,
        null,
      )
    ).items.length,
    1,
  );
  const job = await ok(
    "POST",
    `/api/v1/projects/${song.id}/render`,
    { kind: "full" },
    agent,
  );
  const waitJob = async () => {
    for (let i = 0; i < 150; i++) {
      const j = await ok("GET", `/api/v1/jobs/${job.id}`, undefined, agent);
      if (j.status === "failed" || j.mp3Status === "failed")
        throw Error(JSON.stringify(j));
      if (j.status === "ready" && j.mp3Status === "ready") return j;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw Error("Render timed out");
  };
  const ready = await waitJob();
  assert.ok(ready.wavUrl && ready.mp3Url && ready.coverUrl && ready.pageUrl);
  assert.ok(ready.mp3Bytes > 100);
  const wav = await http(
      "GET",
      `/api/v1/jobs/${job.id}/audio`,
      undefined,
      null,
    ),
    mp3 = await http(
      "GET",
      `/api/v1/jobs/${job.id}/audio?format=mp3`,
      undefined,
      null,
    );
  assert.equal(mp3.headers.get("content-type"), "audio/mpeg");
  assert.equal(Buffer.from(mp3.data).subarray(0, 3).toString(), "ID3");
  // The old-WAV upgrade must preserve every stored WAV byte.
  await client.batch(
    [
      { sql: "delete from project_mp3 where job_id=?", args: [job.id] },
      {
        sql: "update project_jobs set mp3_status='none',mp3_bytes=null where id=?",
        args: [job.id],
      },
    ],
    "write",
  );
  await client.execute({
    sql: "insert into evaluation_lease(singleton,id,expires_at) values(1,?,?)",
    args: ["test-mp3-lease", Date.now() + 60000],
  });
  assert.equal(
    (await http("POST", "/api/v1/evaluate", project, agent)).status,
    429,
    "busy evaluation returns retryable admission",
  );
  await page.goto(`${base}/p/${song.id}`);
  await page
    .getByRole("button", { name: /Open \/ remix this project/ })
    .click();
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await page
    .getByRole("button", { name: "Prepare full download", exact: true })
    .click();
  await page.getByRole("status").filter({ hasText: "Encoding MP3…" }).waitFor();
  await page
    .getByRole("status")
    .filter({ hasText: "Encoding MP3…" })
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Encoding MP3…" })
    .waitFor({ state: "hidden" });
  assert.equal(
    (await ok("GET", `/api/v1/jobs/${job.id}`, undefined, agent)).mp3Status,
    "cancelled",
  );
  await client.execute(
    "delete from evaluation_lease where id='test-mp3-lease'",
  );
  await page
    .getByRole("button", { name: "Prepare full download", exact: true })
    .click();
  await page.getByRole("link", { name: "Download MP3", exact: true }).waitFor();
  await waitJob();
  assert.deepEqual(
    (await http("GET", `/api/v1/jobs/${job.id}/audio`, undefined, null)).data,
    wav.data,
  );
  assert.equal(
    (
      await http("GET", `/api/v1/projects/${song.id}/cover`, undefined, null)
    ).headers.get("content-type"),
    "image/png",
  );
  await page.goto(`${base}/p/${song.id}`);
  await page.getByRole("link", { name: "Download MP3", exact: true }).waitFor();
  await page.evaluate(() => {
    const a = document.querySelector("audio");
    a.src += "?format=mp3";
    a.preload = "auto";
    a.load();
  });
  await page.waitForFunction(
    () => document.querySelector("audio")?.duration > 0,
  );
  const decoded = await page.evaluate(async () => {
    const bytes = await (
      await fetch(document.querySelector("audio").src)
    ).arrayBuffer();
    const context = new OfflineAudioContext(2, 1, 44100),
      audio = await context.decodeAudioData(bytes);
    let energy = 0,
      peak = 0,
      count = 0;
    for (let c = 0; c < audio.numberOfChannels; c++)
      for (const sample of audio.getChannelData(c)) {
        energy += sample * sample;
        peak = Math.max(peak, Math.abs(sample));
        count++;
      }
    return {
      channels: audio.numberOfChannels,
      seconds: audio.duration,
      rms: Math.sqrt(energy / count),
      peak,
    };
  });
  assert.equal(decoded.channels, 2);
  assert.ok(decoded.rms > 0.001);
  assert.ok(Math.abs(decoded.seconds - report.seconds) < 0.15);
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "publication fits mobile",
  );
  await page.screenshot({
    path: "../../.artifacts/artist-lifecycle/song-mobile.png",
    fullPage: true,
  });
  await page.goto(`${base}/ja/library`);
  await page
    .getByRole("heading", { name: "アーティストとエージェント" })
    .waitFor();
  await page.locator(".song-card").first().waitFor();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: "../../.artifacts/artist-lifecycle/library-ja-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${base}/library`);
  await page.getByRole("heading", { name: "Artists & agents" }).waitFor();
  await page.locator(".song-card").first().waitFor();
  await page.screenshot({
    path: "../../.artifacts/artist-lifecycle/library-desktop.png",
    fullPage: true,
  });
  await ok("DELETE", `/api/v1/agents/${identity.id}`);
  assert.equal(
    (await http("GET", "/api/v1/profile", undefined, agent)).status,
    401,
  );
  // Read-only grants cannot publish, edit a profile or cause render work.
  const second = await ok(
    "POST",
    "/api/v1/agent-requests",
    { label: "Read only", scopes: ["projects:read"] },
    null,
  );
  await ok("POST", "/api/v1/agent-requests/decision", {
    code: second.userCode,
    profileId: artist.id,
    days: 1,
    approve: true,
  });
  const readOnly = (
    await ok(
      "POST",
      "/api/v1/agent-requests/token",
      { requestToken: second.requestToken },
      null,
    )
  ).accessToken;
  for (const [method, path, body] of [
    ["POST", "/api/v1/projects", { project }],
    [
      "PUT",
      "/api/v1/profile",
      { handle: "oops", displayName: "Oops", bio: "" },
    ],
    ["POST", "/api/v1/evaluate", project],
    ["POST", `/api/v1/projects/${song.id}/render`, { kind: "full" }],
  ])
    assert.equal(
      (
        await http(method, path, body, readOnly, {
          "idempotency-key": randomUUID(),
        })
      ).status,
      403,
      path,
    );
  await client.execute({
    sql: "update agent_grants set expires_at=? where hash=?",
    args: [Date.now() - 1, createHash("sha256").update(readOnly).digest("hex")],
  });
  assert.equal(
    (await http("GET", "/api/v1/profile", undefined, readOnly)).status,
    401,
  );
  const pending = await ok(
    "POST",
    "/api/v1/agent-requests",
    { label: "Pending", scopes: ["evaluate"] },
    null,
  );
  assert.equal(
    (
      await ok(
        "POST",
        "/api/v1/agent-requests/token",
        { requestToken: pending.requestToken },
        null,
      )
    ).status,
    "pending",
  );
  assert.equal(
    (
      await http(
        "POST",
        "/api/v1/agent-requests/token",
        { requestToken: pending.requestToken },
        null,
      )
    ).status,
    429,
  );
  await ok("POST", "/api/v1/agent-requests/decision", {
    code: pending.userCode,
    profileId: artist.id,
    days: 1,
    approve: false,
  });
  assert.equal(
    (
      await http(
        "POST",
        "/api/v1/agent-requests/token",
        { requestToken: pending.requestToken },
        null,
      )
    ).status,
    403,
  );
  const pinnedMp3 = await http(
    "GET",
    `/api/v1/jobs/${job.id}/audio?format=mp3`,
    undefined,
    null,
  );
  await writeFile(
    "../../.artifacts/artist-lifecycle/full.wav",
    Buffer.from(wav.data),
  );
  await writeFile(
    "../../.artifacts/artist-lifecycle/full.mp3",
    Buffer.from(pinnedMp3.data),
  );
  await writeFile(
    "../../.artifacts/artist-lifecycle/report.json",
    JSON.stringify(
      {
        version: 1,
        engine: report.engine,
        engineVersion: report.engineVersion,
        evaluation: report,
        decodedMp3: decoded,
        wavBytes: wav.data.byteLength,
        mp3Bytes: pinnedMp3.data.byteLength,
        wavPreserved: true,
        authorizationAndIsolation: "passed",
        mobileAndJapanese: "passed",
      },
      null,
      2,
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS artist authorization in browser; scoped/expired/revoked tokens; no legacy escape; deterministic unpublished evaluation; private isolation; grouped variants; MP3 decoding; old WAV preservation; English/Japanese mobile screenshots",
  );
} finally {
  await browser.close();
}
