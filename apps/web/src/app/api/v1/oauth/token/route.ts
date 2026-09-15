import { pollAgentAccess } from "@/lib/agents";
import { DEVICE_GRANT_TYPE, OAuthFailure, oauthRoute } from "@/lib/oauth";
export const runtime = "nodejs";
/** RFC 8628 section 3.4 and 3.5. The credential is delivered once; a lost answer means a new grant. */
export const POST = oauthRoute(async (params) => {
  const grantType = params.grant_type;
  if (grantType !== DEVICE_GRANT_TYPE)
    throw new OAuthFailure(
      grantType ? "unsupported_grant_type" : "invalid_request",
      `Use grant_type=${DEVICE_GRANT_TYPE}.`,
    );
  const deviceCode = params.device_code;
  if (typeof deviceCode !== "string" || !deviceCode || deviceCode.length > 200)
    throw new OAuthFailure("invalid_request", "Supply device_code.");
  const result = await pollAgentAccess(deviceCode);
  if (result.status === "pending")
    throw new OAuthFailure(
      "authorization_pending",
      "The owner has not answered yet.",
    );
  return {
    access_token: result.accessToken,
    token_type: "Bearer",
    expires_in: Math.max(1, Math.floor((result.expiresAt - Date.now()) / 1000)),
    scope: result.scopes.join(" "),
  };
});
