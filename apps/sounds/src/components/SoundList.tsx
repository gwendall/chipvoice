"use client";
import { useEffect, useRef, useState } from "react";
import Link from "@/i18n/react";
import type { Sound } from "@/lib/catalog";
import { usePlayer } from "@/lib/player";
import { PlayButton } from "./PlayButton";
import { CopyForAgent } from "./CopyForAgent";
import { Waveform } from "./Waveform";

/**
 * A keyboard-first result list (spec: `j`/`k` move, `space` play, `1`-`8`
 * variant, `r` random variant, `d` download). One row is "selected"
 * (`data-selected="true"`, used by the Playwright smoke test and by sighted
 * keyboard users as the focus ring) regardless of DOM focus, since a list
 * this long should not need a fresh Tab press per row to keep navigating.
 * `v` (vote) is not bound: Phase 1 has no accounts to vote with (spec
 * phase table), and a button with nothing behind it is worse than no
 * button.
 *
 * Preloading (spec: "preload on visibility and on hover/selection"): every
 * row observes its own visibility (one shared IntersectionObserver, not one
 * per row) and calls `preload()` once it enters the viewport; hovering or
 * moving keyboard selection onto a row preloads it too. `preload()` itself
 * bounds concurrency (lib/player.tsx), so this never opens unbounded
 * parallel decode work no matter how many rows scroll into view at once.
 * `data-preload-state` on each row is the observable proof (test-smoke.mjs).
 */
export function SoundList({ sounds }: { sounds: Sound[] }) {
  const [selected, setSelected] = useState(0);
  const { play, playing, preload, isReady } = usePlayer();
  const rowRefs = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (sounds.length === 0) return;
      const sound = sounds[Math.min(selected, sounds.length - 1)];
      if (!sound) return;

      if (event.key === "j") {
        event.preventDefault();
        setSelected((i) => {
          const next = Math.min(sounds.length - 1, i + 1);
          const nextSound = sounds[next];
          if (nextSound) preload(nextSound);
          return next;
        });
      } else if (event.key === "k") {
        event.preventDefault();
        setSelected((i) => {
          const next = Math.max(0, i - 1);
          const nextSound = sounds[next];
          if (nextSound) preload(nextSound);
          return next;
        });
      } else if (event.key === " ") {
        event.preventDefault();
        const variant = sound.variants[0];
        if (variant) void play(sound, variant);
      } else if (event.key === "r") {
        event.preventDefault();
        const variant = sound.variants[Math.floor(Math.random() * sound.variants.length)];
        if (variant) void play(sound, variant);
      } else if (event.key === "d") {
        event.preventDefault();
        window.location.href = `/api/v1/sounds/${sound.id}.zip`;
      } else if (/^[1-8]$/.test(event.key)) {
        const variant = sound.variants[Number(event.key) - 1];
        if (variant) {
          event.preventDefault();
          void play(sound, variant);
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected, sounds, play, preload]);

  useEffect(() => {
    rowRefs.current[selected]?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  // One shared observer for every row: visibility alone preloads a row's
  // first variant, bounded by lib/player.tsx's own decode concurrency cap,
  // not by how many rows this observer reports at once.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const bySound = new Map(rowRefs.current.map((el, i) => [el, sounds[i]] as const));
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const sound = bySound.get(entry.target as HTMLLIElement);
          if (sound) preload(sound);
        }
      },
      { rootMargin: "200px 0px" },
    );
    for (const el of rowRefs.current) if (el) observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sounds, preload]);

  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }} data-testid="sound-list">
      {sounds.map((sound, i) => (
        <li
          key={sound.id}
          ref={(el) => {
            rowRefs.current[i] = el;
          }}
          className="row"
          data-testid="sound-row"
          data-sound-id={sound.id}
          data-selected={i === selected ? "true" : "false"}
          data-preload-state={isReady(sound) ? "ready" : "idle"}
          style={i === selected ? { outline: "2px solid var(--accent)", outlineOffset: "-1px" } : undefined}
          onMouseEnter={() => {
            setSelected(i);
            preload(sound);
          }}
        >
          <PlayButton sound={sound} />
          <div style={{ flex: "0 0 120px" }}>
            <Waveform peaks={sound.variants[0]?.peaks ?? []} soundId={sound.id} variantN={sound.variants[0]?.n} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Link href={`/s/${sound.id}`} style={{ fontWeight: 600, textDecoration: "none" }}>
              {sound.title}
            </Link>
            <div className="muted" style={{ fontSize: "0.85em" }}>
              {sound.category}
            </div>
          </div>
          <div className="row" style={{ gap: 4 }} aria-label={`${sound.variants.length} variants`} data-testid="variant-dots">
            {sound.variants.map((variant) => (
              <button
                key={variant.n}
                type="button"
                aria-label={`Play variant ${variant.n}`}
                title={`Variant ${variant.n}`}
                onClick={() => void play(sound, variant)}
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  border: "1px solid var(--border)",
                  background: playing.isPlaying && playing.soundId === sound.id && playing.variant === variant.n ? "var(--accent)" : "var(--bg-raised)",
                  padding: 0,
                  cursor: "pointer",
                }}
              />
            ))}
          </div>
          <span className="badge">{sound.style}</span>
          <span className="badge">{sound.license}</span>
          <span className="muted" style={{ fontSize: "0.85em" }}>
            {sound.measure.duration.toFixed(2)}s
          </span>
          <span className="muted" style={{ fontSize: "0.85em" }}>
            {sound.rank.votes} vote{sound.rank.votes === 1 ? "" : "s"}
          </span>
          <a className="button" href={`/api/v1/sounds/${sound.id}.zip`} data-testid="download-button">
            Download
          </a>
          <CopyForAgent command={`npx gamesounds add ${sound.category} --style ${sound.style}`} />
        </li>
      ))}
    </ul>
  );
}
