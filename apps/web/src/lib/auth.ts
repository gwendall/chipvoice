import type { Viewer } from "./projects";
import { agentAuth, type AgentGrant, type AgentScope, type Caller } from "./agents";

export type { AgentGrant, Caller };
export const ANONYMOUS = agentAuth.ANONYMOUS as Caller;
export const SESSION_COOKIE = "chipvoice_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const sameOrigin = agentAuth.sameOrigin;

/**
 * `web-kit/agent-auth`'s generic `identify` resolves an agent credential's
 * owning resource as `agent.ownerId`; this app's callers have always read
 * `agent.profileId` off `Caller`, so the result is remapped here rather than
 * re-exported.
 */
export async function identify(request: Request): Promise<Caller> {
  const caller = await agentAuth.identify(request);
  if (!caller.agent) return caller as Caller;
  const { ownerId, ...rest } = caller.agent;
  return { ...caller, agent: { ...rest, scopes: rest.scopes as AgentScope[], profileId: ownerId } };
}

export const createKey = agentAuth.createApiKey;
export const createMagicLink = agentAuth.createMagicLink;
export const createSignInLink = agentAuth.createSignInLink;
export const magicLinkValid = agentAuth.magicLinkValid;
export const redeemMagicLink = agentAuth.redeemMagicLink;
export const revokeSession = agentAuth.revokeSession;
export const listKeys = agentAuth.listApiKeys;
export const revokeKey = agentAuth.revokeApiKey;

export const projectViewer = (caller: Caller): Viewer =>
  caller.agent && caller.userId
    ? { userId: caller.userId, profileId: caller.agent.profileId }
    : caller.userId;
