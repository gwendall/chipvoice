import { parentPort, workerData } from 'node:worker_threads';
import { arrange, renderSong, toWav } from 'chipvoice';
import { encodeMp3 } from './mp3';
import type { AudioJob } from './audio-renderer';

const job = workerData as AudioJob;
try {
  const audio = renderSong(arrange(job.score), { seconds: job.seconds, sampleRate: 44100, stereo: true });
  const bytes = job.format === 'wav' ? toWav(audio) : encodeMp3(audio.left, audio.sampleRate, job.tags, audio.right);
  parentPort!.postMessage({ bytes }, [bytes.buffer]);
} catch (error) { parentPort!.postMessage({ error: error instanceof Error ? error.message : 'Audio render failed.' }); }
