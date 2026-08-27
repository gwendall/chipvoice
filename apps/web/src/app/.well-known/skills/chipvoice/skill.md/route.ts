import { skillMarkdown } from "@/lib/skill";

export const runtime = "nodejs";

export function GET() {
  return new Response(skillMarkdown(), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
