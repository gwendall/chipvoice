import { getSound } from "@/lib/catalog";
import { corsPreflight, HttpError, json, route } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return route(async () => {
    const sound = getSound(id);
    if (!sound) throw new HttpError(404, "not_found", `No sound "${id}"`, undefined, "GET /api/v1/sounds to list what exists.");
    return json({ sound }, { cache: "public, max-age=300" });
  })(request);
}

export const OPTIONS = corsPreflight;
