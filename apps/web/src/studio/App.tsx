"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Grid } from "./Grid";
import { Scope } from "./Scope";
import { useChip } from "./useChip";
import { paletteFor, DRUM_LABEL } from "./notes";
import { decode, encode } from "./share";
import {
  CHANNELS,
  CHANNEL_LABEL,
  CHANNEL_VOICE,
  STEPS,
  defaultTrack,
  type ChannelName,
  type Track,
} from "./song";

export default function App() {
  const [track, setTrack] = useState<Track>(defaultTrack);
  const [bpm, setBpm] = useState(152);
  const [selected, setSelected] = useState<ChannelName>("lead");
  const [brush, setBrush] = useState<Record<ChannelName, string>>({
    lead: "A4",
    chord: "A3",
    bass: "A1",
    perc: "K",
  });
  const [view, setView] = useState<"grid" | "text">("grid");
  const [muted, setMuted] = useState<Record<ChannelName, boolean>>({
    lead: false, chord: false, bass: false, perc: false,
  });
  const [note, setNote] = useState("");

  const chip = useChip();

  // Load a shared link once, before the first paint that matters.
  useEffect(() => {
    const raw = location.hash.slice(1);
    if (!raw) return;
    const loaded = decode(raw);
    // A truncated or hand-edited link falls back to the default song rather
    // than to an empty page and an error nobody can act on.
    if (loaded) {
      setTrack(loaded.track);
      setBpm(loaded.bpm);
    }
  }, []);

  // Editing while it plays restarts the piece with the change in it: the song
  // id carries the content, so `play` is a no-op until something changes.
  /**
   * What actually plays: the track with muted rows blanked.
   *
   * Mute is a view on the song rather than a flag inside the library, because
   * the library's job is to play what it is given. Blanking the tokens is also
   * what makes muting the chord the fastest way to hear what channel stealing
   * is doing - the row goes quiet and the gun has pulse 2 to itself.
   */
  const audible = useMemo(() => {
    const out = { ...track };
    for (const channel of CHANNELS) {
      if (muted[channel]) out[channel] = Array.from({ length: STEPS }, () => ".");
    }
    return out;
  }, [track, muted]);

  useEffect(() => {
    if (chip.playing) void chip.play(audible, bpm);
  }, [audible, bpm]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Space plays and stops, which every editor with a transport does. Skipped
   * while a text field has focus, or typing a song becomes impossible.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      if (e.code !== "Space") return;
      e.preventDefault();
      if (chip.playing) chip.stop();
      else void chip.play(audible, bpm);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chip, audible, bpm]);

  const paint = useCallback(
    (channel: ChannelName, index: number) => {
      setSelected(channel);
      setTrack((prev) => {
        const line = [...prev[channel]];
        // A cell cycles: empty, the brush, a cut, empty. Three states rather
        // than two because a cut is how a note is ended, and without it a held
        // note runs to the end of the bar with no way to stop it.
        const current = line[index];
        line[index] = current === "." ? brush[channel] : current === "=" ? "." : "=";
        if (line[index] !== "." && line[index] !== "=") {
          void chip.preview(CHANNEL_VOICE[channel], line[index]);
        }
        return { ...prev, [channel]: line };
      });
    },
    [brush, chip],
  );

  const share = useCallback(async () => {
    const hash = encode(track, bpm);
    history.replaceState(null, "", `#${hash}`);
    try {
      await navigator.clipboard.writeText(location.href);
      setNote("Link copied");
    } catch {
      setNote("The link is in the address bar");
    }
    setTimeout(() => setNote(""), 2400);
  }, [track, bpm]);

  const clear = useCallback(() => {
    setTrack((prev) => ({ ...prev, [selected]: Array.from({ length: STEPS }, () => ".") }));
  }, [selected]);

  const palette = useMemo(() => paletteFor(selected), [selected]);

  return (
    <div className="page">
      <header className="head">
        <div className="head-inner">
          <h1>
            chip<span>voice</span>
          </h1>
          <p>
            A real NES sound chip in a browser tab. Press <b>Fire</b> while it
            plays: the shot takes pulse&nbsp;2, and you watch the chord row go
            dark. No other library does that, because no other one emulates the
            chip.
          </p>
        </div>
      </header>

      <main className="work">
        <div className="tabs" role="tablist" aria-label="Editor view">
          <button
            role="tab"
            aria-selected={view === "grid"}
            className={view === "grid" ? "on" : ""}
            onClick={() => setView("grid")}
          >
            Grid
          </button>
          <button
            role="tab"
            aria-selected={view === "text"}
            className={view === "text" ? "on" : ""}
            onClick={() => setView("text")}
          >
            Text
          </button>
          <span className="note">{note || (chip.unsupported ? "No AudioWorklet here" : "")}</span>
        </div>

        {view === "grid" ? (
          <>
            <Grid
              track={track}
              step={chip.step}
              stolenVoice={chip.stolen}
              selected={selected}
              muted={muted}
              onPaint={paint}
              onSelect={setSelected}
              onToggleMute={(c) => setMuted((m) => ({ ...m, [c]: !m[c] }))}
            />

            <div className="palette">
              <div className="palette-head">
                <span>{CHANNEL_LABEL[selected]}</span>
                <button type="button" className="ghost" onClick={clear}>
                  Clear row
                </button>
              </div>
              <div className="palette-keys">
                {palette.map((token) => (
                  <button
                    key={token}
                    type="button"
                    className={brush[selected] === token ? "key on" : "key"}
                    onClick={() => {
                      setBrush((b) => ({ ...b, [selected]: token }));
                      void chip.preview(CHANNEL_VOICE[selected], token);
                    }}
                  >
                    {selected === "perc" ? DRUM_LABEL[token] : token}
                  </button>
                ))}
              </div>
              <p className="hint">
                Tap a cell to place <b>{selected === "perc" ? DRUM_LABEL[brush.perc] : brush[selected]}</b>,
                tap again for a cut, again to clear. Drag to paint a run.
              </p>
            </div>

            <Scope node={chip.output} />
          </>
        ) : (
          <div className="text-view">
            <p className="hint">
              This is the format the library takes. One token per sixteenth, a
              note name, <code>.</code> to hold, <code>=</code> to cut. It is
              text on purpose: a song is a file you can read, diff and paste.
            </p>
            {CHANNELS.map((channel) => (
              <label key={channel}>
                <span>
                  {CHANNEL_LABEL[channel]} · {CHANNEL_VOICE[channel]}
                </span>
                <textarea
                  rows={3}
                  spellCheck={false}
                  value={track[channel].join(" ")}
                  onChange={(e) => {
                    const tokens = e.target.value.trim().split(/\s+/).filter(Boolean);
                    setTrack((prev) => ({
                      ...prev,
                      [channel]: Array.from({ length: STEPS }, (_, i) => tokens[i] ?? "."),
                    }));
                  }}
                />
              </label>
            ))}
          </div>
        )}
      </main>

      <footer className="transport">
        <button
          type="button"
          className="primary"
          onClick={() => (chip.playing ? chip.stop() : void chip.play(audible, bpm))}
        >
          {chip.playing ? "Stop" : "Play"}
        </button>
        <button type="button" className="fire" onClick={() => void chip.fire()}>
          Fire
        </button>
        <label className="bpm">
          <span>{bpm}</span>
          <input
            type="range"
            min={80}
            max={220}
            value={bpm}
            onChange={(e) => setBpm(Number(e.target.value))}
            aria-label="Tempo"
          />
        </label>
        <button type="button" onClick={() => void share()}>
          Copy link
        </button>
        <a className="repo" href="https://github.com/gwendall/chipvoice">
          npm i chipvoice
        </a>
      </footer>
    </div>
  );
}
