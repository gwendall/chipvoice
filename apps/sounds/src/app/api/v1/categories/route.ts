import { listCategories } from "@/lib/catalog";
import { corsPreflight, json, route } from "@/lib/http";

export const runtime = "nodejs";

export const GET = route(async () => json({ categories: listCategories() }, { cache: "public, max-age=300" }));

export const OPTIONS = corsPreflight;
