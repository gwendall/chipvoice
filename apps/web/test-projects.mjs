import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "../../packages/chipvoice/node_modules/esbuild/lib/main.js";
const directory = await mkdtemp(join(tmpdir(), "chipvoice-projects-"));
process.env.VERCEL_ENV = "preview";
process.env.TURSO_DEV_DATABASE_URL = `file:${join(directory, "data.db")}`;
process.env.TURSO_DEV_AUTH_TOKEN = "";
const file = resolve("generated/test-projects.mjs");
await build({
  stdin: {
    contents:
      "export * from './src/lib/utility-worker';export * from './src/lib/project-jobs';export * from './src/lib/auth';export * from './src/lib/projects';export * from './src/lib/db';export * from './src/create/starter';export {GET as audioGet} from './src/app/api/v1/jobs/[id]/audio/route';",
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
try {
  // A slow preflight must consume the same lease deadline as actual computation.
  const realNow = Date.now;
  try {
    await assert.rejects(
      () =>
        api.utilityWorker({}, 30000, async () => {
          Date.now = () => realNow() + 60000;
          return false;
        }),
      (error) => error.code === "worker_limit",
    );
  } finally {
    Date.now = realNow;
  }
  assert.equal(
    (
      await (
        await api.db()
      ).execute("select count(*) as n from evaluation_lease")
    ).rows[0].n,
    0,
  );
  const account = async (email) => {
    const key = await api.createKey(email, null);
    return api.identify(
      new Request("https://chipvoice.test/api", {
        headers: { authorization: `Bearer ${key.key}` },
      }),
    );
  };
  const alice = await account("alice@example.test"),
    bob = await account("bob@example.test");
  const profile = await api.editProfile(alice.userId, {
    handle: "alice_music",
    displayName: "Alice",
    bio: "Tiny songs",
  });
  assert.notEqual(profile.id, alice.userId);
  assert.equal("email" in profile, false);
  await assert.rejects(
    () =>
      api.editProfile(bob.userId, {
        handle: "ALICE_MUSIC",
        displayName: "Bob",
        bio: "",
      }),
    (error) => error.status === 409,
  );
  const project = api.starterProject(),
    request = {
      project,
      visibility: "public",
      requestKey: "project-test-0001",
    };
  const [a, retry] = await Promise.all([
    api.publishProject(alice.userId, request),
    api.publishProject(alice.userId, request),
  ]);
  assert.equal(a.id, retry.id);
  assert.deepEqual(a.project, project);
  await assert.rejects(
    () =>
      api.publishProject(alice.userId, {
        ...request,
        project: { ...project, title: "different" },
      }),
    (error) => error.status === 409,
  );
  const fork = await api.publishProject(bob.userId, {
    ...request,
    parentId: a.id,
    requestKey: "project-test-fork",
  });
  assert.equal(fork.parentId, a.id);
  assert.equal(fork.rootId, a.id);
  const privateSong = await api.publishProject(alice.userId, {
      ...request,
      visibility: "private",
      requestKey: "project-test-private",
    }),
    unlisted = await api.publishProject(alice.userId, {
      ...request,
      visibility: "unlisted",
      requestKey: "project-test-unlisted",
    });
  assert.equal(await api.getProject(privateSong.id, bob.userId), null);
  assert.ok(await api.getProject(privateSong.id, alice.userId));
  assert.ok(await api.getProject(unlisted.id));
  const listed = await api.listProjects({}, null);
  assert.equal(listed.items.length, 2);
  assert.equal(
    listed.items.some((p) => p.id === privateSong.id || p.id === unlisted.id),
    false,
  );
  assert.equal((await api.listProjects({ q: "Alice" }, null)).items.length, 1);
  assert.equal(
    (await api.listProjects({ tag: "original", chip: "snes" }, null)).items
      .length,
    2,
  );
  assert.equal((await api.listProjects({ q: "%" }, null)).items.length, 0);
  await assert.rejects(
    () => api.setFavourite(a.id, alice.userId, true),
    (error) => error.status === 422,
  );
  await api.setFavourite(a.id, bob.userId, true);
  await api.setFavourite(a.id, bob.userId, true);
  assert.equal((await api.getProject(a.id, bob.userId)).favourites, 1);
  const favs = await api.listProjects(
    { favourites: true, mine: true },
    bob.userId,
  );
  assert.equal(favs.items.length, 1);
  assert.equal(favs.items[0].favourited, true);
  assert.equal(
    (await api.listProjects({ sort: "popular" }, null)).items[0].id,
    a.id,
  );
  await api.setFavourite(a.id, bob.userId, false);
  assert.equal((await api.getProject(a.id)).favourites, 0);
  // Real pinned WAV bytes are written once, independent of later engine identity.
  const tiny = structuredClone(project);
  tiny.source.performance.endTick = 960;
  for (const part of tiny.source.performance.parts)
    part.notes = part.notes
      .filter((n) => n.tick < 960)
      .map((n) => ({ ...n, endTick: Math.min(960, n.endTick) }));
  const short = await api.publishProject(bob.userId, {
    project: tiny,
    visibility: "private",
    requestKey: "project-test-render",
  });
  const job = await api.createProjectJob(short.id, bob.userId, "full");
  assert.equal(
    (await api.createProjectJob(short.id, bob.userId, "full")).id,
    job.id,
  );
  await assert.rejects(
    () => api.getProjectJob(job.id, alice.userId),
    (error) => error.status === 404,
  );
  await api.runProjectJob(job.id);
  const ready = await api.getProjectJob(job.id, bob.userId);
  assert.equal(ready.status, "ready", ready.error);
  const client = await api.db();
  const chunks = await client.execute({
    sql: "select bytes from project_audio where job_id=? order by chunk",
    args: [job.id],
  });
  const wav = Buffer.concat(chunks.rows.map((r) => Buffer.from(r.bytes)));
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.length, ready.bytes);
  const token = await api.createKey("bob@example.test", null);
  const audio = (headers = {}, method = 'GET') => api.audioGet(new Request(`https://chipvoice.test/api/v1/jobs/${job.id}/audio`, {method, headers:{authorization:`Bearer ${token.key}`, ...headers}}), {params:Promise.resolve({id:job.id})});
  for (const range of ['bytes=0-43', `bytes=${wav.length-50}-`, 'bytes=-50']) {
    const response = await audio({range});assert.equal(response.status,206);
    const [start,end] = response.headers.get('content-range').match(/bytes (\d+)-(\d+)/).slice(1).map(Number);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),wav.subarray(start,end+1));
  }
  const head=await audio({},'HEAD');assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),String(wav.length));assert.equal((await head.arrayBuffer()).byteLength,0);
  assert.equal((await audio({range:`bytes=${wav.length}-`})).status,416);
  const anonymous=await api.audioGet(new Request(`https://chipvoice.test/api/v1/jobs/${job.id}/audio`,{headers:{range:'bytes=0-43'}}),{params:Promise.resolve({id:job.id})});assert.equal(anonymous.status,404,'range never bypasses private ownership');

  await client.execute({
    sql: "update project_jobs set engine='older-engine' where id=?",
    args: [job.id],
  });
  await api.runProjectJob(job.id);
  assert.equal(
    (await api.getProjectJob(job.id, bob.userId)).engine,
    "older-engine",
  );
  assert.deepEqual(
    Buffer.concat(
      (
        await client.execute({
          sql: "select bytes from project_audio where job_id=? order by chunk",
          args: [job.id],
        })
      ).rows.map((r) => Buffer.from(r.bytes)),
    ),
    wav,
  );
  const queued = await api.createProjectJob(short.id, bob.userId, "preview");
  await client.execute({
    sql: "update project_jobs set status='cancelled' where id=?",
    args: [queued.id],
  });
  await api.runProjectJob(queued.id);
  assert.equal(
    (await api.getProjectJob(queued.id, bob.userId)).status,
    "cancelled",
  );
  await api.withdrawProject(short.id, bob.userId);
  await assert.rejects(
    () => api.getProjectJob(job.id, bob.userId),
    (error) => error.status === 404,
  );
  const long = structuredClone(tiny);
  long.source.performance.endTick = 172800;
  long.source.performance.parts = [
    {
      id: "tone",
      name: "Tone",
      role: "lead",
      priority: 1,
      notes: [
        {
          id: "hold",
          tick: 0,
          endTick: 172799,
          pitch: 64,
          velocity: 90,
          program: 80,
        },
      ],
    },
  ];
  const cancelSong = await api.publishProject(alice.userId, {
    project: long,
    visibility: "private",
    requestKey: "project-test-cancel-worker",
  });
  const running = await api.createProjectJob(
    cancelSong.id,
    alice.userId,
    "full",
  );
  const blocked = await api.createProjectJob(
    cancelSong.id,
    alice.userId,
    "preview",
  );
  const rendering = api.runProjectJob(running.id);
  for (let i = 0; i < 100; i++) {
    if (
      (await api.getProjectJob(running.id, alice.userId)).status === "rendering"
    )
      break;
    await new Promise((r) => setTimeout(r, 5));
  }
  await client.execute({
    sql: "update project_jobs set status='cancelling' where id=? and status='rendering'",
    args: [running.id],
  });
  await api.runProjectJob(blocked.id);
  assert.equal(
    (await api.getProjectJob(blocked.id, alice.userId)).status,
    "queued",
    "cancellation holds the global lease",
  );
  await rendering;
  assert.equal(
    (await api.getProjectJob(running.id, alice.userId)).status,
    "cancelled",
  );
  assert.equal(
    (
      await client.execute({
        sql: "select count(*) n from project_audio where job_id=?",
        args: [running.id],
      })
    ).rows[0].n,
    0,
  );
  await api.withdrawProject(cancelSong.id, alice.userId);
  await api.withdrawProject(a.id, alice.userId);
  assert.equal(await api.getProject(a.id), null);
  assert.ok(await api.getProject(fork.id));
  assert.equal((await api.listProjects({}, null)).items.length, 1);
  assert.equal(
    (await api.listProjects({ mine: true }, alice.userId)).items.length,
    2,
  );
  await assert.rejects(
    () => api.listProjects({ cursor: "bad" }, null),
    (error) => error.status === 400,
  );
  console.log(
    "PASS publication round trips, concurrent retries, forks, visibility, profiles, filters, favourites and withdrawal",
  );
} finally {
  (await api.db()).close();
  await rm(directory, { recursive: true, force: true });
}
