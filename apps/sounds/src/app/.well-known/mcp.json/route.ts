import { agentManifest } from "@/lib/agent-manifest";

export const runtime = "nodejs";

export function GET() {
  return Response.json(agentManifest(), {
    headers: { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" },
  });
}
