import { ImageResponse } from "next/og";
import { projectRoute } from "@/lib/project-http";
import { getProject, ProjectHttpError } from "@/lib/projects";
import { projectViewer } from "@/lib/auth";
import { portraitSvg } from "@/community/portrait";
export const runtime = "nodejs";
export async function GET(r: Request, c: { params: Promise<{ id: string }> }) {
  const { id } = await c.params;
  return projectRoute(async (_, caller) => {
    const p = await getProject(id, projectViewer(caller));
    if (!p)
      throw new ProjectHttpError(404, "not_found", "Publication not found");
    return new ImageResponse(
      (
        <div
          style={{
            display: "flex",
            width: "100%",
            height: "100%",
            background: "#f2efe6",
            color: "#30372f",
            padding: 64,
            flexDirection: "column",
            justifyContent: "space-between",
            fontFamily: "sans-serif",
          }}
        >
          <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
            <img
              src={`data:image/svg+xml;base64,${Buffer.from(portraitSvg(p.profile.id, p.profile.avatar)).toString("base64")}`}
              width={120}
              height={120}
              alt=""
            />
            <span style={{ fontSize: 32 }}>
              {p.profile.displayName || p.profile.handle || "chipvoice"}
            </span>
          </div>
          <div style={{ display: "flex", fontSize: 64, lineHeight: 1.1 }}>
            {p.title}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 28,
              justifyContent: "space-between",
            }}
          >
            <span>{p.chip}</span>
            <span>{"chipvoice.dev"}</span>
          </div>
        </div>
      ),
      {
        width: 1200,
        height: 630,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  })(r);
}
