import { createHash } from "node:crypto";
import {
  projectCapabilities,
  getChip,
  PROJECT_ENGINE_VERSION,
  PROJECT_SCHEMA,
} from "chipvoice";
// Build-time adapters intentionally call the same internal rules as the planner.
// They are not extra public SDK APIs. Engine changes are checked by the agent eval.
import { performanceInstrument } from "../../../packages/chipvoice/dist/performance-palette.js";
import {
  performanceVoices,
  instrumentFitsVoice,
  voicesConflict,
} from "../../../packages/chipvoice/dist/voice-resources.js";
import { pitchRange } from "../../../packages/chipvoice/dist/pitch-range.js";

export function buildAgentCatalog(
  capabilities = projectCapabilities(),
  resolveChip = getChip,
) {
  const targets = capabilities.map((capability) => {
    const { spec } = resolveChip(capability.id);
    const groups = new Map();
    for (const role of ["lead", "chord", "bass"])
      for (let program = 0; program < 128; program++) {
        const instrument = performanceInstrument(spec.id, role, program);
        const voices = performanceVoices(spec, instrument, false).map(
          (voice) => ({
            id: voice.id,
            preservesInstrument: instrumentFitsVoice(spec, voice, instrument),
            pitchHz: pitchRange(spec, voice, instrument),
          }),
        );
        const signature = JSON.stringify({ role, instrument, voices });
        if (!groups.has(signature))
          groups.set(signature, { role, programs: [], instrument, voices });
        groups.get(signature).programs.push(program);
      }
    const conflicts = [];
    for (let a = 0; a < spec.voices.length; a++)
      for (let b = a + 1; b < spec.voices.length; b++)
        if (voicesConflict(spec, spec.voices[a].id, spec.voices[b].id))
          conflicts.push([spec.voices[a].id, spec.voices[b].id]);
    return {
      ...capability,
      system: spec.system,
      automaticMixingSources: ["performance"],
      compactRoles: capability.roles,
      voiceConflicts: conflicts,
      excludedPerformanceVoices: spec.voices
        .filter((v) => v.notes === "sample")
        .map((v) => v.id),
      melodicPalette: [...groups.values()],
      percussionVoices: performanceVoices(spec, {}, true).map((v) => v.id),
    };
  });
  const body = {
    version: 1,
    engineVersion: PROJECT_ENGINE_VERSION,
    projectSchemaVersion: 1,
    semantics: {
      program:
        "Zero-based General MIDI 0–127; palette approximations, not original patches.",
      voices:
        "One simultaneous note consumes one eligible voice, including each chord tone. Lists are not additive polyphony promises.",
      conflicts:
        "Distinct voice IDs in a pair share an allocator resource; inspect actual plan losses.",
      pitchHz:
        "Base representable range before modulation; null means unknown, not unlimited.",
      instrument:
        "Generated generic palette; explicit patches, native memory and portable timbres are separate.",
      mixing:
        "Automatic balancing applies to Performance adaptations. Score retains authored levels; untouched native sources retain original commands.",
    },
    targets,
    projectSchema: PROJECT_SCHEMA,
  };
  return {
    ...body,
    contentHash: createHash("sha256")
      .update(JSON.stringify(body))
      .digest("hex"),
  };
}
