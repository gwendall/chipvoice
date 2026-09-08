import {handlePreviewMessage, type PreviewRequest} from "./preview-worker.js";
import { renderProject, type ProjectRenderOptions } from "./project-render.js";
import type { MusicProject } from "./project.js";
import { toWav } from "./render.js";
import { importMidi } from "./midi.js";
import { projectFromPerformance } from "./project.js";
import type { ProjectChip } from "./project.js";
const scope = globalThis as unknown as {
  onmessage: (
    event: MessageEvent<{
      project: MusicProject;
      options: ProjectRenderOptions;
      midi?: Uint8Array;
      title?: string;
      chip?: ProjectChip;
    }>,
  ) => void;
  postMessage: (value: unknown, transfer?: Transferable[]) => void;
};
scope.onmessage = ({ data }) => {
  if ('type' in data && (data.type === 'load' || data.type === 'read')) {
    void handlePreviewMessage({data} as MessageEvent<PreviewRequest>); return;
  }
  try {
    if (data.midi) {
      scope.postMessage({ progress: 0 });
      scope.postMessage({
        project: projectFromPerformance(
          importMidi(data.midi, { title: data.title }),
          data.chip ?? "2a03",
        ),
      });
      return;
    }
    let last = -1;
    const result = renderProject(data.project, {
      ...data.options,
      onProgress: (fraction) => {
        const percent = Math.floor(fraction * 100);
        if (percent !== last) {
          last = percent;
          scope.postMessage({ progress: fraction });
        }
      },
    });
    const wav = toWav(result.audio);
    scope.postMessage(
      {
        wav: wav.buffer,
        seconds: result.audio.seconds,
        peak: result.audio.peak,
        engineVersion: result.engineVersion,
        native: result.native,
        loopStartSeconds: result.loopStartSeconds,
        losses: result.plan?.losses ?? [],
        mix: result.plan?.mix ?? null,
      },
      [wav.buffer as ArrayBuffer],
    );
  } catch (error) {
    scope.postMessage({
      error: error instanceof Error ? error.message : "Could not prepare music",
    });
  }
};
