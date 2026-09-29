import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "../../packages/chipvoice/node_modules/esbuild/lib/main.js";

// Decision 55 (NEXT-19): project_jobs as a durable queue - dedup, lease
// expiry/reclaim, retry with attempts, dead-lettering, the concurrency
// setting and the cron sweeper. Own isolated database, own bundle, no
// network and no dependency on test-local.mjs's shared server, same as
// test-projects.mjs.
const directory = await mkdtemp(join(tmpdir(), "chipvoice-render-queue-"));
process.env.VERCEL_ENV = "preview";
process.env.TURSO_DEV_DATABASE_URL = `file:${join(directory, "data.db")}`;
process.env.TURSO_DEV_AUTH_TOKEN = "";
const file = "generated/test-render-queue.mjs";
await build({
  stdin: {
    contents:
      "export * from './src/lib/project-jobs';export * from './src/lib/auth';export * from './src/lib/projects';export * from './src/lib/db';export * from './src/create/starter';export {GET as cronSweepGet} from './src/app/api/cron/sweep-jobs/route';",
    resolveDir: process.cwd(),
  },
  outfile: file,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  // "next/server" has no package.json "exports" entry; Next's own bundler
  // resolves the extensionless specifier, but native Node ESM resolution
  // cannot. The literal file next/server.js exists and is what Next itself
  // ships for this - alias to it so the plain `node` run below can import it.
  alias: { "next/server": "next/server.js" },
  logLevel: "silent",
});
const api = await import(pathToFileURL(file));

