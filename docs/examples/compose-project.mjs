// Original eight-bar chamber theme. Run with Node after `npm install chipvoice`.
import { writeFile } from "node:fs/promises";
import {
  projectFromPerformance,
  validateProject,
  renderProject,
  toWav,
  projectCapabilities,
} from "chipvoice";

const ppq = 480;
const part = (id, role, program, priority, importance) => ({
  id,
  name: id,
  role,
  program,
  priority,
  mix: { importance },
  notes: [],
});
const melody = part("melody", "lead", 73, 100, 1);
const strings = part("strings", "chord", 48, 50, 0.6);
const brass = part("brass", "chord", 60, 40, 0.5);
const counter = part("countermelody", "lead", 11, 60, 0.6);
const bass = part("bass", "bass", 42, 90, 0.7);
const drums = part("drums", "perc", 0, 70, 0.5);
function note(p, beat, length, pitch, velocity = 90, drum) {
  p.notes.push({
    id: `${p.id}-${p.notes.length}`,
    tick: Math.round(beat * ppq),
    endTick: Math.round((beat + length) * ppq),
    pitch,
    velocity,
    ...(drum === undefined ? {} : { drum }),
  });
}
const chords = [
  [60, 64, 67],
  [57, 60, 64],
  [53, 57, 60],
  [55, 59, 62],
  [60, 64, 67],
  [53, 57, 60],
  [55, 59, 62],
  [60, 64, 67],
];
const phrases = [
  [72, 76, 79, 76],
  [69, 72, 76, 74],
  [72, 69, 65, 69],
  [71, 74, 79, 77],
  [76, 79, 84, 79],
  [77, 76, 72, 69],
  [74, 71, 67, 71],
  [72, 76, 72, 72],
];
for (let bar = 0; bar < chords.length; bar++) {
  const at = bar * 4,
    chord = chords[bar];
  phrases[bar].forEach((pitch, i) =>
    note(
      melody,
      at + i,
      bar === 7 && i === 3 ? 1 : 0.8,
      pitch,
      i === 0 ? 100 : 86,
    ),
  );
  chord.forEach((pitch) => note(strings, at, 3.7, pitch, 65)); // Three simultaneous voices.
  note(bass, at, 1.8, chord[0] - 24, 82);
  note(bass, at + 2, 1.8, chord[0] - 17, 76);
  if (bar % 2 === 1) note(brass, at + 2, 1.4, chord[2], 72);
  if (bar >= 4 && bar < 7) {
    note(counter, at + 0.5, 0.8, chord[2] + 12, 66);
    note(counter, at + 2.5, 0.8, chord[1] + 12, 60);
  }
  if (bar < 7)
    for (let beat = 0; beat < 4; beat++)
      note(drums, at + beat, 0.2, beat % 2 ? 38 : 36, 58, beat % 2 ? 38 : 36);
}
const performance = {
  version: 1,
  title: "Lantern procession",
  ticksPerBeat: ppq,
  endTick: 32 * ppq,
  tempos: [{ tick: 0, microsecondsPerBeat: 500000 }],
  parts: [melody, strings, brass, counter, bass, drums],
  notices: [],
};
const targets = projectCapabilities();
const chip = process.argv[2] ?? targets[0].id;
if (!targets.some((target) => target.id === chip))
  throw Error("Unsupported chip; inspect projectCapabilities()");
const project = projectFromPerformance(performance, chip);
project.settings.mix = "auto";
project.settings.allowLoss = true; // Audition only: inspect omissions before publishing.
const validation = validateProject(project);
if (!validation.ok) throw Error(JSON.stringify(validation.issues));
const { audio, plan } = renderProject(project, { sampleRate: 44100 });
await writeFile("project.json", JSON.stringify(project, null, 2));
await writeFile("preview.wav", toWav(audio));
await writeFile(
  "evaluation.json",
  JSON.stringify(
    {
      chip,
      seconds: audio.seconds,
      peak: audio.peak,
      sourceNotes: performance.parts.reduce((n, p) => n + p.notes.length, 0),
      playedNotes: plan.notes.length,
      losses: plan.losses,
      mix: plan.mix,
    },
    null,
    2,
  ),
);
console.log(
  "Read evaluation.json and listen to preview.wav. Do not publish unreviewed omissions.",
);
