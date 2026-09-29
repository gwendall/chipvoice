import { utilityWorker } from "./utility-worker";
import { SITE } from "./songs";
import { Worker } from "node:worker_threads";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Client } from "@libsql/client";
import { db, newId } from "./db";
import { PROJECT_ENGINE_VERSION } from "chipvoice";
import {
  viewerUser,
  viewerProfile,
  type Viewer,
  getProject,
  admitProject,
  ProjectHttpError,
} from "./projects";
const path = () => join(process.cwd(), "generated/project-render.cjs");

/** Decision 55: the render worker's own hard deadline - also
 * `runProjectMp3`'s `utilityWorker` timeout - and the one number every
 * other duration below is measured against: `LEASE_TIMEOUT_MS` (how long a
 * lease outlives it) and `SWEEP_START_CUTOFF_MS` (how much of the cron
 * sweep's own function budget a new job's worst case may still use). */
const WORKER_DEADLINE_MS = 240000;

/** Decision 55: how long a claimed render's lease stands before it is
 * reclaimable, unchanged from the 270-second staleness window decision
 * 27/33 already used - `WORKER_DEADLINE_MS` plus 30 seconds' margin for
 * termination and the final write. */
const LEASE_TIMEOUT_MS = WORKER_DEADLINE_MS + 30000;

/** Decision 55 (NEXT-19 review fix): the cron sweep route's own Vercel
 * `maxDuration` - 300 seconds, matching the jobs/render/generations routes'
 * budget on this plan (`apps/web/src/app/api/cron/sweep-jobs/route.ts`).
 * `sweepProjectJobs` must never start a job whose worst case
 * (`WORKER_DEADLINE_MS`) plus a margin for its own final write and function
 * teardown could still be running when Vercel kills the function outright -
 * that leaves the lease held until `LEASE_TIMEOUT_MS` expires before anyone
 * retries it, exactly the failure the sweep exists to prevent. 300 - 240 -
 * 20 = 40: the sweep only starts new work in the first 40 seconds of its
 * own run. A losing claim (every row another instance already holds) still
 * returns near-instantly after that, so this never blocks reclaiming leases
 * or reporting queue depth, only starting fresh long-running work. */
const SWEEP_MAX_DURATION_MS = 300000;
const SWEEP_WRITE_MARGIN_MS = 20000;
const SWEEP_START_CUTOFF_MS =
  SWEEP_MAX_DURATION_MS - WORKER_DEADLINE_MS - SWEEP_WRITE_MARGIN_MS;

/** Pure and exported so the 40-second cutoff above is testable with an
 * injected clock, without stubbing the database or running a real render:
 * true while `sweepProjectJobs` may still start another job without risking
 * Vercel killing the function mid-render. */
export function sweepHasBudget(start: number, now = Date.now()): boolean {
  return now - start < SWEEP_START_CUTOFF_MS;
}

/** How many jobs may hold `status in ('rendering','cancelling')` at once.
 * Decision 55 keeps decision 27/33's single fleet-wide slot as the default,
 * but makes it a setting (`RENDER_CONCURRENCY`) rather than a hardcoded 1.
 * Raising it past 1 in production also needs `evaluation_lease` (a singleton
 * table today) to stop being a hard second 1-slot bound before it changes
 * anything; see decision 55's own text for why that is not done here. */
function renderConcurrency(): number {
  const n = Number(process.env.RENDER_CONCURRENCY ?? 1);
  if (!Number.isSafeInteger(n) || n < 1 || n > 8)
    throw new ProjectHttpError(503, "render_misconfigured", "Invalid RENDER_CONCURRENCY");
  return n;
}

/** How many times decision 55's sweep may reclaim and retry a lease before
 * dead-lettering the job. `RENDER_MAX_ATTEMPTS`, default 3: the first claim
 * plus two retries. */
function renderMaxAttempts(): number {
  const n = Number(process.env.RENDER_MAX_ATTEMPTS ?? 3);
  if (!Number.isSafeInteger(n) || n < 1 || n > 10)
    throw new ProjectHttpError(503, "render_misconfigured", "Invalid RENDER_MAX_ATTEMPTS");
  return n;
}

