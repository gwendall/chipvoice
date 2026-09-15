import assert from "node:assert/strict";
import { build } from "../../packages/chipvoice/node_modules/esbuild/lib/main.js";
import { randomUUID } from "node:crypto";
/**
 * The standard face of agent authorization, end to end against a real server:
 * RFC 8414 / RFC 9728 discovery, the RFC 8628 device grant with every routine
 * and terminal answer, one-time delivery, scope enforcement, and the earlier
 * pairing API still answering as an alias of the same grant.
 */
const base = process.env.API_URL;
assert.ok(
  base && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base),
  "Only a disposable local server",
);
assert.ok(process.env.TURSO_DEV_DATABASE_URL?.startsWith("file:"));
const guard = setTimeout(() => {
  console.error("TIMEOUT test-agent-oauth");
  process.exit(1);
}, 120000);
guard.unref();
await build({
  stdin: {
    contents: "export * from './src/lib/auth';export * from './src/lib/db';",
    resolveDir: process.cwd(),
  },
  outfile: "generated/test-agent-oauth.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  logLevel: "silent",
});
const api = await import("./generated/test-agent-oauth.mjs"),
  client = await api.db(),
  suffix = randomUUID().slice(0, 8);
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const ownerKey = await api.createKey(`oauth-${suffix}@example.test`, null);
const magic = await api.createMagicLink(ownerKey.id),
  redeem = await fetch(`${base}/api/auth/redeem?token=${magic}`, {
    redirect: "manual",
  }),
  cookie = redeem.headers.get("set-cookie").split(";")[0];
