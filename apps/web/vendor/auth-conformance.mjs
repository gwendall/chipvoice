// Vendored from the kami monorepo (scripts/auth-conformance.mjs): the black-box
// conformance run every issuer of the agent device grant plays in its own CI.
// Copy, never edit here - a change belongs upstream first, then in every copy.
//
// Black-box conformance of a service's agent authorization to the profile in
// DOCS/agent-auth-architecture.md section 1: OAuth 2.0 device grant (RFC 8628)
// discovered through RFC 8414 / RFC 9728 metadata, browser-only approval,
// one-time delivery, scope enforcement. No dependencies, so any repo can run it
// against its own server in CI or against production by hand.
//
//   node scripts/auth-conformance.mjs <origin> [options]
//
//   --resource <path>        protected resource path (default: from the metadata,
//                            else the origin) - selects the RFC 9728 document
//   --probe <path>           a resource URL that needs a bearer (default: resource)
//   --client-id <name>       the agent name presented (default: auth-conformance)
//   --scope "<a b>"          scopes requested (default: the first advertised)
//   --approve "<command>"    shell command that approves the pending request the
//                            way a person would; receives AUTH_CONFORMANCE_* env
//   --deny "<command>"       same, declining a second request
//   --out-of-scope "<METHOD path>"  a resource call the issued scope must not allow
//   --json                   machine-readable report
//
// Exit code 1 if any check fails. Checks are numbered W1-W9 (the wire profile) in the doc.
import { spawn } from "node:child_process";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const args = process.argv.slice(2);
const origin = args.find((a) => !a.startsWith("--"))?.replace(/\/$/, "");
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
if (!origin) {
  console.error("usage: auth-conformance.mjs <origin> [options]");
  process.exit(2);
}
const config = {
  resource: option("--resource"),
  probe: option("--probe"),
  clientId: option("--client-id") ?? "auth-conformance",
  scope: option("--scope"),
  approve: option("--approve"),
  deny: option("--deny"),
  outOfScope: option("--out-of-scope"),
  json: args.includes("--json"),
};
const budget = setTimeout(() => {
  console.error("auth-conformance: overall time budget exceeded");
  process.exit(1);
}, 180000);
budget.unref();

const results = [];
let current = null;
function check(id, title) {
  current = { id, title, ok: true, notes: [] };
  results.push(current);
}
function expect(condition, note) {
  if (condition) return;
  current.ok = false;
  current.notes.push(note);
}
function skip(id, title, why) {
  results.push({ id, title, ok: true, skipped: true, notes: [why] });
}
async function get(url, headers = {}) {
  const res = await fetch(url, { headers, redirect: "manual" });
  return {
    status: res.status,
    headers: res.headers,
    body: res.headers.get("content-type")?.includes("json")
      ? await res.json().catch(() => null)
      : await res.text(),
  };
}
async function post(url, fields, headers = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
      ...headers,
    },
    body: new URLSearchParams(fields).toString(),
    redirect: "manual",
  });
  return {
    status: res.status,
    headers: res.headers,
    body: res.headers.get("content-type")?.includes("json")
      ? await res.json().catch(() => null)
      : await res.text(),
  };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isUrl = (value) => {
  try {
    return typeof value === "string" && Boolean(new URL(value));
  } catch {
    return false;
  }
};
/** The metadata names absolute URLs on the issuer; a local server under test answers on the origin. */
const rebase = (url) =>
  isUrl(url) ? origin + new URL(url).pathname + new URL(url).search : url;
function run(command, env) {
  return new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env, ...env },
    });
    child.on("exit", (code) => resolve(code));
  });
}

