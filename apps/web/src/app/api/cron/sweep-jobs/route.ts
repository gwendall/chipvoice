import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { sweepProjectJobs } from "@/lib/project-jobs";

/**
 * Decision 55 (NEXT-19): Vercel Cron's own convention for an endpoint it
 * calls on a schedule - `Authorization: Bearer $CRON_SECRET`, added
 * automatically to the request once `CRON_SECRET` is set on the project -
 * checked the same constant-time way `songs/[id]/route.ts` checks
 * `CHIPVOICE_ADMIN_KEY`. An unset secret refuses every request outright; it
 * must never compare equal to anything, however the header is spelled.
 */
function isCronRequest(request: Request): boolean {
  const configured = process.env.CRON_SECRET;
  if (!configured) return false;
  const header = request.headers.get("authorization") ?? "";
  const presented = /^Bearer (.+)$/.exec(header)?.[1];
  if (!presented) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(presented), digest(configured));
}

export const runtime = "nodejs";
// Decision 55: matches the jobs/render/generations routes' own 300s budget
// on this plan - a render the sweep claims can take up to its own
// 240-second worker deadline, so a 60s function budget would get the
// function itself killed mid-render with the lease still held (the job then
// sits until LEASE_TIMEOUT_MS expires before anyone retries it, which is
// exactly the outcome this route exists to avoid). `sweepProjectJobs`'s own
// start-budget (`sweepHasBudget`, `apps/web/src/lib/project-jobs.ts`) keeps
// it from starting a job it cannot still finish inside this window.
export const maxDuration = 300;

/**
 * The durable queue's cron entry point: reclaims leases a dead instance
 * never renewed (requeuing them for a retry, or dead-lettering them once
 * `RENDER_MAX_ATTEMPTS` is spent) and advances whatever is queued, so a
 * job's progress never depends on the instance that accepted the original
 * request staying alive. `vercel.json`'s `crons` entry is what actually
 * calls this on a schedule in production; see decision 55.
 */
export async function GET(request: Request) {
  if (!isCronRequest(request))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const result = await sweepProjectJobs();
  return NextResponse.json(result, {
    headers: { "Cache-Control": "no-store" },
  });
}
