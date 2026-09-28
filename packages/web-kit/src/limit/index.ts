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
const seen = new Map<string, { start: number; count: number }>();

/** Fixed one-minute windows, with a hard bound on retained caller entries.
 * Saturation refuses new callers until an entry expires; it does not evict
 * active limits and let a busy client reset its quota. Per instance only.
 * `limits` maps a tier name to its per-minute budget; callers choose their
 * own tier vocabulary (chipvoice uses "anonymous" | "key" | "render"). */
export function allow<T extends Record<string, number>>(
  key: string,
  tier: keyof T,
  limits: T,
): { ok: true } | { ok: false; retryAfter: number } {
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
  if (entry.count >= limits[tier]) return { ok: false, retryAfter: Math.max(1, Math.ceil((WINDOW_MS - now + entry.start) / 1000)) };
  entry.count++;
  return { ok: true };
}

/** Best-effort client identity: the proxy-set header, then the edge of the
 * forwarded chain, then the socket. `x-forwarded-for` is a list a client can
 * prepend to freely; only the entry the last trusted proxy appended (the
 * rightmost one) is ours, and Vercel gives that to us directly as
 * `x-real-ip`. Trusting the leftmost entry let a caller behind our own proxy
 * pick its own rate-limit bucket. */
export function clientKey(request: Request): string {
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length) return parts[parts.length - 1]!;
  }
  return "unknown";
}
