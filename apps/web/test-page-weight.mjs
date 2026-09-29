import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
// A cheap regression guard, not a browser test: it reads the already-built
// `.next` output straight off disk (this script runs after
// `pnpm --filter chipvoice-web build`, like the rest of this suite) instead
// of starting a server or a page. See DECISIONS.md #35: `PersistentPlayer`
// (mounted on every route) and `SiteHeader`/`MachinePicker` (rendered on
// nearly every page) once shared a module with the studio editor's
// `arrange`/`validateSong` import, which shipped all five chip engines - and
// their inlined AudioWorklet sources - to pages with no audio feature of
// their own. `registerProcessor` is a solid fingerprint for that: every chip
// engine's worklet source calls it once, and nothing else in this app does.
const quiet = [
  "about",
  "accuracy",
  "instruments",
  "connect",
  "docs",
  "signin",
  "lab",
  "lab/arrangements",
  "lab/components",
  "terms",
  "privacy",
];
for (const page of quiet) {
  const path = `.next/server/app/en/${page}.html`;
  assert.ok(existsSync(path), `${path} is missing; run the web build first`);
  const html = await readFile(path, "utf8");
  const chunks = [
    ...new Set(
      [...html.matchAll(/static\/chunks\/[a-zA-Z0-9_.-]*\.js/g)].map(
        (m) => m[0],
      ),
    ),
  ];
  assert.ok(chunks.length > 0, `/${page} referenced no script chunks`);
  for (const chunk of chunks) {
    const js = await readFile(`.next/${chunk}`, "utf8");
    assert.ok(
      !js.includes("registerProcessor"),
      `/${page} ships a chip engine's AudioWorklet source via ${chunk}, but has no audio feature of its own`,
    );
  }
}
console.log(
  "PASS pages with no audio feature ship no chip engine (about, accuracy, instruments, connect, docs, signin, lab and its sub-pages, terms, privacy)",
);
