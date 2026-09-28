import { test } from "node:test";
import assert from "node:assert/strict";
import { readSSE } from "../dist/sse/index.js";

function streamOf(text) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function collect(iterable) {
  const events = [];
  for await (const event of iterable) events.push(event);
  return events;
}

test("readSSE yields only complete events, defaulting the event name to message", async () => {
  const events = await collect(readSSE(streamOf("data: hello\n\nevent: ping\ndata: 1\ndata: 2\n\n")));
  assert.deepEqual(events, [
    { event: "message", data: "hello" },
    { event: "ping", data: "1\n2" },
  ]);
});

test("readSSE drops an event with no data lines", async () => {
  const events = await collect(readSSE(streamOf("event: heartbeat\n\ndata: real\n\n")));
  assert.deepEqual(events, [{ event: "message", data: "real" }]);
});

test("readSSE enforces its byte budget", async () => {
  const big = "data: " + "x".repeat(100) + "\n\n";
  await assert.rejects(collect(readSSE(streamOf(big), 10)), /size limit/);
});

test("readSSE handles a chunk boundary splitting a line and CRLF terminators", async () => {
  const bytes = new TextEncoder().encode("data: split\r\n\r\n");
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.slice(0, 4));
      controller.enqueue(bytes.slice(4));
      controller.close();
    },
  });
  const events = await collect(readSSE(stream));
  assert.deepEqual(events, [{ event: "message", data: "split" }]);
});
