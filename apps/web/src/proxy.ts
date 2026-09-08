import { NextRequest, NextResponse } from "next/server";

/** English keeps its original URLs; both languages render the same route tree. */
export function proxy(request: NextRequest) {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) {
    // Legacy anonymous publishing must never swallow an agent credential.
    if (
      /^\s*Bearer\s+cv_agent_/i.test(
        request.headers.get("authorization") ?? "",
      ) &&
      !url.pathname.startsWith("/api/v1/")
    )
      return NextResponse.json(
        { error: "agent_endpoint_required" },
        { status: 403 },
      );
    return NextResponse.next();
  }
  if (/^\/en(?:\/|$)/.test(url.pathname)) {
    url.pathname = url.pathname.replace(/^\/en/, "") || "/";
    return NextResponse.redirect(url);
  }
  if (/^\/ja(?:\/|$)/.test(url.pathname)) return NextResponse.next();
  url.pathname = `/en${url.pathname === "/" ? "" : url.pathname}`;
  return NextResponse.rewrite(url);
}
export const config = {
  matcher: ["/api/:path*", "/((?!api(?:/|$)|_next(?:/|$)|.*\\.[^/]+$).*)"],
};
