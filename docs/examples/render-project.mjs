// Render your own MusicProject; this helper does not compose or publish music.
import { readFile, writeFile } from "node:fs/promises";
import { validateProject, renderProject, toWav } from "chipvoice";

const project = JSON.parse(await readFile(process.argv[2] ?? "project.json", "utf8"));
const validation = validateProject(project);
if (!validation.ok) throw Error(JSON.stringify(validation.issues));
const { audio, plan } = renderProject(project, { sampleRate: 44100 });
let energy = 0;
let clippedSamples = 0;
for (const channel of [audio.left, audio.right]) {
  for (const sample of channel) {
    if (!Number.isFinite(sample)) throw Error("Non-finite audio sample");
    energy += sample * sample;
    if (Math.abs(sample) >= 1) clippedSamples++;
  }
}
await writeFile("song.wav", toWav(audio));
await writeFile("evaluation.json", JSON.stringify({
  chip: project.settings.chip,
  seconds: audio.seconds,
  measuredSeconds: audio.seconds,
  sampleRate: 44100,
  peak: audio.peak,
  rms: Math.sqrt(energy / (audio.left.length + audio.right.length)),
  clippedSamples,
  playedNotes: plan.notes.length,
  losses: plan.losses,
  mix: plan.mix,
}, null, 2));
console.log("Full render: song.wav. Inspect evaluation.json and listen before delivery.");
