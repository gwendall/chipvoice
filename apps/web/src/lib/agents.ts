import { createAgentAuth } from "web-kit/agent-auth";
import { HttpError } from "web-kit/http";
import { dbInstance } from "./db";
import { ownedProfile } from "./projects";
import { SITE } from "./songs";

const fail = (status: number, code: string, message: string): never => {
  throw new HttpError(status, code, message);
};

export const AGENT_SCOPES = [
  "generate",
  "projects:read",
  "projects:write",
  "render",
  "evaluate",
  "profile:write",
] as const;
export type AgentScope = (typeof AGENT_SCOPES)[number];
export interface AgentGrant {
  id: string;
  profileId: string;
  scopes: AgentScope[];
  expiresAt: number;
}
export interface Caller {
  userId: string | null;
  keyId: string | null;
  email: string | null;
  agent?: AgentGrant;
}

/**
 * chipvoice's own configuration of `web-kit/agent-auth`'s `createAgentAuth`:
 * its table/column names, token prefixes and the "artist profile" concept
 * that `resolveOwner` closes over (`ownedProfile`, which also enforces
 * ownership). Every function below wraps the shared instance only where the
 * generic package's vocabulary (`ownerId`) differs from a name this app's
 * external API already promised its agent clients (`profileId`,
 * `profileUrl`); everything else passes straight through.
 */
export const agentAuth = createAgentAuth({
  db: dbInstance,
  siteUrl: SITE,
  realm: "chipvoice",
  resourceName: "chipvoice",
  scopes: AGENT_SCOPES,
  cookieName: "chipvoice_session",
  tokenPrefixes: { agent: "cv_agent_", apiKey: "cv_live_", session: "cv_session_" },
  ownerColumn: "profile_id",
  tables: { admission: "project_admission" },
  legacyMagicTable: "magic",
  resolveOwner: (userId, profileId) => ownedProfile(userId, profileId),
});

export const requestAgentAccess = agentAuth.requestAgentAccess;
export const inspectAgentRequest = agentAuth.inspectAgentRequest;
export const decideAgentRequest = agentAuth.decideAgentRequest;
export const revokeAgent = agentAuth.revokeAgent;
export const requireOwnerSession = agentAuth.requireOwnerSession as (caller: Caller) => void;

/**
 * The grant lifecycle behind both wire shapes: the RFC 8628 token endpoint
 * (src/lib/oauth.ts) and the earlier /api/v1/agent-requests/token alias.
 * Tokens are delivered once and stored hashed.
 *
 * `web-kit/agent-auth`'s generic `pollAgentAccess` returns the owning
 * resource as `ownerId`; this app's agent clients have always received
 * `profileId` (and `profileUrl`) in this exact response body, so the poll
 * result is remapped here rather than re-exported.
 */
export type AgentAccessPoll =
  | { status: "pending"; interval: number }
  | {
      status: "authorized";
      accessToken: string;
      tokenType: "Bearer";
      expiresAt: number;
      scopes: AgentScope[];
      profileId: string;
      profileUrl: string;
    };
export async function pollAgentAccess(token: string): Promise<AgentAccessPoll> {
  const result = await agentAuth.pollAgentAccess(token);
  if (result.status === "pending") return result;
  const { ownerId, ...rest } = result;
  return { ...rest, scopes: result.scopes as AgentScope[], profileId: ownerId, profileUrl: `${SITE}/api/v1/profile` };
}

export async function agentGrants(userId: string) {
  return (await agentAuth.listAgentGrants(userId)).map(({ ownerId, ...rest }) => ({
    ...rest,
    profileId: ownerId,
  }));
}

/** Deny by default. Profile ownership is checked independently by the data layer. */
export function authorizeAgent(request: Request, caller: Caller) {
  if (!caller.agent) return;
  if (new URL(request.url).searchParams.get("favourites") === "1")
    fail(403, "insufficient_scope", "Agents cannot access the owner’s favourites");
  const path = new URL(request.url).pathname.replace(/\/$/, ""),
    method = request.method;
  let scope: AgentScope | undefined;
  if (/^\/api\/v1\/generations(?:\/[^/]+(?:\/events)?)?$/.test(path) && ["POST", "GET", "DELETE"].includes(method)) {
    if (!["generate", "projects:write", "render"].every(required => caller.agent!.scopes.includes(required as AgentScope)))
      fail(403, "insufficient_scope", "Composition requires generate, projects:write and render permissions");
    return;
  }
  if (path === "/api/v1/profile")
    scope =
      method === "GET"
        ? "projects:read"
        : method === "PUT"
          ? "profile:write"
          : undefined;
  else if (path === "/api/v1/evaluate" && method === "POST") scope = "evaluate";
  else if (path === "/api/v1/agent" && method === "GET") return;
  else if (/^\/api\/v1\/projects(?:\/[^/]+)?$/.test(path))
    scope =
      method === "GET"
        ? "projects:read"
        : ["POST", "PATCH", "DELETE"].includes(method)
          ? "projects:write"
          : undefined;
  else if (
    /^\/api\/v1\/projects\/[^/]+\/render$/.test(path) &&
    method === "POST"
  )
    scope = "render";
  else if (/^\/api\/v1\/jobs\/[^/]+(?:\/audio)?$/.test(path))
    scope =
      method === "GET"
        ? "projects:read"
        : method === "DELETE"
          ? "render"
          : undefined;
  else if (
    /^\/api\/v1\/(?:projects\/[^/]+\/cover|profiles\/[^/]+\/avatar)$/.test(
      path,
    ) &&
    method === "GET"
  )
    scope = "projects:read";
  if (!scope || !caller.agent.scopes.includes(scope))
    fail(403, "insufficient_scope", "This agent credential does not allow that action");
}
