/**
 * The real-time wrapper around the SID core, bundled by
 * `scripts/build-worklet.mjs` into one self-contained script. The 2A03's
 * `worklet.ts` says why; this one differs only in the core it wraps and
 * the name it registers.
 */

import type { WorkletMessage } from "../../chip.js";
import { C64_PROCESSOR_NAME, SidCore } from "./dsp.js";

declare const sampleRate: number;
declare const currentFrame: number;
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;

class SidProcessor extends AudioWorkletProcessor {
  private readonly core = new SidCore(sampleRate);

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<WorkletMessage>) => {
      const data = e.data;
      if (data.type === "events") this.core.schedule(data.events);
      else if (data.type === "memory") this.core.load();
      else if (data.type === "gain") this.core.setGain(data.value);
      else if (data.type === "reset") this.core.reset();
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    this.core.render(out[0], out.length > 1 ? out[1] : null, currentFrame);
    return true;
  }
}

registerProcessor(C64_PROCESSOR_NAME, SidProcessor);
