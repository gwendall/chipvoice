/**
 * The standard-issue parts of agent authorization: OAuth 2.0 Device
 * Authorization Grant (RFC 8628) constants and RFC 8414 / RFC 9728 discovery
 * plumbing that needs no app configuration at all. `createAgentAuth` (in
 * `./index.ts`) builds the app-specific metadata documents and the device
 * flow's grant lifecycle on top of these.
 */

export const DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

export const OAUTH_ERROR_CODES = [
  "invalid_request",
  "invalid_grant",
  "unsupported_grant_type",
  "invalid_scope",
  "authorization_pending",
  "slow_down",
  "access_denied",
  "expired_token",
  "temporarily_unavailable",
] as const;
export type OAuthErrorCode = (typeof OAUTH_ERROR_CODES)[number];

export class OAuthFailure extends Error {
  constructor(
    readonly error: OAuthErrorCode,
    readonly description: string,
    readonly status = 400,
  ) {
    super(description);
  }
}

/** A space-separated scope parameter; omitted means every scope in
 * `allowedScopes`, which the owner still reviews at approval time. */
export function parseScope(value: unknown, allowedScopes: readonly string[]): string[] {
  if (value === undefined || value === "") return [...allowedScopes];
  if (typeof value !== "string" || value.length > 200)
    throw new OAuthFailure("invalid_scope", "Use a space-separated scope list.");
  const scopes = [...new Set(value.trim().split(/\s+/))];
  const unknown = scopes.find((scope) => !allowedScopes.includes(scope));
  if (unknown)
    throw new OAuthFailure(
      "invalid_scope",
      `Unknown scope ${unknown}; see scopes_supported in the server metadata.`,
    );
  return scopes;
}

/** OAuth endpoints take form encoding (the standard) and accept JSON for convenience. */
export async function oauthParams(request: Request): Promise<Record<string, unknown>> {
  const type = request.headers.get("content-type") ?? "";
  const form = type.includes("application/x-www-form-urlencoded");
  if (!form && !type.includes("application/json"))
    throw new OAuthFailure("invalid_request", "Use application/x-www-form-urlencoded.");
  if (Number(request.headers.get("content-length") ?? 0) > 4096)
    throw new OAuthFailure("invalid_request", "Request is too large.");
  const text = await request.text();
  if (text.length > 4096) throw new OAuthFailure("invalid_request", "Request is too large.");
  if (form) return Object.fromEntries(new URLSearchParams(text));
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("object");
    return value as Record<string, unknown>;
  } catch {
    throw new OAuthFailure("invalid_request", "Invalid JSON.");
  }
}

export function discoveryResponse(document: object) {
  return Response.json(document, {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function oauthError(code: OAuthErrorCode, description: string, status = 400) {
  return Response.json(
    { error: code, error_description: description },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export { oauthError };
