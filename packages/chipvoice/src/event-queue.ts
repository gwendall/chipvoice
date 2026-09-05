import type { RegisterEvent, ScheduledEvent } from "./chip.js";

type Run = {
  events: (ScheduledEvent | undefined)[];
  head: number;
  sequence: number;
  owners: Set<string>;
};

/** One scheduler for live writes and captured register logs. Each incoming
 * batch becomes a sorted run; a heap merges only the heads of pending runs.
 * Already ordered logs take O(n) to enqueue, never an argument-list expansion.
 * No pending history is sorted/copied when another batch arrives. Consumption
 * releases its reference and takes O(log runs), O(1) for a single log.
 * Equal-cycle writes retain arrival order, including within select/data pairs.
 * Event records must not be mutated after scheduling; the input array may be
 * reused. Ownership belongs to this scheduler, never to the register decoder. */
export class EventQueue {
  private readonly runs: Run[] = [];
  private sequence = 0;
  private count = 0;
  /** Cached for the per-cycle fast path: no allocation or heap work if idle. */
  nextAt = Infinity;
  get size() { return this.count; }

  schedule(events: readonly RegisterEvent[], accepts?: (event: RegisterEvent) => boolean) {
    const copy: ScheduledEvent[] = [];
    const owners = new Set<string>();
    let ordered = true;
    let previous = -Infinity;
    for (const event of events as readonly ScheduledEvent[]) {
      if (accepts && !accepts(event)) continue;
      if (event.at < previous) ordered = false;
      previous = event.at;
      copy.push(event);
      if (event.owner !== undefined) owners.add(event.owner);
    }
    if (!copy.length) return;
    if (!ordered) copy.sort((a, b) => a.at - b.at);
    const run: Run = { events: copy, head: 0, sequence: this.sequence++, owners };
    this.count += copy.length;
    let i = this.runs.length;
    this.runs.push(run);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.before(run, this.runs[parent])) break;
      this.runs[i] = this.runs[parent];
      i = parent;
    }
    this.runs[i] = run;
    this.refresh();
  }

  /** Called only when nextAt is due. Returns the existing record, no copy. */
  take(): ScheduledEvent {
    const run = this.runs[0];
    const event = run.events[run.head]!;
    run.events[run.head++] = undefined; // do not retain consumed objects
    this.count--;
    if (run.head === run.events.length) {
      const last = this.runs.pop()!;
      if (this.runs.length) this.runs[0] = last;
    }
    if (this.runs.length > 1) this.down(0);
    this.refresh();
    return event;
  }

  cancel(owner: string, from: number) {
    let kept = 0;
    for (const run of this.runs) {
      if (run.owners.has(owner)) {
        let write = 0;
        run.owners.clear();
        for (let read = run.head; read < run.events.length; read++) {
          const event = run.events[read]!;
          if (event.owner === owner && event.at >= from) { this.count--; continue; }
          run.events[write++] = event;
          if (event.owner !== undefined) run.owners.add(event.owner);
        }
        run.events.length = write;
        run.head = 0;
      }
      if (run.head < run.events.length) this.runs[kept++] = run;
    }
    this.runs.length = kept;
    for (let i = (kept >> 1) - 1; i >= 0; i--) this.down(i);
    this.refresh();
  }

  clear() {
    this.runs.length = 0;
    this.count = 0;
    this.sequence = 0;
    this.nextAt = Infinity;
  }

  private before(a: Run, b: Run) {
    const at = a.events[a.head]!.at, bt = b.events[b.head]!.at;
    return at < bt || (at === bt && a.sequence < b.sequence);
  }
  private down(index: number) {
    const run = this.runs[index];
    while (index * 2 + 1 < this.runs.length) {
      let child = index * 2 + 1;
      if (child + 1 < this.runs.length && this.before(this.runs[child + 1], this.runs[child])) child++;
      if (!this.before(this.runs[child], run)) break;
      this.runs[index] = this.runs[child];
      index = child;
    }
    this.runs[index] = run;
  }
  private refresh() {
    this.nextAt = this.runs.length ? this.runs[0].events[this.runs[0].head]!.at : Infinity;
  }
}
