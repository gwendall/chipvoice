"use client";
import { useEffect, useRef, useState } from "react";
import { usePlayer } from "@/lib/player";

/**
 * Drawn from the catalogue's precomputed peaks (spec: "before any audio
 * loads"), an SVG bar chart rather than canvas - no imperative draw loop, no
 * ref, and it still renders instantly and server-side. When `soundId`/`variantN`
 * are given and that exact variant is the one currently sounding, a
 * playhead line rides over the bars, driven by the player's own
 * `AudioContext.currentTime` (never `Date.now()` - see lib/player.tsx's
 * header) via `requestAnimationFrame`, not a timer, so it never runs while
 * the tab is backgrounded.
 */
export function Waveform({
  peaks,
  height = 32,
  soundId,
  variantN,
}: {
  peaks: number[];
  height?: number;
  soundId?: string;
  variantN?: number;
}) {
  const { playing, now } = usePlayer();
  const isActive = soundId !== undefined && variantN !== undefined && playing.isPlaying && playing.soundId === soundId && playing.variant === variantN;
  const [progress, setProgress] = useState(0);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isActive || playing.startedAt === null || !playing.duration) {
      setProgress(0);
      return;
    }
    const startedAt = playing.startedAt;
    const duration = playing.duration;
    const tick = () => {
      const elapsed = now() - startedAt;
      setProgress(Math.min(1, Math.max(0, elapsed / duration)));
      if (elapsed < duration) frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [isActive, playing.startedAt, playing.duration, now]);

  if (peaks.length === 0) return null;
  const barWidth = 100 / peaks.length;
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      style={{ width: "100%", height }}
      aria-hidden="true"
      data-testid="waveform"
      data-playhead-progress={isActive ? progress.toFixed(3) : undefined}
    >
      {peaks.map((p, i) => {
        const h = Math.max(4, p * 100);
        return <rect key={i} x={i * barWidth} y={(100 - h) / 2} width={Math.max(0.5, barWidth - 0.4)} height={h} fill="currentColor" opacity={0.6} />;
      })}
      {isActive && <rect data-testid="playhead" x={Math.max(0, progress * 100 - 0.3)} y={0} width={0.6} height={100} fill="var(--accent)" />}
    </svg>
  );
}
