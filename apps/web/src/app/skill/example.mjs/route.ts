import example from "../../../../generated/agent-example.json";

export function GET() {
  return new Response(example, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
