"use client";
import { useEffect, useRef, useState } from "react";
import Link, { useT } from "@/i18n/react";
import { Button } from "@/ui/components";
import { RangeControl } from "@/ui/RangeControl";
import { SignInForm } from "@/auth/SignInForm";
import { useSession } from "@/auth/useSession";
import type { Profile } from "@/lib/projects";
const savedDraft = "chipvoice-prompt-draft";
const savedJob = "chipvoice-prompt-job", savedRequest = "chipvoice-prompt-request";
const finished = (status: string) => ["ready", "failed", "cancelled"].includes(status);
type Job = { id: string; status: string; projectId: string | null };
const stages: Record<string, string> = { queued: "Waiting to compose…", composing: "Composing your music…", validating: "Checking the arrangement…", saving: "Saving your song…", rendering: "Rendering the complete audio…", ready: "Your song is ready.", failed: "Could not generate this song. Try another prompt.", cancelled: "Composition cancelled." };
export default function PromptComposer({ target }: { target: string }) {
  const t = useT(), { status: session, email: accountEmail } = useSession();
  const [restored, setRestored] = useState(false);
  const [open, setOpen] = useState(false), [prompt, setPrompt] = useState(""), [seconds, setSeconds] = useState(60);
  const [artists, setArtists] = useState<Profile[]>([]), [artist, setArtist] = useState("");
  const [job, setJob] = useState<Job | null>(null), [sending, setSending] = useState(false), [message, setMessage] = useState("");
  const [lookup, setLookup] = useState<string | null>(null), [retry, setRetry] = useState(0);
  const request = useRef<{ fingerprint: string; key: string } | null>(null);
  const busy = sending || !!job && !finished(job.status);
  useEffect(() => {
    try {
      const draft = JSON.parse(localStorage.getItem(savedDraft) ?? "null");
      if (draft && typeof draft.prompt === "string" && draft.prompt.length <= 2000 && Number.isInteger(draft.seconds) && draft.seconds >= 10 && draft.seconds <= 90) {
        setPrompt(draft.prompt); setSeconds(draft.seconds);
        if (typeof draft.artist === "string") setArtist(draft.artist);
      }
    } catch {}
    if (new URLSearchParams(location.search).has("compose")) setOpen(true);
    setRestored(true);
  }, []);
  useEffect(() => { if (restored) { try { localStorage.setItem(savedDraft, JSON.stringify({prompt, seconds, artist})); } catch {} } }, [restored, prompt, seconds, artist]);
  useEffect(() => { try { const pending = sessionStorage.getItem(savedRequest); if (pending) { request.current = JSON.parse(pending); const body = JSON.parse(request.current!.fingerprint); setPrompt(body.prompt); setSeconds(body.durationSeconds); setArtist(body.profileId ?? ""); } const id = sessionStorage.getItem(savedJob); if (id) { setLookup(id); setOpen(true); } } catch {} }, []);
  useEffect(() => {
    if (session !== "signed-in") { setArtists([]); return; }
    if (!open) return;
    const abort = new AbortController();
    void fetch("/api/v1/profiles", { signal: abort.signal }).then(async r => {
      if (r.ok) { const data = await r.json(); setArtists(data.items); setArtist(current => data.items.some((profile: Profile) => profile.id === current) ? current : data.items[0]?.id || ""); }
    }).catch(() => {});
    return () => abort.abort();
  }, [open, session, accountEmail]);
  useEffect(() => {
    if (!lookup) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch(`/api/v1/generations/${lookup}`, { signal: abort.signal });
        if (!response.ok) throw Error("unavailable");
        const value = await response.json();
        if (abort.signal.aborted) return;
        setJob(value); setMessage("");
        if (!finished(value.status)) timer = setTimeout(poll, 2000);
        else { try { sessionStorage.removeItem(savedJob); sessionStorage.removeItem(savedRequest); } catch {} }
      } catch { if (!abort.signal.aborted) setMessage("Progress is unavailable. Retry to resume the same request."); }
    }
    void poll();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [lookup, retry]);
  const generate = async () => {
    if (session !== "signed-in") return;
    const body = { prompt, target, durationSeconds: seconds, ...(artist ? { profileId: artist } : {}) };
    const fingerprint = JSON.stringify(body);
    if (!request.current || request.current.fingerprint !== fingerprint || job && finished(job.status)) request.current = { fingerprint, key: crypto.randomUUID() };
    try { sessionStorage.setItem(savedRequest, JSON.stringify(request.current)); } catch {}
    setSending(true); setMessage("");
    try {
      const response = await fetch("/api/v1/generations", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": request.current.key }, body: fingerprint });
      const value = await response.json();
      if (!response.ok) {
        if (response.status === 401) window.dispatchEvent(new Event("chipvoice-session"));
        setMessage(response.status === 401 ? "Sign in to generate music." : response.status === 503 ? "Prompt composition is unavailable right now." : response.status === 429 ? "Composition is busy or your daily allowance is reached." : "Could not generate this song. Try another prompt.");
        return;
      }
      setJob(value); setLookup(value.id);
      try { sessionStorage.setItem(savedJob, value.id); } catch {}
    } catch { setMessage("Could not send the request. Retry with the same prompt."); }
    finally { setSending(false); }
  };
  const cancel = async () => {
    if (!job) return;
    try {
      const response = await fetch(`/api/v1/generations/${job.id}`, { method: "DELETE" });
      if (!response.ok) throw Error("cancel");
      setJob(await response.json()); setLookup(null);
      try { sessionStorage.removeItem(savedJob); sessionStorage.removeItem(savedRequest); } catch {}
    } catch { setMessage("Could not cancel. Check the current request again."); }
  };
  return <details id="prompt" className="prompt-composer" open={open} onToggle={e => setOpen(e.currentTarget.open)}>
    <summary>{t("Compose from a prompt")}</summary>
    <p>{t("Describe a new song. It starts private, with your selected console and artist. Your current draft stays here.")}</p>
    <form onSubmit={e => { e.preventDefault(); void generate(); }}>
      <label>{t("Music prompt")}<textarea required minLength={1} maxLength={2000} value={prompt} disabled={busy} onChange={e => setPrompt(e.target.value)} /></label>
      <div className="prompt-options">
        <RangeControl id="prompt-duration" label={t("Song duration")} unit={t("seconds")} min={10} max={90} value={seconds} disabled={busy} onChange={setSeconds} />
        {!!artists.length && <label>{t("Artist")}<select value={artist} disabled={busy} onChange={e => setArtist(e.target.value)}>{artists.map(p => <option key={p.id} value={p.id}>{p.displayName || p.handle || t("My artist")}</option>)}</select></label>}
      </div>
      <div className="project-actions">{session === "signed-in" && <Button type="submit" disabled={busy || !prompt.trim()}>{t("Generate music")}</Button>}{busy && job && <Button type="button" onClick={() => void cancel()}>{t("Cancel composition")}</Button>}</div>
    </form>
    {session === "checking" && <p role="status">{t("Checking your account…")}</p>}
    {session === "anonymous" && <section className="prompt-signin"><h2>{t("Sign in to generate your song")}</h2><p>{t("Your prompt is saved on this device. Follow the email link, then generate your music.")}</p><SignInForm next="/create?compose=1#prompt"/></section>}
    {session === "unavailable" && <p role="alert">{t("Accounts are unavailable right now. Your local draft is safe.")}</p>}
    <p role="status" aria-live="polite">{t.source(message || (sending ? "Sending your prompt…" : job ? stages[job.status] ?? "Waiting to compose…" : ""))}</p>
    {busy && !message && <progress aria-label={t("Composition progress")} />}
    {!!message && lookup && <Button onClick={() => setRetry(n => n + 1)}>{t("Retry progress")}</Button>}
    {job?.status === "ready" && job.projectId && <Link className="small-button dark" href={`/p/${job.projectId}`}>{t("Open your generated song")} →</Link>}
    <p><Link href="/library">{t("Your library")} →</Link></p>
  </details>;
}
