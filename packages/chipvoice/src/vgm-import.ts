import type {PerformancePlan} from './performance.js';
import {MASTER_HZ} from './chips/md/dsp.js';

/** Decode an uncompressed Mega Drive VGM into the ordinary register renderer.
 * Preserves FM patches, automation and DAC bytes. Unknown hardware/commands
 * fail explicitly: this is not a generic player for every VGM chip or stream.
 * VGM timing is 44,100 ticks/s, not a capture of the original CPU bus cycles. */
export function importVgm(bytes: Uint8Array, options: {onCommand?: (sample: number, command: number, register: number, value: number) => void} = {}): PerformancePlan {
  if (bytes.length < 64 || bytes.length > 8 * 1024 * 1024) throw new Error('Invalid VGM size (maximum 8 MiB)');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (at: number) => view.getUint32(at, true);
  if (u32(0) !== 0x206d6756 || u32(4) + 4 !== bytes.length) throw new Error('Expected a complete, uncompressed VGM');
  const version = u32(8);
  if (version < 0x150 || version > 0x171) throw new Error('Supported VGM versions: 1.50–1.71');
  const start = u32(0x34) ? 0x34 + u32(0x34) : 0x40;
  const total = u32(0x18), loop = u32(0x1c) ? 0x1c + u32(0x1c) : -1;
  if (start < 64 || start >= bytes.length || !total || total > 600 * 44100) throw new Error('Invalid VGM header or duration');
  // This bus currently models the NTSC Mega Drive. Do not silently retune PAL,
  // dual-chip files, alternate PSG shift registers or Game Gear stereo.
  if (u32(0x0c) !== 3579545 || u32(0x2c) !== 7670453 || u32(0x10) || view.getUint16(0x28, true) !== 9 || bytes[0x2a] !== 16 || bytes[0x2b]) throw new Error('Expected NTSC Mega Drive YM2612 and SN76489 clocks/configuration');
  const events: PerformancePlan['events'] = [];
  let at = start, sample = 0, loopSample = -1, ended = false, pcm = new Uint8Array(bytes.length), pcmLength = 0, cursor = 0;
  const need = (count: number) => { if (at + count > bytes.length) throw new Error('Truncated VGM command'); };
  let ymFree = 42 * 15;
  const emit = (addr: number, value: number, cycle = Math.round(sample * MASTER_HZ / 44100)) => {
    if (events.length >= 2_000_000) throw new Error('VGM exceeds two million bus writes');
    events.push({at: cycle, addr, value});
  };
  // VGM logs logical register writes, often many at the same sample. Nuked's
  // documented buffered-write adapter spaces each port byte by 15 internal
  // clocks; adjacent-clock writes overwrite pending FM settings. Keep source
  // timestamps in onCommand, and serialize only the physical FM bus here.
  const fm = (port: number, reg: number, value: number) => {
    options.onCommand?.(sample, 0x52 + port, reg, value);
    const cycle = Math.max(Math.ceil(sample * MASTER_HZ / 44100 / 42) * 42, ymFree);
    emit(0xa04000 + port * 2, reg, cycle);
    emit(0xa04001 + port * 2, value, cycle + 42 * 15);
    ymFree = cycle + 42 * 30;
  };
  while (at < bytes.length) {
    if (at === loop) loopSample = sample;
    const op = bytes[at++];
    if (op === 0x66) { ended = true; break; }
    if (op === 0x50) { need(1); const value = bytes[at++]; options.onCommand?.(sample, 0x50, 0, value); emit(0xc00011, value); }
    else if (op === 0x52 || op === 0x53) { need(2); fm(op - 0x52, bytes[at], bytes[at + 1]); at += 2; }
    else if (op === 0x4f) { need(1); if (bytes[at++] !== 255) throw new Error('Game Gear stereo is not Mega Drive hardware'); }
    else if (op === 0x61) { need(2); sample += view.getUint16(at, true); at += 2; }
    else if (op === 0x62) sample += 735;
    else if (op === 0x63) sample += 882;
    else if (op >= 0x70 && op <= 0x7f) sample += op - 0x6f;
    else if (op === 0x67) {
      need(6);
      if (bytes[at] !== 0x66 || bytes[at + 1] !== 0) throw new Error('Unsupported VGM data block');
      const length = u32(at + 2); at += 6; need(length);
      pcm.set(bytes.subarray(at, at + length), pcmLength); pcmLength += length; at += length;
    } else if (op === 0xe0) { need(4); cursor = u32(at); at += 4; if (cursor > pcmLength) throw new Error('VGM PCM seek out of range'); }
    else if (op >= 0x80 && op <= 0x8f) {
      if (cursor >= pcmLength) throw new Error('VGM DAC reads outside its sample bank');
      fm(0, 0x2a, pcm[cursor++]); sample += op - 0x80;
    } else throw new Error(`Unsupported VGM command 0x${op.toString(16)} at ${at - 1}`);
    if (sample > total) throw new Error('VGM duration exceeds header');
  }
  if (!ended || sample !== total) throw new Error('Incomplete VGM timeline');
  if (loop !== -1 && (loopSample < 0 || loopSample >= total || total - loopSample !== u32(0x20))) throw new Error('Invalid VGM loop boundary');
  // Include the internal clock that accepts the final data byte. A bounded
  // renderer must never silently truncate an otherwise accepted command stream.
  if (ymFree > 42 * 15 && ymFree - 42 * 15 + 42 > Math.floor(total * MASTER_HZ / 44100)) throw new Error('VGM FM bus exceeds the captured duration');
  return {chip: 'md', seconds: total / 44100, loopStartSeconds: Math.max(0, loopSample) / 44100, events, memory: [], notes: [], losses: []};
}
