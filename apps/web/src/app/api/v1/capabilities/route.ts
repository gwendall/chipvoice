import catalog from "../../../../../generated/agent-catalog.json";
import text from "../../../../../generated/agent-catalog-text.json";
export const runtime = "nodejs";
export function GET() {
  return new Response(text, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      ETag: `"${catalog.contentHash}"`,
    },
  });
}