try {
  const client = await api.db();
  const account = async (email) => {
    const key = await api.createKey(email, null);
    return api.identify(
      new Request("https://chipvoice.test/api", {
        headers: { authorization: `Bearer ${key.key}` },
      }),
    );
  };
  const alice = await account("render-queue-alice@example.test");
  const bob = await account("render-queue-bob@example.test");

  // A song slow enough to still be 'rendering' when polled, the same
  // fixture shape test-projects.mjs uses for its own cancellation test.
  const longSong = (title) => ({
    ...api.starterProject(),
    title,
    source: {
      ...api.starterProject().source,
      performance: {
        ...api.starterProject().source.performance,
        endTick: 172800,
        parts: [
          {
            id: "tone",
            name: "Tone",
            role: "lead",
            priority: 1,
            notes: [
              { id: "hold", tick: 0, endTick: 172799, pitch: 64, velocity: 90, program: 80 },
            ],
          },
        ],
      },
    },
  });

  // --- Dedup: two identical requests share one job (AUD-2's own key). ---
  const dedupSong = await api.publishProject(alice.userId, {
    project: api.starterProject(),
    visibility: "private",
    requestKey: "render-queue-dedup",
  });
  const [first, second] = await Promise.all([
    api.createProjectJob(dedupSong.id, alice.userId, "full"),
    api.createProjectJob(dedupSong.id, alice.userId, "full"),
  ]);
  assert.equal(first.id, second.id, "concurrent identical requests share one job");
  const dedupRows = await client.execute({
    sql: "select count(*) as n from project_jobs where project_id=? and kind='full'",
    args: [dedupSong.id],
  });
  assert.equal(Number(dedupRows.rows[0].n), 1, "exactly one row backs both requests");
  // A third, sequential request also reuses it.
  assert.equal(
    (await api.createProjectJob(dedupSong.id, alice.userId, "full")).id,
    first.id,
  );
  console.log("PASS dedup: concurrent and sequential identical requests share one job row");

  // --- Kill test: a worker dies mid-job; the job completes after the
  // lease expires, exactly once. ---
  const killSong = await api.publishProject(bob.userId, {
    project: longSong("Kill test"),
    visibility: "private",
    requestKey: "render-queue-kill",
  });
  const killJob = await api.createProjectJob(killSong.id, bob.userId, "full");
  // Attempt 1: start a real render, let it actually reach 'rendering', then
  // - without ever letting it finish or cancelling it - simulate its
  // instance dying by forcing its lease into the past. The render keeps
  // running in this same process (nothing can truly kill:-9 a worker_thread
  // mid-test), which is the harder case to get right: a "zombie" that
  // eventually does try to write must lose the race, not corrupt it.
  const zombie = api.runProjectJob(killJob.id);
  for (let i = 0; i < 400; i++) {
    if ((await api.getProjectJob(killJob.id, bob.userId)).status === "rendering") break;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(
    (await api.getProjectJob(killJob.id, bob.userId)).status,
    "rendering",
    "attempt 1 claimed the job",
  );
  await client.execute({
    sql: "update project_jobs set lease_expires_at=? where id=?",
    args: [Date.now() - 1, killJob.id],
  });
  const reclaimed = await api.reclaimExpiredLeases(client);
  assert.equal(reclaimed, 1, "the expired lease was requeued, not dead-lettered");
  assert.equal(
    (await api.getProjectJob(killJob.id, bob.userId)).status,
    "queued",
    "reclaim puts the job back on the queue for a fresh claim",
  );
  // Attempt 2: a fresh claim (a different instance, or the same one after a
  // cron tick) picks the job back up and finishes it for real.
  await api.runProjectJob(killJob.id);
  const revived = await api.getProjectJob(killJob.id, bob.userId);
  assert.equal(revived.status, "ready", revived.error);
  // Now let the zombie from attempt 1 actually finish. Its own writes must
  // all be fenced out by then: no crash, no duplicate audio, no clobbering
  // attempt 2's ready state.
  await zombie;
  const settled = await api.getProjectJob(killJob.id, bob.userId);
  assert.equal(settled.status, "ready", "exactly-once completion survives the zombie");
  assert.equal(settled.bytes, revived.bytes, "the zombie's own bytes never landed");
  const attemptsRow = await client.execute({
    sql: "select attempts,dead_letter_at from project_jobs where id=?",
    args: [killJob.id],
  });
  assert.equal(Number(attemptsRow.rows[0].attempts), 2, "exactly two claims were made");
  assert.equal(attemptsRow.rows[0].dead_letter_at, null);
  const audioChunks = await client.execute({
    sql: "select count(*) as n from project_audio where job_id=?",
    args: [killJob.id],
  });
  assert.ok(Number(audioChunks.rows[0].n) > 0, "the winning attempt's audio is stored");
  // No stray duplicate rows: every (job_id, chunk) pair is a primary key, so
  // a second successful write of the same chunk would already have thrown;
  // this only confirms the count matches a single render's own chunking.
  const expectedChunks = Math.ceil(settled.bytes / 262144) || 1;
  assert.equal(Number(audioChunks.rows[0].n), Math.max(expectedChunks, 1));
  console.log("PASS kill test: an expired lease is requeued and the job completes exactly once");

  // --- A cancelling lease that expires resolves as cancelled, not requeued
  // (the owner asked to stop; a dead instance must not silently resume it). ---
  const cancelSong = await api.publishProject(alice.userId, {
    project: longSong("Cancel-expiry test"),
    visibility: "private",
    requestKey: "render-queue-cancel-expiry",
  });
  const cancelJob = await api.createProjectJob(cancelSong.id, alice.userId, "full");
  const cancelRun = api.runProjectJob(cancelJob.id);
  for (let i = 0; i < 400; i++) {
    if ((await api.getProjectJob(cancelJob.id, alice.userId)).status === "rendering") break;
    await new Promise((r) => setTimeout(r, 10));
  }
  await client.execute({
    sql: "update project_jobs set status='cancelling',lease_expires_at=? where id=?",
    args: [Date.now() - 1, cancelJob.id],
  });
  await api.reclaimExpiredLeases(client);
  assert.equal(
    (await api.getProjectJob(cancelJob.id, alice.userId)).status,
    "cancelled",
    "an expired cancelling lease resolves as cancelled, never requeued",
  );
  await cancelRun;
  console.log("PASS an expired cancelling lease resolves as cancelled, not requeued");

  // --- Dead-letter: a lease that keeps expiring stops retrying after
  // RENDER_MAX_ATTEMPTS (default 3) and is marked failed, visibly. Driven
  // directly against the row so this is a pure state-machine test of
  // reclaimExpiredLeases, independent of any real render. ---
  const dlSong = await api.publishProject(bob.userId, {
    project: api.starterProject(),
    visibility: "private",
    requestKey: "render-queue-dead-letter",
  });
  const dlJob = await api.createProjectJob(dlSong.id, bob.userId, "full");
  for (let attempt = 1; attempt <= 3; attempt++) {
    await client.execute({
      sql: "update project_jobs set status='rendering',attempts=?,lease_expires_at=? where id=?",
      args: [attempt, Date.now() - 1, dlJob.id],
    });
    await api.reclaimExpiredLeases(client);
    const row = (
      await client.execute({
        sql: "select status,dead_letter_at,error from project_jobs where id=?",
        args: [dlJob.id],
      })
    ).rows[0];
    if (attempt < 3) {
      assert.equal(row.status, "queued", `attempt ${attempt} is still retried`);
      assert.equal(row.dead_letter_at, null);
    } else {
      assert.equal(row.status, "failed", "the third expiry exhausts RENDER_MAX_ATTEMPTS");
      assert.ok(row.dead_letter_at, "dead-lettered with a timestamp");
      assert.ok(row.error, "the failure is visible, not silent");
    }
  }
  console.log("PASS dead-letter: retries stop after RENDER_MAX_ATTEMPTS and the job fails visibly");

  // --- The concurrency bound is a setting: RENDER_CONCURRENCY=2 lets two
  // different jobs render at the same time (decision 55 keeps the default
  // at 1; this proves it is no longer hardcoded). ---
  const concurrencySongA = await api.publishProject(alice.userId, {
    project: longSong("Concurrency A"),
    visibility: "private",
    requestKey: "render-queue-concurrency-a",
  });
  const concurrencySongB = await api.publishProject(bob.userId, {
    project: longSong("Concurrency B"),
    visibility: "private",
    requestKey: "render-queue-concurrency-b",
  });
  const jobA = await api.createProjectJob(concurrencySongA.id, alice.userId, "full");
  const jobB = await api.createProjectJob(concurrencySongB.id, bob.userId, "full");
  process.env.RENDER_CONCURRENCY = "2";
  try {
    const runA = api.runProjectJob(jobA.id);
    const runB = api.runProjectJob(jobB.id);
    let bothRendering = false;
    for (let i = 0; i < 400; i++) {
      const [statusA, statusB] = await Promise.all([
        api.getProjectJob(jobA.id, alice.userId),
        api.getProjectJob(jobB.id, bob.userId),
      ]);
      if (statusA.status === "rendering" && statusB.status === "rendering") {
        bothRendering = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.ok(bothRendering, "RENDER_CONCURRENCY=2 allows two jobs to render at once");
    await Promise.all([runA, runB]);
    const [debugA, debugB] = await Promise.all([
      api.getProjectJob(jobA.id, alice.userId),
      api.getProjectJob(jobB.id, bob.userId),
    ]);
    assert.equal(debugA.status, "ready", debugA.error ?? "");
    assert.equal(debugB.status, "ready", debugB.error ?? "");
  } finally {
    delete process.env.RENDER_CONCURRENCY;
  }
  console.log("PASS the render concurrency bound is a setting, not a hardcoded 1");

  // --- The cron sweeper advances a queued render and a queued mp3 encode,
  // unauthenticated requests are refused, and a correct secret is admitted. ---
  const sweepSong = await api.publishProject(alice.userId, {
    project: api.starterProject(),
    visibility: "private",
    requestKey: "render-queue-sweep",
  });
  const sweepJob = await api.createProjectJob(sweepSong.id, alice.userId, "full");
  assert.equal(
    (await api.getProjectJob(sweepJob.id, alice.userId)).status,
    "queued",
    "nothing has rendered it yet - only the cron sweep will",
  );
  delete process.env.CRON_SECRET;
  const unauthenticated = await api.cronSweepGet(
    new Request("https://chipvoice.test/api/cron/sweep-jobs"),
  );
  assert.equal(unauthenticated.status, 401, "no secret configured refuses every request");
  process.env.CRON_SECRET = "test-cron-secret";
  const wrongSecret = await api.cronSweepGet(
    new Request("https://chipvoice.test/api/cron/sweep-jobs", {
      headers: { authorization: "Bearer wrong" },
    }),
  );
  assert.equal(wrongSecret.status, 401);
  const swept = await api.cronSweepGet(
    new Request("https://chipvoice.test/api/cron/sweep-jobs", {
      headers: { authorization: "Bearer test-cron-secret" },
    }),
  );
  assert.equal(swept.status, 200);
  const sweptBody = await swept.json();
  assert.ok(sweptBody.queued >= 1, "the sweep claimed the queued render");
  const sweptJob = await api.getProjectJob(sweepJob.id, alice.userId);
  assert.equal(sweptJob.status, "ready", "the cron sweep alone rendered it, no request needed");
  // A fresh render encodes its own mp3 inline (mp3_status goes straight to
  // 'ready'); mp3_status='queued' is the separate, older path for upgrading
  // a WAV-only row that predates that - runProjectMp3's own doc comment
  // calls it out. Force the job back into that state to exercise the
  // sweep's other loop, the same way a legacy row would arrive at it.
  assert.equal(sweptJob.mp3Status, "ready", "a fresh render encodes its own mp3 inline");
  const sweepDb = await api.db();
  await sweepDb.execute({
    sql: "delete from project_mp3 where job_id=?",
    args: [sweepJob.id],
  });
  await sweepDb.execute({
    sql: "update project_jobs set mp3_status='queued',mp3_bytes=null where id=?",
    args: [sweepJob.id],
  });
  const secondSweep = await api.cronSweepGet(
    new Request("https://chipvoice.test/api/cron/sweep-jobs", {
      headers: { authorization: "Bearer test-cron-secret" },
    }),
  );
  const secondSweepBody = await secondSweep.json();
  assert.ok(secondSweepBody.mp3 >= 1, "the sweep also claimed the queued mp3 encode");
  assert.equal(
    (await api.getProjectJob(sweepJob.id, alice.userId)).mp3Status,
    "ready",
    "the cron sweep alone encoded the mp3, no request needed",
  );
  delete process.env.CRON_SECRET;
  console.log("PASS the cron sweeper renders and encodes without any request, and refuses an unauthenticated call");
} finally {
  (await api.db()).close();
  await rm(directory, { recursive: true, force: true });
}
