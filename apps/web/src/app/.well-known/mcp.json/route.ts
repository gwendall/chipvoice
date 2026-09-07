import { agentManifest } from "@/lib/agent-tools";
export const runtime = "nodejs";
export function GET() {
  return Response.json(agentManifest(), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
