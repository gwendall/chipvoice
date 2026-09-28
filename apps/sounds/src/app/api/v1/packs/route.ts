import { PACKS } from "@/lib/packs";
import { corsPreflight, json, route } from "@/lib/http";

export const runtime = "nodejs";

export const GET = route(async () => json({ packs: PACKS }, { cache: "public, max-age=300" }));

export const OPTIONS = corsPreflight;
