import type {PerformancePlan} from './performance.js';
import type {RegisterEvent} from './chip.js';
import {MASTER_HZ} from './chips/md/dsp.js';
import {CPU_HZ as NES_HZ} from './chips/nes/dsp.js';
import {CLOCK_HZ as GB_HZ} from './chips/gb/dsp.js';

export interface VgmImportOptions {
  onCommand?: (sample: number, command: number, register: number, value: number) => void;
  onDacStream?: (sample: number, offset: number) => void;
}

/** Decode an uncompressed VGM for the Mega Drive, the NES 2A03 or the Game
 * Boy DMG into the ordinary register renderer. The target machine is read
 * from the header's own clock fields, the way a real player picks it: the
 * Mega Drive needs both its YM2612 and SN76489 clocks, the 2A03 and the DMG
 * each need only their own (added to the header in VGM 1.61, so an older
 * header never claims one). A file naming a second chip, PAL clocks, the
 * Famicom Disk System bit or an unknown command fails explicitly: this is
 * not a generic player for every VGM chip or stream. VGM timing is 44,100
 * ticks/s, not a capture of the original CPU bus cycles, and only the
 * YM2612's two-step port protocol needs the buffered-write spacing below;
 * the 2A03 and DMG take single-byte writes straight off the timeline. */
export function importVgm(bytes: Uint8Array, options: VgmImportOptions = {}): PerformancePlan {
  if (bytes.length < 64 || bytes.length > 8 * 1024 * 1024) throw new Error('Invalid VGM size (maximum 8 MiB)');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (at: number) => view.getUint32(at, true);
  if (u32(0) !== 0x206d6756 || u32(4) + 4 !== bytes.length) throw new Error('Expected a complete, uncompressed VGM');
  const version = u32(8);
  if (version < 0x150 || version > 0x171) throw new Error('Supported VGM versions: 1.50–1.71');
  const start = u32(0x34) ? 0x34 + u32(0x34) : 0x40;
  const total = u32(0x18), loop = u32(0x1c) ? 0x1c + u32(0x1c) : -1;
  if (start < 64 || start >= bytes.length || !total || total > 600 * 44100) throw new Error('Invalid VGM header or duration');
  // These fields only exist from VGM 1.61 on; a shorter or older header reads
  // as "no NES/Game Boy declared" rather than as garbage from elsewhere.
  const headerClock = (offset: number) => (version >= 0x161 && offset + 4 <= start) ? u32(offset) : 0;
  const gbClock = headerClock(0x80), nesClock = headerClock(0x84);
  if (nesClock || gbClock) {
    if (nesClock && gbClock) throw new Error('A VGM combining the NES APU and the Game Boy DMG is not supported');
    if (u32(0x0c) || u32(0x10) || u32(0x2c)) throw new Error('A VGM combining the NES APU or Game Boy DMG with another sound chip is not supported');
    return nesClock ? importNes(bytes, view, u32, start, total, loop, nesClock, options) : importGb(bytes, view, u32, start, total, loop, gbClock, options);
  }
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
    } else if (op === 0xe0) { need(4); cursor = u32(at); at += 4; if (cursor > pcmLength) throw new Error('VGM PCM seek out of range'); options.onDacStream?.(sample,cursor); }
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

/** Command 0xB4: NES APU write, register 0x00-0x1F onto $4000-$401F. Bit 7 of
 * the register selects a second, "Dual Chip Support #2" APU; bits 30/31 of
 * the header clock request that second chip or Famicom Disk System audio.
 * Neither is modeled, so both fail by name rather than being read partially.
 * DPCM sample bytes travel as data-block type 0xC2 ("NES APU RAM write"): a
 * 16-bit address plus raw bytes, matching the DMC's own memory/load contract
 * exactly, unlike the bulk-bank type 0x07 paired with DAC Stream Control
 * commands 0x90-0x95, which this importer does not support. */
