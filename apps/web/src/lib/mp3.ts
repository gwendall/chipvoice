import { Mp3Encoder } from "@breezystack/lamejs";

/**
 * LAME, compiled to JavaScript.
 *
 * Not ffmpeg: a serverless function has no binaries to call, and shipping one
 * would tie the deployment to a runtime image. This runs anywhere the rest of
 * the code does, which is the same reason the chip itself is JavaScript.
 *
 * Mono at 128 kbps. The 2A03 is mono - the two pulses, the triangle and the
 * noise are summed by the hardware into one signal - so a stereo file would be
 * twice the bytes for the same sound.
 */
const BITRATE = 128;
const BLOCK = 1152; // one MPEG frame

export function encodeMp3(samples: Float32Array, sampleRate: number): Uint8Array {
  const encoder = new Mp3Encoder(1, sampleRate, BITRATE);
  const chunks: Uint8Array[] = [];

  // LAME wants 16-bit signed integers, and the renderer produces floats.
  const pcm = new Int16Array(BLOCK);
  for (let offset = 0; offset < samples.length; offset += BLOCK) {
    const size = Math.min(BLOCK, samples.length - offset);
    for (let i = 0; i < size; i++) {
      const v = Math.max(-1, Math.min(1, samples[offset + i]));
      pcm[i] = Math.round(v * 32767);
    }
    const frame = encoder.encodeBuffer(pcm.subarray(0, size));
    if (frame.length > 0) chunks.push(new Uint8Array(frame));
  }

  const tail = encoder.flush();
  if (tail.length > 0) chunks.push(new Uint8Array(tail));

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
