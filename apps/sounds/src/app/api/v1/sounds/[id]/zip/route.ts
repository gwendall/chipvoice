import { getSound } from "@/lib/catalog";
import { licenseText } from "@/lib/credits";
import { readPublicFile } from "@/lib/files";
import { corsPreflight, HttpError, route } from "@/lib/http";
import { createZip, type ZipEntry } from "@/lib/zip";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return route(async () => {
    const sound = getSound(id);
    if (!sound) throw new HttpError(404, "not_found", `No sound "${id}"`, undefined, "GET /api/v1/sounds to list what exists.");

    const entries: ZipEntry[] = [];
    for (const variant of sound.variants) {
      for (const [ext, url] of Object.entries(variant.files) as [string, string][]) {
        entries.push({ name: `${sound.id}/${sound.id}-${variant.n}.${ext}`, data: readPublicFile(url) });
      }
    }
    entries.push({ name: "LICENSE.txt", data: new TextEncoder().encode(licenseText([sound])) });

    const zip = createZip(entries);
    return new Response(zip as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${sound.id}.zip"`,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  })(request);
}

export const OPTIONS = corsPreflight;
