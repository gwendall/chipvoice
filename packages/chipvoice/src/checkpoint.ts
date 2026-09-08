/** In-process snapshots of explicitly opted-in DSP cores. Preserve class
 * prototypes and shared typed-array backing stores; structuredClone alone
 * would turn nested oscillators and event queues into objects without methods.
 * This is a cold worker operation, never an audio callback or a file format.
 * Cores using private slots, native resources or closures must provide their own
 * fork implementation instead. Built-in cores are covered by PCM parity tests. */
export function forkState<T>(value: T): T {
  const seen = new Map<object, unknown>();
  const copy = (item: unknown): any => {
    if (typeof item === 'function') throw Error('DSP checkpoint contains a closure');
    if (item === null || typeof item !== 'object') return item;
    if (seen.has(item)) return seen.get(item);
    if (item instanceof ArrayBuffer) {
      const result = item.slice(0); seen.set(item, result); return result;
    }
    if (ArrayBuffer.isView(item)) {
      const buffer = copy(item.buffer);
      const result = item instanceof DataView
        ? new DataView(buffer, item.byteOffset, item.byteLength)
        : new (item.constructor as any)(buffer, item.byteOffset, (item as any).length);
      seen.set(item, result); return result;
    }
    if (item instanceof Map) {
      const result = new Map(); seen.set(item, result);
      for (const [key, value] of item) result.set(copy(key), copy(value));
      return result;
    }
    if (item instanceof Set) {
      const result = new Set(); seen.set(item, result);
      for (const value of item) result.add(copy(value));
      return result;
    }
    if (item instanceof WeakMap || item instanceof WeakSet || item instanceof Date || item instanceof Promise)
      throw Error('Unsupported DSP checkpoint state');
    const result = Array.isArray(item) ? [] : Object.create(Object.getPrototypeOf(item));
    seen.set(item, result);
    for (const key of Reflect.ownKeys(item)) {
      if (Array.isArray(item) && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
      if (!('value' in descriptor)) throw Error('DSP checkpoint contains an accessor');
      Object.defineProperty(result, key, {...descriptor, value: copy(descriptor.value)});
    }
    return result;
  };
  return copy(value);
}
