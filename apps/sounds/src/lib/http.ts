import { createRoute, HttpError, objectBody as sharedObjectBody, readBody as sharedReadBody } from "web-kit/http";

/**
 * gamesounds.ai's own configuration of `web-kit/http`'s `createRoute`
 * (see packages/web-kit/README.md and apps/web/src/lib/project-http.ts for
 * chipvoice's own copy of this same pattern). Phase 1 has no accounts (spec
 * principle 2: "no account to browse, listen or download"), so `identify`
 * always resolves the same anonymous caller and no route is ever
 * `authenticated` - the wrapper still earns its keep for the one shared
 * error envelope every route returns.
 */
interface Caller {
  userId: null;
}

const baseRoute = createRoute<Caller>({
  identify: async () => ({ userId: null }),
  fallback: { code: "unavailable", message: "Could not complete this request." },
});

/**
 * `web-kit/http`'s `route()`, with open CORS stamped onto every response it
 * produces, success or error alike: reads need no key (spec principle 2)
 * and that is extended here to no origin restriction either, since an
 * agent's own script or a page on another domain is exactly who this API is
 * for. A cacheable read still sets its own `Cache-Control` via `json()`
 * below - `route()`'s default `Response.json` wrapping always sends
 * `no-store`, which is right for POST /resolve and wrong for a GET search.
 */
export function route(
  action: (request: Request, caller: Caller) => Promise<unknown>,
  authenticated = false,
) {
  const handler = baseRoute(action, authenticated);
  return async (request: Request) => {
    const response = await handler(request);
    const headers = new Headers(response.headers);
    headers.set("Access-Control-Allow-Origin", "*");
    return new Response(response.body, { status: response.status, headers });
  };
}

export const readBody = sharedReadBody;
export const objectBody = sharedObjectBody;
export { HttpError };

/** A cacheable read builds its own `Response` (so `route()` passes it
 * through instead of forcing `no-store`) with this. */
export function json(data: unknown, { cache = "no-store" }: { cache?: string } = {}): Response {
  return Response.json(data, { headers: { "Cache-Control": cache } });
}

const CORS_PREFLIGHT_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

/** A route module's `export const OPTIONS = corsPreflight;` answers a
 * browser's CORS preflight for a POST (or any request carrying a header the
 * "simple request" list does not cover) without going through `route()`. */
export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS_PREFLIGHT_HEADERS });
}
