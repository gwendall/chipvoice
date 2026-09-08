import { projectViewer } from "@/lib/auth";
import { projectRoute } from "@/lib/project-http";
import { getProject, withdrawProject, ProjectHttpError } from "@/lib/projects";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  return projectRoute(async (_, caller) => {
    const found = await getProject(id, projectViewer(caller));
    if (!found)
      throw new ProjectHttpError(404, "not_found", "Publication not found");
    return found;
  })(request);
}
export async function DELETE(request: Request, context: Context) {
  const { id } = await context.params;
  return projectRoute(async (_, caller) => {
    await withdrawProject(id, projectViewer(caller));
    return { ok: true };
  }, true)(request);
}
