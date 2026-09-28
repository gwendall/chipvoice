import { readdirSync } from "node:fs";
import { spawn } from "node:child_process";

/**
 * Runs every test/*.mjs through `node --test` in one process, so a failure
 * in one file does not hide the rest: the same reason chipvoice's own
 * scripts/run-unit-tests.mjs exists. A new file under test/ joins the suite
 * automatically.
 */
const testDir = new URL("../test/", import.meta.url);
const files = readdirSync(testDir)
  .filter((name) => name.endsWith(".mjs"))
  .sort()
  .map((name) => `test/${name}`);

const child = spawn(process.execPath, ["--test", ...files], { stdio: "inherit" });
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
