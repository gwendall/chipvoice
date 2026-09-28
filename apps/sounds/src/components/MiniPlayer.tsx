"use client";
import { usePlayer } from "@/lib/player";

/**
 * A sticky strip naming whatever last played: title, variant, licence and a
 * source link (spec). Stays mounted (not unmounted on stop) once something
 * has played, so it does not flicker away between two quick taps - `playing.sound`
 * is only ever replaced by a newer one, never nulled, see lib/player.tsx.
 * `data-active-voices` is the observable proof the spam guard (choking a
 * sound's previous voice) keeps the live voice count from growing under a
 * held key - test-smoke.mjs reads it directly.
 */
export function MiniPlayer() {
  const { playing, activeVoiceCount } = usePlayer();
  if (!playing.sound) return null;
  const { sound } = playing;

  return (
    <div
      className="row"
      data-testid="mini-player"
      data-sound-id={sound.id}
      data-variant={playing.variant ?? ""}
      data-playing={playing.isPlaying ? "true" : "false"}
      data-active-voices={activeVoiceCount}
      style={{
        position: "sticky",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 10,
        gap: 16,
        padding: "10px 24px",
        borderTop: "1px solid var(--border)",
        background: "var(--bg-raised)",
      }}
    >
      <span style={{ fontWeight: 600 }}>{sound.title}</span>
      <span className="muted" style={{ fontSize: "0.85em" }}>
        variant {playing.variant}
      </span>
      <span className="badge">{sound.license}</span>
      {sound.source.url ? (
        <a href={sound.source.url} className="muted" style={{ fontSize: "0.85em" }} data-testid="mini-player-source">
          {sound.source.name}
        </a>
      ) : (
        <span className="muted" style={{ fontSize: "0.85em" }} data-testid="mini-player-source">
          {sound.source.name}
        </span>
      )}
    </div>
  );
}
