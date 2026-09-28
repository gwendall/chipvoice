import { buildManifest } from "@/lib/catalog";
import { corsPreflight, HttpError, json, route } from "@/lib/http";
import { getPack } from "@/lib/packs";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return route(async () => {
    const pack = getPack(id);
    if (!pack) throw new HttpError(404, "not_found", `No pack "${id}"`, undefined, "GET /api/v1/packs to list what exists.");
    const { manifest, resolved, unresolved } = buildManifest(pack.events, { style: pack.style });
    return json({ pack, manifest, resolved, unresolved }, { cache: "public, max-age=300" });
  })(request);
}

export const OPTIONS = corsPreflight;
