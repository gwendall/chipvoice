import { chromium } from "playwright";

/**
 * The editor, saving.
 *
 * There was a complete API that nothing in the editor could reach, and an
 * editor that could not save - so the half that a person can see and the half
 * that agents use were separate products. This drives the seam between them.
 */
const SITE = process.env.SITE || "http://localhost:3010";
const guard = setTimeout(() => { console.error("TIMEOUT"); process.exit(1); }, 120000);
guard.unref();

let failures = 0;
const check = (n, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${n}${extra ? "  " + extra : ""}`); };

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    // The guard test deliberately provokes a 422, and the browser logs every
    // failed fetch. Counting that as a page error would fail the run for
    // working exactly as intended.
    const text = m.text();
    if (m.type() === "error" && !/422 \(Unprocessable/.test(text)) errors.push(text);
  });

  await page.goto(SITE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);

  check("there is a title field", await page.locator(".title").count() === 1);
  const saveButton = page.locator(".transport button", { hasText: /^Save$/ });
  check("and a save button", await saveButton.count() === 1);

  await page.fill(".title", "editor test");
  await saveButton.click();

  const saved = await page
    .waitForFunction(() => /^\/s\/[0-9A-Za-z]{8}$/.test(location.pathname), null, { timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  check("saving stores the song", saved, saved ? "" : "the URL never became a permalink");

  if (saved) {
    const id = new URL(page.url()).pathname.slice(3);
    check("and the URL becomes the permalink", /^[0-9A-Za-z]{8}$/.test(id), id);

    const api = await (await fetch(`${SITE}/api/songs/${id}`)).json();
    check("the API has it", api.id === id);
    check("with the title", api.title === "editor test", api.title);
    check("as an original", api.depth === 0 && api.rootId === id);
    check("and unverified, with no key", api.authorVerified === false);

    check("the permalink is shown", await page.locator(".permalink").count() === 1);

    // Editing a saved song has to offer a fork, because a saved song is
    // immutable. The button saying so is what makes that rule visible.
    await page.fill(".title", "editor test, changed");
    await page.waitForTimeout(200);
    const forkButton = page.locator(".transport button", { hasText: /^Fork$/ });
    check("editing turns Save into Fork", await forkButton.count() === 1);

    await forkButton.click();
    const forked = await page
      .waitForFunction((old) => location.pathname !== `/s/${old}`, id, { timeout: 20000 })
      .then(() => true)
      .catch(() => false);
    check("forking stores a second song", forked);

    if (forked) {
      const childId = new URL(page.url()).pathname.slice(3);
      const child = await (await fetch(`${SITE}/api/songs/${childId}`)).json();
      check("the fork points at its parent", child.parentId === id, child.parentId);
      check("at depth one", child.depth === 1, String(child.depth));
      check("sharing the same root", child.rootId === id, child.rootId);
      check("and the lineage names it", child.lineage?.parent?.id === id);
    }

    // A permalink has to open the song it names.
    const fresh = await browser.newPage();
    await fresh.goto(`${SITE}/s/${id}`, { waitUntil: "domcontentloaded" });
    await fresh.waitForTimeout(1200);
    check(
      "a permalink loads the song into the editor",
      (await fresh.inputValue(".title")) === "editor test",
      await fresh.inputValue(".title"),
    );
    await fresh.close();
  }

  // The guard, from the outside.
  await page.goto(SITE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(400);
  await page.fill(".title", "⚠️ <script>alert(1)</script>");
  await page.locator(".transport button", { hasText: /^Save$/ }).click();
  await page.waitForTimeout(1500);
  const shown = await page.locator(".note.error").textContent().catch(() => "");
  check("a bad title is refused, visibly", /title can hold/.test(shown ?? ""), shown ?? "(nothing shown)");
  check("and the song is not stored", !/^\/s\//.test(new URL(page.url()).pathname));

  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
} finally {
  await browser.close();
}
console.log(failures === 0 ? "\nPASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
