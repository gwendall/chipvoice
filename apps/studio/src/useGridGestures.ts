import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Zoom levels, in pixels per sixteenth.
 *
 * The smallest fits all 64 steps inside a phone (64 x 6 = 384) - too small to
 * read a token, which is the point: it is the overview. Tokens are hidden below
 * 14px rather than shrunk into illegibility.
 */
export const ZOOMS = [6, 12, 20, 34] as const;

/**
 * Where the zoom starts, by screen.
 *
 * A phone at the widest level shows nine steps out of sixty-four, which is a
 * keyhole: you cannot see the bar you are editing, let alone the pattern. It
 * opens at 12px there - twenty-six steps - and at 20px on a desktop, which
 * fits fifty-five and still leaves the tokens readable.
 */
export function defaultZoom(): number {
  if (typeof window === "undefined") return 2;
  return window.innerWidth < 720 ? 1 : 2;
}

/**
 * The gestures a timeline is expected to have.
 *
 * Pinch to zoom and swipe to scroll are what every DAW on a touch screen does,
 * and the research is blunt about custom gestures backfiring. On a desktop the
 * same two live on ctrl/cmd + wheel and ordinary scroll.
 */
export function useGridGestures(scroller: React.RefObject<HTMLDivElement | null>) {
  const [zoomIndex, setZoomIndex] = useState(defaultZoom);
  const pinch = useRef<{ start: number; index: number } | null>(null);
  const points = useRef(new Map<number, { x: number; y: number }>());

  const zoomBy = useCallback((delta: number) => {
    setZoomIndex((i) => Math.max(0, Math.min(ZOOMS.length - 1, i + delta)));
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;

    /**
     * Ctrl or cmd plus wheel is the zoom gesture the browser itself uses, and a
     * trackpad pinch arrives as exactly that event. Without preventDefault the
     * page zooms instead of the grid, which is the wrong thing entirely.
     */
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomBy(e.deltaY > 0 ? -1 : 1);
    };

    const down = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      points.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    };

    const move = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      if (!points.current.has(e.pointerId)) return;
      points.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (points.current.size !== 2) return;

      const [a, b] = [...points.current.values()];
      const spread = Math.hypot(a.x - b.x, a.y - b.y);
      if (!pinch.current) {
        pinch.current = { start: spread, index: zoomIndex };
        return;
      }
      // One zoom level per 60% change, so a pinch does not race through four
      // levels before a thumb has finished moving.
      const ratio = spread / pinch.current.start;
      const steps = Math.trunc(Math.log(ratio) / Math.log(1.6));
      if (steps !== 0) {
        setZoomIndex(
          Math.max(0, Math.min(ZOOMS.length - 1, pinch.current.index + steps)),
        );
      }
    };

    const up = (e: PointerEvent) => {
      points.current.delete(e.pointerId);
      if (points.current.size < 2) pinch.current = null;
    };

    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [scroller, zoomBy, zoomIndex]);

  return { zoom: ZOOMS[zoomIndex], zoomIndex, zoomBy, canZoomIn: zoomIndex < ZOOMS.length - 1, canZoomOut: zoomIndex > 0 };
}

/**
 * Keeps the playhead in view without fighting a hand that is scrolling.
 *
 * Follows only when the head has actually left the visible range, and stops
 * following for a moment after any manual scroll - otherwise the view snaps
 * back the instant somebody drags it somewhere else, which feels broken.
 */
export function useFollowPlayhead(
  scroller: React.RefObject<HTMLDivElement | null>,
  step: number,
  cell: number,
  labelWidth: number,
) {
  const manual = useRef(0);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const touched = () => { manual.current = performance.now(); };
    el.addEventListener("pointerdown", touched);
    el.addEventListener("wheel", touched, { passive: true });
    return () => {
      el.removeEventListener("pointerdown", touched);
      el.removeEventListener("wheel", touched);
    };
  }, [scroller]);

  useEffect(() => {
    const el = scroller.current;
    if (!el || step < 0) return;
    if (performance.now() - manual.current < 2500) return;

    const x = step * cell;
    const viewLeft = el.scrollLeft;
    const viewRight = viewLeft + el.clientWidth - labelWidth;
    if (x < viewLeft || x > viewRight - cell) {
      el.scrollTo({ left: Math.max(0, x - (el.clientWidth - labelWidth) / 3), behavior: "smooth" });
    }
  }, [scroller, step, cell, labelWidth]);
}
