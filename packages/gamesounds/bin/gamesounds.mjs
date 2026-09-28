#!/usr/bin/env node
// The `gamesounds` CLI: no dependencies, calls the public API this same
// package's runtime can also call directly (ManifestSource's `{remote:
// true}` form), plain Node built-ins only. Ships as-is (not compiled from
// src/), so it runs with no build step - see package.json's `bin` and
// `files` fields.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";

const HELP = `gamesounds - a game sound-effects bank's CLI (https://gamesounds.ai)

Usage:
  gamesounds add <event...> [--style <style>] [--formats <fmt[,fmt]>] [--api <url>] [--dir <dir>]
  gamesounds search <query> [--style <style>] [--category <id>] [--limit <n>] [--api <url>]
  gamesounds list [--dir <dir>]
  gamesounds swap <event> [--style <style>] [--api <url>] [--dir <dir>]
  gamesounds sync [--dir <dir>] [--api <url>]

  add               Resolves <event...> to sounds and writes sounds.json,
                     SOUNDS-CREDITS.md and the audio files into <dir>.
                     Safe to run again: a file you already have is not
                     re-downloaded, and re-running with more events only
                     adds to sounds.json.
  search <query>    Free-text search over the catalogue (title, description,
                     category, tags). Prints matches; add one with \`add\`.
  list              Lists the events already resolved in <dir>/sounds.json.
  swap <event>      Re-resolves one event to the next-best sound that is not
                     the one already chosen, and replaces it in sounds.json.
  sync              Verifies every file sounds.json references still exists
                     and still hashes to its own content-addressed name -
                     redownloads a missing one, refuses (does not overwrite)
                     a tampered one.

  <event>           A game event: a category id ("movement/jump"), a bare
                     leaf name ("jump"), or "leaf/tag" ("hit/heavy").
  --style <style>   8bit, 16bit, arcade, cartoon, realistic, scifi, fantasy,
                     horror, cozy, or minimal-ui. Optional; falls back to
                     any style when the chosen one has no candidate.
  --formats <fmt>   Comma-separated, 1-2 of ogg, mp3, wav (e.g. "ogg" or
                     "ogg,wav"). The first becomes the primary file, the
                     second (if given) the fallback. Defaults to ogg,mp3 -
                     "--formats ogg" downloads and writes only ogg.
  --api <url>       Defaults to $GAMESOUNDS_API or https://gamesounds.ai.
  --dir <dir>       Where sounds.json and the audio files live. Defaults to
                     the current directory. (--out is accepted as an alias.)
  --json            Machine-readable output instead of prose.

Every download's SHA-256 is verified against the server's own
content-addressed URL (the hash embedded in the filename itself) before
gamesounds trusts it.
`;

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const positional = [];
  const flags = { style: undefined, api: undefined, dir: undefined, formats: undefined, limit: undefined, category: undefined, json: false, help: false };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--help" || arg === "-h") {
      flags.help = true;
      continue;
    }
    if (arg === "--json") {
      flags.json = true;
      continue;
    }
    if (arg === "--out") {
      const value = rest[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      flags.dir = value;
      continue;
    }
    if (arg === "--style" || arg === "--api" || arg === "--dir" || arg === "--formats" || arg === "--limit" || arg === "--category") {
      const value = rest[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      flags[arg.slice(2)] = value;
      continue;
    }
    if (arg.startsWith("--")) throw new Error(`Unknown flag: ${arg}`);
    positional.push(arg);
  }
  return { command, positional, flags };
}

function toLocalPath(url) {
  return url.startsWith("/") ? url.slice(1) : url;
}

/** The hash a content-addressed `/f/<hash>.<ext>` url - or its local,
 * leading-slash-stripped form `f/<hash>.<ext>` written under --dir - is
 * keyed by. Both forms are content-addressed the same way, so one regex
 * (anchored to a `f/` path segment, not the string's start) covers either. */
function hashFromPath(pathOrUrl) {
  const match = /(?:^|\/)f\/([0-9a-f]{64})\.[a-z0-9]+$/i.exec(pathOrUrl);
  return match ? match[1] : null;
}

