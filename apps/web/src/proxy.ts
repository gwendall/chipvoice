import {NextRequest, NextResponse} from 'next/server';

/** English keeps its original URLs; both languages render the same route tree. */
export function proxy(request: NextRequest) {
  const url = request.nextUrl.clone();
  if (/^\/en(?:\/|$)/.test(url.pathname)) {
    url.pathname = url.pathname.replace(/^\/en/, '') || '/';
    return NextResponse.redirect(url);
  }
  if (/^\/ja(?:\/|$)/.test(url.pathname)) return NextResponse.next();
  url.pathname = `/en${url.pathname}`;
  return NextResponse.rewrite(url);
}
export const config = {matcher: ['/((?!api(?:/|$)|_next(?:/|$)|.*\\.[^/]+$).*)']};
