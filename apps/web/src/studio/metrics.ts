/** Session-only counters: no IDs, score content, storage or network requests. */
const counts: Record<string, number> = {};
export function measure(event: 'sound' | 'play' | 'switch' | 'preset' | 'effect' | 'edit' | 'share' | 'record') {
  counts[event] = (counts[event] ?? 0) + 1;
  if (typeof window !== 'undefined') {
    if (event === 'sound' && counts.firstSoundMs === undefined) counts.firstSoundMs = Math.round(performance.now());
    (window as unknown as { chipvoiceMetrics: object }).chipvoiceMetrics = { ...counts };
  }
}