async function downloadBytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Every format (ogg, mp3, wav) is content-addressed by its OWN bytes now
 * (apps/sounds/scripts/lib/audio.mjs's encodeVariant, decision 40 extended
 * per-file), so verification needs no second fetch of a sibling format: the
 * exact bytes just downloaded for `url` are hashed and checked against the
 * hash embedded in `url` itself. This verifies exactly the file that was
 * written, for every format actually requested - not just a WAV that may
 * not even have been asked for.
 */
function verifyDownload(url, bytes) {
  const expected = hashFromPath(url);
  if (!expected) return; // not a content-addressed path (should not happen for /f/ urls)
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) {
    throw new Error(
      `SHA-256 mismatch for ${url}: expected ${expected}, got ${actual}. The server is not serving what its own content-addressed URL claims - refusing to trust this file.`,
    );
  }
}

function parseFormats(value) {
  if (!value) return undefined;
  const formats = value.split(",").map((f) => f.trim()).filter(Boolean);
  if (formats.length < 1 || formats.length > 2) throw new Error(`--formats takes 1 or 2 formats, got "${value}"`);
  return formats;
}

function mergeCredits(existing, incoming) {
  const bySound = new Map(existing.map((c) => [c.sound, c]));
  for (const credit of incoming) bySound.set(credit.sound, credit);
  return [...bySound.values()];
}

function creditsMarkdown(credits) {
  const lines = [
    "# Sound credits",
    "",
    "Written by `npx gamesounds add`. Every sound below is CC0-1.0 unless a different licence is named.",
    "",
  ];
  for (const credit of credits) {
    const attribution = credit.attribution ? ` - ${credit.attribution}` : "";
    lines.push(`- **${credit.sound}** - ${credit.license}, from ${credit.source} by ${credit.author}${attribution}`);
  }
  lines.push("");
  return lines.join("\n");
}

/** Downloads (skipping what is already on disk) and verifies every file a
 * resolved manifest's events reference. Returns local-relative paths keyed
 * the way sounds.json stores them, plus download/verify counters. */
async function fetchManifestFiles(manifest, api, outDir) {
  const allUrls = new Set();
  for (const event of Object.values(manifest.events)) {
    for (const file of event.files ?? []) allUrls.add(file);
    for (const file of event.fallback ?? []) allUrls.add(file);
  }
  let downloaded = 0;
  let skipped = 0;
  let verified = 0;
  for (const url of allUrls) {
    const localPath = join(outDir, toLocalPath(url));
    if (existsSync(localPath)) {
      skipped++;
      continue;
    }
    const bytes = await downloadBytes(`${api}${url}`);
    verifyDownload(url, bytes);
    verified++;
    await mkdir(dirname(localPath), { recursive: true });
    await writeFile(localPath, bytes);
    downloaded++;
  }
  return { downloaded, skipped, verified };
}

function localizeManifestEvents(events) {
  const localEvents = {};
  for (const [eventId, event] of Object.entries(events)) {
    localEvents[eventId] = {
      ...event,
      files: event.files.map(toLocalPath),
      ...(event.fallback ? { fallback: event.fallback.map(toLocalPath) } : {}),
    };
  }
  return localEvents;
}

async function readLocalManifest(outDir) {
  const manifestPath = join(outDir, "sounds.json");
  if (!existsSync(manifestPath)) return null;
  return JSON.parse(await readFile(manifestPath, "utf8"));
}

async function writeLocalManifest(outDir, manifest) {
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "sounds.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(outDir, "SOUNDS-CREDITS.md"), creditsMarkdown(manifest.credits ?? []));
}

async function resolveEvents(api, body) {
  const response = await fetch(`${api}/api/v1/resolve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${api}/api/v1/resolve answered ${response.status}: ${await response.text()}`);
  return response.json();
}

