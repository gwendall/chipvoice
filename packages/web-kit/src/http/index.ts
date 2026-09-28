/**
 * The HTTP envelope shared by every JSON API route: one error type, one route
 * wrapper that turns it (and anything unexpected) into `{error, message}`,
 * and the small body-reading helpers every route needs.
 *
 * An app wires this up once (see apps/web/src/lib/project-http.ts for
 * chipvoice's `projectRoute`) by calling `createRoute` with its own
 * `identify`, readiness check and authorization hook, then every route
 * handler in that app imports the configured `route` instead of this factory.
 */

/** A thrown error that a route wrapper turns directly into a response.
 * `hint` is additive: chipvoice never sets it, a consuming app may. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfter?: number,
    readonly hint?: string,
  ) {
    super(message);
  }
}

/** Reads a JSON request body with a byte ceiling enforced while streaming,
 * not after the fact: a client that keeps sending past `max` is cut off
 * rather than buffered in full first. */
export async function readBody(request: Request, max = 4 * 1024 * 1024): Promise<unknown> {
  if (Number(request.headers.get("content-length") ?? 0) > max)
    throw new HttpError(413, "too_large", "Request is too large");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "invalid_json", "JSON body required");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      bytes += item.value.length;
      if (bytes > max) {
        await reader.cancel();
        throw new HttpError(413, "too_large", "Request is too large");
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid_json", "Invalid JSON");
  }
}

/** Rejects any object carrying a key outside `keys`, so a route's accepted
 * fields are a positive list rather than everything nobody happened to check. */
export function objectBody(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new HttpError(422, "invalid_request", "Request contains unsupported fields");
  return value as Record<string, unknown>;
}

export interface RouteConfig<Caller> {
  /** Resolves the caller from the request (bearer token, session cookie, ...). */
  identify: (request: Request) => Promise<Caller>;
  /** False while a required dependency (typically the database) is unavailable. */
  ready?: () => boolean;
  /** The body returned when `ready` is false. */
  unavailable?: { code: string; message: string };
  /** A route-to-scope policy; throws HttpError to reject. Runs after `identify`. */
  authorize?: (request: Request, caller: Caller) => void;
  /** Tried before the default HttpError/fallback mapping; return a Response to
   * handle an error type the caller's SDK throws (e.g. a schema validation error),
   * or nothing to fall through. */
  mapError?: (error: unknown) => Response | null | undefined;
  /** RFC 9728: what a rejected bearer is told about where to obtain one. */
  bearerChallenge?: (invalidToken: boolean) => string;
  /** The body returned when an `authenticated` route's caller is signed out.
   * Defaults to a generic message; an app names what signing in is for. */
  signIn?: { code?: string; message?: string };
  /** The body returned when nothing above recognizes the error. */
  fallback?: { code: string; message: string };
}

/**
 * Builds the `route(action, authenticated?)` wrapper every JSON route in an
 * app calls. `action` returns a plain value (wrapped as `Response.json`) or a
 * `Response` it built itself (streaming audio, SSE, and so on).
 */
export function createRoute<Caller extends { userId?: string | null }>(
  config: RouteConfig<Caller>,
) {
  return function route(
    action: (request: Request, caller: Caller) => Promise<unknown>,
    authenticated = false,
  ) {
    return async (request: Request) => {
      try {
        if (config.ready && !config.ready())
          throw new HttpError(
            503,
            config.unavailable?.code ?? "unavailable",
            config.unavailable?.message ?? "Service is unavailable",
          );
        const caller = await config.identify(request);
        if (request.headers.has("authorization") && !caller.userId)
          throw new HttpError(401, "invalid_token", "Credential is invalid, expired or revoked");
        config.authorize?.(request, caller);
        if (authenticated && !caller.userId)
          throw new HttpError(401, config.signIn?.code ?? "sign_in", config.signIn?.message ?? "Sign in to continue");
        const result = await action(request, caller);
        return result instanceof Response
          ? result
          : Response.json(result, { headers: { "Cache-Control": "no-store" } });
      } catch (error) {
        const mapped = config.mapError?.(error);
        if (mapped) return mapped;
        if (error instanceof HttpError)
          return Response.json(
            {
              error: error.code,
              message: error.message,
              ...(error.hint !== undefined ? { hint: error.hint } : {}),
            },
            {
              status: error.status,
              headers: {
                "Cache-Control": "no-store",
                ...(error.status === 429 ? { "Retry-After": String(error.retryAfter ?? 60) } : {}),
                ...(error.status === 401 && config.bearerChallenge
                  ? { "WWW-Authenticate": config.bearerChallenge(error.code === "invalid_token") }
                  : {}),
              },
            },
          );
        return Response.json(
          {
            error: config.fallback?.code ?? "unavailable",
            message: config.fallback?.message ?? "Could not complete this request.",
          },
          { status: 503 },
        );
      }
    };
  };
}
