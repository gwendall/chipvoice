/**
 * The wire format for a `PerformancePlan` in the render-parity fixture.
 *
 * A `PerformancePlan`'s `events` are a flat array of `{at, addr, value}`
 * objects and its `memory` blocks hold a `Uint8Array`; neither survives
 * `JSON.stringify` compactly or losslessly on its own (object keys repeat
 * per event, and a `Uint8Array` serializes as an object with one property
 * per byte). This is deliberately isomorphic - only `JSON`, `btoa` and
 * `atob`, all global in Node 18+ and in every engine this ticket compares -
 * so the exact same functions decode the fixture in a Node script, inside a
 * Playwright page, and on the site's render-parity lab page. That last
 * caller cannot import this file directly (it lives outside `apps/web/src`,
 * and Next's bundler is not asked to trace into `scores/`), so
 * `apps/web/src/lab/RenderParity.tsx` keeps its own copy of `planFromJSON`.
 * Anything but a mechanical, comment-linked copy of the functions below.
 */

/** `{at,addr,value}` triples flattened to `[at,addr,value,at,addr,value,...]` -
 * a plain number array, which JSON encodes with no repeated keys at all. */
export function flattenEvents(events) {
  const flat = new Array(events.length * 3);
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    flat[i * 3] = e.at;
    flat[i * 3 + 1] = e.addr;
    flat[i * 3 + 2] = e.value;
  }
  return flat;
}

export function unflattenEvents(flat) {
  const events = new Array(flat.length / 3);
  for (let i = 0; i < events.length; i++) {
    events[i] = { at: flat[i * 3], addr: flat[i * 3 + 1], value: flat[i * 3 + 2] };
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
    events: flattenEvents(plan.events),
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
    events: unflattenEvents(json.events),
    memory: json.memory.map(block => ({ address: block.address, bytes: base64ToBytes(block.bytes) })),
  };
}
