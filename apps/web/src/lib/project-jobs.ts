import { Worker } from "node:worker_threads";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db, newId } from "./db";
import { getProject, admitProject, ProjectHttpError } from "./projects";
const path = () => join(process.cwd(), "generated/project-render.cjs");
let identity: string | undefined;
export function rendererIdentity() {
  return (identity ??= createHash("sha256")
    .update(readFileSync(path()))
    .digest("hex"));
}
export async function createProjectJob(
  projectId: string,
  userId: string,
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
  if (existing.rows[0]) return jobView(existing.rows[0]);
  await admitProject(`render:${userId}`, 3);
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
    audio: row.status === "ready" ? `/api/v1/jobs/${row.id}/audio` : null,
  };
}
export async function getProjectJob(id: string, viewer: string | null) {
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
    sql: "update project_jobs set status='rendering',started_at=? where id=? and status='queued' and not exists(select 1 from project_jobs where status in ('rendering','cancelling')) returning *",
    args: [now, id],
  });
  const row = claim.rows[0];
  if (!row) return;
  try {
    if (row.engine !== rendererIdentity())
      throw Error("Prepared with a different engine; publish a new revision");
    const p = await client.execute({
      sql: "select document from projects where id=? and deleted_at is null",
      args: [row.project_id],
    });
    if (!p.rows[0]) throw Error("Publication was withdrawn");
    const bytes = await new Promise<Uint8Array>((resolve, reject) => {
      const worker = new Worker(path(), {
        workerData: {
          project: JSON.parse(String(p.rows[0].document)),
          kind: row.kind,
        },
        resourceLimits: { maxOldGenerationSizeMb: 256 },
      });
      let ended = false;
      const finish = (error?: Error, bytes?: Uint8Array) => {
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
        finish(message.error ? Error(message.error) : undefined, message.bytes);
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
      await tx.execute({
        sql: "update project_jobs set status='ready',finished_at=?,bytes=?,etag=?,progress=1 where id=?",
        args: [
          Date.now(),
          bytes.length,
          createHash("sha256").update(bytes).digest("hex"),
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
