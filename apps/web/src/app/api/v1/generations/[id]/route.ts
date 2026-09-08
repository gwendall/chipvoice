import { after } from "next/server";
import { projectRoute } from "@/lib/project-http";
import { getGeneration, runGeneration, cancelGeneration } from "@/lib/composition/jobs";
import { runProjectJob } from "@/lib/project-jobs";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return projectRoute(async (_, caller) => {
    const job = await getGeneration(id, caller);
    if (["queued", "validating", "saving"].includes(job.status)) after(() => runGeneration(id));
    const render = job.render;
    if (job.status === "rendering" && render?.status === "queued") after(() => runProjectJob(render.id));
    return Response.json(job, { headers: { "Cache-Control": "no-store", "Retry-After": "2" } });
  }, true)(request);
}
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return projectRoute((_, caller) => cancelGeneration(id, caller), true)(request);
}