// W1 - authorization server metadata (RFC 8414).
check("W1", "authorization server metadata names the device grant");
const as = await get(`${origin}/.well-known/oauth-authorization-server`);
expect(as.status === 200, `status ${as.status}`);
const meta = as.body && typeof as.body === "object" ? as.body : {};
expect(isUrl(meta.issuer), "issuer is not a URL");
expect(
  isUrl(meta.device_authorization_endpoint),
  "device_authorization_endpoint missing",
);
expect(isUrl(meta.token_endpoint), "token_endpoint missing");
expect(
  Array.isArray(meta.grant_types_supported) &&
    meta.grant_types_supported.includes(DEVICE_GRANT),
  "grant_types_supported lacks the device grant",
);
expect(
  Array.isArray(meta.token_endpoint_auth_methods_supported) &&
    meta.token_endpoint_auth_methods_supported.includes("none"),
  "token_endpoint_auth_methods_supported lacks none (public clients)",
);
expect(
  Array.isArray(meta.scopes_supported) && meta.scopes_supported.length > 0,
  "scopes_supported empty",
);
for (const key of ["device_authorization_endpoint", "token_endpoint"])
  expect(
    isUrl(meta[key]) && isUrl(meta.issuer) && meta[key].startsWith(meta.issuer),
    `${key} is not under the issuer`,
  );
const scopes = Array.isArray(meta.scopes_supported) ? meta.scopes_supported : [];
const requestedScope = config.scope ?? scopes[0] ?? "";

// W2 - protected resource metadata (RFC 9728).
check("W2", "protected resource metadata points back at the issuer");
const resourcePath = config.resource ?? "";
const rsUrl = `${origin}/.well-known/oauth-protected-resource${resourcePath}`;
const rs = await get(rsUrl);
expect(rs.status === 200, `status ${rs.status} at ${rsUrl}`);
const resource = rs.body && typeof rs.body === "object" ? rs.body : {};
expect(isUrl(resource.resource), "resource is not a URL");
expect(
  Array.isArray(resource.authorization_servers) &&
    resource.authorization_servers.includes(meta.issuer),
  "authorization_servers does not include the issuer",
);
expect(
  Array.isArray(resource.scopes_supported) &&
    resource.scopes_supported.every((s) => scopes.includes(s)),
  "resource scopes are not all advertised by the authorization server",
);
expect(
  Array.isArray(resource.bearer_methods_supported) &&
    resource.bearer_methods_supported.includes("header"),
  "bearer_methods_supported lacks header",
);
const probe = config.probe
  ? `${origin}${config.probe}`
  : isUrl(resource.resource)
    ? rebase(resource.resource)
    : origin;

// W3 - a rejected bearer learns where the metadata lives (RFC 9728 section 5.1).
check("W3", "a 401 carries WWW-Authenticate with resource_metadata");
const rejected = await get(probe, { authorization: "Bearer not-a-real-token" });
expect(rejected.status === 401, `status ${rejected.status} at ${probe}`);
const challenge = rejected.headers.get("www-authenticate") ?? "";
expect(/^Bearer\b/.test(challenge), `WWW-Authenticate: ${challenge || "(none)"}`);
expect(
  challenge.includes("/.well-known/oauth-protected-resource"),
  "resource_metadata not named in the challenge",
);

// W4 - device authorization (RFC 8628 section 3.2).
check("W4", "device authorization answers the five fields");
const deviceEndpoint = rebase(meta.device_authorization_endpoint ?? "");
const tokenEndpoint = rebase(meta.token_endpoint ?? "");
const started = await post(deviceEndpoint, {
  client_id: config.clientId,
  ...(requestedScope ? { scope: requestedScope } : {}),
});
expect(started.status === 200, `status ${started.status}: ${JSON.stringify(started.body)}`);
const grant = started.body && typeof started.body === "object" ? started.body : {};
for (const key of ["device_code", "user_code", "verification_uri", "expires_in", "interval"])
  expect(grant[key] !== undefined, `${key} missing`);
