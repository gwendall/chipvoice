import { db } from "@/lib/db";
import { profile, ProjectHttpError } from "@/lib/projects";
import { portraitSvg } from "@/community/portrait";
import { projectRoute } from "@/lib/project-http";
export async function GET(r: Request, c: { params: Promise<{ id: string }> }) {
  const { id } = await c.params;
  return projectRoute(async () => {
    const row = (
      await (
        await db()
      ).execute({ sql: "select * from profiles where id=?", args: [id] })
    ).rows[0];
    if (!row) throw new ProjectHttpError(404, "not_found", "Artist not found");
    return new Response(portraitSvg(id, profile(row).avatar), {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=60",
        "X-Content-Type-Options": "nosniff",
      },
    });
  })(r);
}
