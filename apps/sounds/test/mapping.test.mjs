// Proves catalog/mapping.mjs actually covers every real file in each Kenney
// source, instead of covering only the files whoever wrote the rules
// remembered. catalog/sources/filelists/*.txt are the literal file listing
// of each archive (kenney.nl is stable; these are committed so this test
// runs offline and in CI without re-downloading every pack). If Kenney ever
// changes a pack's contents, `pnpm sounds:fetch:filelists` (scripts/fetch.mjs
// --filelists-only) regenerates these from the live zips and this test will
// immediately show what changed.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mapFile, sourceIds } from "../catalog/mapping.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const filelistDir = join(here, "..", "catalog", "sources", "filelists");

{
  const declared = new Set(sourceIds());
  const files = readdirSync(filelistDir).filter((f) => f.endsWith(".txt"));
  assert.ok(files.length > 0, "filelists directory must not be empty");
  for (const file of files) {
    const sourceId = file.replace(/\.txt$/, "");
    assert.ok(declared.has(sourceId), `mapping.mjs has no rules declared for source "${sourceId}", which has a committed filelist`);
  }
  console.log(`PASS every committed filelist (${files.length}) has a matching source in mapping.mjs`);
}

let totalFiles = 0;
let totalMapped = 0;
const perSourceGroups = {};

for (const sourceId of sourceIds()) {
  const path = join(filelistDir, `${sourceId}.txt`);
  const names = readFileSync(path, "utf8").split("\n").map((s) => s.trim()).filter(Boolean);
  assert.ok(names.length > 0, `${sourceId}.txt must not be empty`);
  const unmapped = [];
  const groups = new Set();
  for (const name of names) {
    const mapped = mapFile(sourceId, name);
    totalFiles++;
    if (!mapped) {
      unmapped.push(name);
      continue;
    }
    totalMapped++;
    groups.add(mapped.group);
    assert.ok(typeof mapped.category === "string" && mapped.category.length > 0, `${sourceId}/${name} mapped with no category`);
    assert.ok(typeof mapped.style === "string" && mapped.style.length > 0, `${sourceId}/${name} mapped with no style`);
    assert.ok(Array.isArray(mapped.tags), `${sourceId}/${name} mapped with non-array tags`);
    // Kenney's own numbering is 0-based for some packs (_000, _001, ...) and
    // 1-based for others (switch1, switch2, ...): 0 is a legitimate take
    // number here. The build assigns the spec's 1-based variant `n` by
    // sorting takes within a group, not by using this number directly.
    assert.ok(Number.isInteger(mapped.take) && mapped.take >= 0, `${sourceId}/${name} mapped with a bad take number: ${mapped.take}`);
  }
  perSourceGroups[sourceId] = groups.size;
  assert.deepEqual(unmapped, [], `${sourceId} has ${unmapped.length} unmapped file(s): ${unmapped.slice(0, 20).join(", ")}`);
  console.log(`PASS ${sourceId}: all ${names.length} files map to a category (${groups.size} distinct sounds)`);
}

console.log(`PASS mapping.mjs covers ${totalMapped}/${totalFiles} real source files across ${sourceIds().length} packs, forming ${Object.values(perSourceGroups).reduce((a, b) => a + b, 0)} sounds before cross-source grouping`);

// A handful of representative filenames get their exact expected category
// pinned, so a rule-ordering accident that still passes "every file mapped"
// (by landing files in the wrong bucket) is still caught.
{
  const cases = [
    ["kenney-impact-sounds", "footstep_grass_003.ogg", "movement/footstep"],
    ["kenney-impact-sounds", "impactWood_heavy_001.ogg", "combat/hit"],
    ["kenney-ui-audio", "switch12.ogg", "ui/toggle"],
    ["kenney-ui-audio", "rollover3.ogg", "ui/hover"],
    ["kenney-rpg-audio", "doorOpen_1.ogg", "objects/door"],
    ["kenney-rpg-audio", "footstep03.ogg", "movement/footstep"],
    ["kenney-rpg-audio", "bookFlip2.ogg", "ui/tab"],
    ["kenney-sci-fi-sounds", "laserLarge_000.ogg", "combat/shoot"],
    ["kenney-sci-fi-sounds", "spaceEngineLow.ogg", "world/machine-hum"],
    ["kenney-digital-audio", "powerUp10.ogg", "collect/powerup"],
    ["kenney-digital-audio", "zapThreeToneDown.ogg", "magic/cast"],
    ["kenney-music-jingles", "jingles_NES00.ogg", "game/win"],
    ["kenney-music-jingles", "jingles_STEEL16.ogg", "game/checkpoint"],
    ["kenney-voiceover-pack", "you_win.ogg", "game/win"],
    ["kenney-voiceover-pack", "10.ogg", "game/countdown"],
    ["kenney-voiceover-pack-fighter", "round_3.ogg", "game/countdown"],
    ["kenney-voiceover-pack-fighter", "player_1.ogg", "ui/confirm"],
  ];
  for (const [sourceId, fileName, expectedCategory] of cases) {
    const mapped = mapFile(sourceId, fileName);
    assert.ok(mapped, `${sourceId}/${fileName} should map to something, got null`);
    assert.equal(mapped.category, expectedCategory, `${sourceId}/${fileName} should map to "${expectedCategory}", got "${mapped.category}"`);
  }
  console.log(`PASS ${cases.length} representative filenames land in their expected category, not just "some" category`);
}

// A junk/non-audio-content name (Preview) must be skipped, not force-mapped.
{
  assert.equal(mapFile("kenney-ui-audio", "Preview.png"), null, "a Preview file must be skipped, never mapped");
  assert.equal(mapFile("kenney-voiceover-pack", "Preview (Female).ogg"), null, "a parenthesised Preview file must also be skipped");
  console.log("PASS Preview files are skipped rather than force-mapped");
}

// An unknown source must throw rather than silently mapping nothing.
{
  assert.throws(() => mapFile("not-a-real-source", "click1.ogg"), "an unknown source id must throw, not silently return null");
  console.log("PASS an unknown source id throws instead of silently mapping nothing");
}
