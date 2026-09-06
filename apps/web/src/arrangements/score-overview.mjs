/** A lightweight, read-only projection. Fractions use elapsed source time,
 * including tempo changes, so tempo scaling preserves musical position. */
export function scoreOverview(score, secondsAt, losses=[]) {
  const omitted=new Set(losses.filter(l=>l.kind==='voice-omitted').map(l=>`${l.part}:${l.note}`));
  const seconds = secondsAt(score.endTick);
  return {seconds, loopStart: secondsAt(score.loopStartTick ?? 0) / seconds,
    parts: score.parts.filter(p => p.notes.length).map(p => ({id:p.id, name:p.name, role:p.role,
      notes:p.notes.filter(n=>!omitted.has(`${p.id}:${n.id}`)).sort((a,b)=>a.tick-b.tick).map(n => [secondsAt(n.tick)/seconds, secondsAt(n.endTick)/seconds, n.pitch])}))};
}