expect(
  typeof grant.device_code === "string" && grant.device_code.length >= 16,
  "device_code shorter than 16 characters",
);
expect(Number.isInteger(grant.interval) && grant.interval >= 5, "interval below 5 s");
expect(Number.isInteger(grant.expires_in) && grant.expires_in > 0, "expires_in not positive");
expect(isUrl(grant.verification_uri), "verification_uri is not a URL");
expect(
  !grant.verification_uri_complete ||
    !String(grant.verification_uri_complete).includes(grant.device_code),
  "verification_uri_complete leaks the device_code",
);
expect(
  (started.headers.get("cache-control") ?? "").includes("no-store"),
  "response is cacheable (Cache-Control lacks no-store)",
);
let interval = Number.isInteger(grant.interval) ? grant.interval : 5;
let lastPoll = 0;
const poll = async (deviceCode = grant.device_code) => {
  if (deviceCode === grant.device_code) lastPoll = Date.now();
  return post(tokenEndpoint, { grant_type: DEVICE_GRANT, device_code: deviceCode });
};
/**
 * RFC 8628 section 3.5: wait the interval since the last poll, grown by 5 s after
 * each slow_down. The server stamps the poll on arrival, later than lastPoll, so
 * a second of margin keeps a punctual poll from reading as early.
 */
const pace = () =>
  sleep(Math.max(0, lastPoll + (interval + 1) * 1000 - Date.now()));

// W5 - routine polling answers.
check("W5", "polling answers authorization_pending, then slow_down inside the interval");
const pending = await poll();
expect(pending.status === 400, `status ${pending.status}`);
expect(pending.body?.error === "authorization_pending", `error ${pending.body?.error}`);
expect(
  (pending.headers.get("cache-control") ?? "").includes("no-store"),
  "token error is cacheable",
);
const hurried = await poll();
expect(hurried.body?.error === "slow_down", `second immediate poll: ${hurried.body?.error}`);
if (hurried.body?.error === "slow_down") interval += 5;

// W6 - malformed and unknown requests answer RFC 6749 section 5.2 codes.
check("W6", "invalid requests answer standard error codes");
const unknown = await poll("not-a-device-code-anyone-issued-0000");
expect(unknown.status === 400, `unknown code status ${unknown.status}`);
expect(unknown.body?.error === "invalid_grant", `unknown code: ${unknown.body?.error}`);
const wrongGrant = await post(tokenEndpoint, {
  grant_type: "authorization_code",
  device_code: grant.device_code,
});
expect(
  wrongGrant.body?.error === "unsupported_grant_type",
  `wrong grant_type: ${wrongGrant.body?.error}`,
);
const noGrant = await post(tokenEndpoint, { device_code: grant.device_code });
expect(noGrant.body?.error === "invalid_request", `missing grant_type: ${noGrant.body?.error}`);
const junkScope = await post(deviceEndpoint, {
  client_id: config.clientId,
  scope: "auth-conformance:no-such-scope",
});
expect(junkScope.body?.error === "invalid_scope", `unknown scope: ${junkScope.body?.error}`);
const noClient = await post(deviceEndpoint, {});
expect(noClient.body?.error === "invalid_request", `missing client_id: ${noClient.body?.error}`);

// W7 - approval is a person in a browser, never a bearer of the codes.
check("W7", "presenting the codes with a bearer does not approve the request");
const verification = rebase(grant.verification_uri_complete ?? grant.verification_uri);
const bearerish = { authorization: `Bearer ${grant.device_code}` };
await get(verification, bearerish);
await fetch(verification, {
  method: "POST",
  headers: { ...bearerish, "content-type": "application/json" },
  body: JSON.stringify({ decision: "approve", approve: true, code: grant.user_code }),
  redirect: "manual",
}).catch(() => null);
await pace();
const stillPending = await poll();
expect(
  stillPending.body?.error === "authorization_pending",
  `after a bearer visited the verification URL: ${stillPending.body?.error ?? stillPending.status}`,
);

