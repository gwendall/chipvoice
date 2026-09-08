import { after } from "next/server";
import { projectRoute, readProjectBody } from "@/lib/project-http";
import { createGeneration, runGeneration } from "@/lib/composition/jobs";
export const runtime = "nodejs";
export const maxDuration = 300;
export const POST = projectRoute(async (request, caller) => {
  const job = await createGeneration(await readProjectBody(request, 16384), request.headers.get("idempotency-key") ?? "", caller);
  if (["queued", "validating", "saving"].includes(job.status)) after(() => runGeneration(job.id));
  return Response.json(job, { status: job.status === "ready" ? 200 : 202, headers: { "Cache-Control": "no-store", "Retry-After": "2" } });
}, true);
