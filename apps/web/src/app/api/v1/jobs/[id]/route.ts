import { after } from "next/server";
import { projectRoute } from "@/lib/project-http";
import { getProjectJob, runProjectJob } from "@/lib/project-jobs";
import { db } from "@/lib/db";
import { getProject, ProjectHttpError } from "@/lib/projects";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function GET(r: Request, c: { params: Promise<{ id: string }> }) {
  const { id } = await c.params;
  return projectRoute(async (_, caller) => {
    const job = await getProjectJob(id, caller.userId);
    if (
      job.status === "queued" &&
      (await getProject(job.projectId, caller.userId))?.owned
    )
      after(() => runProjectJob(id));
    return job;
  })(r);
}
export async function DELETE(
  r: Request,
  c: { params: Promise<{ id: string }> },
) {
  const { id } = await c.params;
  return projectRoute(async (_, caller) => {
    const job = await getProjectJob(id, caller.userId);
    if (!(await getProject(job.projectId, caller.userId))?.owned)
      throw new ProjectHttpError(404, "not_found", "Render not found");
    await (
      await db()
    ).execute({
      sql: "update project_jobs set status='cancelled' where id=? and status in ('queued','rendering')",
      args: [id],
    });
    return { ok: true };
  }, true)(r);
}
