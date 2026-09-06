/** Offline-only observer of this port's private mixing seam. Never installed in
 * playback or shipped with chipvoice. Oracle parity still checks its output.
 * Final DAC peaks alone miss clipping before master-volume attenuation. */
export function observeSnesMixer(chip) {
  const dsp = chip.dsp;
  if (typeof dsp?.voice_output !== 'function' || !dsp.t_main_out || !dsp.t_echo_out) {
    throw new Error('SNES mixer observer needs updating for this DSP layout');
  }
  const original = dsp.voice_output;
  const counts = {mainClampedAdditions:0,echoClampedAdditions:0,mainClippedFrames:0,echoClippedFrames:0};
  let mainFrame = -1, echoFrame = -1;
  dsp.voice_output = function (voice, channel) {
    const signedVolume = this.regs[voice.base + channel] << 24 >> 24;
    const amp = this.t_output * signedVolume >> 7;
    const frame = Math.floor(chip.cycle / 32);
    const main = this.t_main_out[channel] + amp;
    if (main < -32768 || main > 32767) {
      counts.mainClampedAdditions++;
      if (mainFrame !== frame) { counts.mainClippedFrames++; mainFrame = frame; }
    }
    const echo = this.t_echo_out[channel] + amp;
    if ((this.t_eon & voice.vbit) && (echo < -32768 || echo > 32767)) {
      counts.echoClampedAdditions++;
      if (echoFrame !== frame) { counts.echoClippedFrames++; echoFrame = frame; }
    }
    return original.call(this, voice, channel);
  };
  return counts;
}
