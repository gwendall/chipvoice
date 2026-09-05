/** Hardware bus FIFO: bounded by peak backlog, O(1) dequeue without shifting
 * pending writes. Growth is amortized; consumed objects are released at once. */
export class Fifo<T> {
  private slots: (T | undefined)[] = new Array(16);
  private head = 0;
  private count = 0;
  get size() { return this.count; }
  push(value: T) {
    if (this.count === this.slots.length) {
      const grown: (T | undefined)[] = new Array(this.slots.length * 2);
      for (let i = 0; i < this.count; i++) grown[i] = this.slots[(this.head + i) % this.slots.length];
      this.slots = grown;
      this.head = 0;
    }
    this.slots[(this.head + this.count++) % this.slots.length] = value;
  }
  take(): T | undefined {
    if (!this.count) return undefined;
    const value = this.slots[this.head];
    this.slots[this.head] = undefined;
    this.head = (this.head + 1) % this.slots.length;
    this.count--;
    return value;
  }
  clear() { this.slots = new Array(16); this.head = 0; this.count = 0; }
}
