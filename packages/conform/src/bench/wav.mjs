/**
 * Enough of the WAV format to read a capture and write a render: PCM chunks
 * only, mono or the first channel of more, 16-bit or 24-bit integer or
 * 32-bit float samples. No dependency: a WAV's `fmt ` chunk says exactly
 * which of the three it is, and each is a short, well-known unpacking loop.
 */

/** Reads a WAV file's first channel as float samples in [-1, 1], plus its sample rate. */
export function readWav(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file');
  }
  let at = 12;
  let channels = 1;
  let sampleRate = 44100;
  let bitsPerSample = 16;
  let format = 1; // 1 = PCM integer, 3 = IEEE float
  while (at + 8 <= buf.length) {
    const id = buf.toString('ascii', at, at + 4);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === 'fmt ') {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bitsPerSample = view.getUint16(body + 14, true);
    } else if (id === 'data') {
      const bytesPerSample = bitsPerSample / 8;
      const frameBytes = bytesPerSample * channels;
      const n = Math.floor(size / frameBytes);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const off = body + i * frameBytes;
        let v;
        if (format === 3 && bitsPerSample === 32) v = view.getFloat32(off, true);
        else if (bitsPerSample === 16) v = view.getInt16(off, true) / 32768;
        else if (bitsPerSample === 24) {
          const b0 = buf[off];
          const b1 = buf[off + 1];
          const b2 = buf[off + 2];
          let raw = b0 | (b1 << 8) | (b2 << 16);
          if (raw & 0x800000) raw -= 0x1000000;
          v = raw / 8388608;
        } else if (bitsPerSample === 32 && format === 1) {
          v = view.getInt32(off, true) / 2147483648;
        } else {
          throw new Error(`unsupported WAV format ${format}/${bitsPerSample}-bit`);
        }
        out[i] = v;
      }
      return { samples: out, sampleRate, channels: 1, sourceChannels: channels, bitsPerSample, format };
    }
    at = body + size + (size & 1);
  }
  throw new Error('WAV file has no data chunk');
}

/** Writes mono float samples as a 24-bit PCM WAV. */
export function writeWav24(samples, sampleRate) {
  const bytesPerSample = 3;
  const dataSize = samples.length * bytesPerSample;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * bytesPerSample, 28);
  buf.writeUInt16LE(bytesPerSample, 32);
  buf.writeUInt16LE(24, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataSize, 40);
  let at = 44;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    let v = Math.round(clamped * 8388607);
    if (v < 0) v += 0x1000000;
    buf[at] = v & 0xff;
    buf[at + 1] = (v >> 8) & 0xff;
    buf[at + 2] = (v >> 16) & 0xff;
    at += 3;
  }
  return buf;
}
