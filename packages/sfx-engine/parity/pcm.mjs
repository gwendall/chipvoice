import { createHash } from 'node:crypto';

/**
 * The raw bytes a render-parity hash covers: left channel then right, as
 * the IEEE-754 float64 bytes a `Float64Array` already holds - no
 * resampling, no quantizing to int16, so a difference far too small to
 * hear still moves this hash. (`renderRecipe`'s PCM is float64 throughout,
 * unlike chipvoice's own render-parity fixture, which hashes float32 -
 * sfx-engine never downcasts, so there is no float32 truncation step to
 * mirror here.)
 *
 * This reads each typed array's native byte layout directly, which is the
 * host platform's own endianness rather than a format this function
 * chooses. Every environment this harness compares - Node and Chromium/
 * Firefox/WebKit through Playwright, and a caller's own machine - runs on a
 * little-endian CPU (x86-64 or ARM64 in its default mode), which is true of
 * every machine V8, SpiderMonkey and JavaScriptCore ship on today, so the
 * bytes compare directly across engines. A big-endian host would still
 * render correct audio; only the raw-byte hash comparison would need a
 * byte-swap this function does not perform.
 */
export function pcmBytes({ left, right }) {
  const bytes = new Uint8Array(left.byteLength + right.byteLength);
  bytes.set(new Uint8Array(left.buffer, left.byteOffset, left.byteLength), 0);
  bytes.set(new Uint8Array(right.buffer, right.byteOffset, right.byteLength), left.byteLength);
  return bytes;
}

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function pcmSha256(rendered) {
  return sha256Hex(pcmBytes(rendered));
}
