import { arrange, type Score } from "./score.js";
import { shapeScore } from "./composition.js";
import { loopSeconds } from "./render.js";
import { validateSong } from "./validate.js";
import {
  performanceClock,
  validatePerformance,
  type Performance,
  type PerformancePlan,
} from "./performance.js";
import {
  checkData,
  PROJECT_SCHEMA,
  type ProjectIssue,
  type ProjectChip,
} from "./project-schema.js";
export { PROJECT_SCHEMA, CHIP_IDS } from "./project-schema.js";
export type { ProjectIssue, ProjectChip } from "./project-schema.js";
export type StoredPlan = Omit<PerformancePlan, "memory"> & {
  musicStartCycle?: number;
  memory: { address: number; bytes: number[] }[];
};
export interface MusicProject {
  version: 1;
  title: string;
  description?: string;
  author?: string;
  licence?: "reserved" | "CC0-1.0" | "CC-BY-4.0";
  tags?: string[];
  source:
    | { kind: "score"; score: Score }
    | { kind: "performance"; performance: Performance }
    | { kind: "native"; plan: StoredPlan; performance: Performance };
  settings: {
    chip: ProjectChip;
    tempoScale?: number;
    transpose?: number;
    gain?: number;
    mix?: "auto" | "authored";
    allowLoss?: boolean;
  };
  /** The validated output in source is authoritative for playback. */
  generator?: { language: "javascript"; code: string; seed: number };
}
export class ProjectValidationError extends Error {
  constructor(readonly issues: ProjectIssue[]) {
    super(issues[0]?.message ?? "Invalid project");
    this.name = "ProjectValidationError";
  }
}
/** Validate untrusted JSON without changing its source or silently removing fields. */
export function validateProject(value: unknown): {
  ok: boolean;
  issues: ProjectIssue[];
} {
  const issues = checkData(value, PROJECT_SCHEMA);
  if (issues.length) return { ok: false, issues };
  const project = value as MusicProject;
  try {
    if (!project.title.trim()) throw Error("A song title is required");
    if (project.source.kind === "score") {
      if (project.settings.mix === "auto")
        throw Error("Automatic mixing requires a Performance source");
      const score = shapeScore(project.source.score, {
        transpose: project.settings.transpose ?? 0,
      });
      const song = arrange(
        { ...score, bpm: score.bpm * (project.settings.tempoScale ?? 1) },
        project.settings.chip,
      );
      if (loopSeconds(song) > 600) throw Error("Project exceeds ten minutes");
      const result = validateSong(song);
      for (const issue of result.issues)
        issues.push({
          path: "$.source.score",
          code: issue.code ?? "score",
          message: issue.message,
          level: issue.level,
        });
    } else {
      validatePerformance(project.source.performance);
      if (
        performanceClock(
          project.source.performance,
          project.settings.tempoScale,
        )(project.source.performance.endTick) > 600
      )
        throw Error("Performance exceeds ten minutes");
      if (project.source.kind === "native") {
        const plan = project.source.plan;
        if (plan.loopStartSeconds >= plan.seconds)
          throw Error("Native loop starts after the end");
        let last = -1;
        for (const event of plan.events) {
          if (event.at < last)
            throw Error("Native events must be chronological");
          last = event.at;
        }
      }
    }
  } catch (error) {
    issues.push({
      path: "$.source",
      code: "invalid_music",
      message: error instanceof Error ? error.message : "Invalid music",
      level: "error",
    });
  }
  return { ok: !issues.some((i) => i.level === "error"), issues };
}
/** A detached, JSON-only snapshot. The input can be an object or serialized JSON. */
export function parseProject(input: unknown): MusicProject {
  let value = input;
  if (typeof input === "string") {
    if (input.length > 16_000_000)
      throw new ProjectValidationError([
        {
          path: "$",
          code: "limit",
          message: "Project exceeds 16 MB",
          level: "error",
        },
      ]);
    try {
      value = JSON.parse(input);
    } catch (error) {
      if (error instanceof ProjectValidationError) throw error;
      throw new ProjectValidationError([
        {
          path: "$",
          code: "invalid_json",
          message: "Invalid JSON",
          level: "error",
        },
      ]);
    }
  }
  const result = validateProject(value);
  if (!result.ok) throw new ProjectValidationError(result.issues);
  return JSON.parse(JSON.stringify(value)) as MusicProject;
}
export function projectFromPerformance(
  performance: Performance,
  chip: ProjectChip = "2a03",
): MusicProject {
  return parseProject({
    version: 1,
    title: performance.title.slice(0, 80) || "Untitled",
    source: { kind: "performance", performance },
    settings: { chip },
  });
}
/** Preserve the legacy authored score policy; this does not reallocate its voices. */
export function projectFromScore(
  score: Score,
  metadata: { title?: string; author?: string } = {},
): MusicProject {
  return parseProject({
    version: 1,
    title: metadata.title ?? score.id ?? "Untitled",
    ...(metadata.author ? { author: metadata.author } : {}),
    source: { kind: "score", score },
    settings: { chip: score.chip ?? "2a03", mix: "authored" },
  });
}
export function storePlan(plan: PerformancePlan): StoredPlan {
  return {
    ...plan,
    memory: plan.memory.map((block) => ({
      address: block.address,
      bytes: Array.from(block.bytes),
    })),
  };
}
