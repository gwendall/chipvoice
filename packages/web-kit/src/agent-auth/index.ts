import type { Client } from "@libsql/client";
import { hashKey, newId, secret } from "../crypto/index.js";
import { admitWindow, type Db } from "../db/index.js";
import { HttpError } from "../http/index.js";
import {
  DEVICE_GRANT_TYPE,
  OAuthFailure,
  discoveryResponse,
  oauthError,
  oauthParams,
  parseScope,
  type OAuthErrorCode,
} from "./oauth.js";

export {
  DEVICE_GRANT_TYPE,
  OAUTH_ERROR_CODES,
  OAuthFailure,
  discoveryResponse,
  oauthParams,
  parseScope,
  type OAuthErrorCode,
} from "./oauth.js";

export interface AgentGrant {
  id: string;
  /** The account-scoped resource an agent credential is authorized against:
   * chipvoice's artist profile, or whatever a consuming app resolves through
   * `resolveOwner`. Stored under `ownerColumn` (chipvoice: `profile_id`). */
  ownerId: string;
  scopes: string[];
  expiresAt: number;
}
export interface Caller {
  userId: string | null;
  keyId: string | null;
  email: string | null;
  agent?: AgentGrant;
}
export const ANONYMOUS: Caller = { userId: null, keyId: null, email: null };

export interface AgentAuthTables {
  users: string;
  sessions: string;
  loginTokens: string;
  apiKeys: string;
  agentRequests: string;
  agentGrants: string;
  admission: string;
}

export interface AgentAuthConfig {
  /** A `web-kit/db` instance (`createDb(...)`'s return value). */
  db: Db;
  /** The app's public origin, e.g. "https://chipvoice.dev". */
  siteUrl: string;
  /** The WWW-Authenticate realm and the protected-resource metadata's name. */
  realm: string;
  resourceName: string;
  /** Defaults to `${siteUrl}/skill.md`. */
  resourceDocumentationUrl?: string;
  /** Defaults to "/api/v1". */
  resourcePath?: string;
  /** Where the device flow sends a person to enter their user code, relative
   * to `siteUrl`. Defaults to "/connect". */
  verificationPath?: string;
  /** Every scope the app's agent credentials can carry. */
  scopes: readonly string[];
  cookieName: string;
  /** Defaults to 30 days. */
  sessionTtlMs?: number;
  /** Defaults to 30 minutes. */
  magicLinkTtlMs?: number;
  tokenPrefixes: { agent: string; apiKey: string; session: string };
  /** The column agent_requests/agent_grants use for the owning resource,
   * e.g. "profile_id". Chosen by the app, not renamed by this package, since
   * an existing production table's columns cannot be renamed by a migration
   * that must not re-run. */
  ownerColumn: string;
  tables?: Partial<AgentAuthTables>;
  /** Verifies `userId` may grant access under `ownerId`, returning the
   * resource id to store (chipvoice: `ownedProfile`, which also enforces
   * artist ownership). Throws to reject. */
  resolveOwner: (userId: string, ownerId: string) => Promise<{ id: string }>;
  /** Rate limit on device-flow pairing requests, backed by `db`'s
   * `admitWindow` against `tables.admission`. Defaults to 5 per minute. */
  pairing?: { limit?: number; windowMs?: number };
  /** Defaults to 100. */
  agentGrantLimit?: number;
  /**
   * A table name from before this app tracked logins as `login_tokens`; if
   * set, `redeemMagicLink` also marks a matching row used there, so an
   * emailed link issued before that migration stays redeemable after a
   * rollback. Chipvoice sets this to its legacy `magic` table; a new app has
   * no such history and leaves it unset.
   */
  legacyMagicTable?: string;
}

const DEFAULT_TABLES: AgentAuthTables = {
  users: "users",
  sessions: "sessions",
  loginTokens: "login_tokens",
  apiKeys: "keys",
  agentRequests: "agent_requests",
  agentGrants: "agent_grants",
  admission: "admission",
};