function importNes(bytes: Uint8Array, view: DataView, u32: (at: number) => number, start: number, total: number, loop: number, rawClock: number, options: VgmImportOptions): PerformancePlan {
  if (rawClock & 0x80000000) throw new Error('Famicom Disk System expansion audio is not supported');
  if (rawClock & 0x40000000) throw new Error('A second NES APU chip (dual-chip VGM) is not supported');
  if (rawClock !== NES_HZ) throw new Error(`Expected the NTSC NES APU clock (${NES_HZ} Hz); PAL and other clocks are not supported`);
  const events: RegisterEvent[] = [];
  const memory: PerformancePlan['memory'] = [];
  let at = start, sample = 0, loopSample = -1, ended = false;
  const need = (count: number) => { if (at + count > bytes.length) throw new Error('Truncated VGM command'); };
  while (at < bytes.length) {
    if (at === loop) loopSample = sample;
    const op = bytes[at++];
    if (op === 0x66) { ended = true; break; }
    else if (op === 0xb4) {
      need(2);
      const reg = bytes[at], value = bytes[at + 1]; at += 2;
      if (reg & 0x80) throw new Error('A second NES APU chip register write is not supported');
      if (reg > 0x1f) throw new Error('Famicom Disk System expansion audio registers are not supported');
      if (events.length >= 2_000_000) throw new Error('VGM exceeds two million bus writes');
      options.onCommand?.(sample, 0xb4, reg, value);
      events.push({at: Math.round(sample * NES_HZ / 44100), addr: 0x4000 + reg, value});
    }
    else if (op === 0x61) { need(2); sample += view.getUint16(at, true); at += 2; }
    else if (op === 0x62) sample += 735;
    else if (op === 0x63) sample += 882;
    else if (op >= 0x70 && op <= 0x7f) sample += op - 0x6f;
    else if (op === 0x67) {
      need(6);
      if (bytes[at] !== 0x66) throw new Error('Unsupported VGM data block');
      const type = bytes[at + 1], length = u32(at + 2);
      at += 6; need(length);
      if (type !== 0xc2) throw new Error(`Unsupported VGM data block type 0x${type.toString(16)}`);
      if (length < 2) throw new Error('Invalid NES APU RAM write block');
      memory.push({address: view.getUint16(at, true), bytes: bytes.slice(at + 2, at + length)});
      at += length;
    }
    else if (op >= 0x90 && op <= 0x95) throw new Error('NES APU DAC-stream commands are not supported');
    else throw new Error(`Unsupported VGM command 0x${op.toString(16)} at ${at - 1}`);
    if (sample > total) throw new Error('VGM duration exceeds header');
  }
  if (!ended || sample !== total) throw new Error('Incomplete VGM timeline');
  if (loop !== -1 && (loopSample < 0 || loopSample >= total || total - loopSample !== u32(0x20))) throw new Error('Invalid VGM loop boundary');
  return {chip: '2a03', seconds: total / 44100, loopStartSeconds: Math.max(0, loopSample) / 44100, events, memory, notes: [], losses: []};
}

/** Command 0xB3: Game Boy DMG write, register 0x00-0x2F onto $FF10-$FF3F
 * (the four sound channels and their shared wave RAM, in one linear range).
 * As with the NES, bit 7 of the register selects a second DMG under "Dual
 * Chip Support #2", and bit 30 of the header clock requests it; neither is
 * modeled. The DMG has no disk-drive-style expansion audio and no header
 * flag for PAL, since the hardware itself has none. */
function importGb(bytes: Uint8Array, view: DataView, u32: (at: number) => number, start: number, total: number, loop: number, rawClock: number, options: VgmImportOptions): PerformancePlan {
  if (rawClock & 0x80000000) throw new Error('Unsupported Game Boy DMG clock flag');
  if (rawClock & 0x40000000) throw new Error('A second Game Boy DMG chip (dual-chip VGM) is not supported');
  if (rawClock !== GB_HZ) throw new Error(`Expected the Game Boy DMG clock (${GB_HZ} Hz)`);
  const events: RegisterEvent[] = [];
  let at = start, sample = 0, loopSample = -1, ended = false;
  const need = (count: number) => { if (at + count > bytes.length) throw new Error('Truncated VGM command'); };
  while (at < bytes.length) {
    if (at === loop) loopSample = sample;
    const op = bytes[at++];
    if (op === 0x66) { ended = true; break; }
    else if (op === 0xb3) {
      need(2);
      const reg = bytes[at], value = bytes[at + 1]; at += 2;
      if (reg & 0x80) throw new Error('A second Game Boy DMG chip register write is not supported');
      if (reg > 0x2f) throw new Error('Unsupported Game Boy DMG register');
      if (events.length >= 2_000_000) throw new Error('VGM exceeds two million bus writes');
      options.onCommand?.(sample, 0xb3, reg, value);
      events.push({at: Math.round(sample * GB_HZ / 44100), addr: 0xff10 + reg, value});
    }
    else if (op === 0x61) { need(2); sample += view.getUint16(at, true); at += 2; }
    else if (op === 0x62) sample += 735;
    else if (op === 0x63) sample += 882;
    else if (op >= 0x70 && op <= 0x7f) sample += op - 0x6f;
    else if (op >= 0x90 && op <= 0x95) throw new Error('Game Boy DAC-stream commands are not supported');
    else throw new Error(`Unsupported VGM command 0x${op.toString(16)} at ${at - 1}`);
    if (sample > total) throw new Error('VGM duration exceeds header');
  }
  if (!ended || sample !== total) throw new Error('Incomplete VGM timeline');
  if (loop !== -1 && (loopSample < 0 || loopSample >= total || total - loopSample !== u32(0x20))) throw new Error('Invalid VGM loop boundary');
  return {chip: 'dmg', seconds: total / 44100, loopStartSeconds: Math.max(0, loopSample) / 44100, events, memory: [], notes: [], losses: []};
}
