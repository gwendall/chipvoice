/**
 * The real-time wrapper around the Mega Drive core, bundled by
 * `scripts/build-worklet.mjs` into one self-contained script. The 2A03's
 * `worklet.ts` says why.
 */

import type { WorkletMessage } from "../../chip.js";
import { MD_PROCESSOR_NAME, MdCore } from "./dsp.js";

declare const sampleRate: number;
declare const currentFrame: number;
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;

class MdProcessor extends AudioWorkletProcessor {
  private readonly core = new MdCore(sampleRate);
  private alive = true;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<WorkletMessage>) => {
      const data = e.data;
      if (data.type === "events") this.core.schedule(data.events);
      else if (data.type === "memory") this.core.load();
      else if (data.type === "gain") this.core.setGain(data.value);
      else if (data.type === "reset") this.core.reset();
      else if (data.type === "cancel") this.core.cancel(data.owner, data.from);
      else if (data.type === "dispose") { this.alive = false; this.core.reset(); this.port.close(); }
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (!this.alive) return false;
    const out = outputs[0];
    this.core.render(out[0], out.length > 1 ? out[1] : null, currentFrame);
    return true;
  }
}

registerProcessor(MD_PROCESSOR_NAME, MdProcessor);
