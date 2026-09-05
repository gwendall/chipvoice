import type { ChipCore, RegisterEvent, ScheduledEvent } from "./chip.js";

/** Own the future outside the silicon. Only one render block enters the core
 * at a time; cancellation removes whole owned write sequences, never addresses.
 * This also keeps register-select/data pairs together when a voice is stolen. */
export class TransportCore implements ChipCore {
  private pending: ScheduledEvent[] = [];
  constructor(private readonly core: ChipCore, private readonly clockHz: number, private readonly sampleRate: number) {}
  /** Diagnostic access retained for hosts inspecting the digital chip. */
  get chip() { return (this.core as ChipCore & { chip: unknown }).chip; }
  schedule(events: RegisterEvent[]) {
    this.pending.push(...events);
    this.pending.sort((a, b) => a.at - b.at);
  }
  cancel(owner: string, from: number) {
    this.pending = this.pending.filter(e => e.owner !== owner || e.at < from);
  }
  render(left: Float32Array, right: Float32Array | null, startSample: number) {
    const end = (startSample + left.length) * this.clockHz / this.sampleRate;
    let n = 0;
    while (n < this.pending.length && this.pending[n].at < end) n++;
    if (n) this.core.schedule(this.pending.splice(0, n).map(({ at, addr, value }) => ({ at, addr, value })));
    this.core.render(left, right, startSample);
  }
  load(address: number, bytes: Uint8Array) { this.core.load(address, bytes); }
  setGain(value: number) { this.core.setGain(value); }
  reset() { this.pending = []; this.core.reset(); }
}
