"use client";

import { useEffect, useRef } from "react";

/**
 * An oscilloscope on the chip's output.
 *
 * Every audio tool has one, and here it earns its place twice over: it is the
 * proof that this is a chip rather than a synthesiser. Web Audio's oscillators
 * are band-limited, so their squares arrive with rounded corners and ringing;
 * the 2A03 outputs a raw square with every harmonic intact, and the difference
 * is visible before it is audible.
 *
 * Drawn on a canvas rather than as SVG: sixty frames a second of a 2048-point
 * path is exactly what canvas is for.
 */
export function Scope({ node }: { node: AudioNode | null }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el || !node) return;

    const ctx2d = el.getContext("2d");
    if (!ctx2d) return;

    const analyser = node.context.createAnalyser();
    analyser.fftSize = 2048;
    node.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);

    let raf = 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const draw = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (el.width !== w * dpr || el.height !== h * dpr) {
        el.width = w * dpr;
        el.height = h * dpr;
      }
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx2d.clearRect(0, 0, w, h);

      analyser.getFloatTimeDomainData(buf);

      // Centre line, so silence reads as a flat trace rather than as nothing.
      ctx2d.strokeStyle = "#242b38";
      ctx2d.lineWidth = 1;
      ctx2d.beginPath();
      ctx2d.moveTo(0, h / 2);
      ctx2d.lineTo(w, h / 2);
      ctx2d.stroke();

      // Trigger on the first rising zero crossing, the way a scope does, or the
      // waveform slides sideways every frame and reads as noise.
      let start = 0;
      for (let i = 1; i < buf.length / 2; i++) {
        if (buf[i - 1] <= 0 && buf[i] > 0) { start = i; break; }
      }

      // Three milliseconds, which is one or two cycles of a lead note. Wider
      // and the square steps average into a fuzzy line - and the steps are the
      // one thing this is here to show, since a band-limited oscillator has
      // none at all.
      const span = Math.min(buf.length - start, 150);

      // Normalised to the window, with a floor so silence stays flat instead of
      // amplifying its own noise into a waveform.
      let peak = 0;
      for (let i = 0; i < span; i++) peak = Math.max(peak, Math.abs(buf[start + i]));
      const scale = peak > 0.02 ? 0.92 / peak : 0;
      ctx2d.strokeStyle = "#e8973a";
      ctx2d.lineWidth = 1.5;
      ctx2d.lineJoin = "round";
      ctx2d.beginPath();
      for (let i = 0; i < span; i++) {
        const x = (i / span) * w;
        const y = h / 2 - buf[start + i] * scale * (h / 2);
        if (i === 0) ctx2d.moveTo(x, y);
        else ctx2d.lineTo(x, y);
      }
      ctx2d.stroke();

      raf = requestAnimationFrame(draw);
    };

    // Reduced motion still gets a trace, just a calm one: a flat line would
    // hide the one thing this element is here to show.
    if (reduced) {
      const slow = () => { draw(); cancelAnimationFrame(raf); raf = window.setTimeout(slow, 200) as unknown as number; };
      slow();
      return () => { clearTimeout(raf); try { node.disconnect(analyser); } catch { /* already disconnected: the chip that owned the node was disposed of first */ } };
    }

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      try { node.disconnect(analyser); } catch { /* already disconnected: the chip that owned the node was disposed of first */ }
    };
  }, [node]);

  return (
    <div className="scope">
      <span className="scope-label">Output</span>
      <canvas ref={canvas} aria-hidden="true" />
    </div>
  );
}
