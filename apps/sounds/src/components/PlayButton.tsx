"use client";
import { usePlayer } from "@/lib/player";
import type { Sound } from "@/lib/catalog";

/**
 * One button, one variant. `data-testid="play-button"` and
 * `data-playing="true"` while its own variant is the one sounding are the
 * hooks the Playwright smoke test uses to prove a click actually starts an
 * AudioBufferSourceNode, not just a UI state flip.
 */
export function PlayButton({ sound, variantIndex = 0, label = "Play" }: { sound: Sound; variantIndex?: number; label?: string }) {
  const { playing, play } = usePlayer();
  const variant = sound.variants[variantIndex];
  if (!variant) return null;
  const isPlaying = playing.isPlaying && playing.soundId === sound.id && playing.variant === variant.n;

  return (
    <button
      type="button"
      className="button"
      data-testid="play-button"
      data-playing={isPlaying ? "true" : "false"}
      aria-pressed={isPlaying}
      aria-label={`${label} ${sound.title}`}
      onClick={() => void play(sound, variant)}
    >
      {isPlaying ? "Playing" : label}
    </button>
  );
}
