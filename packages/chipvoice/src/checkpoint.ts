/** In-process snapshots of explicitly opted-in DSP cores. Preserve class
 * prototypes and shared typed-array backing stores; structuredClone alone
 * would turn nested oscillators and event queues into objects without methods.
 * This is a cold worker operation, never an audio callback or a file format.
 * Cores using private slots, native resources or closures must provide their own
 * fork implementation instead. Built-in cores are covered by PCM parity tests. */
export function forkState<T>(value: T, initialize?: () => T): T {
  const seen = new Map<object, unknown>();
  const originals = new WeakSet<object>();
  const visit = (item: any) => {
    if (!item || typeof item !== 'object' || originals.has(item)) return;
    originals.add(item);
    if (ArrayBuffer.isView(item) || item instanceof ArrayBuffer) return;
    if (item instanceof Map) {for (const [key, value] of item) {visit(key); visit(value);} return;}
    if (item instanceof Set) {for (const value of item) visit(value); return;}
    for (const key of Reflect.ownKeys(item)) visit(Object.getOwnPropertyDescriptor(item, key)?.value);
  };
  const initialized = initialize?.();
  if (initialize) {
    visit(value);
    // A second fresh graph identifies objects that constructors share (chip
    // definitions, voice arrays, profiles). They are never owned by a snapshot,
    // even when the source is itself a fork and has already cloned them.
    visit(initialize());
  }
  const copy = (item: unknown, seed?: any): any => {
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
    const prototype = Object.getPrototypeOf(item);
    // Refill constructor-created DSP instances to preserve V8 object layouts.
    // Generic prototype-only clones make the per-cycle code polymorphic and
    // can render several times slower. Never mutate shared profile objects.
    const reusable = seed && !originals.has(seed) &&
      Object.getPrototypeOf(seed) === prototype && !Object.isFrozen(seed);
    const result = reusable ? seed : Array.isArray(item) ? [] : Object.create(prototype);
    seen.set(item, result);
    for (const key of Reflect.ownKeys(item)) {
      if (Array.isArray(item) && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
      if (!('value' in descriptor)) throw Error('DSP checkpoint contains an accessor');
      const target = Object.getOwnPropertyDescriptor(result, key);
      const cloned = copy(descriptor.value, target?.value);
      if (target?.writable && descriptor.writable && target.enumerable === descriptor.enumerable && target.configurable === descriptor.configurable)
        result[key] = cloned;
      else Object.defineProperty(result, key, {...descriptor, value: cloned});
    }
    if (Array.isArray(item)) result.length = item.length;
    return result;
  };
  return copy(value, initialized);
}
