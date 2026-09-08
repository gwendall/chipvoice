import { createHash } from "node:crypto";
import type { Caller } from "../auth";
import { projectViewer } from "../auth";
import { db, newId } from "../db";
import { canonical, ensureProfile, ownedProfile, getProject, publishProject, ProjectHttpError } from "../projects";
import { createProjectJob, getProjectJob } from "../project-jobs";
import { utilityWorker } from "../utility-worker";
import { compositionConfig, openAIModel, type CompositionModel } from "./model";
import { compositionRequest, compositionTarget, compositionInstructions, compositionSchema, compositionProject } from "./score";

function error(status: number, code: string, message: string): never { throw new ProjectHttpError(status, code, message); }
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const viewer = (row: Record<string, unknown>) => ({ userId: String(row.user_id), profileId: String(row.profile_id) });

export async function createGeneration(value: unknown, requestKey: string, caller: Caller) {
  const parsed = compositionRequest.safeParse(value);
  if (!parsed.success) error(422, "invalid_request", "Supply a prompt, supported target and duration from 10 to 90 seconds");
  const input = parsed.data;
  compositionTarget(input.target);
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(requestKey)) error(422, "invalid_request_key", "Supply an Idempotency-Key of 8–80 letters, digits, underscores or hyphens");
  if (caller.agent && input.profileId && input.profileId !== caller.agent.profileId) error(403, "artist_scope", "Use this agent's authorized artist");
  const artistId = caller.agent?.profileId ?? input.profileId;
  const artist = artistId ? await ownedProfile(caller.userId!, artistId) : await ensureProfile(caller.userId!);
  const request = { ...input, profileId: artist.id };
  const hash = digest(canonical(request));
  const client = await db();
  const existing = (await client.execute({ sql: "select id,request_hash from generations where user_id=? and request_key=?", args: [caller.userId!, requestKey] })).rows[0];
  if (existing) {
    if (existing.request_hash !== hash) error(409, "request_key_reused", "This key belongs to another generation request");
    return getGeneration(String(existing.id), caller);
  }
  const config = compositionConfig();
  const daily = Number(process.env.COMPOSITION_DAILY_LIMIT ?? 10);
  if (!Number.isSafeInteger(daily) || daily < 1 || daily > 100) error(503, "generation_disabled", "Invalid COMPOSITION_DAILY_LIMIT");
  const id = newId(), now = Date.now();
  const tx = await client.transaction("write");
  try {
    // Idempotency and admission share a transaction, including concurrent POSTs.
    const repeated = (await tx.execute({ sql: "select id,request_hash from generations where user_id=? and request_key=?", args: [caller.userId!, requestKey] })).rows[0];
    if (repeated) {
      if (repeated.request_hash !== hash) error(409, "request_key_reused", "This key belongs to another generation request");
      await tx.commit();
      return getGeneration(String(repeated.id), caller);
    }
    const count = (await tx.execute({ sql: "select count(*) as total from generations where user_id=? and created_at>=?", args: [caller.userId!, Math.floor(now / 86400000) * 86400000] })).rows[0];
    if (Number(count.total) >= daily) error(429, "generation_limit", "Today's composition allowance has been reached");
    const active = (await tx.execute({ sql: "select id from generations where user_id=? and status not in ('ready','failed','cancelled') and created_at>?", args: [caller.userId!, now - 600000] })).rows;
    if (active.length) error(429, "generation_busy", "Finish or cancel the current composition first");
    await tx.execute({ sql: `insert into generations(id,user_id,profile_id,key_id,agent_id,request_key,request_hash,request,model,status,created_at) values(?,?,?,?,?,?,?,?,?,'queued',?)`, args: [id, caller.userId!, artist.id, caller.keyId, caller.agent?.id ?? null, requestKey, hash, JSON.stringify(request), config.model, now] });
    await tx.commit();
  } catch (e) { await tx.rollback(); throw e; } finally { tx.close(); }
  return getGeneration(id, caller);
}

