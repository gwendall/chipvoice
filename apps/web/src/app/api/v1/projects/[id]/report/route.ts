import { projectViewer } from "@/lib/auth";
import { projectRoute, readProjectBody, objectBody } from "@/lib/project-http";
import { getProject, admitProject, ProjectHttpError } from "@/lib/projects";
import { db } from "@/lib/db";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return projectRoute(async (r, caller) => {
    const body = objectBody(await readProjectBody(r, 4096), ["reason"]);
    if (
      typeof body.reason !== "string" ||
      body.reason.trim().length < 3 ||
      body.reason.length > 500
    )
      throw new ProjectHttpError(
        422,
        "invalid_reason",
        "Explain the issue in 3–500 characters",
      );
    if (!(await getProject(id, projectViewer(caller))))
      throw new ProjectHttpError(404, "not_found", "Publication not found");
    await admitProject(`report:${caller.userId}`, 5);
    await (
      await db()
    ).execute({
      sql: "insert into project_reports values(?,?,?,?) on conflict(project_id,user_id) do update set reason=excluded.reason",
      args: [id, caller.userId, body.reason, Date.now()],
    });
    return { ok: true };
  }, true)(request);
}
