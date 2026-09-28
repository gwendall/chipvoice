import { NextRequest, NextResponse } from "next/server";

/**
 * English keeps its original URLs; both languages render the same route
 * tree. Mirrors apps/web's src/proxy.ts locale routing exactly, minus its
 * agent-bearer-token block (gamesounds has no such credential in Phase 1).
 */
export function proxy(request: NextRequest) {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) return NextResponse.next();
  // Discovery documents without a file extension (RFC 8414 / RFC 9728) are
  // not pages; the locale rewrite would turn them into a 404 page.
  if (url.pathname.startsWith("/.well-known/")) return NextResponse.next();
  if (/^\/en(?:\/|$)/.test(url.pathname)) {
    url.pathname = url.pathname.replace(/^\/en/, "") || "/";
    return NextResponse.redirect(url);
  }
  if (/^\/ja(?:\/|$)/.test(url.pathname)) return NextResponse.next();
  url.pathname = `/en${url.pathname === "/" ? "" : url.pathname}`;
  return NextResponse.rewrite(url);
}
export const config = {
  matcher: [
    "/api/:path*",
    "/((?!api(?:/|$)|_next(?:/|$)|\\.well-known(?:/|$)|.*\\.[^/]+$).*)",
  ],
};
