/**
 * Owns a production `next start` server for gamesounds.ai's own integration
 * tests, the same way apps/web's own test-local.mjs does: a free local
 * port, polled readiness, the server closed in a `finally` no matter how
 * this script exits. Runs test-smoke.mjs (this app's browser smoke test)
 * and packages/gamesounds/test-cli.mjs (the CLI's own integration test)
 * against the one server, since both only need a live, built site - not two
 * separate servers started twice in CI.
 *
 * Requires `next build` to have already run (CI's own build step; locally,
 * `pnpm build`).
 */
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

const reservation = createServer();
await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const site = `http://127.0.0.1:${port}`;

const server = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)],
  { cwd: here, stdio: ["ignore", "pipe", "pipe"] },
);
let log = "";
server.stdout.on("data", (chunk) => (log += chunk));
server.stderr.on("data", (chunk) => (log += chunk));

try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw new Error(`server exited early:\n${log}`);
    try {
      if ((await fetch(`${site}/api/v1/categories`)).ok) {
        ready = true;
        break;
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error(`server did not start within 60s:\n${log}`);

  const smoke = spawnSync(process.execPath, ["test-smoke.mjs"], {
    cwd: here,
    stdio: "inherit",
    env: { ...process.env, SITE: site },
  });
  if (smoke.status !== 0) throw new Error("test-smoke.mjs failed");

  const cli = spawnSync(process.execPath, ["test-cli.mjs"], {
    cwd: join(here, "..", "..", "packages", "gamesounds"),
    stdio: "inherit",
    env: { ...process.env, API: site },
  });
  if (cli.status !== 0) throw new Error("packages/gamesounds/test-cli.mjs failed");

  console.log("PASS: gamesounds.ai integration (test-smoke.mjs, packages/gamesounds/test-cli.mjs)");
} finally {
  server.kill();
}