async function addCommand(events, { style, formats, api, outDir, jsonOut }) {
  if (events.length === 0) throw new Error("gamesounds add needs at least one event.");
  const { manifest, unresolved } = await resolveEvents(api, { events, style, formats });

  for (const event of unresolved) console.error(`gamesounds: no sound resolved for "${event}"`);
  if (Object.keys(manifest.events).length === 0) {
    throw new Error("nothing resolved, nothing written.");
  }

  // The server hands back root-relative URLs ("/f/<hash>.ogg"); written to
  // disk they become project-relative ("f/<hash>.ogg") under a "./" base,
  // so the written sounds.json is portable on its own (see runtime.ts's
  // joinPath: a leading "/" would otherwise be read as origin-absolute).
  const localEvents = localizeManifestEvents(manifest.events);
  const { downloaded, skipped, verified } = await fetchManifestFiles(manifest, api, outDir);

  // Merge with any sounds.json already in <outDir>, so re-running only adds
  // what is new.
  let finalManifest = { ...manifest, base: "./", events: localEvents };
  const existing = await readLocalManifest(outDir);
  if (existing) {
    finalManifest = {
      ...finalManifest,
      events: { ...existing.events, ...localEvents },
      credits: mergeCredits(existing.credits ?? [], manifest.credits),
    };
  }
  await writeLocalManifest(outDir, finalManifest);

  const result = { events: Object.keys(finalManifest.events).length, downloaded, skipped, verified, unresolved };
  if (jsonOut) {
    console.log(JSON.stringify(result));
  } else {
    console.log(
      `gamesounds: wrote ${result.events} event(s) to sounds.json, ${downloaded} file(s) downloaded (${skipped} already present), ` +
        `${verified} hash(es) verified against the server's own content-addressed store.`,
    );
    if (unresolved.length > 0) console.log(`gamesounds: ${unresolved.length} event(s) had no candidate and were skipped: ${unresolved.join(", ")}`);
  }
}

async function searchCommand(query, { style, category, limit, api, jsonOut }) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (style) params.set("style", style);
  if (category) params.set("category", category);
  if (limit) params.set("limit", limit);
  const response = await fetch(`${api}/api/v1/sounds?${params.toString()}`);
  if (!response.ok) throw new Error(`${api}/api/v1/sounds answered ${response.status}: ${await response.text()}`);
  const { sounds, total } = await response.json();

  if (jsonOut) {
    console.log(JSON.stringify({ sounds, total }));
    return;
  }
  if (sounds.length === 0) {
    console.log("gamesounds: no matches.");
    return;
  }
  for (const sound of sounds) {
    console.log(`${sound.id}  [${sound.category}]  ${sound.style}  ${sound.variants.length} variant(s)  - ${sound.title}`);
  }
  console.log(`gamesounds: ${sounds.length} of ${total} match(es) shown.`);
}

async function listCommand({ outDir, jsonOut }) {
  const manifest = await readLocalManifest(outDir);
  const events = manifest?.events ?? {};
  if (jsonOut) {
    console.log(JSON.stringify(events));
    return;
  }
  const entries = Object.entries(events);
  if (entries.length === 0) {
    console.log(`gamesounds: no events resolved yet in ${outDir} (run "gamesounds add" first).`);
    return;
  }
  for (const [event, e] of entries) console.log(`${event}  ->  ${e.sound}  (${e.files.length} file(s))`);
}

async function swapCommand(event, { style, api, outDir, jsonOut }) {
  if (!event) throw new Error("gamesounds swap needs exactly one event.");
  const manifest = await readLocalManifest(outDir);
  const current = manifest?.events?.[event];
  if (!current) throw new Error(`"${event}" is not in sounds.json yet - run "gamesounds add ${event}" first.`);

  const resolved = await resolveEvents(api, { events: [event], style, exclude: [current.sound] });
  const newEvent = resolved.manifest.events[event];
  if (!newEvent) {
    throw new Error(`no sound resolved for "${event}" at all (it previously resolved to "${current.sound}") - the catalogue may have changed.`);
  }
  if (newEvent.sound === current.sound) {
    const result = { event, sound: current.sound, swapped: false };
    if (jsonOut) console.log(JSON.stringify(result));
    else console.log(`gamesounds: no alternative sound exists for "${event}" besides "${current.sound}" - sounds.json unchanged.`);
    return;
  }

  const { downloaded, skipped, verified } = await fetchManifestFiles(resolved.manifest, api, outDir);
  const localEvents = localizeManifestEvents(resolved.manifest.events);
  const finalManifest = {
    ...manifest,
    events: { ...manifest.events, ...localEvents },
    credits: mergeCredits(manifest.credits ?? [], resolved.manifest.credits),
  };
  await writeLocalManifest(outDir, finalManifest);

  const result = { event, sound: newEvent.sound, previousSound: current.sound, swapped: true, downloaded, skipped, verified };
  if (jsonOut) console.log(JSON.stringify(result));
  else console.log(`gamesounds: swapped "${event}" from "${current.sound}" to "${newEvent.sound}" (${downloaded} file(s) downloaded, ${verified} verified).`);
}

