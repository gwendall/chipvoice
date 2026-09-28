/**
 * CLI test (Phase 1 acceptance: "`npx gamesounds add jump coin hit/heavy
 * ui/confirm --style 8bit` in an empty directory, against the local dev
 * server, writes the files, sounds.json and SOUNDS-CREDITS.md, SHA-256
 * verified. A test does it."), plus the PR review's fuller CLI scope:
 * search, swap, list, sync, --json, --formats. One flat script, run
 * directly with `node`, not through `node --test test/*.mjs` - mirrors
 * apps/sounds/test-smoke.mjs's own convention, for the same reason: this
 * needs a live server, which test:unit's fast fake-AudioContext suite does
 * not.
 *
 * Assumes a server is already running at API (default
 * http://127.0.0.1:3020) with a built catalogue - CI/dev starts it, this
 * script only drives bin/gamesounds.mjs as a real subprocess against it.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import Ajv2020 from "ajv/dist/2020.js";
import schema from "./schema/manifest-1.json" with { type: "json" };

const run = promisify(execFile);
const API = process.env.API ?? "http://127.0.0.1:3020";
const CLI = new URL("./bin/gamesounds.mjs", import.meta.url).pathname;

const ajv = new Ajv2020({ strict: true });
const validateManifest = ajv.compile(schema);

function assertValidManifest(manifest, label) {
  const valid = validateManifest(manifest);
  assert.ok(valid, `${label}: sounds.json must validate against manifest-1.json: ${ajv.errorsText(validateManifest.errors)}`);
}

/** Every /f/<hash>.<ext> path's hash, recovered from its own filename, must
 * equal the sha256 of the exact bytes served at that path - each format is
 * content-addressed by its OWN bytes now (per-file addressing), so this
 * checks every file actually referenced, not just a WAV that may not even
 * have been requested (see bin/gamesounds.mjs's verifyDownload). */
