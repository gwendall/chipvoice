
/**
 * The real-time wrapper around the core.
 *
 * Everything above this line is the chip itself, pasted in by the build: a
 * worklet has no `import`, so the only way to share the DSP with Node is to
 * concatenate it here and to export it separately for the module world.
 *
 * This shell owns the two things that are specific to running live - the
 * message port, and `currentFrame` as the clock.
 */
class ApuProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.core = new NesApuCore(sampleRate);
    this.port.onmessage = (e) => {
      const data = e.data;
      if (data.type === "events") this.core.schedule(data.events);
      else if (data.type === "gain") this.core.setGain(data.value);
      else if (data.type === "reset") this.core.reset();
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    // currentFrame is the context-wide sample clock, so an event scheduled
    // against ctx.currentTime lands on the sample it was booked for.
    this.core.render(out[0], out.length > 1 ? out[1] : null, currentFrame);
    return true;
  }
}

registerProcessor("apu-processor", ApuProcessor);
