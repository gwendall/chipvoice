import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

/**
 * Installs the published package into an empty project and drives it.
 *
 * Every other test here runs against the source. This one runs against what
 * `npm install chipvoice` actually hands somebody, which is the only way to
 * catch a wrong `files` list, a missing export, or a worklet that did not make
 * it into the tarball - all of which look perfect from inside the repo.
 *
 * Pass a version to test a published one, or nothing to pack the working tree:
 *   node scripts/fresh-install-test.mjs            # the local tree, packed
 *   node scripts/fresh-install-test.mjs 0.1.0      # what is on the registry
 */
const wanted = process.argv[2];
const root = process.cwd();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chipvoice-fresh-"));
const run = (cmd, cwd = dir) => execSync(cmd, { cwd, stdio: "pipe" }).toString();

let server;
try {
  console.log(`project: ${dir}`);
  run("npm init -y");

  // No audit and no funding notice: both are registry round trips that have
  // nothing to do with whether the tarball works, and on a runner with a
  // placeholder token they are minutes of retries before npm gives up on them.
  if (wanted) {
    console.log(`installing chipvoice@${wanted} from the registry`);
    run(`npm i chipvoice@${wanted} --no-audit --no-fund`);
  } else {
    console.log("packing the working tree");
    const tarball = run("npm pack --silent", root).trim().split("\n").pop();
    run(`npm i ${path.join(root, tarball)} --no-audit --no-fund`);
    fs.unlinkSync(path.join(root, tarball));
  }

  fs.copyFileSync(path.join(root, "test/fresh/index.html"), path.join(dir, "index.html"));

  /*
   * The package's own `serve`, not one fetched by npx at test time.
   *
   * It used to be `npx --yes serve` inside the empty project, which downloads
   * serve from the registry on every run. On the release runner that download
   * never completed, and the release failed on a fetch that had nothing to do
   * with the package. A test of what `npm install` hands over should not
   * itself depend on the network once the tarball is installed.
   */
  const port = 4180;
  server = spawn(path.join(root, "node_modules/.bin/serve"), [dir, "-l", String(port)], {
    cwd: root,
    stdio: "ignore",
    detached: true,
  });

  // Wait for it rather than sleeping a guessed amount.
  const until = Date.now() + 20000;
  let up = false;
  while (Date.now() < until && !up) {
    try {
      execSync(`curl -sf -o /dev/null http://localhost:${port}/`, { stdio: "pipe" });
      up = true;
    } catch {
      execSync("sleep 0.5");
    }
  }
  if (!up) throw new Error("the static server never came up");

  execSync(`node ${path.join(root, "test/fresh/check.mjs")}`, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, FRESH_URL: `http://localhost:${port}/` },
  });
} finally {
  // The server is detached so it survives a throw; kill the group, not the pid.
  if (server?.pid) {
    try { process.kill(-server.pid); } catch { /* already gone */ }
  }
  fs.rmSync(dir, { recursive: true, force: true });
}
