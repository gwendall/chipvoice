'use client';
import {useT} from '@/i18n/react';
import { useEffect, useRef, useState } from 'react';
import { runnableCode, type SongDocument } from './document';
import type { ExportKind } from './exports';
function dispose(worker: Worker | null) {
  if (!worker) return;
  worker.onmessage = null; worker.onerror = null; worker.terminate();
}
export function CodePanel({ song, onNotice }: { song: SongDocument; onNotice: (message: string) => void }) {
 const t = useT();
  const [view, setView] = useState<'code' | 'score'>('code');
  const [rendering, setRendering] = useState(false);
  const worker = useRef<Worker | null>(null);
  const [progress, setProgress] = useState('');
  const cancel = () => { dispose(worker.current); worker.current = null; setRendering(false); setProgress(''); };
  useEffect(() => () => { dispose(worker.current); worker.current = null; }, []);
  const content = view === 'code' ? runnableCode(song,{play:t('Play / stop'),unavailable:t('AudioWorklet unavailable')}) : JSON.stringify(song, null, 2);
  const copy = async () => { try { await navigator.clipboard.writeText(content); onNotice(`${view === 'code' ? 'Runnable code' : 'Score'} copied.`); } catch { onNotice('Select the text below to copy it.'); } };
  const download = (kind: ExportKind) => {
    if (worker.current) return;
    setRendering(true); setProgress('Rendering audio…');
    let renderer: Worker;
    try { renderer = new Worker(new URL('./render.worker.ts', import.meta.url)); }
    catch { setRendering(false); onNotice('Audio export could not start. Please try again.'); return; }
    worker.current = renderer;
    const finish = () => { dispose(renderer); if (worker.current === renderer) { worker.current = null; setRendering(false); } };
    renderer.onerror = event => { event.preventDefault(); if (worker.current !== renderer) return; onNotice('Audio export failed. Please try again.'); finish(); };
    renderer.onmessage = event => {
      if (worker.current !== renderer) return;
      if (event.data.progress) { setProgress(event.data.progress); return; }
      if (event.data.error) onNotice(event.data.error);
      else {
        const url = URL.createObjectURL(new Blob([event.data.bytes], { type: event.data.type }));
        const a = document.createElement('a'); a.href = url; a.download = `${song.title || 'chipvoice'}${kind === 'wav' || kind === 'vgm' ? '' : '-' + kind}.${event.data.extension}`; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000); onNotice('Download ready. Your full score was preserved.');
      }
      finish();
    };
    renderer.postMessage({ song, kind });
  };
  return <section className="code-panel" aria-label={t("Use this music in your project")}><div className="section-heading"><div><span className="micro">{t("TAKE IT WITH YOU")}</span><h2>{t("This sound is a few lines of code.")}</h2></div><code>npm i chipvoice</code></div><p>{t("Install the library in your browser project. This example creates its own Play button. Your full score, machine and timbres are included.")}</p><div className="code-actions"><button className="small-button" aria-pressed={view === 'code'} onClick={() => setView('code')}>{t("JavaScript")}</button><button className="small-button" aria-pressed={view === 'score'} onClick={() => setView('score')}>{t("Score JSON")}</button><button className="small-button dark" onClick={() => void copy()}>{t("Copy ")}{t(view)}</button><button className="small-button" disabled={rendering} onClick={() => download('wav')}>{t("Download WAV")}</button><button className="small-button" disabled={rendering} onClick={() => download('stems')}>{t("Download stems ZIP")}</button><button className="small-button" disabled={rendering} onClick={() => download('machines')}>{t("Download five machines ZIP")}</button>{['2a03', 'dmg', 'md'].includes(song.chip) && <button className="small-button" disabled={rendering} onClick={() => download('vgm')}>{t("Download VGM")}</button>}{rendering && <button className="small-button" onClick={cancel}>{t("Cancel export")}</button>}</div><pre tabIndex={0}><code>{content}</code></pre><p className="export-note">{t(rendering ? `${progress} You can keep playing.` : 'Exports contain your score edits. Bundles support up to 30 seconds. Stems render each part alone; their sum can differ from the full mix. Mute, solo and live effects are listening controls.')}</p></section>;
}
