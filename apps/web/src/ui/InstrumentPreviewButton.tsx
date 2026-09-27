'use client';
import {useEffect, useState} from 'react';
import {useT} from '@/i18n/react';
import {PlayButton} from '@/ui/components';

/**
 * The instrument catalogue (NEXT-05) is a server component now - see
 * `Instruments.tsx` - so this is the one part of each card that still needs
 * the browser: a play button. It gets only a file and a name, never the
 * catalogue's measured numbers, which is what keeps the client bundle small.
 *
 * One playhead is shared by every button on the page, at module scope rather
 * than in component state, so the module (loaded once per page) plays
 * exactly one preview at a time without threading state back up through the
 * server-rendered cards above it.
 */
let shared: HTMLAudioElement | null = null;
let activeId: string | null = null;
const listeners = new Set<(id: string | null) => void>();
function setActive(id: string | null) {
  activeId = id;
  for (const listener of listeners) listener(id);
}

export default function InstrumentPreviewButton({id, file, name}: {id: string; file: string; name: string}) {
  const t = useT();
  const [playing, setPlaying] = useState(() => activeId === id);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const listener = (next: string | null) => setPlaying(next === id);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, [id]);

  const toggle = () => {
    if (!shared) {
      shared = new Audio();
      shared.addEventListener('ended', () => setActive(null));
      shared.addEventListener('error', () => setActive(null));
    }
    if (activeId === id) { shared.pause(); setActive(null); return; }
    setLoading(true);
    shared.src = file;
    shared.play().then(() => { setLoading(false); setActive(id); }).catch(() => { setLoading(false); setActive(null); });
  };

  return <PlayButton playing={playing} loading={loading} aria-label={t('Play {name} preview', {name})} onClick={toggle}/>;
}
