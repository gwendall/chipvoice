// Proves buildManifest()'s output (the same function POST /api/v1/resolve
// and /packs/{id} call) actually validates against the manifest's own
// published schema (served at GET /schema/manifest-1.json), not just that
// it "looks right" by eye - and that the schema actually rejects a broken
// manifest, so a schema that accepted anything would not silently pass this
// file.
import assert from "node:assert/strict";
import Ajv2020 from "ajv/dist/2020.js";
import schema from "../../../packages/gamesounds/schema/manifest-1.json" with { type: "json" };
import { buildManifest } from "../src/lib/catalog.ts";

const ajv = new Ajv2020({ strict: true });
const validate = ajv.compile(schema);

{
  // The same four short forms the spec's own CLI example uses: a fully
  // qualified id, and "leaf/tag" ("hit/heavy" -> category "combat/hit",
  // tag "heavy" - see resolveEvent's own doc comment in src/lib/catalog.ts).
  const { manifest, resolved, unresolved } = buildManifest(["movement/jump", "ui/confirm", "collect/coin", "hit/heavy"]);
  assert.deepEqual(unresolved, [], `every event in this fixture should resolve: ${JSON.stringify(resolved)}`);
  const valid = validate(manifest);
  assert.ok(valid, `a real, resolved manifest must validate: ${ajv.errorsText(validate.errors)}`);
  assert.ok(Object.keys(manifest.events).length === 4, "one entry per resolved event");
  console.log("PASS a real buildManifest() output validates against manifest-1.json");
}

{
  // An event with no candidate at all (not just style mismatch) is honestly
  // reported as unresolved, not silently dropped or invented.
  const { manifest, resolved, unresolved } = buildManifest(["movement/jump", "not-a-real-event"]);
  assert.deepEqual(unresolved, ["not-a-real-event"]);
  assert.equal(resolved.find((r) => r.event === "not-a-real-event").sound, null);
  assert.ok(validate(manifest), `a manifest with one unresolved event must still validate (it is simply missing from events): ${ajv.errorsText(validate.errors)}`);
  console.log("PASS an unresolved event is reported, not force-mapped, and the resulting manifest still validates");
}

{
  // Negative: the schema must actually reject a broken manifest, proving
  // this test would fail if buildManifest() (or the schema itself) broke.
  const broken = { $schema: "https://gamesounds.ai/schema/manifest-1.json", version: 1, base: "/", events: {}, credits: [], extra: true };
  assert.equal(validate(broken), false, "additionalProperties: false must reject an unknown top-level field");

  const wrongVersion = { $schema: "https://gamesounds.ai/schema/manifest-1.json", version: 2, base: "/", events: {}, credits: [] };
  assert.equal(validate(wrongVersion), false, "version must be the const 1");

  const missingFiles = {
    $schema: "https://gamesounds.ai/schema/manifest-1.json",
    version: 1,
    base: "/",
    events: { jump: { sound: "x" } },
    credits: [],
  };
  assert.equal(validate(missingFiles), false, "an event with no files must be rejected (files is required)");
  console.log("PASS the schema rejects an unknown field, a wrong version and an event missing files");
}
