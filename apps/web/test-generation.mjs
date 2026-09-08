import assert from "node:assert/strict";
import { build } from "../../packages/chipvoice/node_modules/esbuild/lib/main.js";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { compositionServer } from "./test/composition-server.mjs";
const server = await compositionServer();
Object.assign(process.env, server.env);
await build({ stdin: { contents: "export * from './src/lib/auth';export * from './src/lib/db';export * from './src/lib/projects';export * from './src/lib/composition/model';export * from './src/lib/sse';", resolveDir: process.cwd() }, outfile: "generated/test-generation.mjs", bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent" });
const api = await import("./generated/test-generation.mjs");
const out = "../../.artifacts/prompt-composition";
await mkdir(out, { recursive: true });
const key = await api.createKey("composition-test@example.test", "local test");
const caller = await api.identify(new Request(server.base, { headers: { Authorization: `Bearer ${key.key}` } }));
const headers = { Authorization: `Bearer ${key.key}`, "Content-Type": "application/json" };
const request = { prompt: "An original test theme", target: "md", durationSeconds: 10 };
const query = async (path, options = {}) => {
  const response = await fetch(server.base + path, options);
  return { status: response.status, body: await response.json() };
};
const post = (body, keyId, auth = headers) => ({ method: "POST", headers: { ...auth, "Idempotency-Key": keyId }, body: JSON.stringify(body) });
async function completed(id) {
  const deadline = Date.now() + 300000;
  let last;
  while (Date.now() < deadline) {
    const result = await query(`/api/v1/generations/${id}`, { headers });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    last = result.body;
    assert.ok(!server.logs().includes("SQLITE_BUSY"), server.logs());
    if (["ready", "failed", "cancelled"].includes(result.body.status)) return result.body;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw Error(`Generation did not finish: ${JSON.stringify({ status: last?.status, error: last?.error, render: last?.render })}`);
}
try {
  const configKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  assert.throws(() => api.compositionConfig(), error => error.code === "generation_disabled");
  process.env.OPENAI_API_KEY = configKey;
  assert.equal((await query("/api/v1/generations", post(request, "anonymous", { "Content-Type": "application/json" }))).status, 401);
  assert.equal((await query("/api/v1/generations", post({ ...request, target: "unknown" }, "bad-target"))).status, 422);
  assert.equal((await query("/api/v1/generations", post({ ...request, apiKey: "ignored?" }, "bad-field"))).status, 422);
  assert.equal(server.calls.length, 0);
  const submissions = await Promise.all(Array.from({ length: 3 }, () => query("/api/v1/generations", post(request, "same-request"))));
  submissions.forEach(result => assert.equal(result.status, 202));
  assert.equal(new Set(submissions.map(result => result.body.id)).size, 1);
  const id = submissions[0].body.id;
  assert.equal((await query("/api/v1/generations", post({ ...request, prompt: "different" }, "same-request"))).status, 409);
  const result = await completed(id);
  assert.equal(result.status, "ready", JSON.stringify(result));
  assert.equal(server.calls.length, 1, "concurrent retry makes exactly one provider call");
  assert.equal(server.calls[0].model, "gpt-6-astra");
  assert.equal(server.calls[0].store, false);
  assert.equal(server.calls[0].text.format.strict, true);
  assert.equal(result.project.visibility, "private");
  assert.equal(result.project.generation.prompt, request.prompt);
  assert.equal(result.project.profile.id, (await api.ensureProfile(caller.userId)).id);
  assert.equal(result.evaluation.seconds, 10);
  assert.equal(result.evaluation.audio.seconds, 2, "coverage is explicitly an opening excerpt");
  assert.equal(result.evaluation.losses.filter(loss => loss.kind === "voice-omitted").length, 0);
  assert.equal((await query("/api/v1/generations", post(request, "same-request"))).body.projectId, result.projectId);
  assert.equal(server.calls.length, 1);
  for (const format of ["wav", "mp3"]) {
    const path = `/api/v1/jobs/${result.renderJobId}/audio?format=${format}`;
    assert.equal((await fetch(server.base + path)).status, 404);
    const audio = await fetch(server.base + path, { headers });
    assert.equal(audio.status, 200);
    const bytes = Buffer.from(await audio.arrayBuffer());
    assert.equal(bytes.subarray(0, format === "wav" ? 4 : 3).toString(), format === "wav" ? "RIFF" : "ID3");
    await writeFile(`${out}/fixture.${format}`, bytes);
  }
  const otherKey = await api.createKey("other-composer@example.test", "test");
  assert.equal((await query(`/api/v1/generations/${id}`, { headers: { Authorization: `Bearer ${otherKey.key}` } })).status, 404);
  const publicCopy = await api.publishProject(caller.userId, { project: result.project.project, visibility: "public", requestKey: "public-copy", parentId: result.projectId });
  assert.equal((await query(`/api/v1/projects/${publicCopy.id}`)).body.generation, undefined, "private prompt is not copied into a public score");

  assert.equal((await fetch(server.base + `/api/v1/generations/${id}/events`)).status, 401);
  assert.equal((await fetch(server.base + `/api/v1/generations/${id}/events`, {headers:{Authorization:`Bearer ${otherKey.key}`}})).status,404);
  const streamCalls=server.calls.length;
  const streamed=await query('/api/v1/generations',post({...request,prompt:'streaming'},'streamed-request'));
  const seen=[];
  // Disconnect after a snapshot, then resume the same generation with no JSON polls.
  let stream=await fetch(server.base+`/api/v1/generations/${streamed.body.id}/events`,{headers});
  assert.match(stream.headers.get('content-type'),/text\/event-stream/);
  for await (const frame of api.readSSE(stream.body)) {seen.push(JSON.parse(frame.data));break;}
  while(!seen.some(event=>['ready','failed','cancelled'].includes(event.status))) {
    stream=await fetch(server.base+`/api/v1/generations/${streamed.body.id}/events`,{headers,signal:AbortSignal.timeout(30000)});
    for await(const frame of api.readSSE(stream.body)) {
      assert.equal(frame.event,'progress');
      const snapshot=JSON.parse(frame.data);seen.push(snapshot);
      assert.equal(snapshot.request,undefined);assert.equal(snapshot.project,undefined);
    }
  }
  assert.equal(seen.at(-1).status,'ready');
  assert.ok(seen.some(event=>event.status==='composing' && event.progress.outputCharacters>0),'live output progress arrives before composition completes');
  assert.equal(server.calls.length,streamCalls+1,'SSE reconnection never repeats paid inference');
  assert.ok(seen.at(-1).finishedAt >= seen.at(-1).createdAt);

  // A busy audio worker postpones evaluation, never repeats paid composition.
  const client = await api.db();
  await client.execute({ sql: "insert into evaluation_lease(singleton,id,expires_at) values(1,'test-composition-busy',?)", args: [Date.now() + 60000] });
  const countBeforeLease = server.calls.length;
  const held = await query("/api/v1/generations", post({ ...request, prompt: "held-evaluation" }, "worker-is-busy"));
  assert.equal(held.status, 202);
  for (let i = 0; i < 80; i++) {
    const value = (await query(`/api/v1/generations/${held.body.id}`, { headers })).body;
    if (value.status === "validating") break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(server.calls.length, countBeforeLease + 1);
  // Hold a real cross-process SQLite writer briefly as the server resumes work.
  // Use SQLite's native writer as the fault injector. The libsql binding can leave
  // its own COMMIT statement pending after contention, which tests the injector
  // instead of the server's ability to resume a concurrent paid request.
  const release = spawn("python3", ["-u", "-c", `
import sqlite3,sys
connection=sqlite3.connect(sys.argv[1],timeout=5)
try:
 connection.execute("begin immediate")
 connection.execute("delete from evaluation_lease where id='test-composition-busy'")
 print("locked",flush=True)
 sys.stdin.readline()
 connection.commit()
finally:
 connection.close()
`, server.env.TURSO_DEV_DATABASE_URL.slice(5)], { env: { PATH: process.env.PATH }, stdio: ["pipe", "pipe", "pipe"] });
  let writerError = "";
  release.stderr.on("data", data => { writerError += data; });
  const released = new Promise((resolve, reject) => { release.once("error", reject); release.once("exit", code => resolve(code)); });
  try {
    await Promise.race([
      new Promise(resolve => release.stdout.once("data", resolve)),
      released.then(() => { throw Error("Writer stopped before holding the lock: " + writerError); }),
    ]);
    await query(`/api/v1/generations/${held.body.id}`, { headers });
    await new Promise(resolve => setTimeout(resolve, 200));
  } finally { release.stdin.end("commit\n"); }
  assert.equal(await released, 0, writerError);
  assert.equal((await completed(held.body.id)).status, "ready");
  assert.equal(server.calls.length, countBeforeLease + 1);

  const token = await api.redeemMagicLink(await api.createSignInLink("composition-test@example.test"));
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addCookies([{ name: api.SESSION_COOKIE, value: token, url: server.base }]);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto(`${server.base}/p/${result.projectId}`);
    await page.getByText("Composition prompt", { exact: true }).click();
    await page.getByText(request.prompt, { exact: true }).waitFor();
    await page.getByRole("button",{name:"Play",exact:true}).click();
    await page.waitForFunction(() => Number(document.querySelector('.persistent-player input[type=range]')?.value) > 0);
    assert.ok(await page.locator(".persistent-player input[type=range]").first().evaluate(input => Math.abs(Number(input.max) - 10) < 0.25));
    await page.getByRole("button",{name:"Pause",exact:true}).click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `${out}/song-mobile.png`, fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: `${out}/song-desktop.png`, fullPage: true });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }

  for (const prompt of ["invalid", "refuse", "incomplete", "http-error"]) {
    const job = await query("/api/v1/generations", post({ ...request, prompt }, `failure-${prompt}`));
    assert.equal(job.status, 202);
    const failed = await completed(job.body.id);
    assert.equal(failed.status, "failed");
    assert.equal(failed.projectId, null);
    assert.ok(!JSON.stringify(failed).includes("DO_NOT_LEAK_PROVIDER_BODY"));
    const calls = server.calls.length;
    await query("/api/v1/generations", post({ ...request, prompt }, `failure-${prompt}`));
    assert.equal(server.calls.length, calls, "failed idempotent retry does not spend again");
  }
  const slow = await query("/api/v1/generations", post({ ...request, prompt: "slow" }, "cancel-model"));
  while (!(await query(`/api/v1/generations/${slow.body.id}`, { headers })).body.status.match(/composing|failed/)) await new Promise(resolve => setTimeout(resolve, 50));
  const cancelled = await query(`/api/v1/generations/${slow.body.id}`, { method: "DELETE", headers });
  assert.equal(cancelled.body.status, "cancelled");
  await new Promise(resolve => setTimeout(resolve, 3500));
  assert.equal((await completed(slow.body.id)).projectId, null, "cancelled model response cannot save a song");
  await client.execute({sql:"update generations set status='composing',active=1,started_at=? where id=?",args:[Date.now()-280000,slow.body.id]});
  const timedOut=await completed(slow.body.id);
  assert.equal(timedOut.status,'failed');assert.equal(timedOut.errorCode,'generation_timeout');assert.ok(timedOut.finishedAt);
  const artist = await api.ensureProfile(caller.userId);
  const grantToken = `cv_agent_${api.secret()}`;
  await client.execute({ sql: "insert into agent_grants(id,user_id,profile_id,hash,label,scopes,created_at,expires_at) values(?,?,?,?,?,?,?,?)", args: [api.newId(), caller.userId, artist.id, await api.hashKey(grantToken), "scope test", JSON.stringify(["projects:write", "render"]), Date.now(), Date.now() + 60000] });
  assert.equal((await query("/api/v1/generations", post(request, "missing-scope", { ...headers, Authorization: `Bearer ${grantToken}` }))).status, 403);
  const revokedToken = `cv_agent_${api.secret()}`;
  const revokedId = api.newId();
  await client.execute({ sql: "insert into agent_grants(id,user_id,profile_id,hash,label,scopes,created_at,expires_at) values(?,?,?,?,?,?,?,?)", args: [revokedId, caller.userId, artist.id, await api.hashKey(revokedToken), "revocation test", JSON.stringify(["generate", "projects:write", "render"]), Date.now(), Date.now() + 60000] });
  const revokedJob = await query("/api/v1/generations", post({ ...request, prompt: "slow" }, "revoked-model", { ...headers, Authorization: `Bearer ${revokedToken}` }));
  assert.equal(revokedJob.status, 202);
  while ((await query(`/api/v1/generations/${revokedJob.body.id}`, { headers })).body.status === "queued") await new Promise(resolve => setTimeout(resolve, 50));
  const revokedStream = await fetch(server.base + `/api/v1/generations/${revokedJob.body.id}/events`, {headers:{Authorization:`Bearer ${revokedToken}`}});
  let firstSnapshot = true, revocationNotice = false;
  for await (const frame of api.readSSE(revokedStream.body)) {
    if (firstSnapshot) {
      assert.equal(frame.event,'progress'); firstSnapshot=false;
      await client.execute({ sql: "update agent_grants set revoked_at=? where id=?", args: [Date.now(), revokedId] });
    } else { assert.equal(frame.event,'unavailable'); revocationNotice=true; }
  }
  assert.ok(revocationNotice,'an open SSE connection stops exposing progress after revocation');
  assert.equal((await fetch(server.base + `/api/v1/generations/${revokedJob.body.id}/events`, {headers:{Authorization:`Bearer ${revokedToken}`}})).status,401);
  const revokedResult = await completed(revokedJob.body.id);
  assert.equal(revokedResult.status, "failed");
  assert.equal(revokedResult.projectId, null);
  assert.match(revokedResult.error, /authorization/i);
  const count = Number((await client.execute({ sql: "select count(*) as n from generations where user_id=?", args: [caller.userId] })).rows[0].n);
  for (let i = count; i < 10; i++) await client.execute({ sql: "insert into generations(id,user_id,profile_id,request_key,request_hash,request,model,status,created_at) values(?,?,?,?,?,?,?,'failed',?)", args: [api.newId(), caller.userId, artist.id, `quota-${i}`, "test", JSON.stringify(request), "test", Date.now()] });
  const callsBeforeLimit = server.calls.length;
  assert.equal((await query("/api/v1/generations", post(request, "over-day-limit"))).status, 429);
  assert.equal(server.calls.length, callsBeforeLimit);
  // A terminal encoder error must not leave generation spinning until its deadline.
  const heldJob = (await completed(held.body.id)).renderJobId;
  await client.execute({ sql: "update project_jobs set mp3_status='failed' where id=?", args: [heldJob] });
  await client.execute({ sql: "update generations set status='rendering' where id=?", args: [held.body.id] });
  assert.equal((await completed(held.body.id)).status, "failed");
  await api.withdrawProject(result.projectId, caller.userId);
  assert.equal((await query(`/api/v1/generations/${id}`, { headers })).status, 404);
  await writeFile(`${out}/report.json`, JSON.stringify({ model: result.model, providerCalls: server.calls.length, evaluation: result.evaluation, privateSong: true, promptOwnerOnly: true, completeWavMp3: true }, null, 2));
  console.log("PASS prompt composition: actual HTTP provider adapter, idempotency, normal project/render storage, WAV/MP3, private prompt, failures, cancellation, scope and browser screenshots");
} catch (error) {
  console.error(server.logs());
  throw error;
} finally {
  await (await api.db()).close();
  await server.close();
}