// W8 - issuance, once, and the token opens the resource within its scope.
if (!config.approve) {
  skip("W8", "approval issues the token once", "no --approve hook given");
} else {
  check("W8", "approval issues the token once");
  const code = await run(config.approve, {
    AUTH_CONFORMANCE_ORIGIN: origin,
    AUTH_CONFORMANCE_USER_CODE: grant.user_code,
    AUTH_CONFORMANCE_VERIFICATION_URI: rebase(grant.verification_uri),
    AUTH_CONFORMANCE_VERIFICATION_URI_COMPLETE: verification,
  });
  expect(code === 0, `approve hook exited ${code}`);
  await pace();
  const issued = await poll();
  expect(issued.status === 200, `status ${issued.status}: ${JSON.stringify(issued.body)}`);
  const token = issued.body && typeof issued.body === "object" ? issued.body : {};
  expect(typeof token.access_token === "string" && token.access_token.length > 0, "access_token missing");
  expect(token.token_type === "Bearer", `token_type ${token.token_type}`);
  expect(typeof token.scope === "string", "scope missing from the token response");
  expect(
    (issued.headers.get("cache-control") ?? "").includes("no-store"),
    "token response is cacheable",
  );
  await pace();
  const again = await poll();
  expect(again.body?.error === "invalid_grant", `second delivery: ${again.body?.error ?? again.status}`);
  if (token.access_token) {
    const opened = await get(probe, { authorization: `Bearer ${token.access_token}` });
    expect(opened.status !== 401, `the issued token is rejected at ${probe} (${opened.status})`);
    if (config.outOfScope) {
      const [method, path] = config.outOfScope.split(/\s+/);
      const res = await fetch(`${origin}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token.access_token}`,
          "content-type": "application/json",
        },
        body: method === "GET" ? undefined : "{}",
        redirect: "manual",
      });
      const body = await res.json().catch(() => ({}));
      expect(res.status === 403, `out-of-scope call ${config.outOfScope}: status ${res.status}`);
      // RFC 6750 section 3.1 names the error in the challenge; services that
      // answer JSON errors name it in the body under error or code.
      const named = [
        res.headers.get("www-authenticate") ?? "",
        body.error,
        body.code,
      ].some((v) => typeof v === "string" && v.includes("insufficient_scope"));
      expect(named, `out-of-scope call does not name insufficient_scope: ${JSON.stringify(body)}`);
    } else current.notes.push("no --out-of-scope call given; scope enforcement not exercised");
  }
}

// W9 - a declined request is terminal.
if (!config.deny) {
  skip("W9", "declining answers access_denied", "no --deny hook given");
} else {
  check("W9", "declining answers access_denied");
  const second = await post(deviceEndpoint, {
    client_id: `${config.clientId} (declined)`,
    ...(requestedScope ? { scope: requestedScope } : {}),
  });
  const declined = second.body && typeof second.body === "object" ? second.body : {};
  expect(second.status === 200, `status ${second.status}`);
  const code = await run(config.deny, {
    AUTH_CONFORMANCE_ORIGIN: origin,
    AUTH_CONFORMANCE_USER_CODE: declined.user_code,
    AUTH_CONFORMANCE_VERIFICATION_URI: rebase(declined.verification_uri),
    AUTH_CONFORMANCE_VERIFICATION_URI_COMPLETE: rebase(
      declined.verification_uri_complete ?? declined.verification_uri,
    ),
  });
  expect(code === 0, `deny hook exited ${code}`);
  const answer = await poll(declined.device_code);
  expect(answer.body?.error === "access_denied", `after decline: ${answer.body?.error ?? answer.status}`);
}

const failed = results.filter((r) => !r.ok);
if (config.json) {
  console.log(JSON.stringify({ origin, issuer: meta.issuer, results }, null, 2));
} else {
  console.log(`auth-conformance ${origin} (issuer ${meta.issuer ?? "?"})`);
  for (const r of results) {
    const mark = r.skipped ? "SKIP" : r.ok ? "PASS" : "FAIL";
    console.log(`${mark}  ${r.id}  ${r.title}`);
    for (const note of r.notes) console.log(`      - ${note}`);
  }
  console.log(
    `${results.length - failed.length}/${results.length} checks pass` +
      (failed.length ? `, ${failed.length} failing` : ""),
  );
}
process.exit(failed.length ? 1 : 0);