/**
 * Decision 55's sweep: reclaims leases nobody is renewing, whether or not
 * the instance that held one is still alive. Called from every path that
 * already touches a job - a claim attempt, a status read - and from the
 * cron sweeper (`sweepProjectJobs`), so the queue advances even when nobody
 * ever polls again.
 *
 * - A `cancelling` lease that expires resolves as `cancelled`: the owner
 *   asked to stop, so an expired lease must never silently resume it.
 * - A `rendering` lease that expires with attempts left goes back to
 *   `queued`, for the next claim to pick up exactly like a fresh job.
 * - A `rendering` lease that expires with no attempts left is dead-lettered:
 *   `failed`, with `dead_letter_at` set, so it stops being retried but stays
 *   visible as a job rather than silently vanishing.
 *
 * `lease_expires_at is null` (a row claimed by code older than this
 * migration, or never given a lease at all) is treated as already expired,
 * not as never expiring, so no row can get stuck forever for lack of one.
 *
 * Returns how many rendering jobs were requeued, the number a caller that
 * wants to know whether it did anything can check.
 */
export async function reclaimExpiredLeases(client: Client, now = Date.now()) {
  const maxAttempts = renderMaxAttempts();
  await client.execute({
    sql: "update project_jobs set status='cancelled',lease_expires_at=null where status='cancelling' and (lease_expires_at is null or lease_expires_at<?)",
    args: [now],
  });
  await client.execute({
    sql: "update project_jobs set status='failed',error='Render failed after repeated interruptions; publish a new revision to retry',dead_letter_at=?,lease_expires_at=null where status='rendering' and (lease_expires_at is null or lease_expires_at<?) and attempts>=?",
    args: [now, now, maxAttempts],
  });
  const requeued = await client.execute({
    sql: "update project_jobs set status='queued',lease_expires_at=null where status='rendering' and (lease_expires_at is null or lease_expires_at<?) and attempts<? returning id",
    args: [now, maxAttempts],
  });
  return requeued.rows.length;
}

/**
 * Decision 55's cron entry point (`/api/cron/sweep-jobs`): reclaims expired
 * leases, then advances the queue itself, so a job's progress never depends
 * on the instance that accepted the original request staying alive. Also
 * drives mp3 encoding the same way - it holds no lease of its own (decision
 * 55 explains why re-running it is always safe, so it needs no fencing),
 * so the sweep simply retries any row still `mp3_status='queued'`. Bounded
 * by the same single fleet-wide slot as a request-triggered render: kicking
 * more queued rows than the slot admits is harmless, since every losing
 * claim just returns immediately.
 *
 * Decision 55 (NEXT-19 review fix): starting a render or mp3 encode is the
 * only slow part of a sweep - reclaiming leases and counting rows are both
 * cheap and always run in full - so `sweepHasBudget` guards only the two
 * loops below, stopping before this function's own `maxDuration` could kill
 * it mid-render with the lease still held. `queued`/`mp3` in the return
 * value still count every row the sweep found, whether or not this run had
 * budget left to start it - a skipped row is not lost, only left for the
 * next tick or a live request to claim.
 */
