import { TransportCore } from "../../transport-core.js";
/**
 * The real-time wrapper around the core.
 *
 * `scripts/build-worklet.mjs` bundles this file and everything it imports into
 * one self-contained script, which the driver hands to the browser as a blob
 * URL. A blob has no base URL, so nothing may be left to resolve at load time
 * - and making that true is the bundler's job, not a rule the source has to
 * obey.
 *
 * This owns the two things that are specific to running live: the message
 * port, and `currentFrame` as the clock. It is excluded from the package's
 * own build; the only thing that ever runs it is a worklet.
 */

import type { WorkletMessage } from "../../chip.js";
import { CPU_HZ, NesApuCore, PROCESSOR_NAME } from "./dsp.js";

// The AudioWorkletGlobalScope, which lib.dom does not describe because these
// exist only inside a worklet. Declared here, scoped to this module.
declare const sampleRate: number;
declare const currentFrame: number;
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}
declare function registerProcessor(
  name: string,
  processor: new () => AudioWorkletProcessor,
): void;

class ApuProcessor extends AudioWorkletProcessor {
  private readonly core = new TransportCore(new NesApuCore(sampleRate), CPU_HZ, sampleRate);
  private alive = true;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<WorkletMessage>) => {
      const data = e.data;
      if (data.type === "events") this.core.schedule(data.events);
      else if (data.type === "memory") this.core.load(data.address, data.bytes);
      else if (data.type === "gain") this.core.setGain(data.value);
      else if (data.type === "reset") this.core.reset();
      else if (data.type === "cancel") this.core.cancel(data.owner, data.from);
      else if (data.type === "dispose") { this.alive = false; this.core.reset(); this.port.close(); }
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (!this.alive) return false;
    const out = outputs[0];
    // currentFrame is the context-wide sample clock, so an event scheduled
    // against ctx.currentTime lands on the sample it was booked for.
    this.core.render(out[0], out.length > 1 ? out[1] : null, currentFrame);
    return true;
  }
}

registerProcessor(PROCESSOR_NAME, ApuProcessor);
