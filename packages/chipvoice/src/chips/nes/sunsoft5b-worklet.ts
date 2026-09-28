/**
 * The real-time wrapper around `Sunsoft5bNesCore`, mirroring
 * `vrc6-worklet.ts` exactly except for which core it wraps and which
 * processor name it registers.
 *
 * `scripts/build-worklet.mjs` bundles this into `sunsoft5b-worklet-inline.ts`
 * the same way it bundles `vrc6-worklet.ts` into `vrc6-worklet-inline.ts`;
 * that script is the only thing that reads this file, and it is excluded
 * from the package's own build.
 */

import type { WorkletMessage } from "../../chip.js";
import { Sunsoft5bNesCore, SUNSOFT5B_PROCESSOR_NAME } from "./sunsoft5b-core.js";

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

class Sunsoft5bApuProcessor extends AudioWorkletProcessor {
  private readonly core = new Sunsoft5bNesCore(sampleRate);
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
    this.core.render(out[0], out.length > 1 ? out[1] : null, currentFrame);
    return true;
  }
}

registerProcessor(SUNSOFT5B_PROCESSOR_NAME, Sunsoft5bApuProcessor);
