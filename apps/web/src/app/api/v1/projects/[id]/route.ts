import { projectViewer } from "@/lib/auth";
import { projectRoute, objectBody, readProjectBody } from "@/lib/project-http";
import { getProject, withdrawProject, setProjectVisibility, ProjectHttpError } from "@/lib/projects";
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

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  return projectRoute(async (r, caller) => {
    const body = objectBody(await readProjectBody(r, 1024), ["visibility"]);
    return setProjectVisibility(id, projectViewer(caller), body.visibility);
  }, true)(request);
}
