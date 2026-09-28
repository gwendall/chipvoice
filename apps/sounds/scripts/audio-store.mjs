// Shipped audio lives in a Vercel Blob store, not in git (decision 40's
// pattern, ported from apps/web/scripts/audio-store.mjs). generated/catalog.json
// is committed; the bytes its variants' files point at (public/f/, gitignored)
// are not. Every file already names its own content - encodeVariant
// (scripts/lib/audio.mjs) writes each format to `<its own sha256>.<ext>`, so
// unlike apps/web's lab/arrangement/instrument reports (which need a regex
// to prove a report-chosen name actually names its content), a gamesounds
// file's url already IS `/f/<sha256>.<ext>`: the manifest doesn't need to
// assert the naming convention, only that the sha256 in the url matches the
// sha256 the catalogue recorded for that same file (checkStorePath, below).
// A key is written once and never changes, so the site rewrites a miss to
// the store (next.config.ts) and browsers may keep a file forever
// (headers()'s immutable cache for /f/:path*).
//
//   pnpm sounds:pull    a verified local copy under apps/sounds/public/f
//   pnpm sounds:check   every catalogue file is in the store
//   pnpm sounds:push    upload what is missing (needs GAMESOUNDS_BLOB_READ_WRITE_TOKEN)
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const site = resolve(import.meta.dirname, "..");
const root = resolve(site, "../..");
export const { base } = JSON.parse(await readFile(resolve(site, "audio-store.json"), "utf8"));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const STORE_PATH = /^\/f\/([0-9a-f]{64})\.(ogg|mp3|wav)$/;
const local = (file) => resolve(site, "public" + file);

async function each(items, task, width = 8) {
  const queue = [...items];
  await Promise.all(Array.from({ length: width }, async () => { while (queue.length) await task(queue.shift()); }));
}

// A dropped connection or a busy edge is retried with backoff; a 404 is an
// answer and is not.
async function request(url, init, attempts = 5) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, init);
      if ((response.status < 500 && response.status !== 429) || attempt === attempts) return response;
    } catch (error) {
      if (attempt === attempts) throw error;
    }
    await new Promise((done) => setTimeout(done, 500 * 2 ** attempt));
  }
}

/** A url must be exactly `/f/<sha256>.<ext>` and its own sha256 must match
 * the catalogue's recorded sha256 for that file - a path that does not name
 * its content is refused before it can become a store key that would one
 * day need to change. */
function checkStorePath(file, sha256) {
  const m = STORE_PATH.exec(file);
  if (!m) throw new Error(`${file} is not a content-addressed /f/<sha256>.<ext> path`);
  if (m[1] !== sha256) throw new Error(`${file} does not name its own catalogue sha256 (${sha256})`);
}

/** Every file every sound's every variant ships, by site path, with the
 * SHA-256 of its own bytes (Variant.files.{ogg,mp3,wav}, each already
 * content-addressed - see this file's own header). */
export async function publishedFiles() {
  const files = new Map();
  const catalog = JSON.parse(await readFile(resolve(site, "generated/catalog.json"), "utf8"));
  for (const sound of catalog.sounds) {
    for (const variant of sound.variants) {
      for (const audioFile of Object.values(variant.files)) {
        checkStorePath(audioFile.url, audioFile.sha256);
        if (files.has(audioFile.url) && files.get(audioFile.url) !== audioFile.sha256) {
          throw new Error(`${audioFile.url} is published with two different contents`);
        }
        files.set(audioFile.url, audioFile.sha256);
      }
    }
  }
  return files;
}

async function localCopy(file, sha256) {
  try {
    const bytes = await readFile(local(file));
    return hash(bytes) === sha256 ? bytes : null;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
async function download(file, sha256) {
  const response = await request(base + file);
  if (!response.ok) throw new Error(`${file}: the store answered ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (hash(bytes) !== sha256) throw new Error(`${file}: the stored bytes are not the ones the catalogue names`);
  return bytes;
}
/** One file's published bytes, verified: the local copy when it is there and
 * intact, the store's otherwise. */
export async function publishedBytes(file, sha256) {
  return (await localCopy(file, sha256)) ?? (await download(file, sha256));
}

export async function pull() {
  const files = await publishedFiles();
  let fetched = 0;
  await each(files, async ([file, sha256]) => {
    if (await localCopy(file, sha256)) return;
    const bytes = await download(file, sha256);
    const target = local(file);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target + ".tmp", bytes);
    await rename(target + ".tmp", target);
    fetched++;
  });
  console.log(`PASS ${files.size} published files verified locally; ${fetched} fetched from the store`);
}

export async function check() {
  const files = await publishedFiles();
  const missing = [];
  await each(files, async ([file]) => {
    const response = await request(base + file, { method: "HEAD" });
    if (!response.ok) missing.push(`${file} (${response.status})`);
  });
  if (missing.length) throw new Error(`Not in the store; run pnpm sounds:push:\n${missing.sort().join("\n")}`);
  console.log(`PASS the store holds all ${files.size} published files`);
}

const CONTENT_TYPE = { ogg: "audio/ogg", mp3: "audio/mpeg", wav: "audio/wav" };

export async function push() {
  for (const file of [resolve(root, ".env.local"), resolve(site, ".env.local")]) {
    if (!process.env.GAMESOUNDS_BLOB_READ_WRITE_TOKEN) {
      try { process.loadEnvFile(file); } catch { /* optional file */ }
    }
  }
  const token = process.env.GAMESOUNDS_BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("Uploading needs GAMESOUNDS_BLOB_READ_WRITE_TOKEN: run `vercel env pull .env.local --environment=development` at apps/sounds");
  const { put, head, BlobNotFoundError } = await import("@vercel/blob");
  const files = await publishedFiles();
  let uploaded = 0;
  await each(files, async ([file, sha256]) => {
    const bytes = await localCopy(file, sha256);
    let stored = null;
    try { stored = await head(file.slice(1), { token }); }
    catch (error) { if (!(error instanceof BlobNotFoundError)) throw error; }
    if (stored) {
      if (bytes && stored.size !== bytes.length) throw new Error(`${file} is already stored with other bytes; run pnpm sounds:pull and publish again`);
      return;
    }
    if (!bytes) throw new Error(`${file} is neither in the store nor intact under apps/sounds/public`);
    const ext = file.slice(file.lastIndexOf(".") + 1);
    await put(file.slice(1), bytes, { access: "public", contentType: CONTENT_TYPE[ext] ?? "application/octet-stream", cacheControlMaxAge: 31536000, token });
    uploaded++;
  });
  console.log(`PASS ${uploaded} files uploaded; ${files.size - uploaded} were already stored`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = { pull, check, push }[process.argv[2]];
  if (!command) { console.error("Usage: audio-store.mjs pull|check|push"); process.exit(2); }
  await command();
}
