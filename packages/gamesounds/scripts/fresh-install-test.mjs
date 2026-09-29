import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Installs the published package into an empty project and drives it - the
 * only test here that sees what `npm install gamesounds` actually hands
 * somebody, which is the only way to catch a wrong `files` list, a missing
 * export or a broken `bin` entry, all of which look perfect from inside the
 * repo. Mirrors packages/chipvoice/scripts/fresh-install-test.mjs.
 *
 * Two tiers:
 *   1. Packaging checks (always run, no network): the tarball contains
 *      exactly what ships, the package's exports resolve, and the CLI's
 *      `--help`/`--version` work.
 *   2. Live checks (skipped under CI unless GAMESOUNDS_TEST_LIVE=1): the CLI
 *      and the runtime's `{remote: true}` path resolve real events against
 *      https://gamesounds.ai (or $GAMESOUNDS_API) and a resolved sound's URL
 *      actually returns audio bytes of a sane size and content type. CI's
 *      own `sounds` job never touches the network (it builds and serves the
 *      catalogue itself), so this script skips tier 2 there by default -
 *      the release workflow forces it with GAMESOUNDS_TEST_LIVE=1 before
 *      publishing, which is where a real network check belongs.
 *
 * Pass a version to test a published one, or nothing to pack the working tree:
 *   node scripts/fresh-install-test.mjs            # the local tree, packed
 *   node scripts/fresh-install-test.mjs 0.1.0      # what is on the registry
 */
const wanted = process.argv[2];
const root = process.cwd();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gamesounds-fresh-"));
const run = (cmd, cwd = dir) => execSync(cmd, { cwd, stdio: "pipe" }).toString();

const API = (process.env.GAMESOUNDS_API ?? "https://gamesounds.ai").replace(/\/$/, "");
const skipLive = process.env.CI === "true" && process.env.GAMESOUNDS_TEST_LIVE !== "1";