export async function sweepProjectJobs(limit = 20) {
  const client = await db(),
    start = Date.now();
  const reclaimed = await reclaimExpiredLeases(client, start);
  const queued = await client.execute({
    sql: "select id from project_jobs where status='queued' order by created_at limit ?",
    args: [limit],
  });
  for (const row of queued.rows) {
    if (!sweepHasBudget(start)) break;
    await runProjectJob(String(row.id));
  }
  const pendingMp3 = await client.execute({
    sql: "select id from project_jobs where mp3_status='queued' order by created_at limit ?",
    args: [limit],
  });
  for (const row of pendingMp3.rows) {
    if (!sweepHasBudget(start)) break;
    await runProjectMp3(String(row.id));
  }
  return {
    reclaimed,
    queued: queued.rows.length,
    mp3: pendingMp3.rows.length,
  };
}
let identity: string | undefined;
export function rendererIdentity() {
  return (identity ??= createHash("sha256")
    .update(readFileSync(path()))
    .digest("hex"));
}
export async function createProjectJob(
  projectId: string,
  userId: Viewer,
  kind: "preview" | "full",
) {
  const publication = await getProject(projectId, userId);
  if (!publication || !publication.owned)
    throw new ProjectHttpError(
      404,
      "not_found",
      "Your publication was not found",
    );
  const client = await db(),
    existing = await client.execute({
      sql: "select * from project_jobs where project_id=? and kind=?",
      args: [projectId, kind],
    });
  if (existing.rows[0]) {
    const row = existing.rows[0];
    if (
      row.status === "ready" &&
      !row.mp3_bytes &&
      ["none", "cancelled", "failed"].includes(String(row.mp3_status))
    ) {
      await admitProject(`render:${viewerUser(userId)}`, 3);
      await client.execute({
        sql: "update project_jobs set mp3_status='queued',mp3_error=null where id=? and mp3_status in ('none','cancelled','failed')",
        args: [row.id],
      });
      row.mp3_status = "queued";
    }
    return jobView(row);
  }
  // A render always uses whatever engine is live on the server now (decision
  // 43); it is never refused for differing from the publication's own
  // engineVersion. The job records the version that actually rendered it,
  // which is honest on its own: a rendition never claims to be a recording
  // it is not, whether or not its version matches the publication's.
  await admitProject(`render:${viewerUser(userId)}`, 3);
  await client.execute({
    sql: "insert into project_jobs(id,project_id,kind,status,engine,engine_version,created_at) values(?,?,?,'queued',?,?,?) on conflict(project_id,kind) do nothing",
    args: [newId(), projectId, kind, rendererIdentity(), PROJECT_ENGINE_VERSION, Date.now()],
  });
  return jobView(
    (
      await client.execute({
        sql: "select * from project_jobs where project_id=? and kind=?",
        args: [projectId, kind],
      })
    ).rows[0],
  );
}
function jobView(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    kind: String(row.kind),
    status: String(row.status),
    engine: String(row.engine),
    engineVersion: row.engine_version == null ? null : String(row.engine_version),
    progress: Number(row.progress),
    bytes: Number(row.bytes ?? 0),
    error: row.error ? String(row.error) : null,
    wavUrl:
      row.status === "ready" ? `${SITE}/api/v1/jobs/${row.id}/audio` : null,
    mp3Url:
      row.status === "ready" && row.mp3_bytes
        ? `${SITE}/api/v1/jobs/${row.id}/audio?format=mp3`
        : null,
    mp3Bytes: Number(row.mp3_bytes ?? 0),
    mp3Status: String(row.mp3_status ?? "none"),
    mp3Error: row.mp3_error ? String(row.mp3_error) : null,
    pageUrl: `${SITE}/p/${row.project_id}`,
    coverUrl: `${SITE}/api/v1/projects/${row.project_id}/cover`,
    audio: row.status === "ready" ? `/api/v1/jobs/${row.id}/audio` : null,
  };
}
export async function getProjectJob(id: string, viewer: Viewer) {
  const client = await db();
  // Decision 55: reclaim before reading, so a lease nobody renewed reports
  // its post-sweep state (queued for a retry, or failed once dead-lettered)
  // rather than a stale 'rendering'/'cancelling' a dead instance never left.
  await reclaimExpiredLeases(client);
  const result = await client.execute({
    // A progress read needs authorization, not the entire project JSON and report.
    sql: "select j.* from project_jobs j join projects p on p.id=j.project_id where j.id=? and p.deleted_at is null and (p.visibility<>'private' or (p.user_id=? and (? is null or p.profile_id=?)))",
    args: [id, viewerUser(viewer), viewerProfile(viewer), viewerProfile(viewer)],
  });
  const row = result.rows[0];
  if (!row)
    throw new ProjectHttpError(404, "not_found", "Render not found");
  return jobView(row);
}
export async function runProjectJob(id: string) {
  const client = await db(),
    now = Date.now();
  // Decision 55: reclaim expired leases before claiming, so a job a dead
  // instance abandoned is retried (or dead-lettered) instead of holding the
  // fleet-wide slot forever.
  await reclaimExpiredLeases(client, now);
  const claim = await client.execute({
    sql: "update project_jobs set status='rendering',started_at=?,lease_expires_at=?,attempts=attempts+1 where id=? and status='queued' and (select count(*) from project_jobs where status in ('rendering','cancelling')) < ? and not exists(select 1 from evaluation_lease where expires_at>?) returning *",
    args: [now, now + LEASE_TIMEOUT_MS, id, renderConcurrency(), now],
  });
  const row = claim.rows[0];
  if (!row) return;
  // Decision 55's fencing token: this claim's own attempt number. Every
  // write this run makes back to the job is guarded by it, so a run whose
  // lease already expired and was reclaimed by a later claim (attempts no
  // longer matches) loses every write instead of clobbering the newer
  // attempt's state - the "exactly once" half of the durable queue.
  const attempt = Number(row.attempts);
  try {
    if (row.engine !== rendererIdentity())
      throw Error("Prepared with a different engine; publish a new revision");
    const p = await client.execute({
      sql: "select p.document,p.title,f.display_name,f.handle from projects p join profiles f on f.id=p.profile_id where p.id=? and p.deleted_at is null",
      args: [row.project_id],
    });
    if (!p.rows[0]) throw Error("Publication was withdrawn");
    const { bytes, mp3 } = await new Promise<{
      bytes: Uint8Array;
      mp3: Uint8Array;
    }>((resolve, reject) => {
      const worker = new Worker(path(), {
        workerData: {
          project: JSON.parse(String(p.rows[0].document)),
          kind: row.kind,
          tags: {
            title: String(p.rows[0].title),
            artist: String(
              p.rows[0].display_name || p.rows[0].handle || "chipvoice",
            ),
            album: "chipvoice",
            genre: "Chiptune",
            url: `${SITE}/p/${row.project_id}`,
          },
        },
        resourceLimits: { maxOldGenerationSizeMb: 256 },
      });
      let ended = false;
      const finish = (
        error?: Error,
        bytes?: { bytes: Uint8Array; mp3: Uint8Array },
      ) => {
        if (ended) return;
        ended = true;
        clearTimeout(timer);
        clearInterval(cancellation);
        void worker
          .terminate()
          .then(() => (error ? reject(error) : resolve(bytes!)), reject);
      };
      const timer = setTimeout(
        () =>
          finish(
            Error(
              `Render exceeded ${WORKER_DEADLINE_MS / 1000} seconds; export locally`,
            ),
          ),
        WORKER_DEADLINE_MS,
      );
      let polling = false;
      const cancellation = setInterval(() => {
        if (polling || ended) return;
        polling = true;
        void client
          .execute({
            // Decision 55: fenced by attempt too, so a lease this run's own
            // claim already lost to a later attempt (reclaimed and reclaimed
            // again) is noticed within one poll instead of rendering to
            // completion for nothing.
            sql: "select status from project_jobs where id=? and attempts=?",
            args: [id, attempt],
          })
          .then((result) => {
            if (result.rows[0]?.status !== "rendering")
              finish(Error("Render cancelled"));
          })
          .catch((error) => finish(error))
          .finally(() => {
            polling = false;
          });
      }, 500);
      worker.on("message", (message) => {
        if (message.progress !== undefined) {
          void client
            .execute({
              sql: "update project_jobs set progress=? where id=? and status='rendering' and attempts=? returning id",
              args: [message.progress, id, attempt],
            })
            .then((result) => {
              if (!result.rows.length) finish(Error("Render cancelled"));
            })
            .catch((error) => finish(error));
          return;
        }
        finish(message.error ? Error(message.error) : undefined, {
          bytes: message.bytes,
          mp3: message.mp3,
        });
      });
      worker.once("error", (error) => finish(error));
      worker.once("exit", () => {
        if (!ended) finish(Error("Render worker exited"));
      });
    });
    if (bytes.byteLength > 40 * 1024 * 1024)
      throw Error(
        "Server audio exceeds 40 MB; export the complete song locally",
      );
    const tx = await client.transaction("write");
    try {
      // Decision 55: fenced by attempt - a run whose lease already expired
      // and was reclaimed (a later claim bumped attempts) finds nothing
      // active here and rolls back without writing a single audio chunk,
      // however far its own render got.
      const active = await tx.execute({
        sql: "select 1 from project_jobs j join projects p on p.id=j.project_id where j.id=? and j.status='rendering' and j.attempts=? and p.deleted_at is null",
        args: [id, attempt],
      });
      if (!active.rows.length) {
        await tx.rollback();
        return;
      }
      for (
        let offset = 0, chunk = 0;
        offset < bytes.length;
        offset += 262144, chunk++
      )
        await tx.execute({
          sql: "insert into project_audio values(?,?,?)",
          args: [id, chunk, bytes.slice(offset, offset + 262144)],
        });
      for (
        let offset = 0, chunk = 0;
        offset < mp3.length;
        offset += 262144, chunk++
      )
        await tx.execute({
          sql: "insert into project_mp3 values(?,?,?)",
          args: [id, chunk, mp3.slice(offset, offset + 262144)],
        });
      await tx.execute({
        sql: "update project_jobs set status='ready',finished_at=?,bytes=?,etag=?,progress=1,mp3_status='ready',mp3_bytes=?,lease_expires_at=null where id=? and attempts=?",
        args: [
          Date.now(),
          bytes.length,
          createHash("sha256").update(bytes).digest("hex"),
          mp3.length,
          id,
          attempt,
        ],
      });
      await tx.commit();
    } catch (error) {
      await tx.rollback();
      throw error;
    } finally {
      tx.close();
    }
  } catch (error) {
    // Decision 55: fenced by attempt, so a superseded run's own failure -
    // including the "Render cancelled" a lost fencing check above raises -
    // can never mark a newer attempt's job failed.
    await client.execute({
      sql: "update project_jobs set status='failed',error=?,lease_expires_at=null where id=? and status='rendering' and attempts=?",
      args: [error instanceof Error ? error.message : "Render failed", id, attempt],
    });
  } finally {
    // Keep admission closed until termination, including cancellation during storage.
    await client.execute({
      sql: "update project_jobs set status='cancelled',lease_expires_at=null where id=? and status='cancelling' and attempts=?",
      args: [id, attempt],
    });
  }
}

