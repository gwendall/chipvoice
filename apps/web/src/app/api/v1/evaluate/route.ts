import { projectRoute, readProjectBody } from "@/lib/project-http";
import { evaluateProject } from "@/lib/evaluation";
import { clientKey } from "@/lib/limit";
export const runtime = "nodejs";
export const maxDuration = 60;
export const POST = projectRoute(async (request, caller) =>
  evaluateProject(
    await readProjectBody(request),
    caller.userId ?? `anonymous:${clientKey(request)}`,
  ),
);
