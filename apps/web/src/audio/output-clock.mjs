/** Audio device time, extrapolated to this animation frame. Never subtract
 * latency twice: the timestamp already describes the output device. */
export function outputTime(context, now = performance.now()) {
  const stamp = context.getOutputTimestamp?.();
  if (context.state === 'running' && stamp?.performanceTime > 0 && stamp.contextTime >= 0) {
    return Math.max(0, Math.min(context.currentTime, stamp.contextTime + (now - stamp.performanceTime) / 1000));
  }
  return Math.max(0, context.currentTime - (context.baseLatency || 0) - (context.outputLatency || 0));
}
