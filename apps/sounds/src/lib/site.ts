/** Mirrors apps/web's src/lib/songs.ts `SITE` constant: the deployed origin,
 * overridable for preview environments, defaulting to the production
 * domain this catalogue's own schema `$id` already assumes. */
export const SITE = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "https://gamesounds.ai";