function assertTrue(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

try {
  console.log(`project: ${dir}`);
  run("npm init -y");

  // No audit and no funding notice: both are registry round trips that have
  // nothing to do with whether the tarball works.
  if (wanted) {
    console.log(`installing gamesounds@${wanted} from the registry`);
    run(`npm i gamesounds@${wanted} --no-audit --no-fund`);
  } else {
    console.log("packing the working tree");
    const tarball = run("npm pack --silent", root).trim().split("\n").pop();
    run(`npm i ${path.join(root, tarball)} --no-audit --no-fund`);
    fs.unlinkSync(path.join(root, tarball));
  }

  const pkgDir = path.join(dir, "node_modules", "gamesounds");

  // ---------------------------------------------------------- tier 1: packaging

  for (const file of ["dist/index.js", "dist/index.d.ts", "bin/gamesounds.mjs", "schema/manifest-1.json", "README.md", "README_ja.md", "LICENSE", "package.json"]) {
    assertTrue(fs.existsSync(path.join(pkgDir, file)), `the tarball ships ${file}`);
  }
  for (const leak of ["src", "test", "test-cli.mjs", "scripts", "tsconfig.json", "tsconfig.build.json"]) {
    assertTrue(!fs.existsSync(path.join(pkgDir, leak)), `the tarball does not ship ${leak} (files whitelist leak)`);
  }

  const installedPkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
  assertTrue(typeof installedPkg.version === "string" && installedPkg.version.length > 0, "the installed package.json carries a version");

  const mod = await import(pathToFileURL(path.join(pkgDir, "dist", "index.js")).href);
  assertTrue(typeof mod.loadSounds === "function", "the installed package exports loadSounds()");
  assertTrue(typeof mod.GameSounds === "function", "the installed package exports the GameSounds class");
  assertTrue(typeof mod.MANIFEST_SCHEMA_URL === "string", "the installed package exports MANIFEST_SCHEMA_URL");

  const schema = JSON.parse(fs.readFileSync(path.join(pkgDir, "schema", "manifest-1.json"), "utf8"));
  assertTrue(schema.$id === "https://gamesounds.ai/schema/manifest-1.json", "schema/manifest-1.json is importable and carries its own $id");

  // There is no top-level `gamesounds --help`: the first token is always
  // read as a subcommand, so `--help` alone is "unknown command". The
  // documented way (README.md, "gamesounds add --help") is `<command>
  // --help`, and a bare `gamesounds` also prints the same usage (exit 1).
  const CLI = path.join(pkgDir, "bin", "gamesounds.mjs");
  const help = run(`node ${CLI} add --help`);
  assertTrue(/gamesounds - a game sound-effects bank/.test(help), "gamesounds add --help prints usage, no network needed");
  const version = run(`node ${CLI} --version`).trim();
  assertTrue(version === installedPkg.version, `gamesounds --version (${version}) matches package.json (${installedPkg.version})`);

  // ------------------------------------------------------------- tier 2: live

  if (skipLive) {
    console.log(
      "SKIP: live checks against a real gamesounds.ai-compatible API (CI's own sounds job is network-free by design; " +
        "set GAMESOUNDS_TEST_LIVE=1 to force them, as the release workflow does before publishing).",
    );
  } else {
    console.log(`running live checks against ${API}`);

    const searchOut = run(`node ${CLI} search jump --api ${API} --json`);
    const { sounds: searchResults, total } = JSON.parse(searchOut);
    assertTrue(Array.isArray(searchResults) && searchResults.length > 0, `gamesounds search jump finds real results on ${API} (${searchResults?.length} of ${total})`);

    const addOut = run(`node ${CLI} add jump --style 8bit --api ${API} --dir ${dir} --json`);
    const addResult = JSON.parse(addOut);
    assertTrue(addResult.events === 1, `gamesounds add jump resolved and wrote 1 event against ${API}`);
    assertTrue(addResult.downloaded >= 1 && addResult.verified >= 1, `gamesounds add downloaded and SHA-256-verified real files from ${API}`);

    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "sounds.json"), "utf8"));
    const jumpEvent = manifest.events["jump"];
    assertTrue(!!jumpEvent && jumpEvent.files.length > 0, "sounds.json carries the resolved jump event");

    // The one assertion this whole tier exists for: a resolved sound's own
    // URL, fetched live (not from the local download the CLI already
    // verified by hash), answers with real audio bytes - the right
    // content type and a sane, non-trivial size, not an HTML error page or
    // an empty response a broken deploy could otherwise pass silently.
    for (const relativePath of jumpEvent.files) {
      const url = `${API}/${relativePath.replace(/^\.?\/*/, "")}`;
      const response = await fetch(url);
      assertTrue(response.ok, `${url} answers ${response.status}`);
      const contentType = response.headers.get("content-type") ?? "";
      assertTrue(/^audio\//.test(contentType), `${url} serves an audio/* content-type (got "${contentType}")`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      assertTrue(bytes.byteLength > 200 && bytes.byteLength < 10_000_000, `${url} is a sane size (${bytes.byteLength} bytes)`);
    }

    const listOut = run(`node ${CLI} list --dir ${dir} --json`);
    const listed = JSON.parse(listOut);
    assertTrue(Object.keys(listed).includes("jump"), "gamesounds list reports the event resolved above");

    const syncOut = run(`node ${CLI} sync --dir ${dir} --api ${API} --json`);
    const syncResult = JSON.parse(syncOut);
    assertTrue(syncResult.tampered === 0, "gamesounds sync verifies every downloaded file against its own content-addressed name");

    // The programmatic API's own remote path (`{remote: true}`), not just
    // the CLI that wraps the same POST /api/v1/resolve call: loadSounds()
    // needs an AudioContext-shaped object, so this uses the smallest stub
    // that satisfies its constructor (a GainNode with .connect()) - `lazy:
    // true` skips decodeAudioData, which no such stub can honestly provide,
    // and is not what this tier is checking; the manifest resolution and
    // event bookkeeping below are real network results, not stubbed.
    const fakeGain = { gain: { value: 1, setValueAtTime() {}, cancelScheduledValues() {}, linearRampToValueAtTime() {} }, connect() {} };
    const fakeContext = { currentTime: 0, destination: {}, createGain: () => ({ ...fakeGain }) };
    const sounds = await mod.loadSounds(
      { remote: true, events: ["jump", "coin"], style: "8bit", api: API },
      { context: fakeContext, lazy: true },
    );
    assertTrue(sounds.has("jump"), "loadSounds({remote: true}) resolved \"jump\" against the live API");
    assertTrue(sounds.eventIds.length >= 1, "loadSounds({remote: true}) returns a GameSounds handle with real event ids");
  }

  console.log(wanted ? `gamesounds@${wanted}: fresh-install test passed.` : "gamesounds (packed from the working tree): fresh-install test passed.");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
