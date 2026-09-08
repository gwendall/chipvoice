import { parentPort, workerData } from "node:worker_threads";
import {
  renderProject,
  toWav,
  parseProject,
  performanceClock,
  arrange,
  shapeScore,
  loopSeconds,
} from "chipvoice";
import { encodeMp3 } from "./mp3";
try {
  let last = 0;
  if (workerData.wav) {
    const wav = new DataView(
      workerData.wav.buffer,
      workerData.wav.byteOffset,
      workerData.wav.byteLength,
    );
    // Our pinned WAV writer always emits 16-bit PCM with a 44-byte header.
    if (
      wav.getUint32(0) !== 0x52494646 ||
      wav.getUint16(20, true) !== 1 ||
      wav.getUint16(34, true) !== 16 ||
      wav.getUint32(36) !== 0x64617461
    )
      throw Error("Unsupported pinned WAV");
    const channels = wav.getUint16(22, true),
      rate = wav.getUint32(24, true),
      length = wav.getUint32(40, true) / (2 * channels);
    if (
      ![1, 2].includes(channels) ||
      !Number.isSafeInteger(length) ||
      44 + length * channels * 2 !== wav.byteLength
    )
      throw Error("Invalid pinned WAV");
    const left = new Float32Array(length),
      right = channels === 2 ? new Float32Array(length) : null;
    for (let i = 0; i < length; i++) {
      left[i] = wav.getInt16(44 + i * channels * 2, true) / 32768;
      if (right) right[i] = wav.getInt16(46 + i * channels * 2, true) / 32768;
    }
    const mp3 = encodeMp3(left, rate, workerData.tags, right);
    parentPort!.postMessage({ mp3 }, [mp3.buffer]);
  } else {
    const project = parseProject(workerData.project);
    const result = renderProject(project, {
      seconds: workerData.evaluate
        ? 2
        : workerData.kind === "preview"
          ? 30
          : undefined,
      onProgress: (progress) => {
        if (Date.now() - last > 1000) {
          last = Date.now();
          parentPort!.postMessage({ progress: progress * 0.8 });
        }
      },
    });
    if (workerData.evaluate) {
      let sum = 0,
        peak = 0,
        clipped = 0,
        count = 0;
      for (const channel of [result.audio.left, result.audio.right])
        if (channel)
          for (const sample of channel) {
            sum += sample * sample;
            peak = Math.max(peak, Math.abs(sample));
            if (Math.abs(sample) >= 1) clipped++;
            count++;
          }
      const seconds =
        project.source.kind === "score"
          ? loopSeconds(
              arrange(
                {
                  ...shapeScore(project.source.score, {
                    transpose: project.settings.transpose ?? 0,
                  }),
                  bpm:
                    project.source.score.bpm *
                    (project.settings.tempoScale ?? 1),
                },
                project.settings.chip,
              ),
            )
          : result.native && project.source.kind === "native"
            ? project.source.plan.seconds
            : performanceClock(
                project.source.performance,
                project.settings.tempoScale,
              )(project.source.performance.endTick);
      parentPort!.postMessage({
        report: {
          engineVersion: result.engineVersion,
          chip: project.settings.chip,
          native: result.native,
          seconds,
          sourceNotes:
            project.source.kind === "score"
              ? null
              : project.source.performance.parts.reduce(
                  (n, p) => n + p.notes.length,
                  0,
                ),
          plannedNotes: result.plan?.notes.length ?? null,
          silentNotes: result.plan?.silentNotes ?? [],
          losses: result.plan?.losses ?? [],
          mix: result.plan?.mix ?? null,
          audio: {
            seconds: result.audio.seconds,
            sampleRate: result.audio.sampleRate,
            peak,
            rms: count ? Math.sqrt(sum / count) : 0,
            clippedSamples: clipped,
          },
          limitations: [
            "Audio measurements cover only the first two seconds.",
            "Allocation and mix reports are deterministic diagnostics, not a musical-quality or original-game-fidelity score.",
          ],
        },
      });
    } else {
      const bytes = toWav(result.audio);
      if (bytes.length > 40 * 1024 * 1024)
        throw Error(
          "Server audio exceeds 40 MB; export the complete song locally",
        );
      const mp3 = encodeMp3(
        result.audio.left,
        result.audio.sampleRate,
        workerData.tags,
        result.audio.right,
      );
      parentPort!.postMessage({ bytes, mp3 }, [bytes.buffer, mp3.buffer]);
    }
  }
} catch (error) {
  parentPort!.postMessage({
    error: error instanceof Error ? error.message : "Render failed",
  });
}
