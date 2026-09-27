import { createHash } from 'node:crypto';

/**
 * The raw bytes a render-parity hash covers: left channel, then right (when
 * present), as the IEEE-754 float32 bytes a `Float32Array` already holds -
 * no resampling, no quantizing to int16 the way `toWav` does, so a
 * difference far too small for `toWav` to show still moves this hash.
 *
 * This reads each typed array's native byte layout directly, which is the
 * host platform's own endianness rather than a format this function
 * chooses. Every environment MIX-14 compares - Node and Chromium/Firefox/
 * WebKit through Playwright, and a visitor's own phone - runs on a
 * little-endian CPU (x86-64 or ARM64 in its default mode), which is true of
 * every machine V8, SpiderMonkey and JavaScriptCore ship on today, so the
 * bytes compare directly across engines. A big-endian host would still
 * render correct audio; only the raw-byte hash comparison would need a
 * byte-swap this function does not perform.
 */
export function pcmBytes({ left, right }) {
  const bytes = new Uint8Array(left.byteLength + (right ? right.byteLength : 0));
  bytes.set(new Uint8Array(left.buffer, left.byteOffset, left.byteLength), 0);
  if (right) bytes.set(new Uint8Array(right.buffer, right.byteOffset, right.byteLength), left.byteLength);
  return bytes;
}

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function pcmSha256(audio) {
  return sha256Hex(pcmBytes(audio));
}
