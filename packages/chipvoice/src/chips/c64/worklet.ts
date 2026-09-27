/**
 * The real-time wrapper around the SID core, bundled by
 * `scripts/build-worklet.mjs` into one self-contained script. The 2A03's
 * `worklet.ts` says why; this one differs only in the core it wraps and
 * the name it registers.
 */

import type { WorkletMessage } from "../../chip.js";
import { C64_PROCESSOR_NAME, SID_6581_PROFILE, SID_8580_PROFILE, SidCore } from "./dsp.js";

declare const sampleRate: number;
declare const currentFrame: number;
/** What `new AudioWorkletNode(ctx, name, { processorOptions })` hands the processor. */
interface AudioWorkletNodeOptions {
  processorOptions?: { model?: string };
}
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
}
declare function registerProcessor(name: string, processor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor): void;

class SidProcessor extends AudioWorkletProcessor {
  private readonly core: SidCore;
  private alive = true;

  constructor(options?: AudioWorkletNodeOptions) {
    super(options);
    const profile = options?.processorOptions?.model === "8580" ? SID_8580_PROFILE : SID_6581_PROFILE;
    this.core = new SidCore(sampleRate, profile);
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

registerProcessor(C64_PROCESSOR_NAME, SidProcessor);
