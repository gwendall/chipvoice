import { parentPort, workerData } from "node:worker_threads";
import { renderProject, toWav } from "chipvoice";
try {
  let last = 0;
  const result = renderProject(workerData.project, {
    seconds: workerData.kind === "preview" ? 30 : undefined,
    onProgress: (progress) => {
      if (Date.now() - last > 1000) {
        last = Date.now();
        parentPort!.postMessage({ progress });
      }
    },
  });
  const bytes = toWav(result.audio);
  parentPort!.postMessage({ bytes }, [bytes.buffer]);
} catch (error) {
  parentPort!.postMessage({
    error: error instanceof Error ? error.message : "Render failed",
  });
}
