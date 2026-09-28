/** Single byte ranges cover browser audio seeking. Unsupported multipart or
 * malformed syntax falls back to a complete, streamed response. */
export function audioRange(header: string | null, size: number): {start: number; end: number} | null | 'unsatisfiable' {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || !match[1] && !match[2]) return null;
  const a = match[1] ? Number(match[1]) : null, b = match[2] ? Number(match[2]) : null;
  if (a !== null && !Number.isSafeInteger(a) || b !== null && !Number.isSafeInteger(b)) return 'unsatisfiable';
  if (a === null) return b! > 0 && size > 0 ? {start: Math.max(0, size - b!), end: size - 1} : 'unsatisfiable';
  if (a >= size || b !== null && b < a) return 'unsatisfiable';
  return {start: a, end: Math.min(size - 1, b ?? size - 1)};
}

/** One bounded database chunk per pull; cancellation stops subsequent reads. */
export function audioStream(start: number, end: number, read: (chunk: number, offset: number, length: number) => Promise<Uint8Array>) {
  let position = start, cancelled = false;
  const chunkSize = 262144;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (cancelled) return;
      if (position > end) {controller.close(); return;}
      const chunk = Math.floor(position / chunkSize), offset = position % chunkSize;
      const length = Math.min(chunkSize - offset, end - position + 1);
      try {
        const bytes = await read(chunk, offset, length);
        if (cancelled) return;
        if (bytes.byteLength !== length) throw Error('Audio chunk is incomplete');
        position += length; controller.enqueue(bytes);
        if (position > end) controller.close();
      } catch (error) {if (!cancelled) controller.error(error);}
    },
    cancel() {cancelled = true;},
  }, {highWaterMark: 0});
}
