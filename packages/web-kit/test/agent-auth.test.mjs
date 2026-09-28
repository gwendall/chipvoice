import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "../dist/db/index.js";
import { createAgentAuth } from "../dist/agent-auth/index.js";
import { HttpError } from "../dist/http/index.js";

const migrations = [
  {
    name: "baseline",
    up: async (tx) => {
      await tx.execute(
        `create table users (id text primary key, email text not null unique, created_at integer not null)`,
      );
      await tx.execute(
        `create table sessions (hash text primary key, user_id text not null, created_at integer not null, expires_at integer not null, revoked_at integer)`,
      );
      await tx.execute(
        `create table login_tokens (hash text primary key, user_id text not null, created_at integer not null, used_at integer, session_hash text)`,
      );
      await tx.execute(
        `create table keys (id text primary key, user_id text not null, hash text not null, email text not null, label text, created_at integer not null, last_used integer, revoked_at integer)`,
      );
      await tx.execute(
        `create table agent_requests (hash text primary key, code_hash text not null unique, label text not null, scopes text not null, created_at integer not null, expires_at integer not null, next_poll integer not null, status text not null default 'pending', user_id text, owner_id text, grant_days integer)`,
      );
      await tx.execute(
        `create table agent_grants (id text primary key, user_id text not null, owner_id text not null, hash text not null unique, label text not null, scopes text not null, created_at integer not null, expires_at integer not null, revoked_at integer, last_used integer)`,
      );
      await tx.execute(
        `create table admission (scope text primary key, window integer not null, count integer not null)`,
      );
    },
  },
];

async function makeAuth(t, overrides = {}) {
  const dir = await mkdtemp(join(tmpdir(), "web-kit-agent-auth-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const db = createDb({
    localFile: join(dir, "auth.db"),
    envPrefix: `WEBKIT_TEST_AUTH_${Math.random().toString(36).slice(2)}`,
    migrations,
  });
  const owners = new Map([["owner-1", { id: "owner-1" }]]);
  const auth = createAgentAuth({
    db,
    siteUrl: "https://example.test",
    realm: "example",
    resourceName: "example api",
    scopes: ["read", "write"],
    cookieName: "example_session",
    tokenPrefixes: { agent: "ex_agent_", apiKey: "ex_key_", session: "ex_session_" },
    ownerColumn: "owner_id",
    resolveOwner: async (userId, ownerId) => {
      const owner = owners.get(ownerId);
      if (!owner) throw new HttpError(403, "forbidden", "Not your resource");
      return owner;
    },
    ...overrides,
  });
  return { auth, db };
}

async function createSignedInUser(auth, db, email) {
  const client = await db.db();
  const { key } = await auth.createApiKey(email, "test key");
  const result = await client.execute({ sql: `select id from users where email=?`, args: [email] });
  return { userId: String(result.rows[0].id), apiKey: key };
}

test("device flow: request, approve, poll delivers a token exactly once", async (t) => {
  const { auth, db } = await makeAuth(t);
  const { userId } = await createSignedInUser(auth, db, "owner@example.test");

  const request = await auth.requestAgentAccess("My Agent", ["read"], "client-fingerprint-1");
  assert.match(request.requestToken, /^[0-9a-f]+$/);
  assert.equal(request.userCode.length, 12);
  assert.ok(request.verificationUrl.includes(encodeURIComponent(request.userCode)));

  const inspected = await auth.inspectAgentRequest(request.userCode);
  assert.equal(inspected.status, "pending");
  assert.deepEqual(inspected.scopes, ["read"]);

  const decision = await auth.decideAgentRequest(userId, request.userCode, "owner-1", 7, true);
  assert.deepEqual(decision, { ok: true });

  const authorized = await auth.pollAgentAccess(request.requestToken);
  assert.equal(authorized.status, "authorized");
  assert.equal(authorized.tokenType, "Bearer");
  assert.ok(authorized.accessToken.startsWith("ex_agent_"));
  assert.deepEqual(authorized.scopes, ["read"]);
  assert.equal(authorized.ownerId, "owner-1");

  // Negative gate: the token is delivered once. A second poll of the same
  // request token must not mint or reveal another one.
  await assert.rejects(auth.pollAgentAccess(request.requestToken), (error) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 409);
    assert.equal(error.code, "consumed");
    return true;
  });

  // And the delivered credential actually authenticates as the approved owner.
  const authedRequest = new Request("https://example.test/api/v1/songs", {
    headers: { authorization: `Bearer ${authorized.accessToken}` },
  });
  const caller = await auth.identify(authedRequest);
  assert.equal(caller.userId, userId);
  assert.equal(caller.agent.ownerId, "owner-1");
  assert.deepEqual(caller.agent.scopes, ["read"]);
});

