import {audioRange, audioStream} from "@/lib/audio-range";
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
    const size = format === 'mp3' ? job.mp3Bytes : job.bytes;
    // Authorization remains live even when the rendition bytes are immutable.
    const range = audioRange(request.headers.has('if-range') ? null : request.headers.get('range'), size);
    const headers: Record<string,string> = {
      'Content-Type': format === 'mp3' ? 'audio/mpeg' : 'audio/wav',
      'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store',
      'Content-Disposition': `attachment; filename="chipvoice-${id}.${format}"`,
    };
    if (range === 'unsatisfiable') return new Response(null, {status: 416, headers: {...headers, 'Content-Range': `bytes */${size}`}});
    const start = range?.start ?? 0, end = range?.end ?? size - 1;
    headers['Content-Length'] = String(Math.max(0,end - start + 1));
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    const body = request.method === 'HEAD' ? null : audioStream(start, end, async (chunk, offset, length) => {
      const result = await (await db()).execute({
        sql: `select substr(bytes,?,?) as bytes from ${format === 'mp3' ? 'project_mp3' : 'project_audio'} where job_id=? and chunk=?`,
        args: [offset + 1, length, id, chunk],
      });
      return new Uint8Array(result.rows[0]?.bytes as ArrayBuffer ?? new ArrayBuffer(0));
    });
    return new Response(body, {status: range ? 206 : 200, headers});
  })(r);
}
export const HEAD = GET;
