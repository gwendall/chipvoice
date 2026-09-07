"use client";
import { useMemo, useState } from "react";
import type { PerformancePart } from "chipvoice";
import { useT } from "@/i18n/react";
const names = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
export default function PianoRoll({
  part,
  ticksPerBeat,
  startTick,
  positionTick,
  columns,
  onEdit,
}: {
  part: PerformancePart;
  ticksPerBeat: number;
  startTick: number;
  positionTick: number;
  columns: number;
  onEdit: (part: PerformancePart) => void;
}) {
  const t = useT(),
    drums = part.role === "perc";
  const [octave, setOctave] = useState(() =>
    Math.max(
      0,
      Math.min(
        8,
        Math.floor(
          (part.notes.length
            ? part.notes.reduce((sum, n) => sum + n.pitch, 0) /
              part.notes.length
            : 60) / 12,
        ) - 1,
      ),
    ),
  );
  const [length, setLength] = useState(1),
    [velocity, setVelocity] = useState(90);
  const low = octave * 12,
    step = ticksPerBeat / 4,
    endTick = startTick + step * columns;
  const rows = drums
    ? [42, 38, 36]
    : Array.from({ length: 25 }, (_, i) => Math.min(127, low + 24 - i));
  const cells = useMemo(() => {
    const result = new Set<string>();
    for (const note of part.notes) {
      if (note.tick >= endTick || note.endTick <= startTick) continue;
      const from = Math.max(0, Math.ceil((note.tick - startTick) / step));
      for (
        let column = from;
        column < columns && startTick + column * step < note.endTick;
        column++
      )
        result.add(`${Math.round(note.pitch)}:${column}`);
    }
    return result;
  }, [part.notes, startTick, endTick, step, columns]);
  const toggle = (pitch: number, column: number) => {
    const tick = Math.round(startTick + column * step),
      found = part.notes.find(
        (n) =>
          Math.round(n.pitch) === pitch && n.tick <= tick && n.endTick > tick,
      );
    onEdit({
      ...part,
      notes: found
        ? part.notes.filter((n) => n.id !== found.id)
        : [
            ...part.notes,
            {
              id: crypto.randomUUID(),
              tick,
              endTick: Math.max(
                tick + 1,
                Math.round(tick + step * length * (drums ? 0.7 : 1)),
              ),
              pitch,
              velocity,
              ...(drums ? { drum: pitch } : { program: 80 }),
            },
          ].sort((a, b) => a.tick - b.tick),
    });
  };
  return (
    <>
      <div className="part-tools note-tools">
        {!drums && (
          <label>
            {t("Pitch range")}
            <select
              aria-label={t("Pitch range")}
              value={octave}
              onChange={(e) => setOctave(Number(e.target.value))}
            >
              {Array.from({ length: 9 }, (_, n) => (
                <option key={n} value={n}>
                  C{n - 1}–C{n + 1}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          {t("Note length")}
          <select
            value={length}
            onChange={(e) => setLength(Number(e.target.value))}
          >
            {[1, 2, 4, 8, 16].map((n) => (
              <option key={n} value={n}>
                {n / 4} {t("beats")}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Velocity")}
          <input
            type="number"
            min={1}
            max={127}
            value={velocity}
            onChange={(e) =>
              setVelocity(
                Math.max(1, Math.min(127, Number(e.target.value) || 1)),
              )
            }
          />
        </label>
      </div>
      <div className="piano-scroll">
        <div
          className="piano-roll"
          role="group"
          aria-label={t("Edit notes")}
          style={{
            gridTemplateColumns: `38px repeat(${columns},minmax(0,1fr))`,
          }}
        >
          {rows.map((pitch) => (
            <div className="piano-row" key={pitch}>
              <span className="piano-key">
                {drums
                  ? t(pitch === 36 ? "Kick" : pitch === 38 ? "Snare" : "Hat")
                  : names[pitch % 12] + (Math.floor(pitch / 12) - 1)}
              </span>
              {Array.from({ length: columns }, (_, column) => {
                const tick = startTick + column * step,
                  note = cells.has(`${pitch}:${column}`),
                  current = positionTick >= tick && positionTick < tick + step;
                return (
                  <button
                    key={column}
                    className={`${note ? "note-on " : ""}${column % 4 === 0 ? "beat " : ""}${current ? "now" : ""}`}
                    aria-label={`${drums ? t(pitch === 36 ? "Kick" : pitch === 38 ? "Snare" : "Hat") : names[pitch % 12] + (Math.floor(pitch / 12) - 1)} · ${t("Step")} ${column + 1}`}
                    aria-pressed={!!note}
                    onClick={() => toggle(pitch, column)}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
