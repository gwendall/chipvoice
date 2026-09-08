import { db, hashKey, newId, secret } from "./db";
import { admitProject, ownedProfile, ProjectHttpError } from "./projects";
import { SITE } from "./songs";
import type { Caller } from "./auth";
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
const error = (status: number, code: string, message: string): never => {
  throw new ProjectHttpError(status, code, message);
};
const codeHash = (code: string) =>
  hashKey(code.replace(/[-\s]/g, "").toUpperCase());
export async function requestAgentAccess(
  label: unknown,
  scopes: unknown,
  client: string,
) {
  if (
    typeof label !== "string" ||
    !label.trim() ||
    label.length > 60 ||
    !Array.isArray(scopes) ||
    !scopes.length ||
    scopes.some((s) => !AGENT_SCOPES.includes(s))
  )
    error(422, "invalid_request", "Supply a label and supported scopes");
  await admitProject(`pair:${client}`, 5);
  const token = secret(),
    code = secret().slice(0, 12).toUpperCase(),
    now = Date.now();
  const dbClient = await db();
  await dbClient.execute({
    sql: "delete from agent_requests where expires_at<?",
    args: [now - 86400000],
  });
  await dbClient.execute({
    sql: "insert into agent_requests(hash,code_hash,label,scopes,created_at,expires_at,next_poll) values(?,?,?,?,?,?,?)",
    args: [
      await hashKey(token),
      await codeHash(code),
      String(label).trim(),
      JSON.stringify([...new Set(scopes as string[])]),
      now,
      now + 600000,
      now,
    ],
  });
  return {
    requestToken: token,
    userCode: code,
    verificationUrl: `${SITE}/connect?code=${encodeURIComponent(code)}`,
    expiresIn: 600,
    interval: 5,
  };
}
export async function inspectAgentRequest(code: string) {
  const r = await (
    await db()
  ).execute({
    sql: "select label,scopes,status,expires_at from agent_requests where code_hash=? and expires_at>?",
    args: [await codeHash(code), Date.now()],
  });
  if (!r.rows[0])
    error(404, "not_found", "Authorization request expired or unavailable");
  const row = r.rows[0];
  return {
    label: String(row.label),
    scopes: JSON.parse(String(row.scopes)) as AgentScope[],
    status: String(row.status),
    expiresAt: Number(row.expires_at),
  };
}
export async function decideAgentRequest(
  userId: string,
  code: string,
  profileId: string,
  days: number,
  approve: boolean,
) {
  if (![1, 7, 30].includes(days))
    error(422, "invalid_expiry", "Choose 1, 7 or 30 days");
  if (approve) await ownedProfile(userId, profileId);
  const r = await (
    await db()
  ).execute({
    sql: `update agent_requests set status=?,user_id=?,profile_id=?,grant_days=? where code_hash=? and status='pending' and expires_at>? returning hash`,
    args: [
      approve ? "approved" : "denied",
      userId,
      approve ? profileId : null,
      days,
      await codeHash(code),
      Date.now(),
    ],
  });
  if (!r.rows.length)
    error(
      409,
      "request_closed",
      "Authorization request expired or already answered",
    );
  return { ok: true };
}
/** Custom pairing protocol, inspired by RFC 8628. Tokens are delivered once and stored hashed. */
export async function pollAgentAccess(token: string) {
  const client = await db(),
    tx = await client.transaction("write");
  try {
    const hash = await hashKey(token),
      now = Date.now();
    const row = (
      await tx.execute({
        sql: "select * from agent_requests where hash=?",
        args: [hash],
      })
    ).rows[0];
    if (!row || Number(row.expires_at) <= now)
      error(400, "expired", "Start a new authorization request");
    if (row.status === "denied")
      error(403, "denied", "The owner declined access");
    if (row.status === "consumed")
      error(
        409,
        "consumed",
        "This credential was already delivered; start a new request if it was lost",
      );
    if (Number(row.next_poll) > now)
      error(429, "slow_down", "Poll no more than once every five seconds");
    await tx.execute({
      sql: "update agent_requests set next_poll=? where hash=?",
      args: [now + 5000, hash],
    });
    if (row.status === "pending") {
      await tx.commit();
      return { status: "pending", interval: 5 };
    }
    const active = await tx.execute({
      sql: "select count(*) as n from agent_grants where user_id=? and revoked_at is null and expires_at>?",
      args: [row.user_id, now],
    });
    if (Number(active.rows[0].n) >= 100)
      error(
        429,
        "agent_limit",
        "Revoke an existing access before creating more than 100 active agent credentials",
      );
    const key = "cv_agent_" + secret(),
      id = newId(),
      expiresAt = now + Number(row.grant_days) * 86400000;
    await tx.execute({
      sql: "insert into agent_grants(id,user_id,profile_id,hash,label,scopes,created_at,expires_at) values(?,?,?,?,?,?,?,?)",
      args: [
        id,
        row.user_id,
        row.profile_id,
        await hashKey(key),
        row.label,
        row.scopes,
        now,
        expiresAt,
      ],
    });
    await tx.execute({
      sql: "update agent_requests set status='consumed' where hash=?",
      args: [hash],
    });
    await tx.commit();
    return {
      status: "authorized",
      accessToken: key,
      tokenType: "Bearer",
      expiresAt,
      scopes: JSON.parse(String(row.scopes)),
      profileId: String(row.profile_id),
      profileUrl: `${SITE}/api/v1/profile`,
    };
  } catch (e) {
    if (!tx.closed) await tx.rollback();
    throw e;
  } finally {
    tx.close();
  }
}
export async function agentGrants(userId: string) {
  return (
    await (
      await db()
    ).execute({
      sql: "select id,profile_id,label,scopes,created_at,expires_at,revoked_at,last_used from agent_grants where user_id=? order by (revoked_at is null and expires_at>?) desc,created_at desc,id desc limit 100",
      args: [userId, Date.now()],
    })
  ).rows.map((r) => ({
    id: r.id,
    profileId: r.profile_id,
    label: r.label,
    scopes: JSON.parse(String(r.scopes)),
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    revokedAt: r.revoked_at,
    lastUsed: r.last_used,
  }));
}
export async function revokeAgent(userId: string, id: string) {
  const r = await (
    await db()
  ).execute({
    sql: "update agent_grants set revoked_at=coalesce(revoked_at,?) where user_id=? and id=? returning id",
    args: [Date.now(), userId, id],
  });
  if (!r.rows.length) error(404, "not_found", "Agent access not found");
  return { ok: true };
}
export function requireOwnerSession(caller: Caller) {
  if (!caller.userId || caller.keyId || caller.agent)
    error(
      403,
      "owner_session_required",
      "Sign in through your browser to authorize or manage agents",
    );
}
/** Deny by default. Profile ownership is checked independently by the data layer. */
export function authorizeAgent(request: Request, caller: Caller) {
  if (!caller.agent) return;
  if (new URL(request.url).searchParams.get("favourites") === "1")
    error(
      403,
      "insufficient_scope",
      "Agents cannot access the owner’s favourites",
    );
  const path = new URL(request.url).pathname.replace(/\/$/, ""),
    method = request.method;
  let scope: AgentScope | undefined;
  if (/^\/api\/v1\/generations(?:\/[^/]+)?$/.test(path) && ["POST", "GET", "DELETE"].includes(method)) {
    if (!["generate", "projects:write", "render"].every(required => caller.agent!.scopes.includes(required as AgentScope)))
      error(403, "insufficient_scope", "Composition requires generate, projects:write and render permissions");
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
    error(
      403,
      "insufficient_scope",
      "This agent credential does not allow that action",
    );
}
