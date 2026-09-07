import type { MusicProject, PerformancePart } from "chipvoice";
/** Original sixteen-bar starter; no existing game's notes or extra backing implied. */
export function starterProject(): MusicProject {
  const ppq = 480,
    notes = [64, 67, 71, 74, 72, 67, 64, 62, 60, 64, 67, 72, 71, 67, 62, 59];
  const parts: PerformancePart[] = [
    {
      id: "lead",
      name: "Melody",
      role: "lead",
      priority: 4,
      notes: Array.from({ length: 64 }, (_, i) => ({
        id: `l${i}`,
        tick: i * 480,
        endTick: i * 480 + 360,
        pitch: notes[i % 16],
        velocity: i % 4 === 0 ? 105 : 90,
        program: 80,
      })),
    },
    {
      id: "chord",
      name: "Harmony",
      role: "chord",
      priority: 1,
      notes: Array.from({ length: 16 }, (_, bar) =>
        [0, 4, 7].map((offset, j) => ({
          id: `c${bar}-${j}`,
          tick: bar * 1920,
          endTick: bar * 1920 + 1680,
          pitch: [48, 45, 53, 55][bar % 4] + offset,
          velocity: 56,
          program: 81,
        })),
      ).flat(),
    },
    {
      id: "bass",
      name: "Bass",
      role: "bass",
      priority: 3,
      notes: Array.from({ length: 32 }, (_, i) => ({
        id: `b${i}`,
        tick: i * 960,
        endTick: i * 960 + 720,
        pitch: [36, 33, 41, 43][Math.floor(i / 2) % 4],
        velocity: 85,
        program: 38,
      })),
    },
    {
      id: "drums",
      name: "Drums",
      role: "perc",
      priority: 2,
      notes: Array.from({ length: 128 }, (_, i) => ({
        id: `d${i}`,
        tick: i * 240,
        endTick: i * 240 + 100,
        pitch: i % 8 === 0 ? 36 : i % 8 === 4 ? 38 : 42,
        drum: i % 8 === 0 ? 36 : i % 8 === 4 ? 38 : 42,
        velocity: i % 4 === 0 ? 80 : 48,
      })),
    },
  ];
  return {
    version: 1,
    title: "Pocket orbit",
    description: "An original loop. Make it yours.",
    tags: ["original"],
    source: {
      kind: "performance",
      performance: {
        version: 1,
        title: "Pocket orbit",
        ticksPerBeat: ppq,
        endTick: 30720,
        tempos: [{ tick: 0, microsecondsPerBeat: 500000 }],
        parts,
        notices: [],
      },
    },
    settings: { chip: "snes", allowLoss: true },
  };
}
export const GENERATOR_EXAMPLE = `// Original music. The same seed produces the same notes.\nconst project = structuredClone(starter);\nproject.title = "My pocket orbit";\nproject.source.performance.parts[0].notes = Array.from({length: 64}, (_, i) => ({\n  id: "note-" + i, tick: i * 480, endTick: i * 480 + 360,\n  pitch: [60, 62, 64, 67, 69][Math.floor(random() * 5)],\n  velocity: 90, program: 80\n}));\nreturn project;`;
