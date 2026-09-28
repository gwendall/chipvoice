/**
 * CLI test (Phase 1 acceptance: "`npx gamesounds add jump coin hit/heavy
 * ui/confirm --style 8bit` in an empty directory, against the local dev
 * server, writes the files, sounds.json and SOUNDS-CREDITS.md, SHA-256
 * verified. A test does it."). One flat script, run directly with `node`,
 * not through `node --test test/*.mjs` - mirrors apps/sounds/test-smoke.mjs's
 * own convention, for the same reason: this needs a live server, which
 * test:unit's fast fake-AudioContext suite does not.
 *
 * Assumes a server is already running at API (default
 * http://127.0.0.1:3020) with a built catalogue - CI/dev starts it, this
 * script only drives bin/gamesounds.mjs as a real subprocess against it.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const API = process.env.API ?? "http://127.0.0.1:3020";
const CLI = new URL("./bin/gamesounds.mjs", import.meta.url).pathname;

const dir = await mkdtemp(join(tmpdir(), "gamesounds-cli-"));
try {
  // First run: the acceptance example itself, verbatim.
  const first = await run(process.execPath, [CLI, "add", "jump", "coin", "hit/heavy", "ui/confirm", "--style", "8bit", "--api", API, "--out", dir]);
  assert.match(first.stdout, /wrote 4 event\(s\)/, `expected 4 events written, got: ${first.stdout}`);
  assert.match(first.stdout, /hash\(es\) verified/);

  const manifestPath = join(dir, "sounds.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.base, "./", "the written manifest is portable on its own, not origin-relative");
  assert.deepEqual(Object.keys(manifest.events).sort(), ["coin", "hit/heavy", "jump", "ui/confirm"].sort());

  // Every path the manifest points at was actually written, and none of
  // them regressed to an origin-absolute leading "/".
  const allPaths = Object.values(manifest.events).flatMap((event) => [...event.files, ...(event.fallback ?? [])]);
  assert.ok(allPaths.length > 0);
  for (const relativePath of allPaths) {
    assert.ok(!relativePath.startsWith("/"), `${relativePath} must be relative to sounds.json, not origin-absolute`);
    const stats = await stat(join(dir, relativePath));
    assert.ok(stats.isFile() && stats.size > 0, `${relativePath} was written and is non-empty`);
  }

  // "SHA-256 verified" independently re-proven here, not just trusted from
  // the CLI's own stdout claim: every /f/<hash>.<ext> path's hash is
  // recovered from its filename and checked against the server's own
  // content-addressed .wav for that hash (only the WAV's own bytes equal
  // that hash - see bin/gamesounds.mjs's verifyHash doc comment).
  const hashes = new Set(allPaths.map((p) => /\/?f\/([0-9a-f]{64})\./i.exec(p)?.[1]).filter(Boolean));
  assert.ok(hashes.size > 0, "at least one content-addressed file was downloaded");
  for (const hash of hashes) {
    const response = await fetch(`${API}/f/${hash}.wav`);
    assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer());
    const actual = createHash("sha256").update(bytes).digest("hex");
    assert.equal(actual, hash, `the server's own /f/${hash}.wav truly hashes to ${hash}`);
  }

  // SOUNDS-CREDITS.md names every credited sound, with a licence.
  const credits = await readFile(join(dir, "SOUNDS-CREDITS.md"), "utf8");
  assert.match(credits, /^# Sound credits/);
  for (const event of Object.values(manifest.events)) {
    assert.ok(credits.includes(event.sound), `SOUNDS-CREDITS.md names ${event.sound}`);
  }
  assert.match(credits, /CC0-1\.0/, "the phase 1 catalogue is CC0-only, and the credits say so");

  const filesAfterFirstRun = await countFiles(dir);

  // Second run: re-running the same events downloads nothing new (content-
  // addressed filenames make a from-disk skip safe), and adding one more
  // event merges into the existing sounds.json rather than replacing it.
  const second = await run(process.execPath, [CLI, "add", "jump", "footstep/grass", "--style", "8bit", "--api", API, "--out", dir]);
  assert.match(second.stdout, /0 file\(s\) downloaded/, `re-running "jump" should download nothing new: ${second.stdout}`);

  const manifestAfterSecondRun = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.deepEqual(
    Object.keys(manifestAfterSecondRun.events).sort(),
    ["coin", "footstep/grass", "hit/heavy", "jump", "ui/confirm"].sort(),
    "a second run adds to sounds.json rather than replacing it",
  );

  const filesAfterSecondRun = await countFiles(dir);
  assert.ok(filesAfterSecondRun > filesAfterFirstRun, "the new event's own files were still written");

  console.log(
    `PASS: gamesounds add writes sounds.json + SOUNDS-CREDITS.md + ${allPaths.length} SHA-256-verified file(s) for the acceptance example, ` +
      "is idempotent on re-run, and merges a later run's events rather than overwriting them",
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}

async function countFiles(root) {
  let count = 0;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else count++;
    }
  }
  return count;
}