export async function getGeneration(id: string, caller: Caller) {
  const client = await db();
  let row = (await client.execute({ sql: "select * from generations where id=? and user_id=?", args: [id, caller.userId!] })).rows[0];
  if (!row || (caller.agent && row.profile_id !== caller.agent.profileId)) error(404, "not_found", "Generation not found");
  if (!["ready", "failed", "cancelled"].includes(String(row.status)) && (Date.now() - Number(row.created_at) > 600000 || (row.active && Date.now() - Number(row.started_at) > 210000))) {
    await client.execute({ sql: "update generations set status='failed',error='Generation interrupted or timed out; start a new request',active=0 where id=? and status not in ('ready','failed','cancelled')", args: [id] });
    if (row.render_job_id) await client.execute({ sql: "update project_jobs set status=case when status='rendering' then 'cancelling' else 'cancelled' end where id=? and status in ('queued','rendering')", args: [String(row.render_job_id)] });
    row = (await client.execute({ sql: "select * from generations where id=?", args: [id] })).rows[0];
  }
  const publication = row.project_id ? await getProject(String(row.project_id), projectViewer(caller)) : null;
  if (row.project_id && !publication) error(404, "not_found", "The generated song was withdrawn");
  const job = row.render_job_id ? await getProjectJob(String(row.render_job_id), projectViewer(caller)) : null;
  if (row.status === "rendering" && job && ["ready", "failed", "cancelled"].includes(job.status)) {
    const mp3Failed = job.status === "ready" && ["failed", "cancelled"].includes(job.mp3Status);
    const status = mp3Failed ? "failed" : job.status === "ready" && job.mp3Status !== "ready" ? "rendering" : job.status;
    const failure = mp3Failed ? "The complete MP3 could not be prepared" : job.error;
    await client.execute({ sql: "update generations set status=?,error=? where id=? and status='rendering'", args: [status, failure, id] });
    row.status = status; row.error = failure;
  }
  return {
    id: String(row.id), status: String(row.status), model: String(row.model),
    request: JSON.parse(String(row.request)), createdAt: Number(row.created_at),
    error: row.error ? String(row.error) : null,
    projectId: row.project_id ? String(row.project_id) : null,
    renderJobId: row.render_job_id ? String(row.render_job_id) : null,
    project: publication, render: job,
    evaluation: row.report ? JSON.parse(String(row.report)) : null,
    usage: row.usage ? JSON.parse(String(row.usage)) : null,
  };
}

async function authorized(row: Record<string, unknown>) {
  const client = await db();
  if (row.agent_id) {
    const grant = (await client.execute({ sql: "select scopes from agent_grants where id=? and user_id=? and profile_id=? and revoked_at is null and expires_at>?", args: [String(row.agent_id), String(row.user_id), String(row.profile_id), Date.now()] })).rows[0];
    if (!grant || !["generate", "projects:write", "render"].every(scope => JSON.parse(String(grant.scopes)).includes(scope))) return false;
  } else if (row.key_id) {
    if (!(await client.execute({ sql: "select id from keys where id=? and user_id=? and revoked_at is null", args: [String(row.key_id), String(row.user_id)] })).rows.length) return false;
  }
  return (await client.execute({ sql: "select id from profiles where id=? and user_id=?", args: [String(row.profile_id), String(row.user_id)] })).rows.length > 0;
}

