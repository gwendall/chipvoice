"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CHANNELS,
  CHANNEL_LABEL,
  CHANNEL_VOICE,
  STEPS,
  type ChannelName,
  type Track,
} from "./song";
import { cellKind } from "./notes";
import { PHONE_WIDTH, useFollowPlayhead, useGridGestures } from "./useGridGestures";

/**
 * The gutter, narrower on a phone where 64 steps and a wide one do not both
 * fit. Measured after mounting rather than during render: the server has no
 * window, so deciding here would send different markup than the phone builds.
 */
const WIDE_LABEL = 92;
const NARROW_LABEL = 74;

/**
 * The tracker, laid flat: one row per channel, one column per sixteenth.
 *
 * The library's data shape rendered directly - a token is a cell, with nothing
 * in between that could disagree with what is heard. A piano roll would need a
 * row per pitch, which is fifty-six rows for four channels and unreadable on a
 * phone.
 */
export function Grid({
  track,
  step,
  stolenVoice,
  selected,
  muted,
  onPaint,
  onSelect,
  onToggleMute,
}: {
  track: Track;
  step: number;
  stolenVoice: string | null;
  selected: ChannelName;
  muted: Record<ChannelName, boolean>;
  onPaint: (channel: ChannelName, index: number) => void;
  onSelect: (channel: ChannelName) => void;
  onToggleMute: (channel: ChannelName) => void;
}) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const [labelWidth, setLabelWidth] = useState(WIDE_LABEL);

  useEffect(() => {
    if (window.innerWidth < PHONE_WIDTH) setLabelWidth(NARROW_LABEL);
  }, []);
  const { zoom, zoomBy, canZoomIn, canZoomOut } = useGridGestures(scroller);
  useFollowPlayhead(scroller, step, zoom, labelWidth);

  /**
   * Drag to paint, on a mouse only.
   *
   * A finger dragging across a timeline means scroll - that is the gesture
   * every DAW on a touch screen uses, and taking it for painting would leave a
   * grid nobody can move. So touch taps one cell at a time and drags the view;
   * a mouse, which has a scrollbar and a wheel, paints.
   */
  const painting = useRef<{ channel: ChannelName; last: number } | null>(null);

  const down = useCallback(
    (channel: ChannelName, index: number) => (e: React.PointerEvent) => {
      onPaint(channel, index);
      if (e.pointerType !== "mouse") return;
      painting.current = { channel, last: index };
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    },
    [onPaint],
  );

  const enter = useCallback(
    (channel: ChannelName, index: number) => (e: React.PointerEvent) => {
      const drag = painting.current;
      if (!drag || e.pointerType !== "mouse" || e.buttons === 0) return;
      // Stay on the row the drag started on. Sliding into another channel and
      // silently painting it is the kind of edit nobody notices making.
      if (drag.channel !== channel || drag.last === index) return;
      drag.last = index;
      onPaint(channel, index);
    },
    [onPaint],
  );

  const endPaint = useCallback(() => {
    painting.current = null;
  }, []);

  const zoomedOut = zoom < 14;

  return (
    <div className="grid-shell">
      <div className="grid-tools">
        <span className="grid-hint">
          {zoomedOut ? "Overview" : "Tap a cell to place a note"}
        </span>
        <div className="zoom">
          <button type="button" onClick={() => zoomBy(-1)} disabled={!canZoomOut} aria-label="Zoom out">
            &minus;
          </button>
          <button type="button" onClick={() => zoomBy(1)} disabled={!canZoomIn} aria-label="Zoom in">
            +
          </button>
        </div>
      </div>

      <div
        className={`grid ${zoomedOut ? "dense" : ""}`}
        ref={scroller}
        style={{ ["--cell" as string]: `${zoom}px`, ["--label" as string]: `${labelWidth}px` }}
        onPointerUp={endPaint}
        onPointerLeave={endPaint}
      >
        <div className="grid-rows">
          {CHANNELS.map((channel) => {
            const voice = CHANNEL_VOICE[channel];
            const taken = stolenVoice === voice;
            return (
              <div
                key={channel}
                className={[
                  "row",
                  channel === selected ? "on" : "",
                  taken ? "taken" : "",
                  muted[channel] ? "muted" : "",
                ].join(" ")}
              >
                <div className="row-label">
                  <button
                    type="button"
                    className="row-pick"
                    onClick={() => onSelect(channel)}
                    aria-pressed={channel === selected}
                  >
                    <span className="row-name">{CHANNEL_LABEL[channel]}</span>
                    <span className="row-voice">{taken ? "taken" : voice}</span>
                  </button>
                  <button
                    type="button"
                    className={`row-mute ${muted[channel] ? "on" : ""}`}
                    onClick={() => onToggleMute(channel)}
                    aria-pressed={muted[channel]}
                    aria-label={`Mute ${CHANNEL_LABEL[channel]}`}
                    title="Mute"
                  >
                    M
                  </button>
                </div>
                <div className="row-cells">
                  {track[channel].map((token, i) => {
                    const kind = cellKind(token);
                    return (
                      <button
                        key={i}
                        type="button"
                        className={[
                          "cell",
                          kind,
                          i === step ? "at" : "",
                          i % 16 === 0 ? "bar" : "",
                          i % 4 === 0 ? "beat" : "",
                        ].join(" ")}
                        onPointerDown={down(channel, i)}
                        onPointerEnter={enter(channel, i)}
                        aria-label={`${CHANNEL_LABEL[channel]} step ${i + 1}: ${token}`}
                      >
                        {zoomedOut ? "" : kind === "note" ? token : kind === "cut" ? "=" : ""}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="grid-ruler" aria-hidden="true">
          <span className="row-label" />
          <div className="row-cells">
            {Array.from({ length: STEPS }, (_, i) => (
              <span key={i} className={`tick ${i % 16 === 0 ? "bar" : ""} ${i === step ? "at" : ""}`}>
                {i % 16 === 0 && !zoomedOut ? i / 16 + 1 : ""}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
