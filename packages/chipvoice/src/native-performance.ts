import type {PerformancePlan} from './performance.js';

/** Solo hardware voices without reallocating notes or disturbing bus timing.
 * Unselected voices still receive their original registers, with key-on/DAC
 * enable/volume masked. Shared latches and PSG tone 3's noise clock stay intact. */
export function isolateNativePerformance(plan: PerformancePlan, voices: string[]): PerformancePlan {
  const selected = new Set(voices);
  if (plan.chip === '2a03') {
    const bits: Record<string, number> = {p1: 1, p2: 2, tri: 4, noi: 8, dmc: 16};
    if (voices.some(v => !bits[v])) throw new Error('Unknown native NES voice');
    const mask = voices.reduce((m, v) => m | bits[v], 0);
    return {...plan, events: plan.events.map(e => e.addr === 0x4015 ? {...e, value: e.value & mask} : e)};
  }
  if (plan.chip !== 'md' || voices.some(v => !/^(fm[1-6]|psg[1-3]|noise)$/.test(v))) throw new Error('Unsupported native voices');
  let fmLatch = 0, psgLatch = 0;
  return {...plan, events: plan.events.map(e => {
    let value = e.value;
    if (e.addr === 0xa04000) fmLatch = value;
    else if (e.addr === 0xa04001) {
      if (fmLatch === 0x28) {
        const channel = (value & 3) + (value & 4 ? 3 : 0);
        if (!selected.has(`fm${channel + 1}`)) value &= 15;
      } else if (fmLatch === 0x2b && !selected.has('fm6')) value &= 0x7f;
      // CSM keys FM3 from timer A without a $28 write. Preserve the timer
      // and special-frequency mode, but suppress that unselected auto-trigger.
      else if (fmLatch === 0x27 && !selected.has('fm3')) value &= 0x7f;
    } else if (e.addr === 0xc00011) {
      if (value & 128) psgLatch = value >> 4 & 7;
      const channel = psgLatch >> 1;
      if ((psgLatch & 1) && !selected.has(channel === 3 ? 'noise' : `psg${channel + 1}`)) value |= 15;
    }
    return value === e.value ? e : {...e, value};
  })};
}
