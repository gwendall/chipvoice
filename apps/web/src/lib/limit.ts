import { allow as sharedAllow, clientKey } from "web-kit/limit";

const LIMITS = { anonymous: 20, key: 240, render: 6 } as const;

/** chipvoice's own tier budgets, bound once against `web-kit/limit`'s
 * generic in-memory limiter so every call site here keeps its original
 * two-argument shape. */
export function allow(
  key: string,
  tier: keyof typeof LIMITS = "anonymous",
): { ok: true } | { ok: false; retryAfter: number } {
  return sharedAllow(key, tier, LIMITS);
}

export { clientKey };
