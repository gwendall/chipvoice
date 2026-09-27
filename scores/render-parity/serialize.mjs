/**
 * The wire format for a `PerformancePlan` in the render-parity fixture.
 *
 * A `PerformancePlan`'s `events` are an array of `{at, addr, value}` objects
 * and its `memory` blocks hold a `Uint8Array`; neither survives
 * `JSON.stringify` compactly or losslessly on its own (object keys repeat
 * per event, and a `Uint8Array` serializes as an object with one property
 * per byte). Both are packed into raw bytes and base64-encoded instead. This
 * is deliberately isomorphic - only `JSON`, `DataView`, `btoa` and `atob`,
 * all global in Node 18+ and in every engine this ticket compares - so the
 * exact same functions decode the fixture in a Node script, inside a
 * Playwright page, and on the site's render-parity lab page. That last
 * caller cannot import this file directly (it lives outside `apps/web/src`,
 * and Next's bundler is not asked to trace into `scores/`), so
 * `apps/web/src/lab/RenderParity.tsx` keeps its own copy of `planFromJSON`.
 * Anything but a mechanical, comment-linked copy of the functions below.
 */

/**
 * `{at,addr,value}` triples packed into a compact binary form and
 * base64-encoded: a 4-byte `at` (uint32, little-endian), a 4-byte `addr`
 * (uint32) and a 1-byte `value` (uint8), 9 bytes per event. A JSON number
 * array costs a byte per digit plus a comma for every one of the three
 * fields (sonic-md's excerpt alone carries over 100,000 events); `at` runs
 * into the hundreds of millions on a native VGM import's absolute cycle
 * count and the Mega Drive's own `addr` exceeds 16 bits on some commands, so
 * both keep the full 32 bits, while `value` is always one register byte.
 * This is what keeps the published fixture
 * (apps/web/public/render-parity-data/inputs.json) light enough for a phone
 * to fetch.
 */
export function packEvents(events) {
  const bytes = new Uint8Array(events.length * 9);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    view.setUint32(i * 9, e.at, true);
    view.setUint32(i * 9 + 4, e.addr, true);
    view.setUint8(i * 9 + 8, e.value);
  }
  return bytesToBase64(bytes);
}

export function unpackEvents(text) {
  const bytes = base64ToBytes(text);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const events = new Array(bytes.length / 9);
  for (let i = 0; i < events.length; i++) {
    events[i] = { at: view.getUint32(i * 9, true), addr: view.getUint32(i * 9 + 4, true), value: view.getUint8(i * 9 + 8) };
  }
  return events;
}

export function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function base64ToBytes(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** A `PerformancePlan` to its compact JSON-safe form. */
export function planToJSON(plan) {
  return {
    chip: plan.chip,
    seconds: plan.seconds,
    events: packEvents(plan.events),
    memory: (plan.memory ?? []).map(block => ({ address: block.address, bytes: bytesToBase64(block.bytes) })),
  };
}

/** The inverse of `planToJSON`: exactly the `{chip, seconds, events, memory}`
 * shape `renderPerformance` reads, nothing else of a full `PerformancePlan`
 * carried along (this fixture never needs `notes`, `losses` or `mix`). */
export function planFromJSON(json) {
  return {
    chip: json.chip,
    seconds: json.seconds,
    events: unpackEvents(json.events),
    memory: json.memory.map(block => ({ address: block.address, bytes: base64ToBytes(block.bytes) })),
  };
}
