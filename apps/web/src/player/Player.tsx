'use client';
import {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import Link, {useT, useErrorText} from '@/i18n/react';
import {PlayButton, Button} from '@/ui/components';
import {Thumbnail} from '@/ui/Thumbnail';
import {PixelAvatar} from '@/community/avatar';
import {DEMO_MACHINES} from '@/studio/document';
import type {Publication} from '@/lib/projects';
import {playbackSession as session, type Playback, type QueueTrack} from './session';
import {playPublication} from './publications';
import './style.css';
export function usePlayback() { useSyncExternalStore(session.subscribe, session.snapshot, session.serverSnapshot); return session; }
const stamp = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
/** The audio clock updates only these DOM nodes, never the editor or app tree. */
export function PlayerControls({player, onToggle, seconds = 0, loading = false, disabled = false, compact = false, playing = player?.playing() ?? false}: {
  player?: Playback | null; onToggle?: () => void; seconds?: number; loading?: boolean; disabled?: boolean; compact?: boolean; playing?: boolean;
}) {
  const t = useT(); usePlayback();
  const range = useRef<HTMLInputElement>(null), elapsed = useRef<HTMLOutputElement>(null), duration = useRef<HTMLSpanElement>(null);
  const dragging = useRef(false);
  useEffect(() => {
    let frame = 0, last = '';
    const tick = () => {
      const length = player?.duration() || seconds, position = player?.position() ?? 0;
      if (range.current && !dragging.current) { range.current.max = String(length || 1); range.current.value = String(Math.min(position, length)); }
      const label = `${stamp(position)}/${stamp(length)}`;
      if (last !== label) {
        last = label;
        if (elapsed.current) elapsed.current.textContent = stamp(position);
        if (duration.current) duration.current.textContent = stamp(length);
        range.current?.setAttribute('aria-valuetext', t('{elapsed} of {duration}', {elapsed: stamp(position), duration: stamp(length)}));
      }
      frame = requestAnimationFrame(tick);
    }; tick(); return () => cancelAnimationFrame(frame);
  }, [player, seconds, t]);
  return <div className={`player-controls ${compact ? 'compact' : ''}`}>
    <div className={compact ? "player-time" : "song-time"}><output ref={elapsed} aria-label={compact ? t('Playback time') : t('Elapsed time')}>0:00</output><span ref={duration}>{stamp(player?.duration() || seconds)}</span></div>
    <input ref={range} className={compact ? "player-seek" : "song-seek"} aria-label={compact ? t('Playback position') : t('Song position')} type="range" min={0} max={player?.duration() || seconds || 1} step={.05} defaultValue={0} disabled={!player?.seek || !player.ready()} onPointerDown={() => { dragging.current = true; }} onPointerUp={() => { dragging.current = false; }} onPointerCancel={() => { dragging.current = false; }} onBlur={() => { dragging.current = false; }} onChange={e => player?.seek?.(Number(e.target.value))}/>
    <div className="transport-actions">
      <PlayButton aria-label={compact ? (playing ? t('Pause playback') : t('Start playback')) : undefined} pause playing={playing} loading={loading || player?.loading()} disabled={disabled} onClick={() => onToggle ? onToggle() : session.toggle(player)}/>
      <Button className="player-restart" disabled={!player?.ready()} aria-label={compact ? t('Back to beginning') : t('Restart')} onClick={() => player?.restart()}><span aria-hidden="true">↤</span><span>{t('Restart')}</span></Button>
      {player?.setLoop && <Button aria-label={compact ? t('Repeat playback') : undefined} aria-pressed={player.loop?.()} onClick={() => { player.setLoop?.(!player.loop?.()); session.refresh(); }}>{t('↻ Loop ')}{player.loop?.() ? t('on') : t('off')}</Button>}
    </div>
  </div>;
}
export function PublicationPlay({item, queue, full = false}: {item: QueueTrack; queue?: QueueTrack[]; full?: boolean}) {
  const state = usePlayback(), t = useT();
  const selected = [state.pending, state.active].find(p => p?.key === `publication:${item.id}`);
  const play = () => { if (selected) session.toggle(selected); else void playPublication(item, queue); };
  return full ? <PlayerControls player={selected} onToggle={play}/> : <Button className="publication-play" aria-label={t('Play {title}', {title: item.title})} aria-pressed={!!selected?.playing()} onClick={play}>{selected?.loading() ? t('Loading…') : selected?.playing() ? t('Pause') : t('Play')}</Button>;
}
/** Mounted once beside route children. Keeping the audio owner here allows
 * normal Next navigation without keeping any hidden editor trees alive. */
export function PersistentPlayer() {
  const state = usePlayback(), t = useT(), errorText = useErrorText();
  const root = useRef<HTMLElement>(null);
  const [expanded, setExpanded] = useState(false), [queueOpen, setQueueOpen] = useState(false);
  const player = state.active ?? state.pending;
  const info = player?.info();
  useEffect(() => {
    const timer = setInterval(() => session.refresh(), 50);
    const key = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat || event.defaultPrevented || (event.target instanceof Element && event.target.closest('input,textarea,select,button,a,summary,[contenteditable]'))) return;
      if (session.active || session.pending) { event.preventDefault(); session.toggle(); }
    };
    window.addEventListener('keydown', key);
    return () => { clearInterval(timer); window.removeEventListener('keydown', key); };
  }, []);
  useEffect(() => { document.body.classList.toggle('has-player', !!player); return () => document.body.classList.remove('has-player'); }, [!!player]);
  useEffect(() => { const node=root.current;if(!node)return;const observer=new ResizeObserver(()=>document.documentElement.style.setProperty('--player-height', `${node.getBoundingClientRect().height}px`));observer.observe(node);return()=>{observer.disconnect();document.documentElement.style.removeProperty('--player-height');}; }, [!!player]);
  if (!player || !info) return state.error ? <aside className="persistent-player" role="alert">{errorText(state.error)}</aside> : null;
  return <aside ref={root} className={`persistent-player ${expanded ? 'expanded' : ''}`} aria-label={t('Now playing')}>
    <div className="player-identity">
      {info.profileId && !info.blind ? <PixelAvatar id={info.profileId} avatar={info.avatar} size={40}/> : <Thumbnail width={40} className="player-artwork">{!info.blind && <span aria-hidden="true">♫</span>}</Thumbnail>}
      <div><Link href={info.href}>{info.blind ? t('Blind comparison') : info.translateTitle ? t.source(info.title) : info.title}</Link><span>{info.blind ? t('Identities hidden') : [info.creator, info.chip ? t(DEMO_MACHINES.find(m => m.id === info.chip)?.name ?? info.chip) : null].filter(Boolean).join(' · ')}</span></div>
    </div>
    <PlayerControls player={player} compact playing={(state.pending??player).playing()} loading={!!state.pending} onToggle={() => session.toggle()}/>
    <button className="player-expand small-button" aria-label={expanded ? t('Collapse player') : t('Expand player')} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? '⌄' : '⌃'}</button>
    <div className="player-extras">
      {state.queue.length > 1 && <><Button aria-label={t('Previous song')} disabled={state.queueIndex < 1} onClick={() => state.next(-1)}>〈</Button><Button aria-label={t('Next song')} disabled={state.queueIndex >= state.queue.length - 1} onClick={() => state.next()}>〉</Button><Button aria-expanded={queueOpen} onClick={() => setQueueOpen(!queueOpen)}>{t('Queue')} · {state.queueIndex + 1}/{state.queue.length}</Button></>}
      <label>{t('Volume')}<input aria-label={t('Playback volume')} type="range" min={0} max={1} step={.01} value={state.volume} onChange={e => state.setVolume(Number(e.target.value))}/></label>
      {!info.blind && info.download && <a href={info.download} download aria-label={t('Download current recording')}>↓</a>}
      <Link href={info.href}>{player.key.startsWith('publication:') ? t('Open song') : t('Open workspace')} ↗</Link>
    </div>
    {(state.pending || state.error || player.error()) && <p className="player-status" role="status">{state.error || player.error() ? errorText(state.error || player.error()) : t('Preparing your next sound…')}</p>}
    {queueOpen && !!state.queue.length && <ol className="player-queue" aria-label={t('Queue')}>{state.queue.map((track, index) => <li key={track.id}><button aria-current={index === state.queueIndex ? 'true' : undefined} onClick={() => state.next(index - state.queueIndex)}>{track.title}</button></li>)}</ol>}
  </aside>;
}
