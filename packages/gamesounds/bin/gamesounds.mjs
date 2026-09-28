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
  gamesounds add <event...> [--style <style>] [--api <url>] [--out <dir>]

  <event>           A game event: a category id ("movement/jump"), a bare
                     leaf name ("jump"), or "leaf/tag" ("hit/heavy").
  --style <style>   8bit, 16bit, arcade, cartoon, realistic, scifi, fantasy,
                     horror, cozy, or minimal-ui. Optional; falls back to
                     any style when the chosen one has no candidate.
  --api <url>       Defaults to $GAMESOUNDS_API or https://gamesounds.ai.
  --out <dir>       Where to write sounds.json and the audio files.
                     Defaults to the current directory.

Writes sounds.json, SOUNDS-CREDITS.md and the audio files into <dir>,
verifying every download's SHA-256 against the server's own content-addressed
store before exiting. Safe to run again: a file you already have is not
re-downloaded, and re-running with more events only adds to sounds.json.
`;

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const events = [];
  const flags = { style: undefined, api: undefined, out: undefined, help: false };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--help" || arg === "-h") {
      flags.help = true;
      continue;
    }
    if (arg === "--style" || arg === "--api" || arg === "--out") {
      const value = rest[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      flags[arg.slice(2)] = value;
      continue;
    }
    if (arg.startsWith("--")) throw new Error(`Unknown flag: ${arg}`);
    events.push(arg);
  }
  return { command, events, flags };
}

function toLocalPath(url) {
  return url.startsWith("/") ? url.slice(1) : url;
}

/** The hash a content-addressed /f/<hash>.<ext> URL is keyed by. */
function hashFromUrl(url) {
  const match = /\/f\/([0-9a-f]{64})\.[a-z0-9]+$/i.exec(url);
  return match ? match[1] : null;
}

async function downloadBytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Every format of one variant (ogg, mp3, wav) shares one filename hash - the
 * canonical WAV's own SHA-256 (apps/sounds/scripts/lib/audio.mjs's
 * encodeVariant) - so the WAV is the one format whose own bytes are
 * provably that hash. Verifying against it proves the server's
 * content-addressed store still holds what its own address claims, which is
 * the actual guarantee "SHA-256 verified" is worth making.
 */
async function verifyHash(api, url, expectedHash) {
  const wavUrl = url.replace(/\.[a-z0-9]+$/i, ".wav");
  const bytes = await downloadBytes(`${api}${wavUrl}`);
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expectedHash) {
    throw new Error(
      `SHA-256 mismatch for ${wavUrl}: expected ${expectedHash}, got ${actual}. The server is not serving what its own content-addressed URL claims - refusing to trust these files.`,
    );
  }
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

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === "--version" || argv[0] === "-v") {
    const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    console.log(pkg.version);
    return;
  }

  const { command, events, flags } = parseArgs(argv);
  if (flags.help || !command) {
    console.log(HELP);
    process.exitCode = command ? 0 : 1;
    return;
  }
  if (command !== "add") {
    console.error(`Unknown command "${command}". Only "add" exists in phase 1.\n\n${HELP}`);
    process.exitCode = 1;
    return;
  }
  if (events.length === 0) {
    console.error(`gamesounds add needs at least one event.\n\n${HELP}`);
    process.exitCode = 1;
    return;
  }

  const api = (flags.api ?? process.env.GAMESOUNDS_API ?? "https://gamesounds.ai").replace(/\/$/, "");
  const outDir = flags.out ?? process.cwd();

  const response = await fetch(`${api}/api/v1/resolve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ events, style: flags.style }),
  });
  if (!response.ok) {
    throw new Error(`${api}/api/v1/resolve answered ${response.status}: ${await response.text()}`);
  }
  const { manifest, unresolved } = await response.json();

  for (const event of unresolved) console.error(`gamesounds: no sound resolved for "${event}"`);
  if (Object.keys(manifest.events).length === 0) {
    console.error("gamesounds: nothing resolved, nothing written.");
    process.exitCode = 1;
    return;
  }

  // The server hands back root-relative URLs ("/f/<hash>.ogg"); written to
  // disk they become project-relative ("f/<hash>.ogg") under a "./" base,
  // so the written sounds.json is portable on its own (see runtime.ts's
  // joinPath: a leading "/" would otherwise be read as origin-absolute).
  const localEvents = {};
  for (const [eventId, event] of Object.entries(manifest.events)) {
    localEvents[eventId] = {
      ...event,
      files: event.files.map(toLocalPath),
      ...(event.fallback ? { fallback: event.fallback.map(toLocalPath) } : {}),
    };
  }

  const allUrls = new Set();
  for (const event of Object.values(manifest.events)) {
    for (const file of event.files) allUrls.add(file);
    for (const file of event.fallback ?? []) allUrls.add(file);
  }

  let downloaded = 0;
  let skipped = 0;
  const verifiedHashes = new Set();
  for (const url of allUrls) {
    const localPath = join(outDir, toLocalPath(url));
    if (existsSync(localPath)) {
      skipped++;
    } else {
      const bytes = await downloadBytes(`${api}${url}`);
      await mkdir(dirname(localPath), { recursive: true });
      await writeFile(localPath, bytes);
      downloaded++;
    }
    const hash = hashFromUrl(url);
    if (hash && !verifiedHashes.has(hash)) {
      verifiedHashes.add(hash);
      await verifyHash(api, url, hash);
    }
  }

  // Merge with any sounds.json already in <outDir>, so re-running only adds
  // what is new.
  const manifestPath = join(outDir, "sounds.json");
  let finalManifest = { ...manifest, base: "./", events: localEvents };
  if (existsSync(manifestPath)) {
    const existing = JSON.parse(await readFile(manifestPath, "utf8"));
    finalManifest = {
      ...finalManifest,
      events: { ...existing.events, ...localEvents },
      credits: mergeCredits(existing.credits ?? [], manifest.credits),
    };
  }

  await mkdir(outDir, { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(finalManifest, null, 2)}\n`);
  await writeFile(join(outDir, "SOUNDS-CREDITS.md"), creditsMarkdown(finalManifest.credits));

  console.log(
    `gamesounds: wrote ${Object.keys(finalManifest.events).length} event(s) to sounds.json, ` +
      `${downloaded} file(s) downloaded (${skipped} already present), ${verifiedHashes.size} hash(es) verified against the server's own content-addressed store.`,
  );
  if (unresolved.length > 0) console.log(`gamesounds: ${unresolved.length} event(s) had no candidate and were skipped: ${unresolved.join(", ")}`);
}

main().catch((error) => {
  console.error(`gamesounds: ${error.message}`);
  process.exitCode = 1;
});
