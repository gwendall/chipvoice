import type {ArrangementPlayback} from '../audio/ArrangementPlayback';
import type {ProjectPlayer} from 'chipvoice';
import type {BufferPlayback} from '../audio/BufferPlayback.mjs';
import type {LivePlayback} from '../audio/LivePlayback';
import {registerPlayback, type TrackInfo} from './session';
/** A separate output gain controls session ownership without changing the
 * engine's own mix, matched A/B levels or transition envelopes. */
function gate(context: AudioContext, output: AudioNode) {
  const node = context.createGain(); node.gain.value = 0;
  output.disconnect(); output.connect(node); node.connect(context.destination);
  return { volume: (value: number) => { node.gain.cancelScheduledValues(context.currentTime); node.gain.setTargetAtTime(value, context.currentTime, .008); },
    dispose: () => { node.disconnect(); } };
}
export function bufferedPlayback(player: BufferPlayback | ArrangementPlayback, key: string, info: () => TrackInfo, dispose?: () => void) {
  const output = gate(player.context, player.output);
  const seconds = () => {const info = player.audibleSelection() as {seconds?:number;row?:{seconds?:number}} | null;return info?.seconds ?? info?.row?.seconds ?? (player.buffers[player.side] as {duration?:number} | undefined)?.duration ?? 0;};
  return registerPlayback(player, {
    key, info, playing: () => player.playing, loading: () => player.loading, error: () => player.error,
    duration: seconds, position: () => player.phase() * seconds(), ready: () => !!player.audibleSelection() || !!player.buffers.length,
    play: () => player.playing ? undefined : player.toggle(), pause: () => player.pause(),
    restart: () => player.restart(), seek: value => player.seek(value / (seconds() || 1)),
    loop: () => player.loop, setLoop: value => player.setLoop(value), volume: output.volume,
    dispose: () => { player.dispose(); output.dispose(); void player.context.close(); dispose?.(); },
  });
}
export function projectPlayback(player: ProjectPlayer, sourceHref: () => string) {
  const output = gate(player.context, player.output);
  let audible=player.audibleProject, href=sourceHref();
  const info=()=>{const project=player.audibleProject;if(project!==audible){audible=project;href=sourceHref();}return {title:project?.title??"Your composition",translateTitle:!project,chip:project?.settings.chip,href};};
  return registerPlayback(player, {
    key: `project:${crypto.randomUUID()}`, info,
    playing: () => player.playing, loading: () => player.preparing, error: () => player.error,
    duration: () => player.duration, position: () => player.position, ready: () => !!player.audibleProject,
    play: () => player.play(), pause: () => player.pause(), restart: () => player.restart(), seek: value => player.seek(value),
    loop: () => player.loop, setLoop: value => { player.loop = value; }, volume: output.volume,
    dispose: () => { player.dispose(); output.dispose(); },
  });
}
export function livePlayback(player: LivePlayback, info: () => TrackInfo) {
  const output = gate(player.context, player.output);
  return registerPlayback(player, {
    key: `live:${crypto.randomUUID()}`, info, playing: () => player.playing, loading: () => player.loading, error: () => player.error,
    duration: () => player.duration, position: () => player.position, ready: () => !!player.current,
    play: () => player.resume(), pause: () => player.pause(), restart: () => player.seek(0), seek: value => player.seek(value),
    volume: output.volume, dispose: () => { player.dispose(); output.dispose(); void player.context.close(); },
  });
}
