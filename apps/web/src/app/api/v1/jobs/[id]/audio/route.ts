import { projectRoute } from "@/lib/project-http";
import { getProjectJob } from "@/lib/project-jobs";
import { ProjectHttpError } from "@/lib/projects";
import { db } from "@/lib/db";
export const runtime = "nodejs";
export async function GET(r: Request, c: { params: Promise<{ id: string }> }) {
  const { id } = await c.params;
  return projectRoute(async (_, caller) => {
    const job = await getProjectJob(id, caller.userId);
    if (job.status !== "ready")
      throw new ProjectHttpError(409, "not_ready", "Audio is not ready");
    const result = await (
      await db()
    ).execute({
      sql: "select bytes from project_audio where job_id=? order by chunk",
      args: [id],
    });
    const bytes = Buffer.concat(
      result.rows.map((row) => Buffer.from(row.bytes as ArrayBuffer)),
    );
    return new Response(bytes, {
      headers: {
        "Content-Type": "audio/wav",
        "Content-Length": String(bytes.length),
        "Content-Disposition": `attachment; filename="chipvoice-${id}.wav"`,
        "Cache-Control": "private, no-store",
      },
    });
  })(r);
}
