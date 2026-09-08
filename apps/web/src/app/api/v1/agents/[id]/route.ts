import { projectRoute } from "@/lib/project-http";
import { requireOwnerSession, revokeAgent } from "@/lib/agents";
export async function DELETE(
  r: Request,
  c: { params: Promise<{ id: string }> },
) {
  const { id } = await c.params;
  return projectRoute(async (_, caller) => {
    requireOwnerSession(caller);
    return revokeAgent(caller.userId!, id);
  }, true)(r);
}
