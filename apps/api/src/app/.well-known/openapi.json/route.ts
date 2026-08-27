import { openApiSpec } from "@/lib/openapi";

export const runtime = "nodejs";

export function GET() {
  return Response.json(openApiSpec(), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