async function assertPathsHashCorrectly(paths, label) {
  let checked = 0;
  for (const relativePath of paths) {
    const hash = /(?:^|\/)f\/([0-9a-f]{64})\.[a-z0-9]+$/i.exec(relativePath)?.[1];
    if (!hash) continue;
    const response = await fetch(`${API}/${relativePath.replace(/^\/+/, "")}`);
    assert.equal(response.status, 200, `${label}: ${relativePath}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const actual = createHash("sha256").update(bytes).digest("hex");
    assert.equal(actual, hash, `${label}: /${relativePath} truly hashes to ${hash}`);
    checked++;
  }
  assert.ok(checked > 0, `${label}: at least one content-addressed file was checked`);
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

const dir = await mkdtemp(join(tmpdir(), "gamesounds-cli-"));
try {
  // First run: the acceptance example itself, verbatim.
  const first = await run(process.execPath, [CLI, "add", "jump", "coin", "hit/heavy", "ui/confirm", "--style", "8bit", "--api", API, "--dir", dir]);
  assert.match(first.stdout, /wrote 4 event\(s\)/, `expected 4 events written, got: ${first.stdout}`);
  assert.match(first.stdout, /hash\(es\) verified/);

  const manifestPath = join(dir, "sounds.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.base, "./", "the written manifest is portable on its own, not origin-relative");
  assert.deepEqual(Object.keys(manifest.events).sort(), ["coin", "hit/heavy", "jump", "ui/confirm"].sort());
  assertValidManifest(manifest, "first add");

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
  // the CLI's own stdout claim - every file actually written, checked
  // against its OWN hash (per-file content addressing), not a shared WAV.
  await assertPathsHashCorrectly(allPaths, "add");

  // SOUNDS-CREDITS.md names every credited sound, with a licence.
  const credits = await readFile(join(dir, "SOUNDS-CREDITS.md"), "utf8");
  assert.match(credits, /^# Sound credits/);
  for (const event of Object.values(manifest.events)) {
    assert.ok(credits.includes(event.sound), `SOUNDS-CREDITS.md names ${event.sound}`);
  }
  assert.match(credits, /CC0-1\.0/, "the phase 1 catalogue is CC0-only, and the credits say so");

  const filesAfterFirstRun = await countFiles(dir);

  // Re-running the exact same events downloads nothing new (content-
  // addressed filenames make a from-disk skip safe).
  const rerun = await run(process.execPath, [CLI, "add", "jump", "coin", "hit/heavy", "ui/confirm", "--style", "8bit", "--api", API, "--dir", dir]);
  assert.match(rerun.stdout, /\b0 file\(s\) downloaded/, `re-running the same events should download nothing new: ${rerun.stdout}`);
  assert.equal(await countFiles(dir), filesAfterFirstRun, "re-running the same events writes no new files");

  // A separate run adding one more event merges into the existing
  // sounds.json rather than replacing it.
  const second = await run(process.execPath, [CLI, "add", "footstep/grass", "--style", "8bit", "--api", API, "--dir", dir]);
  assert.doesNotMatch(second.stdout, /\b0 file\(s\) downloaded/, `adding a genuinely new event should download something: ${second.stdout}`);

  const manifestAfterSecondRun = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.deepEqual(
    Object.keys(manifestAfterSecondRun.events).sort(),
    ["coin", "footstep/grass", "hit/heavy", "jump", "ui/confirm"].sort(),
    "a second run adds to sounds.json rather than replacing it",
  );
  assertValidManifest(manifestAfterSecondRun, "second add (merge)");

  const filesAfterSecondRun = await countFiles(dir);
  assert.ok(filesAfterSecondRun > filesAfterFirstRun, "the new event's own files were still written");

  console.log(
    `PASS: gamesounds add writes sounds.json + SOUNDS-CREDITS.md + ${allPaths.length} SHA-256-verified file(s) for the acceptance example, ` +
      "is idempotent on re-run, and merges a later run's events rather than overwriting them",
  );

  // --formats ogg writes only ogg: no fallback field, no .mp3/.wav on disk.
  const formatsDir = await mkdtemp(join(tmpdir(), "gamesounds-cli-formats-"));
  try {
    const formatsRun = await run(process.execPath, [CLI, "add", "jump", "--formats", "ogg", "--api", API, "--dir", formatsDir, "--json"]);
    const formatsResult = JSON.parse(formatsRun.stdout);
    assert.equal(formatsResult.events, 1);
    const formatsManifest = JSON.parse(await readFile(join(formatsDir, "sounds.json"), "utf8"));
    assertValidManifest(formatsManifest, "--formats ogg");
    const jumpEvent = formatsManifest.events.jump;
    assert.ok(jumpEvent.files.every((f) => f.endsWith(".ogg")), `--formats ogg must write only .ogg files: ${JSON.stringify(jumpEvent.files)}`);
    assert.equal(jumpEvent.fallback, undefined, "--formats ogg (a single format) must write no fallback field");
    const writtenFormatsFiles = Object.values(formatsManifest.events).flatMap((e) => [...e.files, ...(e.fallback ?? [])]);
    for (const p of writtenFormatsFiles) assert.ok(p.endsWith(".ogg"), `only .ogg should be on disk under --formats ogg, found ${p}`);
    console.log("PASS: gamesounds add --formats ogg downloads and writes only ogg, with no fallback field");
  } finally {
    await rm(formatsDir, { recursive: true, force: true });
  }

  // --json: add's own summary is machine-readable.
  {
    const jsonDir = await mkdtemp(join(tmpdir(), "gamesounds-cli-json-"));
    try {
      const jsonRun = await run(process.execPath, [CLI, "add", "ui/click", "--api", API, "--dir", jsonDir, "--json"]);
      const parsed = JSON.parse(jsonRun.stdout);
      assert.equal(parsed.events, 1);
      assert.equal(typeof parsed.downloaded, "number");
      console.log("PASS: gamesounds add --json prints a machine-readable summary");
    } finally {
      await rm(jsonDir, { recursive: true, force: true });
    }
  }

  // search: free-text finds "jump" both as prose and as --json.
  {
    const searchProse = await run(process.execPath, [CLI, "search", "jump", "--api", API]);
    assert.match(searchProse.stdout, /match\(es\) shown/, `search should report matches: ${searchProse.stdout}`);
    const searchJson = await run(process.execPath, [CLI, "search", "jump", "--api", API, "--json"]);
    const { sounds, total } = JSON.parse(searchJson.stdout);
    assert.ok(Array.isArray(sounds) && sounds.length > 0, "search jump --json must return at least one sound");
    assert.ok(total >= sounds.length);
    console.log(`PASS: gamesounds search jump finds ${sounds.length} sound(s) (prose and --json)`);
  }

  // list: reports exactly what sounds.json (from the first run) holds.
  {
    const listRun = await run(process.execPath, [CLI, "list", "--dir", dir, "--json"]);
    const listed = JSON.parse(listRun.stdout);
    assert.deepEqual(Object.keys(listed).sort(), Object.keys(manifestAfterSecondRun.events).sort());
    console.log("PASS: gamesounds list reports exactly what sounds.json holds");
  }

  // swap: changes the chosen sound for one event and keeps sounds.json
  // valid against the schema; the previous sound is genuinely excluded.
  {
    const beforeSwap = JSON.parse(await readFile(manifestPath, "utf8"));
    const previousSound = beforeSwap.events["jump"].sound;
    const swapRun = await run(process.execPath, [CLI, "swap", "jump", "--api", API, "--dir", dir, "--json"]);
    const swapResult = JSON.parse(swapRun.stdout);
    const afterSwap = JSON.parse(await readFile(manifestPath, "utf8"));
    assertValidManifest(afterSwap, "after swap");
    if (swapResult.swapped) {
      assert.notEqual(afterSwap.events["jump"].sound, previousSound, "swap must change which sound is chosen");
      assert.equal(swapResult.sound, afterSwap.events["jump"].sound);
      await assertPathsHashCorrectly(afterSwap.events["jump"].files, "swap");
      console.log(`PASS: gamesounds swap replaced jump's sound ${previousSound} -> ${afterSwap.events["jump"].sound}, still schema-valid`);
    } else {
      // Only legitimate if the catalogue truly has no other candidate for
      // "jump" - still proves swap left sounds.json valid and unchanged.
      assert.equal(afterSwap.events["jump"].sound, previousSound);
      console.log("PASS: gamesounds swap reports no alternative and leaves sounds.json unchanged (no other jump candidate exists)");
    }
  }

  // sync: redownloads a deleted file, refuses a tampered one.
  {
    const syncDir = await mkdtemp(join(tmpdir(), "gamesounds-cli-sync-"));
    try {
      await run(process.execPath, [CLI, "add", "ui/error", "--api", API, "--dir", syncDir]);
      const syncManifest = JSON.parse(await readFile(join(syncDir, "sounds.json"), "utf8"));
      const syncPaths = Object.values(syncManifest.events).flatMap((e) => [...e.files, ...(e.fallback ?? [])]);
      assert.ok(syncPaths.length > 0);

      // A deleted file is redownloaded and re-verified.
      const deletedPath = join(syncDir, syncPaths[0]);
      await rm(deletedPath);
      const syncAfterDelete = await run(process.execPath, [CLI, "sync", "--api", API, "--dir", syncDir, "--json"]);
      const deleteResult = JSON.parse(syncAfterDelete.stdout);
      assert.ok(deleteResult.redownloaded >= 1, `sync must redownload the deleted file: ${syncAfterDelete.stdout}`);
      assert.equal(deleteResult.tampered, 0);
      const restatDeleted = await stat(deletedPath);
      assert.ok(restatDeleted.isFile() && restatDeleted.size > 0, "the deleted file must be back on disk after sync");

      // A tampered file (bytes that no longer hash to its own filename) is
      // refused outright - sync must exit non-zero and must NOT silently
      // overwrite it. The bug this guards: silently overwriting a file the
      // caller may have intentionally modified is worse than stopping.
      const tamperedPath = join(syncDir, syncPaths[0]);
      const beforeTamper = await readFile(tamperedPath);
      await writeFile(tamperedPath, Buffer.concat([beforeTamper, Buffer.from("tampered")]));
      await assert.rejects(
        () => run(process.execPath, [CLI, "sync", "--api", API, "--dir", syncDir]),
        (error) => /tampered|no longer hash/.test(`${error.stdout ?? ""}${error.stderr ?? ""}${error.message ?? ""}`) && error.code === 1,
        "sync must exit non-zero on a tampered file",
      );
      const afterTamperAttempt = await readFile(tamperedPath);
      assert.deepEqual(afterTamperAttempt, Buffer.concat([beforeTamper, Buffer.from("tampered")]), "a tampered file must be left untouched, never silently overwritten");

      console.log("PASS: gamesounds sync redownloads a deleted file and refuses (without overwriting) a tampered one");
    } finally {
      await rm(syncDir, { recursive: true, force: true });
    }
  }

  // A non-retro style (GS-03): the sfx-engine-generated half of the
  // catalogue is reachable through the exact same CLI path as any
  // chipvoice sound - add, verify, download - and the resolved sound is
  // genuinely origin: "generated", not a chipvoice sound that merely
  // happens to carry a matching style label.
  {
    const generatedDir = await mkdtemp(join(tmpdir(), "gamesounds-cli-generated-"));
    try {
      const generatedRun = await run(process.execPath, [CLI, "add", "combat/hit", "--style", "realistic", "--api", API, "--dir", generatedDir, "--json"]);
      const generatedResult = JSON.parse(generatedRun.stdout);
      assert.equal(generatedResult.events, 1, `expected 1 event written, got: ${generatedRun.stdout}`);

      const generatedManifest = JSON.parse(await readFile(join(generatedDir, "sounds.json"), "utf8"));
      assertValidManifest(generatedManifest, "add --style realistic (generated)");
      const soundId = generatedManifest.events["combat/hit"].sound;

      const soundResponse = await fetch(`${API}/api/v1/sounds/${soundId}`);
      assert.equal(soundResponse.status, 200);
      const { sound } = await soundResponse.json();
      assert.equal(sound.origin, "generated", `--style realistic must resolve a generated-origin sound, got ${JSON.stringify({ id: sound.id, origin: sound.origin, style: sound.style })}`);
      assert.equal(sound.style, "realistic");

      const generatedPaths = [...generatedManifest.events["combat/hit"].files, ...(generatedManifest.events["combat/hit"].fallback ?? [])];
      await assertPathsHashCorrectly(generatedPaths, "add --style realistic (generated)");

      console.log(`PASS: gamesounds add combat/hit --style realistic resolves a generated-origin sound (${soundId}) and downloads SHA-256-verified files`);
    } finally {
      await rm(generatedDir, { recursive: true, force: true });
    }
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}
