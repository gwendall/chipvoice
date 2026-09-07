import type { Performance, PerformanceNote } from "./performance.js";
import { validatePerformance } from "./performance.js";
/** Append an explicitly chosen section. Clip crossing notes and preserve the
 * controller values held at the cut, then shift exact ticks without quantizing. */
export function repeatPerformanceSection(
  source: Performance,
  start: number,
  end: number,
): Performance {
  validatePerformance(source);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end <= start ||
    end > source.endTick
  )
    throw new RangeError("Invalid section range");
  const offset = source.endTick - start;
  const parts = source.parts.map((part) => {
    const added: PerformanceNote[] = [];
    const ids = new Set(part.notes.map((note) => note.id));
    for (const note of part.notes) {
      if (note.endTick <= start || note.tick >= end) continue;
      const clippedStart = Math.max(note.tick, start),
        clippedEnd = Math.min(note.endTick, end);
      const expression: NonNullable<PerformanceNote["expression"]> = [];
      if (note.expression) {
        const held: NonNullable<PerformanceNote["expression"]>[number] = {
          tick: clippedStart + offset,
        };
        for (const point of note.expression) {
          if (point.tick > clippedStart) break;
          Object.assign(held, point, { tick: clippedStart + offset });
        }
        if (Object.keys(held).length > 1) expression.push(held);
        for (const point of note.expression)
          if (point.tick > clippedStart && point.tick < clippedEnd)
            expression.push({ ...point, tick: point.tick + offset });
      }
      let id = `${note.id}:repeat:${source.endTick}`;
      while (ids.has(id)) id += "r";
      ids.add(id);
      added.push({
        ...note,
        id,
        tick: clippedStart + offset,
        endTick: clippedEnd + offset,
        ...(note.expression ? { expression } : {}),
      });
    }
    return { ...part, notes: [...part.notes, ...added] };
  });
  const heldTempo = source.tempos.filter((p) => p.tick <= start).at(-1)!;
  const tempos = [
    ...source.tempos,
    { ...heldTempo, tick: source.endTick },
    ...source.tempos
      .filter((p) => p.tick > start && p.tick < end)
      .map((p) => ({ ...p, tick: p.tick + offset })),
  ];
  const result = {
    ...source,
    parts,
    tempos,
    endTick: source.endTick + end - start,
  };
  validatePerformance(result);
  return result;
}
