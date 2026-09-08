import { projectViewer } from "@/lib/auth";
import { projectRoute } from "@/lib/project-http";
import { getProjectJob } from "@/lib/project-jobs";
import { ProjectHttpError } from "@/lib/projects";
import { db } from "@/lib/db";
export const runtime = "nodejs";
export async function GET(r: Request, c: { params: Promise<{ id: string }> }) {
  const { id } = await c.params;
  return projectRoute(async (request, caller) => {
    const job = await getProjectJob(id, projectViewer(caller));
    if (job.status !== "ready")
      throw new ProjectHttpError(409, "not_ready", "Audio is not ready");
    const format = new URL(request.url).searchParams.get("format") ?? "wav";
    if (!["wav", "mp3"].includes(format))
      throw new ProjectHttpError(422, "invalid_format", "Choose wav or mp3");
    if (format === "mp3" && !job.mp3Url)
      throw new ProjectHttpError(
        409,
        "mp3_unavailable",
        "This older rendition has only WAV; export MP3 locally or publish a new revision",
      );
    const result = await (
      await db()
    ).execute({
      sql: `select bytes from ${format === "mp3" ? "project_mp3" : "project_audio"} where job_id=? order by chunk`,
      args: [id],
    });
    const bytes = Buffer.concat(
      result.rows.map((row) => Buffer.from(row.bytes as ArrayBuffer)),
    );
    return new Response(bytes, {
      headers: {
        "Content-Type": format === "mp3" ? "audio/mpeg" : "audio/wav",
        "Content-Length": String(bytes.length),
        "Content-Disposition": `attachment; filename="chipvoice-${id}.${format}"`,
        "Cache-Control": "private, no-store",
      },
    });
  })(r);
}
