import { TransportCore } from "../../transport-core.js";
/**
 * The real-time wrapper around the SNES core, bundled by
 * `scripts/build-worklet.mjs` into one self-contained script. The 2A03's
 * `worklet.ts` says why. This one takes the memory message: samples go into
 * the DSP's RAM before a note can play them.
 */

import type { WorkletMessage } from "../../chip.js";
import { SPC_HZ, SNES_PROCESSOR_NAME, SnesCore } from "./dsp.js";

declare const sampleRate: number;
declare const currentFrame: number;
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;

class SnesProcessor extends AudioWorkletProcessor {
  private readonly core = new TransportCore(new SnesCore(sampleRate), SPC_HZ, sampleRate);
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

registerProcessor(SNES_PROCESSOR_NAME, SnesProcessor);
