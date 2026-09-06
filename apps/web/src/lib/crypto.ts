const ALPHABET = "0123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";

/** A longer random string, for things that are secrets rather than names. */
export function secret(bytes = 24): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return [...raw].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * What gets stored instead of a key.
 *
 * SHA-256 with no salt on purpose: these are 48 hex characters of CSPRNG
 * output, so there is no dictionary to defend against, and a deterministic
 * hash is what lets a lookup happen in one indexed query rather than by
 * comparing against every row.
 */
export async function hashKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Eight characters of base62, minus the glyphs that look like each other.
 *
 * These end up read aloud, typed from a screenshot and pasted into chat, so
 * `l`, `I`, `O` and `1` being distinguishable is worth more than the handful of
 * extra combinations they would add.
 */
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let out = "";
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return out;
}
