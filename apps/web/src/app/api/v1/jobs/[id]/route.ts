import { projectViewer } from "@/lib/auth";
import { after } from "next/server";
import { projectRoute } from "@/lib/project-http";
import {
  getProjectJob,
  runProjectJob,
  runProjectMp3,
} from "@/lib/project-jobs";
import { db } from "@/lib/db";
import { getProject, ProjectHttpError } from "@/lib/projects";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function GET(r: Request, c: { params: Promise<{ id: string }> }) {
  const { id } = await c.params;
  return projectRoute(async (_, caller) => {
    const job = await getProjectJob(id, projectViewer(caller));
    if (
      job.status === "queued" &&
      (!caller.agent || caller.agent.scopes.includes("render")) &&
      (await getProject(job.projectId, projectViewer(caller)))?.owned
    )
      after(() => runProjectJob(id));
    if (
      job.mp3Status === "queued" &&
      (!caller.agent || caller.agent.scopes.includes("render")) &&
      (await getProject(job.projectId, projectViewer(caller)))?.owned
    )
      after(() => runProjectMp3(id));
    return job;
  })(r);
}
export async function DELETE(
  r: Request,
  c: { params: Promise<{ id: string }> },
) {
  const { id } = await c.params;
  return projectRoute(async (_, caller) => {
    const job = await getProjectJob(id, projectViewer(caller));
    if (!(await getProject(job.projectId, projectViewer(caller)))?.owned)
      throw new ProjectHttpError(404, "not_found", "Render not found");
    await (
      await db()
    ).execute({
      sql: "update project_jobs set status=case when status='rendering' then 'cancelling' else 'cancelled' end where id=? and status in ('queued','rendering')",
      args: [id],
    });
    return { ok: true };
  }, true)(r);
}