/** Composition stores one normal project and uses its existing render job. */
export async function runGeneration(id: string, suppliedModel?: CompositionModel) {
  const client = await db(), now = Date.now();
  const row = (await client.execute({
    sql: "update generations set active=1,started_at=? where id=? and active=0 and status in ('queued','validating','saving') and created_at>? and (select count(*) from generations where active=1 and started_at>?)<2 returning *",
    args: [now, id, now - 600000, now - 210000],
  })).rows[0];
  if (!row) return;
  const controller = new AbortController();
  const stopped = async () => !(await client.execute({ sql: "select id from generations where id=? and status not in ('cancelled','failed')", args: [id] })).rows.length;
  const timer = setTimeout(() => controller.abort(), Math.min(180000, Number(row.created_at) + 600000 - Date.now()));
  let polling = false;
  const cancellation = setInterval(async () => {
    if (polling) return;
    polling = true;
    try { if (await stopped()) controller.abort(); } catch { controller.abort(); } finally { polling = false; }
  }, 500);
  try {
    if (!await authorized(row)) error(403, "authorization_expired", "Composition authorization expired or was revoked");
    const request = compositionRequest.parse(JSON.parse(String(row.request)));
    let project = row.document ? JSON.parse(String(row.document)) : null;
    if (row.status === "queued") {
      await client.execute({ sql: "update generations set status='composing' where id=? and active=1 and status='queued'", args: [id] });
      if (await stopped()) return;
      const model = suppliedModel ?? openAIModel({ ...compositionConfig(), model: String(row.model) });
      const result = await model.generate({ instructions: compositionInstructions(request), prompt: request.prompt, schema: compositionSchema, signal: controller.signal });
      if (await stopped()) return;
      project = compositionProject(result.value, request);
      await client.execute({ sql: "update generations set document=?,model=?,usage=?,status='validating' where id=? and status='composing'", args: [canonical(project), result.model, JSON.stringify(result.usage), id] });
      row.status = "validating"; row.model = result.model;
    }
    if (!project || await stopped()) return;
    if (!await authorized(row)) error(403, "authorization_expired", "Composition authorization expired or was revoked");
    if (row.status === "validating") {
      const result = await utilityWorker({ project, evaluate: true }, 30000, stopped);
      if (await stopped()) return;
      await client.execute({ sql: "update generations set report=?,status='saving' where id=? and status='validating'", args: [JSON.stringify(result.report), id] });
    }
    if (await stopped()) return;
    if (!await authorized(row)) error(403, "authorization_expired", "Composition authorization expired or was revoked");
    const publication = await publishProject(String(row.user_id), { project, visibility: request.visibility, origin: { method: "prompt", model: String(row.model) }, profileId: String(row.profile_id), viewer: viewer(row), requestKey: `generation-${id}` });
    await client.execute({ sql: "update generations set project_id=? where id=?", args: [publication.id, id] });
    if (await stopped()) return;
    const job = await createProjectJob(publication.id, viewer(row), "full");
    await client.execute({ sql: "update generations set render_job_id=?,status=case when status='saving' then 'rendering' else status end,document=null where id=?", args: [job.id, id] });
    if (await stopped()) await client.execute({ sql: "update project_jobs set status='cancelled' where id=? and status='queued'", args: [job.id] });
    // Rendering is advanced separately by normal job polling, within its own deadline.
  } catch (e) {
    if (e instanceof ProjectHttpError && e.status === 429) return;
    const message = e instanceof ProjectHttpError ? e.message : "Composition failed or was interrupted; try a simpler request";
    await client.execute({ sql: "update generations set status='failed',error=? where id=? and status not in ('cancelled','failed')", args: [message, id] });
  } finally {
    clearTimeout(timer); clearInterval(cancellation);
    await client.execute({ sql: "update generations set active=0 where id=?", args: [id] });
  }
}

export async function cancelGeneration(id: string, caller: Caller) {
  const generation = await getGeneration(id, caller);
  if (["ready", "failed"].includes(generation.status)) error(409, "already_finished", "This composition has already finished");
  const client = await db();
  await client.execute({ sql: "update generations set status='cancelled' where id=? and status not in ('ready','failed')", args: [id] });
  if (generation.renderJobId) await client.execute({ sql: "update project_jobs set status=case when status='rendering' then 'cancelling' else 'cancelled' end where id=? and status in ('queued','rendering')", args: [generation.renderJobId] });
  return getGeneration(id, caller);
}
