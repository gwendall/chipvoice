'use client';
import { useEffect, useRef, useState } from 'react';
import { runnableCode, type SongDocument } from './document';
export function CodePanel({ song, onNotice }: { song: SongDocument; onNotice: (message: string) => void }) {
  const [view, setView] = useState<'code' | 'score'>('code');
  const [rendering, setRendering] = useState(false);
  const worker = useRef<Worker | null>(null);
  useEffect(() => () => worker.current?.terminate(), []);
  const content = view === 'code' ? runnableCode(song) : JSON.stringify(song, null, 2);
  const copy = async () => { try { await navigator.clipboard.writeText(content); onNotice(`${view === 'code' ? 'Runnable code' : 'Score'} copied.`); } catch { onNotice('Select the text below to copy it.'); } };
  const download = () => {
    if (rendering) return;
    setRendering(true);
    const renderer = new Worker(new URL('./render.worker.ts', import.meta.url));
    worker.current = renderer;
    const finish = () => { renderer.terminate(); worker.current = null; setRendering(false); };
    renderer.onerror = () => { onNotice('Audio export failed. Please try again.'); finish(); };
    renderer.onmessage = event => {
      if (event.data.error) onNotice(event.data.error);
      else {
        const url = URL.createObjectURL(new Blob([event.data.wav], { type: 'audio/wav' }));
        const a = document.createElement('a'); a.href = url; a.download = `${song.title || 'chipvoice'}.wav`; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000); onNotice('Stereo WAV ready. Live effects are not recorded.');
      }
      finish();
    };
    renderer.postMessage(song);
  };
  return <section className="code-panel" aria-label="Use this music in your project"><div className="section-heading"><div><span className="micro">TAKE IT WITH YOU</span><h2>This sound is a few lines of code.</h2></div><code>npm i chipvoice</code></div><p>Install the library in your browser project. This example creates its own Play button. Your full score, machine and timbres are included.</p><div className="code-actions"><button className="small-button" aria-pressed={view === 'code'} onClick={() => setView('code')}>JavaScript</button><button className="small-button" aria-pressed={view === 'score'} onClick={() => setView('score')}>Score JSON</button><button className="small-button dark" onClick={() => void copy()}>Copy {view}</button><button className="small-button" disabled={rendering} onClick={download}>{rendering ? 'Rendering audio…' : 'Download WAV'}</button></div><pre tabIndex={0}><code>{content}</code></pre><p className="export-note">{rendering ? 'Rendering in the background. You can keep playing.' : 'Exports contain your score edits. Mute, solo and live arcade effects are listening controls.'}</p></section>;
}
