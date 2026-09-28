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
 */
export function SoundList({ sounds }: { sounds: Sound[] }) {
  const [selected, setSelected] = useState(0);
  const { play, playing } = usePlayer();
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
        setSelected((i) => Math.min(sounds.length - 1, i + 1));
      } else if (event.key === "k") {
        event.preventDefault();
        setSelected((i) => Math.max(0, i - 1));
      } else if (event.key === " ") {
        event.preventDefault();
        const variant = sound.variants[0];
        if (variant) void play(sound.id, { ogg: variant.files.ogg, mp3: variant.files.mp3 }, variant.n);
      } else if (event.key === "r") {
        event.preventDefault();
        const variant = sound.variants[Math.floor(Math.random() * sound.variants.length)];
        if (variant) void play(sound.id, { ogg: variant.files.ogg, mp3: variant.files.mp3 }, variant.n);
      } else if (event.key === "d") {
        event.preventDefault();
        window.location.href = `/api/v1/sounds/${sound.id}.zip`;
      } else if (/^[1-8]$/.test(event.key)) {
        const variant = sound.variants[Number(event.key) - 1];
        if (variant) {
          event.preventDefault();
          void play(sound.id, { ogg: variant.files.ogg, mp3: variant.files.mp3 }, variant.n);
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected, sounds, play]);

  useEffect(() => {
    rowRefs.current[selected]?.scrollIntoView({ block: "nearest" });
  }, [selected]);

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
          style={i === selected ? { outline: "2px solid var(--accent)", outlineOffset: "-1px" } : undefined}
          onMouseEnter={() => setSelected(i)}
        >
          <PlayButton sound={sound} />
          <div style={{ flex: "0 0 120px" }}>
            <Waveform peaks={sound.variants[0]?.peaks ?? []} />
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
                onClick={() => void play(sound.id, { ogg: variant.files.ogg, mp3: variant.files.mp3 }, variant.n)}
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  border: "1px solid var(--border)",
                  background: playing.soundId === sound.id && playing.variant === variant.n ? "var(--accent)" : "var(--bg-raised)",
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
