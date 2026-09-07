import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  parseProject,
  validateProject,
  projectFromPerformance,
  projectFromScore,
  renderProject,
  renderSong,
  arrange,
  storePlan,
  repeatPerformanceSection,
} from "../dist/index.js";
const score = {
  bpm: 120,
  patterns: [
    {
      lead: "C4 . . .",
      chord: ". . . .",
      bass: ". . . .",
      perc: ". . . .",
      chordShape: [[0, 4, 7]],
    },
  ],
  order: [0],
};
const compact = projectFromScore(score, { title: "A short phrase" });
assert.deepEqual(parseProject(JSON.stringify(compact)), compact);
assert.deepEqual(
  renderProject(compact, { sampleRate: 8000 }).audio,
  renderSong(arrange(score), {
    seconds: 0.5,
    sampleRate: 8000,
    stereo: true,
    gain: 0.78,
  }),
  "legacy samples remain unchanged",
);
for (const modify of [
  (p) => (p.unexpected = true),
  (p) => (p.settings.chip = "mystery"),
  (p) => (p.source.score.gainn = 0.5),
  (p) => (p.version = 2),
  (p) => (p.source.score.patterns[0].lead = null),
]) {
  const bad = structuredClone(compact);
  modify(bad);
  assert.equal(validateProject(bad).ok, false);
  assert.throws(() => parseProject(bad));
}
assert.throws(() => parseProject("{invalid"), /Invalid JSON/);
for (const id of ["mario", "zelda", "sonic"]) {
  const performance = JSON.parse(
    await readFile(`../../scores/arrangements/${id}.json`),
  );
  const project = projectFromPerformance(
    performance,
    id === "sonic" ? "md" : "2a03",
  );
  assert.deepEqual(
    parseProject(JSON.stringify(project)).source.performance,
    performance,
    `${id}: every source field survives`,
  );
  const detached = parseProject(project);
  detached.source.performance.title = "changed";
  assert.notEqual(project.source.performance.title, "changed");
}
for (const id of ["mario", "zelda"]) {
  const performance = JSON.parse(
    await readFile(`../../scores/arrangements/${id}.json`),
  );
  const plan = JSON.parse(
    await readFile(`../../scores/arrangements/${id}-native.json`),
  );
  const project = {
    version: 1,
    title: id,
    source: { kind: "native", plan, performance },
    settings: { chip: "2a03" },
  };
  assert.equal(
    validateProject(project).ok,
    true,
    JSON.stringify(validateProject(project).issues),
  );
  assert.deepEqual(parseProject(project), project);
}
const native = {
  chip: "2a03",
  seconds: 1,
  loopStartSeconds: 0,
  events: [],
  memory: [{ address: 0, bytes: new Uint8Array([0, 255]) }],
  notes: [],
  losses: [],
};
assert.deepEqual(storePlan(native).memory[0].bytes, [0, 255]);
console.log(
  "PASS strict versioned projects, legacy audio parity, complete repertoire round trips and detached source ownership",
);

const section = {
  version: 1,
  title: "Section",
  ticksPerBeat: 480,
  endTick: 1920,
  tempos: [
    { tick: 0, microsecondsPerBeat: 500000 },
    { tick: 720, microsecondsPerBeat: 400000 },
  ],
  parts: [
    {
      id: "lead",
      name: "Lead",
      role: "lead",
      priority: 1,
      notes: [
        {
          id: "long",
          tick: 0,
          endTick: 1200,
          pitch: 60,
          velocity: 90,
          expression: [
            { tick: 0, gain: 0.5 },
            { tick: 700, gain: 0.8 },
          ],
        },
      ],
    },
  ],
  notices: [],
};
const repeated = repeatPerformanceSection(section, 480, 960);
assert.equal(repeated.endTick, 2400);
assert.deepEqual(repeated.parts[0].notes[1], {
  ...section.parts[0].notes[0],
  id: "long:repeat:1920",
  tick: 1920,
  endTick: 2400,
  expression: [
    { tick: 1920, gain: 0.5 },
    { tick: 2140, gain: 0.8 },
  ],
});
assert.deepEqual(repeated.tempos.slice(-2), [
  { tick: 1920, microsecondsPerBeat: 500000 },
  { tick: 2160, microsecondsPerBeat: 400000 },
]);
assert.equal(section.parts[0].notes.length, 1);
for (const settings of [
  { mix: "auto" },
  { transpose: 0.1 },
  { tempoScale: 0.001 },
])
  assert.equal(
    validateProject({
      ...compact,
      settings: { ...compact.settings, ...settings },
    }).ok,
    false,
  );
console.log(
  "PASS section clipping, held expression, tempo preservation and admission/render consistency",
);

const authored = projectFromPerformance({...section,endTick:1920,parts:[{...section.parts[0],notes:[{id:'tone',tick:0,endTick:1600,pitch:64,velocity:90}],program:80}]},'snes');
authored.settings.mix='authored';
const level = p => { const audio=renderProject(p,{sampleRate:8000}).audio;return Math.sqrt(audio.left.reduce((sum,x)=>sum+x*x,0)/audio.left.length); };
const normal=level(authored),quiet=structuredClone(authored),muted=structuredClone(authored);
quiet.source.performance.parts[0].mix={gainDb:-12};muted.source.performance.parts[0].muted=true;
assert.ok(level(quiet)<normal*.4);assert.ok(level(muted)<1e-8);
const programExplicit=structuredClone(authored);programExplicit.source.performance.parts[0].notes[0].program=80;
assert.deepEqual(renderProject(authored,{sampleRate:8000}).audio,renderProject(programExplicit,{sampleRate:8000}).audio);
console.log('PASS explicit mute/trim with authored mixing and persistent default part instrument');
