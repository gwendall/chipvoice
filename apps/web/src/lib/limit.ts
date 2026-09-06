/**
 * A rate limit that costs nothing to run.
 *
 * In memory, per instance, which means it is leaky across a fleet - and that is
 * the right trade for now. The thing being protected is CPU on writes, and the
 * failure it has to prevent is one script filling the table, not a distributed
 * attack. A shared counter can arrive when there is something worth attacking.
 */
const WINDOW_MS = 60_000;
const CAPACITY = 5000;
const LIMITS = { anonymous: 20, key: 240, render: 6 } as const;
const seen = new Map<string, { start: number; count: number }>();

/** Fixed one-minute windows, with a hard bound on retained caller entries.
 * Saturation refuses new callers until an entry expires; it does not evict
 * active limits and let a busy client reset its quota. Per instance only. */
export function allow(key: string, tier: keyof typeof LIMITS = "anonymous"): { ok: true } | { ok: false; retryAfter: number } {
  const now = Date.now();
  let entry = seen.get(key);
  if (!entry || now - entry.start >= WINDOW_MS) {
    if (!entry && seen.size >= CAPACITY) {
      let earliest = now + WINDOW_MS;
      for (const [id, value] of seen) {
        if (now - value.start >= WINDOW_MS) seen.delete(id);
        else earliest = Math.min(earliest, value.start + WINDOW_MS);
      }
      if (seen.size >= CAPACITY) return { ok: false, retryAfter: Math.max(1, Math.ceil((earliest - now) / 1000)) };
    }
    entry = { start: now, count: 0 }; seen.set(key, entry);
  }
  if (entry.count >= LIMITS[tier]) return { ok: false, retryAfter: Math.max(1, Math.ceil((WINDOW_MS - now + entry.start) / 1000)) };
  entry.count++;
  return { ok: true };
}

/** Best-effort client identity: the proxy header, then the socket. */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}
