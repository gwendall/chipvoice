import { Worker } from "node:worker_threads";
import { join } from "node:path";
import { db, newId } from "./db";
import { ProjectHttpError, admitWorkerTime, chargeWorkerTime } from "./projects";
/** Render time one caller may spend per minute across every utility action
 * (decision 33): well below the six evaluate requests per minute that
 * admitProject already allows anonymously, so a caller that never stops
 * asking cannot fill the one fleet-wide slot for everyone else. */
const ANONYMOUS_BUDGET_MS = 20000;
const ACCOUNT_BUDGET_MS = 60000;
/** A queued publication render blocks utility work only while fresh; past this
 * bound (matching the interrupted-render cleanup below) it is presumed
 * abandoned, so it stops holding the lease hostage. */
const QUEUE_STALE_MS = 270000;
/** Shared admission with publication renders; termination precedes lease release.
 * Publications go first (decision 33): the lease is refused while a fresh
 * publication render is queued, not only while one is already rendering, and a
 * caller past its per-minute render-time budget is refused before either check. */
export async function utilityWorker(
  identity: string,
  data: unknown | (() => Promise<unknown>),
  timeout = 30000,
  cancelled?: () => Promise<boolean>,
): Promise<Record<string, unknown>> {
  await admitWorkerTime(
    identity,
    identity.startsWith("anonymous:") ? ANONYMOUS_BUDGET_MS : ACCOUNT_BUDGET_MS,
  );
  const client = await db(),
    id = newId(),
    now = Date.now();
  const r = await client.execute({
    sql: `insert into evaluation_lease(singleton,id,expires_at) select 1,?,? where not exists(select 1 from project_jobs where status in ('rendering','cancelling') and started_at>?) and not exists(select 1 from project_jobs where status='queued' and created_at>?) on conflict(singleton) do update set id=excluded.id,expires_at=excluded.expires_at where evaluation_lease.expires_at<? returning id`,
    args: [id, now + timeout + 15000, now - 270000, now - QUEUE_STALE_MS, now],
  });
  if (!r.rows.length)
    throw new ProjectHttpError(
      429,
      "renderer_busy",
      "The renderer is busy; retry shortly",
    );
  try {
    const input = typeof data === "function" ? await data() : data;
    if (await cancelled?.())
      throw new ProjectHttpError(409, "cancelled", "Processing cancelled");
    const remaining = now + timeout - Date.now();
    if (remaining <= 0)
      throw new ProjectHttpError(
        422,
        "worker_limit",
        "Processing exceeded its time budget",
      );
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
        clearInterval(cancellation);
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
      let polling = false;
      const cancellation = setInterval(() => {
        if (!cancelled || ended || polling) return;
        polling = true;
        void cancelled()
          .then((stopped) => {
            if (stopped)
              finish(
                new ProjectHttpError(409, "cancelled", "Processing cancelled"),
              );
          })
          .catch((error) => finish(error))
          .finally(() => {
            polling = false;
          });
      }, 500);
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
    await chargeWorkerTime(identity, Date.now() - now);
  }
}
