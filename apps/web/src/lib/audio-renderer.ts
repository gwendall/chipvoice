import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Score } from 'chipvoice';
import type { Tags } from './id3';
import { createRenderCache } from './render-cache';

export interface AudioJob { score: Score; seconds: number; format: 'mp3' | 'wav'; tags: Tags }
const workerPath = join(process.cwd(), 'generated', 'audio-render.cjs');
const cached = createRenderCache();
let version: string | undefined;

export function renderAudio(job: AudioJob, admit: () => void) {
  // Hash the actual built renderer, including chip/arranger/encoder changes,
  // instead of assuming the npm version changes with every deployment.
  version ??= createHash('sha256').update(readFileSync(workerPath)).digest('hex');
  const key = createHash('sha256').update(version).update(JSON.stringify(job)).digest('hex');
  return cached(key, () => { admit(); return runWorker(job); });
}

function runWorker(job: AudioJob): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath, { workerData: job, resourceLimits: { maxOldGenerationSizeMb: 128 } });
    let done = false;
    const finish = (error?: Error, bytes?: Uint8Array<ArrayBuffer>) => {
      if (done) return; done = true;
      clearTimeout(timer); void worker.terminate();
      if (error) reject(error); else resolve(bytes!);
    };
    const timer = setTimeout(() => finish(new Error('Audio render exceeded its time budget.')), 45_000);
    worker.once('message', message => finish(message.error ? new Error(message.error) : undefined, message.bytes));
    worker.once('error', error => finish(error));
    worker.once('exit', () => { if (!done) finish(new Error('Audio worker exited before returning a file.')); });
  });
}
