/** Match both sides using the same measurement, attenuating only. */
export function listeningLevels(entries) {
  const useLUFS = entries.every(entry => Number.isFinite(entry.loudness?.integratedLUFS));
  const values = entries.map(entry => useLUFS ? entry.loudness.integratedLUFS : entry.metrics.rmsDbFS);
  const target = Math.min(useLUFS ? -23 : -26, ...values.filter(Number.isFinite));
  return {
    method: useLUFS ? 'LUFS' : 'RMS (approximation)',
    gains: values.map(value => Number.isFinite(value) ? 10 ** ((target - value) / 20) : 0),
  };
}