const json = async (path, init = {}) => {
  const r = await fetch(base + path, init);
  return {
    status: r.status,
    headers: r.headers,
    body: r.headers.get("content-type")?.includes("json")
      ? await r.json()
      : await r.text(),
  };
};
const form = (path, fields) =>
  json(path, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
const owner = (method, path, body) =>
  json(path, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
const bearer = (method, path, token, body) =>
  json(path, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
// Polling is rate limited to one call per five seconds per grant; the tests
// move the clock in the database rather than waiting.
const allowPoll = (deviceCode) =>
  api
    .hashKey(deviceCode)
    .then((hash) =>
      client.execute({
        sql: "update agent_requests set next_poll=0 where hash=?",
        args: [hash],
      }),
    );
// Five pairing requests a minute per address is the product behaving correctly;
// this suite alone needs more, so it clears the window instead of waiting.
const resetPairingLimit = () =>
  client.execute("delete from project_admission");
const poll = async (deviceCode) => {
  await allowPoll(deviceCode);
  return form("/api/v1/oauth/token", {
    grant_type: DEVICE_GRANT,
    device_code: deviceCode,
  });
};

// Discovery: the two documents agree with each other and with the routes.
const as = await json("/.well-known/oauth-authorization-server");
assert.equal(as.status, 200);
assert.equal(as.headers.get("access-control-allow-origin"), "*");
assert.deepEqual(as.body.grant_types_supported, [DEVICE_GRANT]);
assert.deepEqual(as.body.token_endpoint_auth_methods_supported, ["none"]);
assert.ok(as.body.scopes_supported.includes("projects:read"));
assert.ok(
  as.body.device_authorization_endpoint.endsWith(
    "/api/v1/oauth/device_authorization",
  ),
);
assert.ok(as.body.token_endpoint.endsWith("/api/v1/oauth/token"));
assert.ok(as.body.device_authorization_endpoint.startsWith(as.body.issuer));
for (const path of [
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/api/v1",
]) {
  const rs = await json(path);
  assert.equal(rs.status, 200, path);
  assert.deepEqual(rs.body.authorization_servers, [as.body.issuer]);
  assert.deepEqual(rs.body.scopes_supported, as.body.scopes_supported);
  assert.deepEqual(rs.body.bearer_methods_supported, ["header"]);
  assert.ok(rs.body.resource.endsWith("/api/v1"));
}
// A rejected bearer is told where the resource metadata lives (RFC 9728 section 5.1).
const challenged = await bearer("GET", "/api/v1/agent", "cv_agent_nobody");
assert.equal(challenged.status, 401);
assert.match(
  challenged.headers.get("www-authenticate"),
  /^Bearer realm="chipvoice", resource_metadata="[^"]+\/\.well-known\/oauth-protected-resource\/api\/v1", error="invalid_token"$/,
);

// Malformed device authorization requests.
await resetPairingLimit();
assert.equal(
  (await form("/api/v1/oauth/device_authorization", {})).body.error,
  "invalid_request",
);
assert.equal(
  (
    await form("/api/v1/oauth/device_authorization", {
      client_id: "Bad scope bot",
      scope: "projects:read root",
    })
  ).body.error,
  "invalid_scope",
);
const plain = await json("/api/v1/oauth/device_authorization", {
  method: "POST",
  headers: { "content-type": "text/plain" },
  body: "client_id=x",
});
assert.equal(plain.status, 400);
assert.equal(plain.body.error, "invalid_request");

// The happy path: request, owner approves in the browser session, one delivery.
const started = await form("/api/v1/oauth/device_authorization", {
  client_id: "Pocket conductor",
  scope: "projects:read evaluate",
});
assert.equal(started.status, 200, JSON.stringify(started.body));
assert.equal(started.headers.get("cache-control"), "no-store");
const grant = started.body;
assert.ok(grant.device_code.length >= 16);
assert.equal(grant.expires_in, 600);
assert.equal(grant.interval, 5);
assert.ok(grant.verification_uri.endsWith("/connect"));
assert.ok(
  grant.verification_uri_complete.endsWith(
    `/connect?code=${encodeURIComponent(grant.user_code)}`,
  ),
);
assert.ok(!grant.verification_uri_complete.includes(grant.device_code));
const pending = await poll(grant.device_code);
assert.equal(pending.status, 400);
assert.equal(pending.body.error, "authorization_pending");
assert.equal(pending.headers.get("cache-control"), "no-store");
// Polling again inside the interval is the one routine error the RFC reserves.
const hurried = await form("/api/v1/oauth/token", {
  grant_type: DEVICE_GRANT,
  device_code: grant.device_code,
});
assert.equal(hurried.status, 400);
assert.equal(hurried.body.error, "slow_down");
// The owner sees exactly the requested scopes before deciding.
const review = await owner(
  "GET",
  `/api/v1/agent-requests/decision?code=${grant.user_code}`,
);
assert.equal(review.status, 200);
assert.equal(review.body.label, "Pocket conductor");
assert.deepEqual(review.body.scopes, ["projects:read", "evaluate"]);
// A bearer holder cannot approve: approval is a browser session, never an API key.
assert.equal(
  (
    await bearer("POST", "/api/v1/agent-requests/decision", ownerKey.key, {
      code: grant.user_code,
      profileId: "x",
      days: 7,
      approve: true,
    })
  ).status,
  403,
);
const profile = (await owner("GET", "/api/v1/profiles")).body.items[0];
assert.equal(
  (
    await owner("POST", "/api/v1/agent-requests/decision", {
      code: grant.user_code,
      profileId: profile.id,
      days: 1,
      approve: true,
    })
  ).status,
  200,
);
const issued = await poll(grant.device_code);
assert.equal(issued.status, 200, JSON.stringify(issued.body));
assert.equal(issued.body.token_type, "Bearer");
assert.match(issued.body.access_token, /^cv_agent_/);
assert.equal(issued.body.scope, "projects:read evaluate");
assert.ok(issued.body.expires_in > 86000 && issued.body.expires_in <= 86400);
const again = await poll(grant.device_code);
assert.equal(again.status, 400);
assert.equal(again.body.error, "invalid_grant", "delivered exactly once");
const token = issued.body.access_token;
const me = await bearer("GET", "/api/v1/agent", token);
assert.equal(me.status, 200);
assert.deepEqual(me.body.scopes, ["projects:read", "evaluate"]);
assert.equal(me.body.profile.id, profile.id);
// Scope is enforced by the resource, not by the token's existence.
const denied = await bearer("PUT", "/api/v1/profile", token, {
  displayName: "Nope",
});
assert.equal(denied.status, 403);
assert.equal(denied.body.error, "insufficient_scope");

// Terminal answers: declined, unknown, expired, wrong grant type.
await resetPairingLimit();
const declined = await form("/api/v1/oauth/device_authorization", {
  client_id: "Declined bot",
});
assert.equal(declined.status, 200);
assert.deepEqual(
  (
    await owner(
      "GET",
      `/api/v1/agent-requests/decision?code=${declined.body.user_code}`,
    )
  ).body.scopes,
  as.body.scopes_supported,
  "omitted scope asks for every agent scope, which the owner reviews",
);
await owner("POST", "/api/v1/agent-requests/decision", {
  code: declined.body.user_code,
  profileId: profile.id,
  days: 7,
  approve: false,
});
assert.equal(
  (await poll(declined.body.device_code)).body.error,
  "access_denied",
);
const unknown = await form("/api/v1/oauth/token", {
  grant_type: DEVICE_GRANT,
  device_code: "not-a-device-code-anyone-issued",
});
assert.equal(unknown.status, 400);
assert.equal(unknown.body.error, "invalid_grant");
const stale = await form("/api/v1/oauth/device_authorization", {
  client_id: "Slow bot",
});
await client.execute({
  sql: "update agent_requests set expires_at=? where hash=?",
  args: [Date.now() - 1, await api.hashKey(stale.body.device_code)],
});
assert.equal((await poll(stale.body.device_code)).body.error, "expired_token");
const wrongGrant = await form("/api/v1/oauth/token", {
  grant_type: "authorization_code",
  device_code: grant.device_code,
});
assert.equal(wrongGrant.status, 400);
assert.equal(wrongGrant.body.error, "unsupported_grant_type");
assert.equal(
  (await form("/api/v1/oauth/token", { device_code: grant.device_code })).body
    .error,
  "invalid_request",
);

// The earlier pairing API is an alias of the same lifecycle, not a second one:
// a grant started there is visible to the standard token endpoint and vice versa.
const legacy = await json("/api/v1/agent-requests", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ label: "Legacy bot", scopes: ["projects:read"] }),
});
assert.equal(legacy.status, 200);
assert.equal(
  (await poll(legacy.body.requestToken)).body.error,
  "authorization_pending",
);
await allowPoll(grant.device_code);
const legacyPoll = await json("/api/v1/agent-requests/token", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ requestToken: grant.device_code }),
});
assert.equal(legacyPoll.status, 409, "consumed in the alias vocabulary");
assert.equal(legacyPoll.body.error, "consumed");
const legacyUnknown = await json("/api/v1/agent-requests/token", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ requestToken: "not-a-request-token-anyone-issued" }),
});
assert.equal(legacyUnknown.status, 400);
assert.equal(legacyUnknown.body.error, "invalid_token");

// Discovery surfaces name the standard, not a custom protocol.
const skill = await (await fetch(base + "/skill.md")).text();
assert.ok(skill.includes("/.well-known/oauth-authorization-server"));
assert.ok(skill.includes("urn:ietf:params:oauth:grant-type:device_code"));
assert.ok(!skill.includes("not an OAuth"));
const manifest = (await json("/.well-known/mcp.json")).body;
assert.ok(
  manifest.authorization.authorization_server.endsWith(
    "/.well-known/oauth-authorization-server",
  ),
);
assert.ok(
  manifest.tools.some((tool) => tool.name === "requestDeviceAuthorization"),
);
const spec = (await json("/.well-known/openapi.json")).body;
assert.ok(spec.paths["/api/v1/oauth/token"].post.operationId);
assert.equal(spec.paths["/api/v1/agent-requests"].post.deprecated, true);
await resetPairingLimit();
await client.close();
console.log(
  "PASS OAuth discovery; device grant routine and terminal answers; one-time delivery; scope enforcement; pairing alias shares the grant",
);
