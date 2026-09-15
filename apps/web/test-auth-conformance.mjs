import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { build } from "../../packages/chipvoice/node_modules/esbuild/lib/main.js";
/**
 * The same conformance run every issuer of the agent device grant plays, as a
 * black box against this server: vendor/auth-conformance.mjs knows nothing of
 * chipvoice beyond the two discovery documents. test-agent-oauth.mjs pins OUR
 * reading of the grant; this pins that a consumer written from the RFCs alone
 * gets the same answers. The two halves a script cannot play by itself - a
 * person approving, a person declining - are a browser session on /connect
 * (test-auth-conformance-decide.mjs), never an API call.
 */
const base = process.env.API_URL;
assert.ok(
  base && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base),
  "Only a disposable local server",
);
assert.ok(process.env.TURSO_DEV_DATABASE_URL?.startsWith("file:"));
const guard = setTimeout(() => {
  console.error("TIMEOUT test-auth-conformance");
  process.exit(1);
}, 240000);
guard.unref();
await build({
  stdin: {
    contents: "export * from './src/lib/auth';export * from './src/lib/db';",
    resolveDir: process.cwd(),
  },
  outfile: "generated/test-auth-conformance.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  logLevel: "silent",
});
const api = await import("./generated/test-auth-conformance.mjs");
await api.db();
// An owner with a browser session: the person who will see the code.
const ownerKey = await api.createKey(
  `conformance-${randomUUID().slice(0, 8)}@example.test`,
  null,
);
const magic = await api.createMagicLink(ownerKey.id);
const redeem = await fetch(`${base}/api/auth/redeem?token=${magic}`, {
  redirect: "manual",
});
const cookie = redeem.headers.get("set-cookie").split(";")[0];
assert.ok(cookie, "the owner has a session");

const decide = (choice) => `node test-auth-conformance-decide.mjs ${choice}`;
const child = spawn(
  process.execPath,
  [
    "vendor/auth-conformance.mjs",
    base,
    "--resource",
    "/api/v1",
    "--probe",
    "/api/v1/agent",
    "--client-id",
    "Conformance run",
    "--scope",
    "projects:read",
    "--approve",
    decide("approve"),
    "--deny",
    decide("deny"),
    // projects:read cannot compose: the issued scope is a ceiling, not a label.
    "--out-of-scope",
    "POST /api/v1/generations",
  ],
  { env: { ...process.env, CHIPVOICE_OWNER_COOKIE: cookie }, stdio: "inherit" },
);
const code = await new Promise((resolve) => child.on("exit", resolve));
assert.equal(code, 0, `auth-conformance exited ${code}`);
console.log("PASS  the standard consumer gets the standard answers (W1-W9)");
process.exit(0);
