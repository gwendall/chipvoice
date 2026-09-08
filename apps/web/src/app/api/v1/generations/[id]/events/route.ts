import { after } from "next/server";
import { setTimeout as delay } from "node:timers/promises";
import { projectRoute } from "@/lib/project-http";
import { identify } from "@/lib/auth";
import { authorizeAgent } from "@/lib/agents";
import { getGeneration, runGeneration } from "@/lib/composition/jobs";
import { runProjectJob } from "@/lib/project-jobs";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Durable snapshots work across serverless instances and reconnects. Disconnecting
 * an observer never aborts or repeats paid composition. No score/prompt is streamed. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return projectRoute(async (_, caller) => {
    let job = await getGeneration(id, caller, true);
    const encoder = new TextEncoder(), stop = new AbortController();
    const signal = AbortSignal.any([request.signal, stop.signal]);
    const expires = Date.now() + 20000;
    let first = true, composition: Promise<void> | undefined, rendering: Promise<void> | undefined;
    const work: Promise<unknown>[] = [];
    // Register while Next's request scope exists. Stream pull callbacks run outside it.
    after(async () => { await Promise.all(work); });
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          if (!first) {
            if (Date.now() >= expires) { controller.close(); return; }
            await delay(2000, undefined, { signal });
            const current = await identify(request);
            if (!current.userId || current.userId !== caller.userId) throw Error("Authorization expired");
            authorizeAgent(request, current);
            job = await getGeneration(id, current, true);
          }
          first = false;
          if (signal.aborted) { controller.close(); return; }
          if (!composition && ["queued", "validating", "saving"].includes(job.status)) {
            composition = runGeneration(id).finally(() => { composition = undefined; });
            work.push(composition.catch(() => undefined));
          }
          if (!rendering && job.status === "rendering" && job.render?.status === "queued") {
            rendering = runProjectJob(job.render.id).finally(() => { rendering = undefined; });
            work.push(rendering.catch(() => undefined));
          }
          const { status, projectId, createdAt, finishedAt, errorCode, progress } = job;
          controller.enqueue(encoder.encode(`event: progress\ndata: ${JSON.stringify({ id, status, projectId, createdAt, finishedAt, errorCode, progress })}\n\n`));
          if (["ready", "failed", "cancelled"].includes(status)) controller.close();
        } catch {
          if (!signal.aborted) {
            controller.enqueue(encoder.encode('event: unavailable\ndata: {}\n\n'));
          }
          if (!stop.signal.aborted) controller.close();
        }
      },
      cancel() { stop.abort(); },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "private, no-store, no-transform", "X-Accel-Buffering": "no" } });
  }, true)(request);
}