/**
 * Verifies every file sounds.json's events reference is still on disk and
 * still hashes to its own content-addressed name: a missing file is
 * redownloaded and re-verified, a present-but-tampered one is refused
 * outright (never silently overwritten - the caller decides what to do
 * with a file that does not match its own name).
 */
async function syncCommand({ outDir, api, jsonOut }) {
  const manifest = await readLocalManifest(outDir);
  if (!manifest) throw new Error(`No sounds.json in ${outDir} - run "gamesounds add" first.`);

  const paths = new Set();
  for (const event of Object.values(manifest.events ?? {})) {
    for (const p of event.files ?? []) paths.add(p);
    for (const p of event.fallback ?? []) paths.add(p);
  }

  let verified = 0;
  let redownloaded = 0;
  const tampered = [];
  for (const localPath of paths) {
    const hash = hashFromPath(localPath);
    const full = join(outDir, localPath);
    if (existsSync(full)) {
      if (hash) {
        const bytes = await readFile(full);
        const actual = createHash("sha256").update(bytes).digest("hex");
        if (actual !== hash) {
          tampered.push(localPath);
          continue;
        }
      }
      verified++;
      continue;
    }
    if (!hash) throw new Error(`${localPath} is missing and is not a content-addressed path gamesounds can redownload.`);
    const bytes = await downloadBytes(`${api}/${localPath}`);
    verifyDownload(`/${localPath}`, bytes);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, bytes);
    redownloaded++;
    verified++;
  }

  if (tampered.length > 0) {
    throw new Error(
      `${tampered.length} file(s) no longer hash to their own content-addressed name - refusing to overwrite them (tampered or corrupted), run "gamesounds sync" after resolving this by hand:\n` +
        tampered.join("\n"),
    );
  }

  const result = { verified, redownloaded, tampered: 0 };
  if (jsonOut) console.log(JSON.stringify(result));
  else console.log(`gamesounds: sync verified ${verified} file(s), redownloaded ${redownloaded}, 0 tampered.`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === "--version" || argv[0] === "-v") {
    const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    console.log(pkg.version);
    return;
  }

  const { command, positional, flags } = parseArgs(argv);
  if (flags.help || !command) {
    console.log(HELP);
    process.exitCode = command ? 0 : 1;
    return;
  }

  const api = (flags.api ?? process.env.GAMESOUNDS_API ?? "https://gamesounds.ai").replace(/\/$/, "");
  const outDir = flags.dir ?? process.cwd();
  const formats = parseFormats(flags.formats);
  const limit = flags.limit;

  if (command === "add") {
    await addCommand(positional, { style: flags.style, formats, api, outDir, jsonOut: flags.json });
  } else if (command === "search") {
    await searchCommand(positional.join(" "), { style: flags.style, category: flags.category, limit, api, jsonOut: flags.json });
  } else if (command === "list") {
    await listCommand({ outDir, jsonOut: flags.json });
  } else if (command === "swap") {
    await swapCommand(positional[0], { style: flags.style, api, outDir, jsonOut: flags.json });
  } else if (command === "sync") {
    await syncCommand({ outDir, api, jsonOut: flags.json });
  } else {
    console.error(`Unknown command "${command}".\n\n${HELP}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`gamesounds: ${error.message}`);
  process.exitCode = 1;
});