/** Upgrade an older WAV by encoding its stored bytes, never by rerendering music. */
export async function runProjectMp3(id: string) {
  const client = await db();
  const row = (
    await client.execute({
      sql: `select j.*,p.user_id,p.title,f.display_name,f.handle from project_jobs j join projects p on p.id=j.project_id join profiles f on f.id=p.profile_id where j.id=? and j.status='ready' and j.mp3_status='queued' and p.deleted_at is null`,
      args: [id],
    })
  ).rows[0];
  if (!row) return;
  try {
    const result = await utilityWorker(
      String(row.user_id),
      async () => {
        const chunks = await client.execute({
          sql: "select bytes from project_audio where job_id=? order by chunk",
          args: [id],
        });
        const wav = Buffer.concat(
          chunks.rows.map((r) => Buffer.from(r.bytes as ArrayBuffer)),
        );
        return {
          wav,
          tags: {
            title: String(row.title),
            artist: String(row.display_name || row.handle || "chipvoice"),
            album: "chipvoice",
            genre: "Chiptune",
            url: `${SITE}/p/${row.project_id}`,
          },
        };
      },
      WORKER_DEADLINE_MS,
      async () => {
        const active = await client.execute({
          sql: "select 1 from project_jobs j join projects p on p.id=j.project_id where j.id=? and j.mp3_status='queued' and p.deleted_at is null",
          args: [id],
        });
        return active.rows.length === 0;
      },
    );
    const mp3 = result.mp3 as Uint8Array,
      tx = await client.transaction("write");
    try {
      const active = await tx.execute({
        sql: `select 1 from project_jobs j join projects p on p.id=j.project_id where j.id=? and j.mp3_status='queued' and p.deleted_at is null`,
        args: [id],
      });
      if (active.rows.length) {
        for (
          let offset = 0, chunk = 0;
          offset < mp3.length;
          offset += 262144, chunk++
        )
          await tx.execute({
            sql: "insert into project_mp3 values(?,?,?)",
            args: [id, chunk, mp3.slice(offset, offset + 262144)],
          });
        await tx.execute({
          sql: "update project_jobs set mp3_status='ready',mp3_bytes=? where id=?",
          args: [mp3.length, id],
        });
      }
      await tx.commit();
    } catch (e) {
      await tx.rollback();
      throw e;
    } finally {
      tx.close();
    }
  } catch (e) {
    if (e instanceof ProjectHttpError && e.status === 429) return;
    await client.execute({
      sql: "update project_jobs set mp3_status='failed',mp3_error=? where id=? and mp3_status='queued'",
      args: [e instanceof Error ? e.message : "MP3 encoding failed", id],
    });
  }
}
