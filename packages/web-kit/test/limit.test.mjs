import { test } from "node:test";
import assert from "node:assert/strict";
import { allow, clientKey } from "../dist/limit/index.js";

test("allow() enforces the caller-supplied per-tier budget within a fixed window", () => {
  const limits = { anonymous: 2, key: 5 };
  const id = `unit-${Math.random()}`;
  assert.deepEqual(allow(id, "anonymous", limits), { ok: true });
  assert.deepEqual(allow(id, "anonymous", limits), { ok: true });
  const blocked = allow(id, "anonymous", limits);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfter >= 1);
  // A different tier vocabulary for the same key gets its own budget.
  assert.deepEqual(allow(id, "key", limits), { ok: true });
});

test("allow() tracks callers independently by key", () => {
  const limits = { anonymous: 1 };
  const a = `unit-a-${Math.random()}`,
    b = `unit-b-${Math.random()}`;
  assert.deepEqual(allow(a, "anonymous", limits), { ok: true });
  assert.equal(allow(a, "anonymous", limits).ok, false);
  assert.deepEqual(allow(b, "anonymous", limits), { ok: true });
});

test("clientKey() prefers x-real-ip, then the rightmost x-forwarded-for entry, then unknown", () => {
  assert.equal(
    clientKey(new Request("https://example.com", { headers: { "x-real-ip": " 1.2.3.4 " } })),
    "1.2.3.4",
  );
  assert.equal(
    clientKey(new Request("https://example.com", { headers: { "x-forwarded-for": "9.9.9.9, 5.6.7.8" } })),
    "5.6.7.8",
  );
  assert.equal(clientKey(new Request("https://example.com")), "unknown");
  // x-real-ip wins even when both are present.
  assert.equal(
    clientKey(
      new Request("https://example.com", {
        headers: { "x-real-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" },
      }),
    ),
    "1.1.1.1",
  );
});
