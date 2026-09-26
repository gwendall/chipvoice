import { readdirSync } from "node:fs";
import { spawn } from "node:child_process";

/**
 * Runs every unit test under test/*.mjs through `node --test`, instead of
 * chaining each one with `&&`. The chain stopped at the first failure and
 * printed nothing about the tests after it; `node --test` runs every file,
 * reports every failure, and exits non-zero if any of them fail.
 *
 * New files land in the suite automatically: this globs test/*.mjs itself,
 * so a file can only be missing from a run by being named here on purpose.
 * Right now that is just one file:
 *
 *  - test/parity.mjs compares against a slower reference render and has its
 *    own `test:parity` script; it was never part of this chain either.
 *
 * test/checkpoint-layout.mjs needs V8's --allow-natives-syntax to inspect
 * internal object layouts (it used to run as `node --allow-natives-syntax
 * test/checkpoint-layout.mjs` on its own). Passing that flag for the whole
 * run is harmless for every other file, so it is simpler than special-casing
 * one file's process.
 */
const EXCLUDE = new Set(["parity.mjs"]);
const testDir = new URL("../test/", import.meta.url);
const files = readdirSync(testDir)
  .filter((name) => name.endsWith(".mjs") && !EXCLUDE.has(name))
  .sort()
  .map((name) => `test/${name}`);

// CI runs on 4 vCPUs and several of these files (the golden renders, the
// progressive/preview suites) are CPU heavy; keep concurrency at that width
// instead of node --test's default (available parallelism - 1), which would
// let more CPU-bound files fight over the same cores at once than helps.
const concurrency = 4;

const child = spawn(
  process.execPath,
  ["--test", "--allow-natives-syntax", `--test-concurrency=${concurrency}`, ...files],
  { stdio: "inherit" },
);
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
