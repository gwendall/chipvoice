import { agentAuth } from "./agents";

/**
 * The standard face of agent authorization: OAuth 2.0 Device Authorization
 * Grant (RFC 8628) with RFC 8414 / RFC 9728 discovery. Any OAuth device-flow
 * client reaches the same grant lifecycle as the earlier custom pairing API,
 * which stays as an alias for agents that already speak it.
 *
 * `web-kit/agent-auth`'s shared `agentAuth` instance (configured in
 * `./agents`) does the actual work; this file only re-exports it under the
 * names every route handler in this app already imports, unchanged in shape
 * from before this package existed.
 */
export {
  DEVICE_GRANT_TYPE,
  OAUTH_ERROR_CODES,
  OAuthFailure,
  discoveryResponse,
  oauthParams,
  type OAuthErrorCode,
} from "web-kit/agent-auth";

export const RESOURCE_PATH = "/api/v1";
export const DEVICE_AUTHORIZATION_PATH = agentAuth.DEVICE_AUTHORIZATION_PATH;
export const TOKEN_PATH = agentAuth.TOKEN_PATH;
export const PROTECTED_RESOURCE_METADATA_PATH = agentAuth.PROTECTED_RESOURCE_METADATA_PATH;
export const authorizationServerMetadata = agentAuth.authorizationServerMetadata;
export const protectedResourceMetadata = agentAuth.protectedResourceMetadata;
export const bearerChallenge = agentAuth.bearerChallenge;
export const oauthRoute = agentAuth.oauthRoute;
export const parseScope = agentAuth.parseScope as (value: unknown) => import("./agents").AgentScope[];
