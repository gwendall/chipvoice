import { projectRoute } from "@/lib/project-http";
import { setFavourite, admitProject } from "@/lib/projects";
export const runtime = "nodejs";
async function change(
  request: Request,
  context: { params: Promise<{ id: string }> },
  enabled: boolean,
) {
  const { id } = await context.params;
  return projectRoute(async (_, caller) => {
    await admitProject(`favourite:${caller.userId}`, 60);
    return setFavourite(id, caller.userId!, enabled);
  }, true)(request);
}
export const PUT = (r: Request, c: { params: Promise<{ id: string }> }) =>
  change(r, c, true);
export const DELETE = (r: Request, c: { params: Promise<{ id: string }> }) =>
  change(r, c, false);