test("device flow: polling faster than the interval is throttled with slow_down", async (t) => {
  const { auth } = await makeAuth(t);
  const request = await auth.requestAgentAccess("Impatient Agent", ["read"], "client-impatient");
  const first = await auth.pollAgentAccess(request.requestToken);
  assert.deepEqual(first, { status: "pending", interval: 5 });
  // Negative gate: polling again immediately, before the interval elapses,
  // must be rejected rather than quietly answered a second time.
  await assert.rejects(auth.pollAgentAccess(request.requestToken), (error) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 429);
    assert.equal(error.code, "slow_down");
    return true;
  });
});

test("device flow: a denied request never issues a token", async (t) => {
  const { auth, db } = await makeAuth(t);
  const { userId } = await createSignedInUser(auth, db, "denier@example.test");
  const request = await auth.requestAgentAccess("Denied Agent", ["read"], "client-fingerprint-2");
  await auth.decideAgentRequest(userId, request.userCode, "owner-1", 7, false);
  await assert.rejects(auth.pollAgentAccess(request.requestToken), (error) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 403);
    assert.equal(error.code, "denied");
    return true;
  });
});

test("device flow: an expired request cannot be polled into a token", async (t) => {
  const { auth, db } = await makeAuth(t);
  const request = await auth.requestAgentAccess("Expiring Agent", ["read"], "client-fingerprint-3");
  const client = await db.db();
  await client.execute({
    sql: `update agent_requests set expires_at=? where code_hash is not null`,
    args: [Date.now() - 1000],
  });
  await assert.rejects(auth.pollAgentAccess(request.requestToken), (error) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 400);
    assert.equal(error.code, "expired");
    return true;
  });
});

test("device flow: an unknown request token is rejected as invalid_token", async (t) => {
  // Negative gate: polling a token that was never issued must not be
  // confused with "pending" or leak whether any request exists.
  const { auth } = await makeAuth(t);
  await assert.rejects(auth.pollAgentAccess("not-a-real-token"), (error) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 400);
    assert.equal(error.code, "invalid_token");
    return true;
  });
});

test("requestAgentAccess rejects an unsupported scope and a missing label", async (t) => {
  const { auth } = await makeAuth(t);
  await assert.rejects(auth.requestAgentAccess("ok", ["not-a-real-scope"], "client-4"), (error) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 422);
    return true;
  });
  await assert.rejects(auth.requestAgentAccess("", ["read"], "client-4"), HttpError);
});

test("requestAgentAccess rate-limits pairing per client and reports Retry-After via retryAfter", async (t) => {
  const { auth } = await makeAuth(t, { pairing: { limit: 2, windowMs: 60_000 } });
  await auth.requestAgentAccess("A", ["read"], "same-client");
  await auth.requestAgentAccess("A", ["read"], "same-client");
  await assert.rejects(auth.requestAgentAccess("A", ["read"], "same-client"), (error) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 429);
    assert.equal(error.code, "rate_limited");
    assert.ok(error.retryAfter >= 1);
    return true;
  });
});

test("decideAgentRequest rejects approval against an owner resolveOwner does not recognize", async (t) => {
  const { auth, db } = await makeAuth(t);
  const { userId } = await createSignedInUser(auth, db, "stranger@example.test");
  const request = await auth.requestAgentAccess("Stranger Agent", ["read"], "client-5");
  await assert.rejects(
    auth.decideAgentRequest(userId, request.userCode, "not-an-owner", 7, true),
    HttpError,
  );
  // The request must remain open for a legitimate decision, not get stuck closed.
  const inspected = await auth.inspectAgentRequest(request.userCode);
  assert.equal(inspected.status, "pending");
});

test("identify() resolves an API key and rejects a garbage bearer token as anonymous", async (t) => {
  const { auth, db } = await makeAuth(t);
  const { apiKey } = await createSignedInUser(auth, db, "keyholder@example.test");
  const good = await auth.identify(
    new Request("https://example.test/api/v1/songs", { headers: { authorization: `Bearer ${apiKey}` } }),
  );
  assert.equal(good.email, "keyholder@example.test");
  assert.equal(good.keyId !== null, true);

  const bad = await auth.identify(
    new Request("https://example.test/api/v1/songs", { headers: { authorization: "Bearer totally-invalid" } }),
  );
  assert.deepEqual(bad, auth.ANONYMOUS);
});

test("magic link sign-in: a redeemed link cannot be redeemed twice", async (t) => {
  const { auth } = await makeAuth(t);
  const token = await auth.createSignInLink("magic@example.test");
  assert.equal(await auth.magicLinkValid(token), true);
  const session = await auth.redeemMagicLink(token);
  assert.ok(session.startsWith("ex_session_"));
  assert.equal(await auth.magicLinkValid(token), false);
  // Negative gate: redeeming an already-used link must not mint a second session.
  const second = await auth.redeemMagicLink(token);
  assert.equal(second, null);
});
