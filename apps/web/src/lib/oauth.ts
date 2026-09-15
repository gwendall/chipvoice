import { AGENT_SCOPES, type AgentScope } from "./agents";
import { hasDatabase } from "./db";
import { ProjectHttpError } from "./projects";
import { SITE } from "./songs";
/**
 * The standard face of agent authorization: OAuth 2.0 Device Authorization
 * Grant (RFC 8628) with RFC 8414 / RFC 9728 discovery. Any OAuth device-flow
 * client reaches the same grant lifecycle as the earlier custom pairing API,
 * which stays as an alias for agents that already speak it.
 */
export const DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";
export const RESOURCE_PATH = "/api/v1";
export const DEVICE_AUTHORIZATION_PATH = `${RESOURCE_PATH}/oauth/device_authorization`;
export const TOKEN_PATH = `${RESOURCE_PATH}/oauth/token`;
export const PROTECTED_RESOURCE_METADATA_PATH = `/.well-known/oauth-protected-resource${RESOURCE_PATH}`;
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
export function authorizationServerMetadata() {
  return {
    issuer: SITE,
    device_authorization_endpoint: `${SITE}${DEVICE_AUTHORIZATION_PATH}`,
    token_endpoint: `${SITE}${TOKEN_PATH}`,
    grant_types_supported: [DEVICE_GRANT_TYPE],
    response_types_supported: [],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...AGENT_SCOPES],
    service_documentation: `${SITE}/skill.md`,
  };
}
export function protectedResourceMetadata() {
  return {
    resource: `${SITE}${RESOURCE_PATH}`,
    resource_name: "chipvoice",
    authorization_servers: [SITE],
    scopes_supported: [...AGENT_SCOPES],
    bearer_methods_supported: ["header"],
    resource_documentation: `${SITE}/skill.md`,
  };
}
export function discoveryResponse(document: object) {
  return Response.json(document, {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
/** RFC 6750 section 3 and RFC 9728 section 5.1: a 401 names where the resource metadata lives. */
export function bearerChallenge(invalidToken: boolean) {
  return `Bearer realm="chipvoice", resource_metadata="${SITE}${PROTECTED_RESOURCE_METADATA_PATH}"${
    invalidToken ? ', error="invalid_token"' : ""
  }`;
}
export class OAuthFailure extends Error {
  constructor(
    readonly error: OAuthErrorCode,
    readonly description: string,
    readonly status = 400,
  ) {
    super(description);
  }
}
/** A space-separated scope parameter; omitted means every agent scope, which the owner still reviews. */
export function parseScope(value: unknown): AgentScope[] {
  if (value === undefined || value === "") return [...AGENT_SCOPES];
  if (typeof value !== "string" || value.length > 200)
    throw new OAuthFailure("invalid_scope", "Use a space-separated scope list.");
  const scopes = [...new Set(value.trim().split(/\s+/))];
  const unknown = scopes.find(
    (scope) => !AGENT_SCOPES.includes(scope as AgentScope),
  );
  if (unknown)
    throw new OAuthFailure(
      "invalid_scope",
      `Unknown scope ${unknown}; see scopes_supported in the server metadata.`,
    );
  return scopes as AgentScope[];
}
/** OAuth endpoints take form encoding (the standard) and accept JSON for convenience. */
export async function oauthParams(
  request: Request,
): Promise<Record<string, unknown>> {
  const type = request.headers.get("content-type") ?? "";
  const form = type.includes("application/x-www-form-urlencoded");
  if (!form && !type.includes("application/json"))
    throw new OAuthFailure(
      "invalid_request",
      "Use application/x-www-form-urlencoded.",
    );
  if (Number(request.headers.get("content-length") ?? 0) > 4096)
    throw new OAuthFailure("invalid_request", "Request is too large.");
  const text = await request.text();
  if (text.length > 4096)
    throw new OAuthFailure("invalid_request", "Request is too large.");
  if (form) return Object.fromEntries(new URLSearchParams(text));
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("object");
    return value as Record<string, unknown>;
  } catch {
    throw new OAuthFailure("invalid_request", "Invalid JSON.");
  }
}
/** The grant lifecycle answers in the pairing API's vocabulary; the standard endpoint speaks RFC 8628 section 3.5. */
const codes: Record<string, OAuthErrorCode> = {
  invalid_token: "invalid_grant",
  consumed: "invalid_grant",
  expired: "expired_token",
  denied: "access_denied",
  slow_down: "slow_down",
  agent_limit: "access_denied",
  invalid_request: "invalid_request",
  invalid_expiry: "invalid_request",
};
function oauthError(code: OAuthErrorCode, description: string, status = 400) {
  return Response.json(
    { error: code, error_description: description },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
/** RFC 6749 section 5.2 error bodies, whatever the grant lifecycle threw. */
export function oauthRoute(
  action: (params: Record<string, unknown>, request: Request) => Promise<object>,
) {
  return async (request: Request) => {
    try {
      if (!hasDatabase())
        throw new OAuthFailure(
          "temporarily_unavailable",
          "Authorization service is unavailable.",
          503,
        );
      const result = await action(await oauthParams(request), request);
      return Response.json(result, {
        headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
      });
    } catch (e) {
      if (e instanceof OAuthFailure)
        return oauthError(e.error, e.description, e.status);
      if (e instanceof ProjectHttpError) {
        if (e.status === 429 && e.code === "rate_limited")
          return oauthError("temporarily_unavailable", e.message, 429);
        return oauthError(codes[e.code] ?? "invalid_request", e.message);
      }
      return oauthError(
        "temporarily_unavailable",
        "Could not complete this request.",
        503,
      );
    }
  };
}