/**
 * Configures the device-flow grant lifecycle (RFC 8628), bearer/session
 * identification and RFC 8414/9728 discovery metadata for one app's
 * database and vocabulary. Everything below closes over `config`; nothing
 * chipvoice- or app-specific (route-to-scope maps, the "artist" concept
 * beyond an opaque owner id) lives here - see `AgentAuthConfig.resolveOwner`
 * for where that seam is.
 */
export function createAgentAuth(config: AgentAuthConfig) {
  const tables: AgentAuthTables = { ...DEFAULT_TABLES, ...config.tables };
  const resourcePath = config.resourcePath ?? "/api/v1";
  const verificationPath = config.verificationPath ?? "/connect";
  const sessionTtlMs = config.sessionTtlMs ?? 30 * 24 * 60 * 60 * 1000;
  const magicLinkTtlMs = config.magicLinkTtlMs ?? 30 * 60 * 1000;
  const agentGrantLimit = config.agentGrantLimit ?? 100;
  const pairingLimit = config.pairing?.limit ?? 5;
  const pairingWindowMs = config.pairing?.windowMs ?? 60_000;
  const resourceDocumentationUrl = config.resourceDocumentationUrl ?? `${config.siteUrl}/skill.md`;

  const DEVICE_AUTHORIZATION_PATH = `${resourcePath}/oauth/device_authorization`;
  const TOKEN_PATH = `${resourcePath}/oauth/token`;
  const PROTECTED_RESOURCE_METADATA_PATH = `/.well-known/oauth-protected-resource${resourcePath}`;

  const fail = (status: number, code: string, message: string): never => {
    throw new HttpError(status, code, message);
  };
  const codeHash = (code: string) => hashKey(code.replace(/[-\s]/g, "").toUpperCase());

  // ---- RFC 8414 / RFC 9728 metadata -------------------------------------

  function authorizationServerMetadata() {
    return {
      issuer: config.siteUrl,
      device_authorization_endpoint: `${config.siteUrl}${DEVICE_AUTHORIZATION_PATH}`,
      token_endpoint: `${config.siteUrl}${TOKEN_PATH}`,
      grant_types_supported: [DEVICE_GRANT_TYPE],
      response_types_supported: [],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: [...config.scopes],
      service_documentation: resourceDocumentationUrl,
    };
  }
  function protectedResourceMetadata() {
    return {
      resource: `${config.siteUrl}${resourcePath}`,
      resource_name: config.resourceName,
      authorization_servers: [config.siteUrl],
      scopes_supported: [...config.scopes],
      bearer_methods_supported: ["header"],
      resource_documentation: resourceDocumentationUrl,
    };
  }
  /** RFC 6750 section 3 and RFC 9728 section 5.1: a 401 names where the resource metadata lives. */
  function bearerChallenge(invalidToken: boolean) {
    return `Bearer realm="${config.realm}", resource_metadata="${config.siteUrl}${PROTECTED_RESOURCE_METADATA_PATH}"${
      invalidToken ? ', error="invalid_token"' : ""
    }`;
  }

  /** The grant lifecycle answers in the pairing API's vocabulary; the standard endpoint speaks RFC 8628 section 3.5. */
  const OAUTH_CODES: Record<string, OAuthErrorCode> = {
    invalid_token: "invalid_grant",
    consumed: "invalid_grant",
    expired: "expired_token",
    denied: "access_denied",
    slow_down: "slow_down",
    agent_limit: "access_denied",
    invalid_request: "invalid_request",
    invalid_expiry: "invalid_request",
  };
  /** RFC 6749 section 5.2 error bodies, whatever the grant lifecycle threw. */
  function oauthRoute(action: (params: Record<string, unknown>, request: Request) => Promise<object>) {
    return async (request: Request) => {
      try {
        if (!config.db.hasDatabase())
          throw new OAuthFailure("temporarily_unavailable", "Authorization service is unavailable.", 503);
        const result = await action(await oauthParams(request), request);
        return Response.json(result, { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
      } catch (e) {
        if (e instanceof OAuthFailure) return oauthError(e.error, e.description, e.status);
        if (e instanceof HttpError) {
          if (e.status === 429 && e.code === "rate_limited")
            return oauthError("temporarily_unavailable", e.message, 429);
          return oauthError(OAUTH_CODES[e.code] ?? "invalid_request", e.message);
        }
        return oauthError("temporarily_unavailable", "Could not complete this request.", 503);
      }
    };
  }

  // ---- Bearer/session identification ------------------------------------

  function sameOrigin(request: Request): boolean {
    const origin = request.headers.get("origin");
    if (request.headers.get("sec-fetch-site") === "cross-site") return false;
    if (!origin) return true;
    // Next can normalize request.url to localhost; Host retains the public host.
    try {
      const source = new URL(origin),
        target = new URL(request.url);
      return source.protocol === target.protocol && source.host === (request.headers.get("host") ?? target.host);
    } catch {
      return false;
    }
  }
  function sessionToken(request: Request): string | null {
    return (
      request.headers
        .get("cookie")
        ?.split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${config.cookieName}=`))
        ?.slice(config.cookieName.length + 1) ?? null
    );
  }

  /** API keys and browser sessions resolve to the same stable account. Explicit
   * invalid bearer credentials do not silently fall back to a browser session. */
  async function identify(request: Request): Promise<Caller> {
    const header = request.headers.get("authorization");
    const presented = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
    const token = sessionToken(request);
    if (header && !presented?.startsWith(config.tokenPrefixes.apiKey) && !presented?.startsWith(config.tokenPrefixes.agent))
      return ANONYMOUS;
    if (
      !header &&
      (!token || (!["GET", "HEAD", "OPTIONS"].includes(request.method) && !sameOrigin(request)))
    )
      return ANONYMOUS;
    const client = await config.db.db(),
      now = Date.now();
    if (presented?.startsWith(config.tokenPrefixes.agent)) {
      const r = await client.execute({
        sql: `select * from ${tables.agentGrants} where hash=? and revoked_at is null and expires_at>?`,
        args: [await hashKey(presented), now],
      });
      const row = r.rows[0];
      if (!row) return ANONYMOUS;
      if (Number(row.last_used ?? 0) < now - 60000)
        void client
          .execute({ sql: `update ${tables.agentGrants} set last_used=? where id=?`, args: [now, row.id] })
          .catch(() => {});
      return {
        userId: String(row.user_id),
        keyId: null,
        email: null,
        agent: {
          id: String(row.id),
          ownerId: String(row[config.ownerColumn]),
          scopes: JSON.parse(String(row.scopes)),
          expiresAt: Number(row.expires_at),
        },
      };
    }
    if (presented) {
      const result = await client.execute({
        sql: `select ${tables.apiKeys}.id,${tables.apiKeys}.user_id,${tables.apiKeys}.last_used,${tables.users}.email from ${tables.apiKeys} join ${tables.users} on ${tables.users}.id=${tables.apiKeys}.user_id where ${tables.apiKeys}.hash=? and ${tables.apiKeys}.revoked_at is null`,
        args: [await hashKey(presented)],
      });
      const row = result.rows[0];
      if (!row) return ANONYMOUS;
      if (Number(row.last_used ?? 0) < now - 60_000)
        void client
          .execute({ sql: `update ${tables.apiKeys} set last_used=? where id=?`, args: [now, row.id] })
          .catch(() => {});
      return { userId: String(row.user_id), keyId: String(row.id), email: String(row.email) };
    }
    const result = await client.execute({
      sql: `select ${tables.sessions}.user_id,${tables.users}.email from ${tables.sessions} join ${tables.users} on ${tables.users}.id=${tables.sessions}.user_id where ${tables.sessions}.hash=? and ${tables.sessions}.revoked_at is null and ${tables.sessions}.expires_at>?`,
      args: [await hashKey(token!), now],
    });
    const row = result.rows[0];
    return row ? { userId: String(row.user_id), keyId: null, email: String(row.email) } : ANONYMOUS;
  }

  /** Deny by default: only a browser session (never an API key or an agent
   * credential) may authorize or manage agent access. */
  function requireOwnerSession(caller: Caller) {
    if (!caller.userId || caller.keyId || caller.agent)
      fail(403, "owner_session_required", "Sign in through your browser to authorize or manage agents");
  }

  async function userFor(client: Client, email: string): Promise<string> {
    const result = await client.execute({
      sql: `insert into ${tables.users} (id,email,created_at) values (?,?,?) on conflict(email) do update set email=excluded.email returning id`,
      args: [newId(), email.toLowerCase().trim(), Date.now()],
    });
    return String(result.rows[0]!.id);
  }
  async function createApiKey(email: string, label: string | null) {
    const client = await config.db.db(),
      userId = await userFor(client, email),
      key = config.tokenPrefixes.apiKey + secret(),
      id = newId();
    await client.execute({
      sql: `insert into ${tables.apiKeys} (id,user_id,hash,email,label,created_at) values (?,?,?,?,?,?)`,
      args: [id, userId, await hashKey(key), email.toLowerCase().trim(), label, Date.now()],
    });
    return { id, key };
  }
  async function loginToken(userId: string) {
    const token = secret(),
      client = await config.db.db(),
      now = Date.now();
    await client.batch(
      [
        { sql: `delete from ${tables.loginTokens} where created_at<?`, args: [now - magicLinkTtlMs] },
        { sql: `delete from ${tables.sessions} where expires_at<?`, args: [now] },
        {
          sql: `insert into ${tables.loginTokens} (hash,user_id,created_at) values (?,?,?)`,
          args: [await hashKey(token), userId, now],
        },
      ],
      "write",
    );
    return token;
  }
  async function createMagicLink(keyId: string): Promise<string> {
    const result = await (await config.db.db()).execute({
      sql: `select user_id from ${tables.apiKeys} where id=? and revoked_at is null`,
      args: [keyId],
    });
    if (!result.rows[0]) throw new Error("Unknown key.");
    return loginToken(String(result.rows[0].user_id));
  }
  async function createSignInLink(email: string): Promise<string> {
    return loginToken(await userFor(await config.db.db(), email));
  }
  /** Read-only mirror of redeemMagicLink's own claim condition, without the
   * claim: lets the emailed link's first GET show a confirm button for a link
   * that is still good, without spending it. A mail scanner that opens the GET
   * link this checks finds the same answer and moves on; only a person clicking
   * confirm reaches redeemMagicLink and actually consumes it. */
  async function magicLinkValid(token: string): Promise<boolean> {
    const result = await (await config.db.db()).execute({
      sql: `select 1 from ${tables.loginTokens} where hash=? and used_at is null and created_at>=?`,
      args: [await hashKey(token), Date.now() - magicLinkTtlMs],
    });
    return result.rows.length > 0;
  }
  /** The conditional update claims one token; session insertion uses that unique
   * claim in the same transaction. Two simultaneous redeems cannot both win. */
  async function redeemMagicLink(token: string): Promise<string | null> {
    const client = await config.db.db(),
      now = Date.now(),
      session = config.tokenPrefixes.session + secret();
    const [tokenHash, sessionHash] = await Promise.all([hashKey(token), hashKey(session)]);
    const statements = [
      {
        sql: `update ${tables.loginTokens} set used_at=?,session_hash=? where hash=? and used_at is null and created_at>=?`,
        args: [now, sessionHash, tokenHash, now - magicLinkTtlMs],
      },
      {
        sql: `insert into ${tables.sessions} (hash,user_id,created_at,expires_at) select ?,user_id,?,? from ${tables.loginTokens} where hash=? and session_hash=? returning user_id`,
        args: [sessionHash, now, now + sessionTtlMs, tokenHash, sessionHash],
      },
    ];
    if (config.legacyMagicTable)
      // Preserve consumed legacy links if the deployment is rolled back.
      statements.push({
        sql: `update ${config.legacyMagicTable} set used_at=? where token=? and exists(select 1 from ${tables.loginTokens} where hash=? and session_hash=?)`,
        args: [now, token, tokenHash, sessionHash],
      });
    const results = await client.batch(statements, "write");
    return results[1]!.rows.length ? session : null;
  }
  async function revokeSession(request: Request) {
    const token = sessionToken(request);
    if (token)
      await (await config.db.db()).execute({
        sql: `update ${tables.sessions} set revoked_at=? where hash=?`,
        args: [Date.now(), await hashKey(token)],
      });
  }
  async function listApiKeys(userId: string) {
    return (
      await (await config.db.db()).execute({
        sql: `select id,label,created_at,last_used,revoked_at from ${tables.apiKeys} where user_id=? order by created_at desc limit 100`,
        args: [userId],
      })
    ).rows;
  }
  async function revokeApiKey(userId: string, id: string) {
    const result = await (await config.db.db()).execute({
      sql: `update ${tables.apiKeys} set revoked_at=coalesce(revoked_at,?) where user_id=? and id=? returning id`,
      args: [Date.now(), userId, id],
    });
    return result.rows.length > 0;
  }

  // ---- Device-flow grant lifecycle ---------------------------------------

  async function requestAgentAccess(label: unknown, scopes: unknown, client: string) {
    if (
      typeof label !== "string" ||
      !label.trim() ||
      label.length > 60 ||
      !Array.isArray(scopes) ||
      !scopes.length ||
      scopes.some((s) => !config.scopes.includes(s))
    )
      fail(422, "invalid_request", "Supply a label and supported scopes");
    const admission = await admitWindow(await config.db.db(), tables.admission, `pair:${client}`, pairingLimit, pairingWindowMs);
    if (!admission.ok)
      throw new HttpError(
        429,
        "rate_limited",
        "Please wait before trying again",
        Math.max(1, Math.ceil(admission.retryAfterMs / 1000)),
      );
    const token = secret(),
      code = secret().slice(0, 12).toUpperCase(),
      now = Date.now();
    const dbClient = await config.db.db();
    await dbClient.execute({
      sql: `delete from ${tables.agentRequests} where expires_at<?`,
      args: [now - 86400000],
    });
    await dbClient.execute({
      sql: `insert into ${tables.agentRequests}(hash,code_hash,label,scopes,created_at,expires_at,next_poll) values(?,?,?,?,?,?,?)`,
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
      verificationUrl: `${config.siteUrl}${verificationPath}?code=${encodeURIComponent(code)}`,
      expiresIn: 600,
      interval: 5,
    };
  }
  async function inspectAgentRequest(code: string) {
    const r = await (await config.db.db()).execute({
      sql: `select label,scopes,status,created_at,expires_at from ${tables.agentRequests} where code_hash=? and expires_at>?`,
      args: [await codeHash(code), Date.now()],
    });
    if (!r.rows[0]) fail(404, "not_found", "Authorization request expired or unavailable");
    const row = r.rows[0];
    return {
      label: String(row.label),
      scopes: JSON.parse(String(row.scopes)) as string[],
      status: String(row.status),
      createdAt: Number(row.created_at),
      expiresAt: Number(row.expires_at),
    };
  }
  async function decideAgentRequest(userId: string, code: string, ownerId: string, days: number, approve: boolean) {
    if (![1, 7, 30].includes(days)) fail(422, "invalid_expiry", "Choose 1, 7 or 30 days");
    if (approve) await config.resolveOwner(userId, ownerId);
    const r = await (await config.db.db()).execute({
      sql: `update ${tables.agentRequests} set status=?,user_id=?,${config.ownerColumn}=?,grant_days=? where code_hash=? and status='pending' and expires_at>? returning hash`,
      args: [approve ? "approved" : "denied", userId, approve ? ownerId : null, days, await codeHash(code), Date.now()],
    });
    if (!r.rows.length) fail(409, "request_closed", "Authorization request expired or already answered");
    return { ok: true };
  }
  /**
   * The grant lifecycle behind both wire shapes: the RFC 8628 token endpoint
   * and an app's own alias for agents that already speak an earlier custom
   * pairing API. Tokens are delivered once and stored hashed.
   */
  async function pollAgentAccess(
    token: string,
  ): Promise<
    | { status: "pending"; interval: number }
    | {
        status: "authorized";
        accessToken: string;
        tokenType: "Bearer";
        expiresAt: number;
        scopes: string[];
        ownerId: string;
      }
  > {
    const client = await config.db.db(),
      tx = await client.transaction("write");
    try {
      const hash = await hashKey(token),
        now = Date.now();
      const row = (
        await tx.execute({ sql: `select * from ${tables.agentRequests} where hash=?`, args: [hash] })
      ).rows[0];
      if (!row) fail(400, "invalid_token", "Unknown request token");
      if (Number(row.expires_at) <= now) fail(400, "expired", "Start a new authorization request");
      if (row.status === "denied") fail(403, "denied", "The owner declined access");
      if (row.status === "consumed")
        fail(409, "consumed", "This credential was already delivered; start a new request if it was lost");
      if (Number(row.next_poll) > now) fail(429, "slow_down", "Poll no more than once every five seconds");
      await tx.execute({
        sql: `update ${tables.agentRequests} set next_poll=? where hash=?`,
        args: [now + 5000, hash],
      });
      if (row.status === "pending") {
        await tx.commit();
        return { status: "pending" as const, interval: 5 };
      }
      const active = await tx.execute({
        sql: `select count(*) as n from ${tables.agentGrants} where user_id=? and revoked_at is null and expires_at>?`,
        args: [row.user_id, now],
      });
      if (Number(active.rows[0]!.n) >= agentGrantLimit)
        fail(
          429,
          "agent_limit",
          `Revoke an existing access before creating more than ${agentGrantLimit} active agent credentials`,
        );
      const key = config.tokenPrefixes.agent + secret(),
        id = newId(),
        expiresAt = now + Number(row.grant_days) * 86400000;
      await tx.execute({
        sql: `insert into ${tables.agentGrants}(id,user_id,${config.ownerColumn},hash,label,scopes,created_at,expires_at) values(?,?,?,?,?,?,?,?)`,
        args: [id, row.user_id, row[config.ownerColumn], await hashKey(key), row.label, row.scopes, now, expiresAt],
      });
      await tx.execute({
        sql: `update ${tables.agentRequests} set status='consumed' where hash=?`,
        args: [hash],
      });
      await tx.commit();
      return {
        status: "authorized" as const,
        accessToken: key,
        tokenType: "Bearer" as const,
        expiresAt,
        scopes: JSON.parse(String(row.scopes)) as string[],
        ownerId: String(row[config.ownerColumn]),
      };
    } catch (e) {
      if (!tx.closed) await tx.rollback();
      throw e;
    } finally {
      tx.close();
    }
  }
  async function listAgentGrants(userId: string) {
    return (
      await (
        await config.db.db()
      ).execute({
        sql: `select id,${config.ownerColumn},label,scopes,created_at,expires_at,revoked_at,last_used from ${tables.agentGrants} where user_id=? order by (revoked_at is null and expires_at>?) desc,created_at desc,id desc limit 100`,
        args: [userId, Date.now()],
      })
    ).rows.map((r) => ({
      id: r.id,
      ownerId: r[config.ownerColumn],
      label: r.label,
      scopes: JSON.parse(String(r.scopes)),
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      revokedAt: r.revoked_at,
      lastUsed: r.last_used,
    }));
  }
  async function revokeAgent(userId: string, id: string) {
    const r = await (await config.db.db()).execute({
      sql: `update ${tables.agentGrants} set revoked_at=coalesce(revoked_at,?) where user_id=? and id=? returning id`,
      args: [Date.now(), userId, id],
    });
    if (!r.rows.length) fail(404, "not_found", "Agent access not found");
    return { ok: true };
  }

  return {
    ANONYMOUS,
    DEVICE_AUTHORIZATION_PATH,
    TOKEN_PATH,
    PROTECTED_RESOURCE_METADATA_PATH,
    authorizationServerMetadata,
    protectedResourceMetadata,
    bearerChallenge,
    discoveryResponse,
    oauthRoute,
    parseScope: (value: unknown) => parseScope(value, config.scopes),
    sameOrigin,
    identify,
    requireOwnerSession,
    createApiKey,
    createMagicLink,
    createSignInLink,
    magicLinkValid,
    redeemMagicLink,
    revokeSession,
    listApiKeys,
    revokeApiKey,
    requestAgentAccess,
    inspectAgentRequest,
    decideAgentRequest,
    pollAgentAccess,
    listAgentGrants,
    revokeAgent,
  };
}

export type AgentAuth = ReturnType<typeof createAgentAuth>;
