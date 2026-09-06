/** One audio-clock envelope, shared by live engines and decoded recordings.
 * Store the scheduled ramp so interruptions work without cancelAndHoldAtTime. */
export class Fade {
  constructor(context, destination, value = 0) {
    this.context = context;
    this.node = context.createGain();
    this.node.gain.value = value;
    this.node.connect(destination);
    this.from = this.to = value;
    this.start = this.end = context.currentTime;
  }
  valueAt(time) {
    if (time >= this.end) return this.to;
    if (time <= this.start) return this.from;
    return this.from + (this.to - this.from) * (time - this.start) / (this.end - this.start);
  }
  toValue(value, at = this.context.currentTime, seconds = .06) {
    const current = this.valueAt(at);
    this.node.gain.cancelScheduledValues(at);
    this.node.gain.setValueAtTime(current, at);
    this.node.gain.linearRampToValueAtTime(value, at + seconds);
    this.from = current; this.to = value; this.start = at; this.end = at + seconds;
  }
  disconnect() { this.node.disconnect(); }
}
