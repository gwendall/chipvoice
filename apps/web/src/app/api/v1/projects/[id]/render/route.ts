import { projectViewer } from "@/lib/auth";
import { after } from "next/server";
import { projectRoute, readProjectBody, objectBody } from "@/lib/project-http";
import {
  createProjectJob,
  runProjectJob,
  runProjectMp3,
} from "@/lib/project-jobs";
import { ProjectHttpError } from "@/lib/projects";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return projectRoute(async (r, caller) => {
    const body = objectBody(await readProjectBody(r, 1024), ["kind"]);
    if (body.kind !== "preview" && body.kind !== "full")
      throw new ProjectHttpError(422, "invalid_kind", "Choose preview or full");
    const job = await createProjectJob(id, projectViewer(caller), body.kind);
    if (job.status === "queued") after(() => runProjectJob(job.id));
    if (job.mp3Status === "queued") after(() => runProjectMp3(job.id));
    return Response.json(job, {
      status: job.status === "ready" ? 200 : 202,
      headers: { "Cache-Control": "no-store" },
    });
  }, true)(request);
}
