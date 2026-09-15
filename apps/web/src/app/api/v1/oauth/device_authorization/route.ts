import { requestAgentAccess } from "@/lib/agents";
import { clientKey } from "@/lib/limit";
import { OAuthFailure, oauthRoute, parseScope } from "@/lib/oauth";
import { SITE } from "@/lib/songs";
export const runtime = "nodejs";
/** RFC 8628 section 3.1. Public client: client_id is the name the owner reviews. */
export const POST = oauthRoute(async (params, request) => {
  const clientId = params.client_id;
  if (typeof clientId !== "string" || !clientId.trim())
    throw new OAuthFailure("invalid_request", "Supply client_id.");
  const grant = await requestAgentAccess(
    clientId,
    parseScope(params.scope),
    clientKey(request),
  );
  return {
    device_code: grant.requestToken,
    user_code: grant.userCode,
    verification_uri: `${SITE}/connect`,
    verification_uri_complete: grant.verificationUrl,
    expires_in: grant.expiresIn,
    interval: grant.interval,
  };
});
