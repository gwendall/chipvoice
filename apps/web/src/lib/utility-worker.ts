import { Worker } from "node:worker_threads";
import { join } from "node:path";
import { db, newId } from "./db";
import { ProjectHttpError } from "./projects";
/** Shared admission with publication renders; termination precedes lease release. */
export async function utilityWorker(
  data: unknown | (() => Promise<unknown>),
  timeout = 30000,
): Promise<Record<string, unknown>> {
  const client = await db(),
    id = newId(),
    now = Date.now();
  const r = await client.execute({
    sql: `insert into evaluation_lease(id,expires_at) select ?,? where not exists(select 1 from project_jobs where status in ('rendering','cancelling') and started_at>?) on conflict(singleton) do update set id=excluded.id,expires_at=excluded.expires_at where evaluation_lease.expires_at<? returning id`,
    args: [id, now + timeout + 15000, now - 270000, now],
  });
  if (!r.rows.length)
    throw new ProjectHttpError(
      429,
      "renderer_busy",
      "The renderer is busy; retry shortly",
    );
  try {
    const input = typeof data === "function" ? await data() : data;
    const remaining=now+timeout-Date.now();
    if(remaining<=0) throw new ProjectHttpError(422,"worker_limit","Processing exceeded its time budget");
    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      const worker = new Worker(
        join(process.cwd(), "generated/project-render.cjs"),
        { workerData: input, resourceLimits: { maxOldGenerationSizeMb: 256 } },
      );
      let ended = false;
      const finish = (error?: Error, value?: Record<string, unknown>) => {
        if (ended) return;
        ended = true;
        clearTimeout(timer);
        void worker
          .terminate()
          .then(() => (error ? reject(error) : resolve(value!)), reject);
      };
      const timer = setTimeout(
        () =>
          finish(
            new ProjectHttpError(
              422,
              "worker_limit",
              "Processing exceeded its time budget; export or evaluate locally",
            ),
          ),
        remaining,
      );
      worker.on("message", (m) => {
        if (m.progress !== undefined) return;
        finish(
          m.error
            ? new ProjectHttpError(422, "processing_failed", m.error)
            : undefined,
          m,
        );
      });
      worker.once("error", () =>
        finish(
          new ProjectHttpError(
            422,
            "worker_limit",
            "Processing exceeded its worker budget",
          ),
        ),
      );
      worker.once("exit", () => {
        if (!ended)
          finish(
            new ProjectHttpError(422, "processing_failed", "Worker stopped"),
          );
      });
    });
  } finally {
    await client.execute({
      sql: "delete from evaluation_lease where id=?",
      args: [id],
    });
  }
}
