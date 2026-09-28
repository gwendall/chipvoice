/**
 * Drawn from the catalogue's precomputed peaks (spec: "before any audio
 * loads"), an SVG bar chart rather than canvas - no imperative draw loop, no
 * ref, and it still renders instantly and server-side.
 */
export function Waveform({ peaks, height = 32 }: { peaks: number[]; height?: number }) {
  if (peaks.length === 0) return null;
  const barWidth = 100 / peaks.length;
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: "100%", height }} aria-hidden="true">
      {peaks.map((p, i) => {
        const h = Math.max(4, p * 100);
        return <rect key={i} x={i * barWidth} y={(100 - h) / 2} width={Math.max(0.5, barWidth - 0.4)} height={h} fill="currentColor" opacity={0.6} />;
      })}
    </svg>
  );
}
