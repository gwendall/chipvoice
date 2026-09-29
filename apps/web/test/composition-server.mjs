import { createServer as httpServer } from "node:http";
import { createServer as netServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

// Decision 56 (NEXT-21): the first 16 melody notes of Mario's Ground Theme,
// reconstructed from the exact interval/duration-ratio data
// src/lib/composition/known-melodies.ts stores (see that file's comment for
// the source). An unmodified reconstruction always scores 1.0 against the
// same reference, comfortably above KNOWN_MELODY_THRESHOLD (0.40), so this
// is a deterministic fixture for the "known-melody" prompt sentinel below -
// no audio, no sheet music, the same short interval/rhythm data already
// committed to the repo.
const MARIO_INTERVALS = [0, 0, -4, 4, 3, -12, 5, -5, -3, 5, 2, -1, -1, -2, 9];
const MARIO_DURATION_RATIOS = [1.8899, 1.0069, 0.4951, 2.0119, 2.0325, 0.9835, 0.7656, 0.9807, 1.0216, 0.6502, 1.0069, 0.4951, 2.0119, 0.6969];
function knownMelodyLeadNotes() {
  const pitches = [72];
  for (const interval of MARIO_INTERVALS) pitches.push(pitches[pitches.length - 1] + interval);
  const iois = [480];
  for (const ratio of MARIO_DURATION_RATIOS) iois.push(iois[iois.length - 1] * ratio);
  const ticks = [0];
  for (const ioi of iois) ticks.push(ticks[ticks.length - 1] + ioi);
  return pitches.map((pitch, i) => ({ tick: Math.round(ticks[i]), endTick: Math.round(ticks[i]) + 200, pitch, velocity: 85, drum: null }));
}
function knownMelodyScore() {
  return {
    title: "Known-melody fixture", description: "Recorded response for a moderation/known-melody test", bpm: 120,
    parts: [{ name: "Theme", role: "lead", program: 80, priority: 100, importance: 1, notes: knownMelodyLeadNotes() }],
  };
}

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

/** A real local Next server, isolated DB and either a recorded HTTP provider or explicit live credentials.
 * Composition is open to every account unless a test asks for the closed beta
 * (`access: "invite"`) or a monthly budget (decision 42). */
export async function compositionServer({ live = false, mailBase, access = "open", budgetUsd } = {}) {
  if (live && !process.env.OPENAI_API_KEY) throw Error("Set OPENAI_API_KEY in apps/web/.env.local before the live evaluation");
  const directory = await mkdtemp(join(tmpdir(), "chipvoice-composition-"));
  const calls = [];
  // Decision 56 (NEXT-21): moderation calls are tracked separately from
  // `calls` (the paid Responses API) so every existing `server.calls.length`
  // assertion in test-generation.mjs stays correct unchanged - a moderation
  // call was never a provider call as far as those tests are concerned.
  const moderationCalls = [];
  const provider = live ? null : httpServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    // The free Moderation API (decision 56): sentinel prompts drive the same
    // three outcomes the paid-provider branch below uses for its own
    // sentinels - flagged, unavailable (fails closed) and the ordinary
    // unflagged pass-through every other prompt gets.
    if (request.url?.includes("moderations")) {
      moderationCalls.push(body);
      if (body.input === "moderation-down") {
        response.writeHead(500, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "DO_NOT_LEAK_PROVIDER_BODY" }));
        return;
      }
      const flagged = body.input === "flag-me";
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        id: "modr-fixture", model: body.model,
        results: [{ flagged, categories: { violence: flagged, hate: false, harassment: false }, category_scores: {} }],
      }));
      return;
    }
    calls.push(body);
    const prompt = body.input;
    if (prompt === "slow") await new Promise(resolve => setTimeout(resolve, 3000));
    if (prompt === "http-error") {
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "DO_NOT_LEAK_PROVIDER_BODY" }));
      return;
    }
    const seconds = Number(body.instructions.match(/Duration is exactly (\d+)/)[1]);
    const score = prompt === "known-melody" ? knownMelodyScore() : fixtureScore(seconds);
    if (prompt === "invalid") score.parts[0].notes[0].endTick = -1;
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.write(`data: ${JSON.stringify({type:"response.output_text.delta",delta:JSON.stringify(score)})}\n\n`);
    if (prompt === "streaming") await new Promise(resolve => setTimeout(resolve, 3500));
    response.end(`data: ${JSON.stringify({type: prompt === "incomplete" ? "response.incomplete" : "response.completed", response: {
      status: prompt === "incomplete" ? "incomplete" : "completed", model: body.model,
      usage: { input_tokens: 100, output_tokens: 200, total_tokens: 300 },
      output: [{ type: "message", content: prompt === "refuse" ? [{ type: "refusal", refusal: "No" }] : [{ type: "output_text", text: JSON.stringify(score) }] }],
    }})}\n\n`);
  });
  if (provider) await new Promise(resolve => provider.listen(0, "127.0.0.1", resolve));
  const reservation = netServer();
  await new Promise(resolve => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env, VERCEL_ENV: "preview", DOMANI_API_KEY: mailBase ? "fixture-mail-key" : "", DOMANI_BASE_URL: mailBase ?? "https://domani.run", CHIPVOICE_MAIL_FROM: "hello@chipvoice.dev",
    TURSO_DEV_DATABASE_URL: `file:${join(directory, "data.db")}`, TURSO_DEV_AUTH_TOKEN: "",
    SITE: base, URL: base, API_URL: base,
    OPENAI_API_KEY: live ? process.env.OPENAI_API_KEY : "test-not-a-real-key",
    OPENAI_BASE_URL: live ? (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1/") : `http://127.0.0.1:${provider.address().port}/v1/`,
    OPENAI_MODEL: live ? (process.env.OPENAI_MODEL ?? "gpt-6-astra") : "gpt-6-astra",
    COMPOSITION_PROVIDER: "openai", COMPOSITION_DAILY_LIMIT: "20", COMPOSITION_ACCESS: access,
    COMPOSITION_MONTHLY_BUDGET_USD: budgetUsd === undefined ? "" : String(budgetUsd),
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
      try { if ((await fetch(base + "/api/v1/capabilities")).ok) return { base, env, calls, moderationCalls, close, logs: () => log }; } catch {}
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw Error("The local server did not start");
  } catch (e) { await close(); throw e; }
}
