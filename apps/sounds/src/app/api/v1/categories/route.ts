import { listCategoriesWithCounts } from "@/lib/catalog";
import { corsPreflight, json, route } from "@/lib/http";

export const runtime = "nodejs";

// Every category carries its own honest `count` (listCategoriesWithCounts):
// the taxonomy may keep a category with zero sounds today, but this
// endpoint must never present one as if it had content - see
// docs/GAMESOUNDS.md's "taxonomy and event resolution" section.
export const GET = route(async () => json({ categories: listCategoriesWithCounts() }, { cache: "public, max-age=300" }));

export const OPTIONS = corsPreflight;
