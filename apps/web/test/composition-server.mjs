import { createServer as httpServer } from "node:http";
import { createServer as netServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

export function fixtureScore(seconds = 10) {
  const end = seconds * 960;
  return {
    title: "Composition transport fixture", description: "Recorded response for an API test", bpm: 120,
    parts: [
      { name: "Theme", role: "lead", program: 80, priority: 100, importance: 1,
        notes: Array.from({ length: seconds * 2 - 1 }, (_, i) => ({ tick: i * 480, endTick: Math.min(end, i * 480 + 400), pitch: [72,76,79,74][i % 4], velocity: 85, drum: null })) },
      { name: "Bass", role: "bass", program: 38, priority: 90, importance: 0.6,
        notes: Array.from({ length: seconds }, (_, i) => ({ tick: i * 960, endTick: i * 960 + 600, pitch: [36,41,43,36][i % 4], velocity: 65, drum: null })) },
    ],
  };
}

/** A real local Next server, isolated DB and either a recorded HTTP provider or explicit live credentials. */
export async function compositionServer({ live = false } = {}) {
  if (live && !process.env.OPENAI_API_KEY) throw Error("Set OPENAI_API_KEY in apps/web/.env.local before the live evaluation");
  const directory = await mkdtemp(join(tmpdir(), "chipvoice-composition-"));
  const calls = [];
  const provider = live ? null : httpServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    calls.push(body);
    const prompt = body.input;
    if (prompt === "slow") await new Promise(resolve => setTimeout(resolve, 3000));
    if (prompt === "http-error") {
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "DO_NOT_LEAK_PROVIDER_BODY" }));
      return;
    }
    const seconds = Number(body.instructions.match(/Duration is exactly (\d+)/)[1]);
    const score = fixtureScore(seconds);
    if (prompt === "invalid") score.parts[0].notes[0].endTick = -1;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      status: prompt === "incomplete" ? "incomplete" : "completed", model: body.model,
      usage: { input_tokens: 100, output_tokens: 200, total_tokens: 300 },
      output: [{ type: "message", content: prompt === "refuse" ? [{ type: "refusal", refusal: "No" }] : [{ type: "output_text", text: JSON.stringify(score) }] }],
    }));
  });
  if (provider) await new Promise(resolve => provider.listen(0, "127.0.0.1", resolve));
  const reservation = netServer();
  await new Promise(resolve => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env, VERCEL_ENV: "preview", DOMANI_API_KEY: "",
    TURSO_DEV_DATABASE_URL: `file:${join(directory, "data.db")}`, TURSO_DEV_AUTH_TOKEN: "",
    SITE: base, URL: base, API_URL: base,
    OPENAI_API_KEY: live ? process.env.OPENAI_API_KEY : "test-not-a-real-key",
    OPENAI_BASE_URL: live ? (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1/") : `http://127.0.0.1:${provider.address().port}/v1/`,
    OPENAI_MODEL: live ? (process.env.OPENAI_MODEL ?? "gpt-6-astra") : "gpt-6-astra",
    COMPOSITION_PROVIDER: "openai", COMPOSITION_DAILY_LIMIT: "10",
  };
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], { env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  server.stdout.on("data", chunk => { log += chunk; });
  server.stderr.on("data", chunk => { log += chunk; });
  async function close() {
    if (server.exitCode === null) {
      server.kill("SIGTERM");
      await new Promise(resolve => server.once("exit", resolve));
    }
    if (provider) { provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve)); }
    await rm(directory, { recursive: true, force: true });
  }
  try {
    for (let attempt = 0; attempt < 120; attempt++) {
      if (server.exitCode !== null) throw Error(log);
      try { if ((await fetch(base + "/api/v1/capabilities")).ok) return { base, env, calls, close, logs: () => log }; } catch {}
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw Error("The local server did not start");
  } catch (e) { await close(); throw e; }
}
