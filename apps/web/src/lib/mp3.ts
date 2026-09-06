import { Mp3Encoder } from "@breezystack/lamejs";
import { id3, type Tags } from "./id3";

/**
 * LAME, compiled to JavaScript.
 *
 * Not ffmpeg: a serverless function has no binaries to call, and shipping one
 * would tie the deployment to a runtime image. This runs anywhere the rest of
 * the code does, which is the same reason the chip itself is JavaScript.
 *
 * Mono at 128 kbps or stereo at 192 kbps when the renderer supplies both channels.
 */
const BITRATE = 128;
const BLOCK = 1152; // one MPEG frame

export function encodeMp3(
  samples: Float32Array,
  sampleRate: number,
  tags?: Tags,
  right?: Float32Array | null,
): Uint8Array<ArrayBuffer> {
  const encoder = new Mp3Encoder(right ? 2 : 1, sampleRate, right ? 192 : BITRATE);
  // The published types say Uint8Array; the current runtime returns Int8Array.
  const chunks: (Int8Array | Uint8Array)[] = [];

  // LAME wants 16-bit signed integers, and the renderer produces floats.
  const pcm = new Int16Array(BLOCK);
  const pcmRight = right ? new Int16Array(BLOCK) : null;
  for (let offset = 0; offset < samples.length; offset += BLOCK) {
    const size = Math.min(BLOCK, samples.length - offset);
    for (let i = 0; i < size; i++) {
      const v = Math.max(-1, Math.min(1, samples[offset + i]));
      pcm[i] = Math.round(v * 32767);
      if (right && pcmRight) pcmRight[i] = Math.round(Math.max(-1, Math.min(1, right[offset + i])) * 32767);
    }
    const frame = encoder.encodeBuffer(size === BLOCK ? pcm : pcm.subarray(0, size), pcmRight ? (size === BLOCK ? pcmRight : pcmRight.subarray(0, size)) : undefined);
    // lamejs returns an owned copy, including for flush; retain it until concat.
    if (frame.length > 0) chunks.push(frame);
  }

  const tail = encoder.flush();
  if (tail.length > 0) chunks.push(tail);

  // The tag goes in front of the first frame, which is where every reader
  // looks for it.
  const header = tags ? id3(tags) : new Uint8Array(0);
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, header.length);
  const out = new Uint8Array(total);
  out.set(header, 0);
  let at = header.length;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
