import type {Publication} from '@/lib/projects';
import {playbackSession as session, type Playback, type QueueTrack} from './session';

let generation = 0;
let request: AbortController | null = null;
/** Only fetch the chosen publication. Long recordings stay in the browser's
 * streaming media pipeline; a catalogue never decodes dozens of WAVs. */
export async function playPublication(item: Pick<Publication, 'id' | 'title'>, queue?: QueueTrack[]) {
  const key = `publication:${item.id}`;
  if (session.active?.key === key && !session.pending) { session.toggle(); return; }
  const ticket = ++generation;
  request?.abort(); const abort = new AbortController(); request = abort;
  const media = new Audio(); media.preload = 'metadata'; media.volume = 0;
  let publication: Publication | null = null, loading = true, error = '', intent = true, disposed = false;
  const adapter: Playback = {
    key, info: () => ({title: publication?.title ?? item.title, href: `/p/${item.id}`, chip: publication?.chip,
      creator: publication?.profile.displayName || publication?.profile.handle || '', profileId: publication?.profile.id,
      avatar: publication?.profile.avatar, download: publication ? media.src : undefined}),
    playing: () => intent && (loading || !media.paused), loading: () => loading,
    error: () => error, duration: () => Number.isFinite(media.duration) ? media.duration : 0,
    position: () => media.currentTime, ready: () => media.readyState >= 2,
    ended: () => media.ended,
    play: async () => { intent = true; if (media.src) { error = ''; await media.play(); } },
    pause: () => { intent = false; media.pause(); },
    restart: () => { media.currentTime = 0; }, seek: value => { media.currentTime = value; },
    loop: () => media.loop, setLoop: value => { media.loop = value; }, volume: value => { media.volume = value; },
    dispose: () => { disposed = true; abort.abort(); media.pause(); media.removeAttribute('src'); media.load(); },
  };
  session.attach(adapter);
  if (queue) session.setQueue(queue, item.id, next => { void playPublication(next); });
  session.request(adapter);
  // Detached immediately: the application, not a card or publication route,
  // owns the lifetime. Release is done after the async selection settles.
  const refresh = () => { session.refresh(); };
  for (const event of ['playing','pause','ended','durationchange','waiting','canplay','error']) media.addEventListener(event, () => {
    if (disposed) return;
    if (event === 'error') { loading = false; error = 'Audio unavailable. Try again.'; }
    if (event === 'playing' || event === 'canplay') loading = false;
    if (event === 'waiting') loading = true;
    refresh();
  });
  try {
    const response = await fetch(`/api/v1/projects/${item.id}`, {signal: abort.signal});
    if (!response.ok) throw Error('This song could not load.');
    publication = await response.json();
    const rendition = publication!.renditions?.find(r => r.kind === 'full' && r.status === 'ready') ?? publication!.renditions?.find(r => r.status === 'ready');
    if (!rendition) throw Error('This song has no ready recording yet.');
    if (ticket !== generation || disposed || !intent) return;
    media.src = `/api/v1/jobs/${rendition.id}/audio${rendition.mp3Bytes > 0 ? '?format=mp3' : ''}`;
    await media.play(); loading = false; session.refresh();
  } catch (e) {
    loading = false;
    if (!abort.signal.aborted && intent && !disposed) { error = e instanceof Error ? e.message : 'Audio unavailable. Try again.'; loading = false; session.refresh(); }
  } finally {
    // Once promoted, keep only the active asset. An unsuccessful/cancelled
    // selection is disposed; its error stays visible on the shared player.
    session.release(adapter);
  }
}
