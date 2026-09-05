import { TransportCore } from "../../transport-core.js";
import { registerChip, type ChipDefinition, type ChipSpec } from "../../chip.js";
import { MASTER_HZ, MD_PROCESSOR_NAME, MdChip, MdCore } from "./dsp.js";
import { MdDriver } from "./driver.js";
import { WORKLET_SOURCE } from "./worklet-inline.js";

/**
 * The Mega Drive: a YM2612 and an SN76489, the third chip and the first with
 * an instrument that is not a table of frames. Ten voices, on the machine's
 * master clock, reached through the addresses the 68000 wrote to.
 */
export const MEGA_DRIVE: ChipSpec = {
  id: "md",
  name: "YM2612 + SN76489",
  system: "Mega Drive / Genesis",
  instruments: "fm",
  nativeSampleRate: null,
  clockHz: MASTER_HZ,
  voices: [
    { id: "fm1", label: "FM 1", kind: "fm", notes: "pitch" },
    { id: "fm2", label: "FM 2", kind: "fm", notes: "pitch" },
    { id: "fm3", label: "FM 3", kind: "fm", notes: "pitch" },
    { id: "fm4", label: "FM 4", kind: "fm", notes: "pitch" },
    { id: "fm5", label: "FM 5", kind: "fm", notes: "pitch" },
    { id: "fm6", label: "FM 6", kind: "fm", notes: "pitch" },
    { id: "psg1", label: "PSG 1", kind: "pulse", notes: "pitch" },
    { id: "psg2", label: "PSG 2", kind: "pulse", notes: "pitch" },
    { id: "psg3", label: "PSG 3", kind: "pulse", notes: "pitch" },
    { id: "noise", label: "Noise", kind: "noise", notes: "period" },
  ],
  // The lead and the bass on FM, the chord on the PSG as Mega Drive music
  // did, the kit on the noise, which takes tone 3 as its clock.
  roles: { lead: "fm1", chord: "psg1", bass: "fm2", perc: "noise" },
};

export const mdChip: ChipDefinition = {
  spec: MEGA_DRIVE,
  create: (sampleRate: number) => new TransportCore(new MdCore(sampleRate), MEGA_DRIVE.clockHz, sampleRate),
  digital: () => new MdChip(),
  driver: () => new MdDriver(),
  workletSource: WORKLET_SOURCE,
  processorName: MD_PROCESSOR_NAME,
};

registerChip(mdChip);
