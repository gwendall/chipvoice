import { projectRoute } from "@/lib/project-http";
import { compositionAvailability } from "@/lib/composition/jobs";
export const runtime = "nodejs";
/** Whether the signed-in account may compose now, and why not (decision 42). */
export const GET = projectRoute(async (_request, caller) => compositionAvailability(caller), true);
