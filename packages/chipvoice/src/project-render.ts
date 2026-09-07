import { nesChip } from "./chips/nes/index.js";
import { gbChip } from "./chips/gb/index.js";
import { mdChip } from "./chips/md/index.js";
import { snesChip } from "./chips/snes/index.js";
import { c64Chip } from "./chips/c64/index.js";
import { arrange } from "./score.js";
import { shapeScore } from "./composition.js";
import { renderSong, loopSeconds, type RenderResult } from "./render.js";
import {
  planPerformance,
  renderPerformance,
  type PerformancePlan,
} from "./performance.js";
import { parseProject, type MusicProject } from "./project.js";
export const PROJECT_ENGINE_VERSION = "0.17.0";
const definitions = {
  "2a03": nesChip,
  dmg: gbChip,
  md: mdChip,
  snes: snesChip,
  c64: c64Chip,
};
export interface ProjectRenderOptions {
  sampleRate?: number;
  seconds?: number;
  parts?: string[];
  onProgress?: (fraction: number) => void;
}
export interface ProjectRender {
  audio: RenderResult;
  plan: PerformancePlan | null;
  engineVersion: string;
  native: boolean;
  loopStartSeconds: number;
}
/** Pure preparation/rendering for Node and workers. Browser callers use ProjectPlayer. */
export function renderProject(
  input: MusicProject,
  options: ProjectRenderOptions = {},
): ProjectRender {
  const project = parseProject(input),
    settings = project.settings,
    chip = definitions[settings.chip],
    sampleRate = options.sampleRate ?? 44100;
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000)
    throw Error("Sample rate must be 8000–96000 Hz");
  if (
    options.seconds !== undefined &&
    (!Number.isFinite(options.seconds) ||
      options.seconds <= 0 ||
      options.seconds > 600)
  )
    throw Error("Invalid render duration");
  options.onProgress?.(0);
  if (project.source.kind === "score") {
    if (settings.mix === "auto")
      throw Error(
        "Automatic mixing requires a Performance source; this score retains its authored mix",
      );
    const source = shapeScore(project.source.score, {
      transpose: settings.transpose ?? 0,
    });
    const song = arrange(
      { ...source, bpm: source.bpm * (settings.tempoScale ?? 1) },
      settings.chip,
    );
    if (options.parts)
      for (const pattern of (song.patterns = song.patterns.map((p) => ({
        ...p,
      }))))
        for (const role of ["lead", "chord", "bass", "perc"] as const)
          if (!options.parts.includes(role))
            pattern[role] = pattern[role]
              .trim()
              .split(/\s+/)
              .map(() => ".")
              .join(" ");
    const fullSeconds = loopSeconds(song);
    if (fullSeconds > 600) throw Error("Project exceeds ten minutes");
    const seconds = Math.min(fullSeconds, options.seconds ?? fullSeconds);
    const audio = renderSong(song, {
      seconds,
      sampleRate,
      stereo: true,
      gain: settings.gain ?? 0.78,
    });
    options.onProgress?.(1);
    return {
      audio,
      plan: null,
      engineVersion: PROJECT_ENGINE_VERSION,
      native: false,
      loopStartSeconds: 0,
    };
  }
  const native =
    project.source.kind === "native" &&
    project.source.plan.chip === settings.chip &&
    (settings.transpose ?? 0) === 0 &&
    (settings.tempoScale ?? 1) === 1 &&
    !options.parts;
  const plan: PerformancePlan =
    native && project.source.kind === "native"
      ? {
          ...project.source.plan,
          memory: project.source.plan.memory.map((block) => ({
            address: block.address,
            bytes: new Uint8Array(block.bytes),
          })),
        }
      : planPerformance(project.source.performance, chip, {
          allowLoss: settings.allowLoss ?? false,
          tempoScale: settings.tempoScale,
          transpose: settings.transpose,
          mix: settings.mix === "authored" ? false : undefined,
          parts: options.parts,
        });
  if (options.seconds !== undefined) {
    plan.seconds = Math.min(plan.seconds, options.seconds);
    plan.loopStartSeconds = Math.min(
      plan.loopStartSeconds,
      Math.max(0, plan.seconds - 0.001),
    );
  }
  const audio = renderPerformance(plan, chip, {
    sampleRate,
    gain: settings.gain ?? 0.6,
    onProgress: options.onProgress,
  });
  return {
    audio,
    plan,
    engineVersion: PROJECT_ENGINE_VERSION,
    native,
    loopStartSeconds: plan.loopStartSeconds,
  };
}
export function projectCapabilities() {
  return Object.values(definitions).map(({ spec }) => ({
    id: spec.id,
    name: spec.name,
    voices: spec.voices,
    roles: spec.roles,
    exportFormats: ["wav"],
    registerExportFormats: ["2a03", "dmg", "md"].includes(spec.id)
      ? ["vgm"]
      : [],
    sourceFormats: ["score", "performance", "native"],
    automaticMixing: true,
  }));
}
