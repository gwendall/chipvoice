import { test } from "node:test";
import assert from "node:assert/strict";
import { HttpError, createRoute, objectBody } from "../dist/http/index.js";

function route(config = {}) {
  return createRoute({
    identify: async () => ({ userId: null }),
    ...config,
  });
}

test("a successful action is wrapped as JSON with Cache-Control: no-store", async () => {
  const handler = route()(async () => ({ ok: true }));
  const response = await handler(new Request("https://example.test/"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { ok: true });
});

test("an action returning its own Response is passed through untouched", async () => {
  const raw = new Response("audio bytes", { status: 206, headers: { "Content-Range": "bytes 0-1/2" } });
  const handler = route()(async () => raw);
  const response = await handler(new Request("https://example.test/"));
  assert.equal(response, raw);
});

test("a thrown HttpError becomes {error, message} with its status code", async () => {
  const handler = route()(async () => {
    throw new HttpError(404, "not_found", "No such project");
  });
  const response = await handler(new Request("https://example.test/"));
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "not_found", message: "No such project" });
});

test("a 429 HttpError sets Retry-After from retryAfter, defaulting to 60", async () => {
  const withValue = route()(async () => {
    throw new HttpError(429, "rate_limited", "Slow down", 12);
  });
  const withDefault = route()(async () => {
    throw new HttpError(429, "rate_limited", "Slow down");
  });
  const a = await withValue(new Request("https://example.test/"));
  const b = await withDefault(new Request("https://example.test/"));
  assert.equal(a.headers.get("retry-after"), "12");
  assert.equal(b.headers.get("retry-after"), "60");
});

test("hint is additive: omitted when unset, present when the error carries one", async () => {
  const withoutHint = route()(async () => {
    throw new HttpError(400, "invalid_request", "Bad input");
  });
  const withHint = route()(async () => {
    throw new HttpError(400, "invalid_request", "Bad input", undefined, "try again with a shorter title");
  });
  const a = await (await withoutHint(new Request("https://example.test/"))).json();
  const b = await (await withHint(new Request("https://example.test/"))).json();
  assert.equal("hint" in a, false);
  assert.equal(b.hint, "try again with a shorter title");
});

test("a 401 HttpError carries WWW-Authenticate only when bearerChallenge is configured", async () => {
  const handler = route({ bearerChallenge: (invalid) => `Bearer realm="test"${invalid ? ', error="invalid_token"' : ""}` })(
    async () => {
      throw new HttpError(401, "invalid_token", "Credential is invalid, expired or revoked");
    },
  );
  const response = await handler(new Request("https://example.test/"));
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("www-authenticate"), 'Bearer realm="test", error="invalid_token"');
});

test("an unrecognized thrown value falls back to a 503 envelope, not a crash", async () => {
  // Negative gate: a route must never leak a raw exception or stack trace to
  // the client, even when the action throws something that is not an HttpError.
  const handler = route()(async () => {
    throw new Error("database connection reset");
  });
  const response = await handler(new Request("https://example.test/"));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "unavailable",
    message: "Could not complete this request.",
  });
});

test("mapError intercepts before the default HttpError/fallback mapping", async () => {
  class ValidationError extends Error {}
  const handler = route({
    mapError: (error) => (error instanceof ValidationError ? Response.json({ error: "validation", message: error.message }, { status: 422 }) : null),
  })(async () => {
    throw new ValidationError("bad shape");
  });
  const response = await handler(new Request("https://example.test/"));
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), { error: "validation", message: "bad shape" });
});

test("ready() false short-circuits into the unavailable envelope before identify runs", async () => {
  let identified = false;
  const handler = route({
    ready: () => false,
    unavailable: { code: "db_down", message: "Database is unavailable" },
    identify: async () => {
      identified = true;
      return { userId: null };
    },
  })(async () => ({ ok: true }));
  const response = await handler(new Request("https://example.test/"));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "db_down", message: "Database is unavailable" });
  assert.equal(identified, false);
});

test("authenticated routes require a signed-in caller", async () => {
  const handler = route()(async () => ({ ok: true }), true);
  const response = await handler(new Request("https://example.test/"));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "sign_in", message: "Sign in to continue" });
});

test("a present but unrecognized bearer credential is rejected as invalid_token, not silently anonymous", async () => {
  const handler = route({ identify: async () => ({ userId: null }) })(async () => ({ ok: true }));
  const response = await handler(
    new Request("https://example.test/", { headers: { authorization: "Bearer garbage" } }),
  );
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: "invalid_token",
    message: "Credential is invalid, expired or revoked",
  });
});

test("objectBody accepts only listed keys and rejects anything else", () => {
  assert.deepEqual(objectBody({ title: "x" }, ["title", "tempo"]), { title: "x" });
  assert.throws(() => objectBody({ title: "x", evil: 1 }, ["title"]), (error) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 422);
    assert.equal(error.code, "invalid_request");
    return true;
  });
});

test("objectBody rejects arrays and non-objects, not just extra keys", () => {
  // Negative gate: an array happens to have string-indexable properties and
  // must not slip past the "no unknown keys" check.
  assert.throws(() => objectBody([1, 2, 3], ["title"]), HttpError);
  assert.throws(() => objectBody(null, ["title"]), HttpError);
  assert.throws(() => objectBody("nope", ["title"]), HttpError);
});
