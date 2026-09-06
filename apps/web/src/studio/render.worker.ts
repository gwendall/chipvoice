import { exportSong, type ExportKind } from './exports';
import type { SongDocument } from './document';
self.onmessage = (event: MessageEvent<{ song: SongDocument; kind: ExportKind }>) => {
  try {
    const result = exportSong(event.data.song, event.data.kind, (done, total) => self.postMessage({ progress: `${done} / ${total} files` }));
    self.postMessage(result, { transfer: [result.bytes.buffer] });
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'Could not render audio.' }); }
};
