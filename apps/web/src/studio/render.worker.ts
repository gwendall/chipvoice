import { arrange, renderSong, toWav } from 'chipvoice';
import type { SongDocument } from './document';
self.onmessage = (event: MessageEvent<SongDocument>) => {
  try {
    const audio = renderSong(arrange(event.data), { chip: event.data.chip, stereo: true });
    const wav = toWav(audio);
    self.postMessage({ wav });
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'Could not render audio.' }); }
};
