import { buildManifest, getSound, type AudioFile, type Sound } from "@/lib/catalog";
import { licenseText } from "@/lib/credits";
import { readPublicFile } from "@/lib/files";
import { corsPreflight, HttpError, route } from "@/lib/http";
import { getPack } from "@/lib/packs";
import { createZip, type ZipEntry } from "@/lib/zip";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return route(async () => {
    const pack = getPack(id);
    if (!pack) throw new HttpError(404, "not_found", `No pack "${id}"`, undefined, "GET /api/v1/packs to list what exists.");

    const { resolved, unresolved } = buildManifest(pack.events, { style: pack.style });
    if (unresolved.length > 0) {
      throw new HttpError(500, "incomplete_pack", `Pack "${id}" has unresolved event(s): ${unresolved.join(", ")}`);
    }

    const entries: ZipEntry[] = [];
    const credited = new Set<string>();
    const soundsForLicense: Sound[] = [];
    for (const { event, sound: soundId } of resolved) {
      const sound = soundId ? getSound(soundId) : null;
      if (!sound) continue;
      const eventSlug = event.replace(/\//g, "-");
      for (const variant of sound.variants) {
        for (const [ext, file] of Object.entries(variant.files) as [string, AudioFile][]) {
          entries.push({ name: `${eventSlug}/${eventSlug}-${variant.n}.${ext}`, data: await readPublicFile(file.url) });
        }
      }
      if (!credited.has(sound.id)) {
        credited.add(sound.id);
        soundsForLicense.push(sound);
      }
    }
    entries.push({ name: "LICENSE.txt", data: new TextEncoder().encode(licenseText(soundsForLicense)) });

    const zip = createZip(entries);
    return new Response(zip as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${pack.id}.zip"`,
        "Cache-Control": "public, max-age=300",
      },
    });
  })(request);
}

export const OPTIONS = corsPreflight;
