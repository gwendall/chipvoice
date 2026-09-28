import { createHash } from 'node:crypto';

export class RenderBusy extends Error {}
export interface AudioAsset { bytes: Uint8Array<ArrayBuffer>; etag: string; milliseconds: number }

/** One in-flight render per instance, same-key requests share that promise.
 * Retained bytes, entries and age are bounded independently. Failed jobs never
 * populate the cache or keep the admission slot. */
export function createRenderCache({ maxBytes = 32 * 1024 * 1024, maxEntries = 16, ttl = 600_000, now = Date.now } = {}) {
  const ready = new Map<string, { value: AudioAsset; expires: number }>();
  let retained = 0;
  let active: { key: string; promise: Promise<AudioAsset> } | null = null;
  const remove = (key: string) => { retained -= ready.get(key)!.value.bytes.byteLength; ready.delete(key); };
  return async (key: string, render: () => Promise<Uint8Array<ArrayBuffer>>): Promise<AudioAsset> => {
    for (const [id, entry] of ready) if (entry.expires <= now()) remove(id);
    const hit = ready.get(key);
    if (hit) { ready.delete(key); ready.set(key, hit); return hit.value; }
    if (active) {
      if (active.key === key) return active.promise;
      throw new RenderBusy('An audio render is already running. Try again shortly.');
    }
    const started = now();
    const promise = Promise.resolve().then(render).then(bytes => {
      const value = { bytes, etag: `"${createHash('sha256').update(bytes).digest('hex')}"`, milliseconds: now() - started };
      if (maxEntries > 0 && ttl > 0 && bytes.byteLength <= maxBytes) {
        while (ready.size && (retained + bytes.byteLength > maxBytes || ready.size >= maxEntries)) remove(ready.keys().next().value!);
        ready.set(key, { value, expires: now() + ttl }); retained += bytes.byteLength;
      }
      return value;
    }).finally(() => { active = null; });
    active = { key, promise };
    return promise;
  };
}
