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
 *
 * test/progressive-handoff-stall.mjs (REV-11) races a real wall clock: its
 * fake worker renders in-process on the same thread as that clock, so a CPU
 * core taken by another test file shows up as a late read and an underrun it
 * never meant to test. It failed that way once in CI (REV-13: 1 underrun on
 * the undelayed baseline, passing on a rerun of the same commit), so it runs
 * alone, after the concurrent batch has finished, instead of inside it.
 */
const EXCLUDE = new Set(["parity.mjs"]);
const REAL_TIME = new Set(["progressive-handoff-stall.mjs"]);
const testDir = new URL("../test/", import.meta.url);
const names = readdirSync(testDir)
  .filter((name) => name.endsWith(".mjs") && !EXCLUDE.has(name))
  .sort();
const files = names.filter((name) => !REAL_TIME.has(name)).map((name) => `test/${name}`);
const realTimeFiles = names.filter((name) => REAL_TIME.has(name)).map((name) => `test/${name}`);
if (realTimeFiles.length !== REAL_TIME.size) {
  console.error(`run-unit-tests: a REAL_TIME file is missing from test/: ${[...REAL_TIME].join(", ")}`);
  process.exit(1);
}

// CI runs on 4 vCPUs and several of these files (the golden renders, the
// progressive/preview suites) are CPU heavy; keep concurrency at that width
// instead of node --test's default (available parallelism - 1), which would
// let more CPU-bound files fight over the same cores at once than helps.
const concurrency = 4;

function run(testFiles, width) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["--test", "--allow-natives-syntax", `--test-concurrency=${width}`, ...testFiles],
      { stdio: "inherit" },
    );
    child.on("exit", (code, signal) => resolve(signal ? 1 : (code ?? 1)));
  });
}

// Both batches always run, so a failure in the first still reports the second.
const batchCode = await run(files, concurrency);
const realTimeCode = await run(realTimeFiles, 1);
process.exit(batchCode || realTimeCode);
