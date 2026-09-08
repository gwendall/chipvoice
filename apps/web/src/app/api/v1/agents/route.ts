import { projectRoute } from "@/lib/project-http";
import { requireOwnerSession, agentGrants } from "@/lib/agents";
export const GET = projectRoute(async (_, caller) => {
  requireOwnerSession(caller);
  return { items: await agentGrants(caller.userId!) };
}, true);
