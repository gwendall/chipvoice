import { utilityWorker } from "./utility-worker";
import { SITE } from "./songs";
import { Worker } from "node:worker_threads";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db, newId } from "./db";
import {
  viewerUser,
  type Viewer,
  getProject,
  admitProject,
  ProjectHttpError,
} from "./projects";
const path = () => join(process.cwd(), "generated/project-render.cjs");
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
  await admitProject(`render:${viewerUser(userId)}`, 3);
  await client.execute({
    sql: "insert into project_jobs(id,project_id,kind,status,engine,created_at) values(?,?,?,'queued',?,?) on conflict(project_id,kind) do nothing",
    args: [newId(), projectId, kind, rendererIdentity(), Date.now()],
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
  const result = await (
    await db()
  ).execute({ sql: "select * from project_jobs where id=?", args: [id] });
  const row = result.rows[0];
  if (
    ["rendering", "cancelling"].includes(String(row?.status)) &&
    Number(row.started_at) < Date.now() - 270000
  ) {
    await (
      await db()
    ).execute({
      sql: "update project_jobs set status='failed',error='Render interrupted; publish a new revision to retry' where id=? and status in ('rendering','cancelling')",
      args: [id],
    });
    row.status = "failed";
    row.error = "Render interrupted; publish a new revision to retry";
  }
  if (!row || !(await getProject(String(row.project_id), viewer)))
    throw new ProjectHttpError(404, "not_found", "Render not found");
  return jobView(row);
}
export async function runProjectJob(id: string) {
  const client = await db(),
    now = Date.now();
  // Expired leases fail visibly instead of producing a different engine's audio.
  await client.execute({
    sql: "update project_jobs set status='failed',error='Render interrupted; publish a new revision to retry' where status in ('rendering','cancelling') and started_at<?",
    args: [now - 270000],
  });
  const claim = await client.execute({
    sql: "update project_jobs set status='rendering',started_at=? where id=? and status='queued' and not exists(select 1 from project_jobs where status in ('rendering','cancelling')) and not exists(select 1 from evaluation_lease where expires_at>?) returning *",
    args: [now, id, now],
  });
  const row = claim.rows[0];
  if (!row) return;
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
        () => finish(Error("Render exceeded 240 seconds; export locally")),
        240000,
      );
      let polling = false;
      const cancellation = setInterval(() => {
        if (polling || ended) return;
        polling = true;
        void client
          .execute({
            sql: "select status from project_jobs where id=?",
            args: [id],
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
              sql: "update project_jobs set progress=? where id=? and status='rendering' returning id",
              args: [message.progress, id],
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
      const active = await tx.execute({
        sql: "select 1 from project_jobs j join projects p on p.id=j.project_id where j.id=? and j.status='rendering' and p.deleted_at is null",
        args: [id],
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
        sql: "update project_jobs set status='ready',finished_at=?,bytes=?,etag=?,progress=1,mp3_status='ready',mp3_bytes=? where id=?",
        args: [
          Date.now(),
          bytes.length,
          createHash("sha256").update(bytes).digest("hex"),
          mp3.length,
          id,
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
    await client.execute({
      sql: "update project_jobs set status='failed',error=? where id=? and status='rendering'",
      args: [error instanceof Error ? error.message : "Render failed", id],
    });
  } finally {
    // Keep admission closed until termination, including cancellation during storage.
    await client.execute({
      sql: "update project_jobs set status='cancelled' where id=? and status='cancelling'",
      args: [id],
    });
  }
}

/** Upgrade an older WAV by encoding its stored bytes, never by rerendering music. */
export async function runProjectMp3(id: string) {
  const client = await db();
  const row = (
    await client.execute({
      sql: `select j.*,p.title,f.display_name,f.handle from project_jobs j join projects p on p.id=j.project_id join profiles f on f.id=p.profile_id where j.id=? and j.status='ready' and j.mp3_status='queued' and p.deleted_at is null`,
      args: [id],
    })
  ).rows[0];
  if (!row) return;
  try {
    const result = await utilityWorker(
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
            url: `${SITE}/p/${row.project_id}`,
          },
        };
      },
      240000,
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
