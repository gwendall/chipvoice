/**
 * A rate limit that costs nothing to run.
 *
 * In memory, per instance, which means it is leaky across a fleet - and that is
 * the right trade for now. The thing being protected is CPU on writes, and the
 * failure it has to prevent is one script filling the table, not a distributed
 * attack. A shared counter can arrive when there is something worth attacking.
 */
const seen = new Map<string, number[]>();
const WINDOW_MS = 60_000;

/**
 * Two ceilings.
 *
 * The anonymous one is sized for a person clicking save. The identified one is
 * sized for an agent exploring - which is the actual use, and the reason a key
 * is worth having at all when nothing here needs protecting from writes.
 */
const LIMITS = { anonymous: 20, key: 240 } as const;

export function allow(
  key: string,
  tier: keyof typeof LIMITS = "anonymous",
): { ok: true } | { ok: false; retryAfter: number } {
  const now = Date.now();
  const hits = (seen.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= LIMITS[tier]) {
    const oldest = hits[0];
    return { ok: false, retryAfter: Math.ceil((WINDOW_MS - (now - oldest)) / 1000) };
  }
  hits.push(now);
  seen.set(key, hits);

  // Keep the map from growing for the life of the instance.
  if (seen.size > 5000) {
    for (const [k, v] of seen) {
      if (v.every((t) => now - t >= WINDOW_MS)) seen.delete(k);
    }
  }
  return { ok: true };
}

/** Best-effort client identity: the proxy header, then the socket. */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}
