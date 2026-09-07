/** Audio device time, extrapolated to this animation frame. Never subtract
 * latency twice: the timestamp already describes the output device. */
const lastOutputTimes = new WeakMap();
export function outputTime(context, now = performance.now()) {
  const stamp = context.getOutputTimestamp?.();
  const estimate = context.state === 'running' && stamp?.performanceTime > 0 && stamp.contextTime >= 0
    ? stamp.contextTime + (now - stamp.performanceTime) / 1000
    : context.currentTime - (context.baseLatency || 0) - (context.outputLatency || 0);
  // A refreshed device timestamp can trail our previous extrapolation when
  // the audio thread is starved. Hold that position until it catches up;
  // otherwise a score can visibly switch back across a scheduled crossfade.
  // Seeking changes the transport offset, never the AudioContext clock.
  const audible = Math.max(0, Math.min(context.currentTime, Math.max(lastOutputTimes.get(context) ?? 0, estimate)));
  lastOutputTimes.set(context, audible);
  return audible;
}
