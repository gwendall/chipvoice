import { redeemMagicLink } from "@/lib/auth";
import { hasDatabase } from "@/lib/db";
import { SITE } from "@/lib/songs";

export const runtime = "nodejs";

/**
 * Turns a link from an inbox into a key in a browser.
 *
 * The key is handed to the page in the URL fragment, which browsers do not send
 * to servers and proxies do not log. The editor reads it, stores it, and strips
 * it - so it exists in the address bar for one paint and nowhere else.
 *
 * Single use, thirty minutes. A link that has been followed cannot be followed
 * again, so a forwarded email is worth nothing.
 */
export async function GET(request: Request) {
  if (!hasDatabase()) return new Response("no database", { status: 503 });

  const token = new URL(request.url).searchParams.get("token");
  if (!token) return Response.redirect(`${SITE}/?signin=missing`, 302);

  const key = await redeemMagicLink(token);
  if (!key) return Response.redirect(`${SITE}/?signin=expired`, 302);

  return Response.redirect(`${SITE}/#key=${encodeURIComponent(key)}`, 302);
}
