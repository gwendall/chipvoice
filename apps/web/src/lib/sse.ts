/** Bounded SSE decoding shared by the provider adapter and browser subscription.
 * Only complete events are emitted. A disconnected stream never implies success. */
export async function* readSSE(body: ReadableStream<Uint8Array>, maxBytes = 8 * 1024 * 1024) {
  const reader = body.getReader(), decoder = new TextDecoder();
  let buffer = "", scanned = 0, bytes = 0, event = "message", data: string[] = [];
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) throw Error("Event stream exceeded its size limit");
      buffer += decoder.decode(chunk.value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf("\n", scanned)) >= 0) {
        const line = buffer.slice(0, end).replace(/\r$/, "");
        buffer = buffer.slice(end + 1);
        scanned = 0;
        if (!line) {
          if (data.length) yield { event, data: data.join("\n") };
          event = "message"; data = [];
        } else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
        else if (line.startsWith("event:")) event = line.slice(6).trim();
      }
      scanned = buffer.length;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
