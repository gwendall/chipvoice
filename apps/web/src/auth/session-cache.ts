/** Display metadata only. APIs still verify the real HttpOnly session cookie. */
import { SESSION_REVISION_COOKIE } from "./session-config";
export const SESSION_CACHE_KEY = "chipvoice-session-view-v1";
export const SESSION_CACHE_TTL = 5 * 60 * 1000;
export type SessionView = {
  status: "checking" | "signed-in" | "anonymous" | "unavailable";
  email: string | null;
  userId: string | null;
  profile: { id: string; displayName: string; handle: string | null; avatar: { palette: number; variant: number } | null } | null;
};
export const EMPTY_SESSION: SessionView = { status: "checking", email: null, userId: null, profile: null };
const listeners = new Set<() => void>();
let view = EMPTY_SESSION, revision = "", checkedAt = 0, hydrated = false;
let pending: { controller: AbortController; promise: Promise<void> } | undefined;
let removeEvents: (() => void) | undefined;
const cookieRevision = () => document.cookie.split(";").map(v => v.trim()).find(v => v.startsWith(SESSION_REVISION_COOKIE + "="))?.slice(SESSION_REVISION_COOKIE.length + 1) ?? "";
const notify = () => listeners.forEach(listener => listener());
function complete(controller: AbortController) {
  if (pending?.controller === controller) { pending = undefined; notify(); }
}
const clearStored = () => { try { sessionStorage.removeItem(SESSION_CACHE_KEY); } catch {} };
function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true; revision = cookieRevision();
  try {
    const cached = JSON.parse(sessionStorage.getItem(SESSION_CACHE_KEY) ?? "null");
    if (cached?.revision === revision && cached.checkedAt <= Date.now() && Date.now() - cached.checkedAt < 24 * 60 * 60 * 1000 &&
        ["signed-in", "anonymous"].includes(cached.view?.status) &&
        (cached.view.status === "anonymous" || (typeof cached.view.email === "string" && typeof cached.view.userId === "string" && typeof cached.view.profile?.id === "string"))) {
      view = cached.view; checkedAt = cached.checkedAt;
    } else clearStored();
  } catch { clearStored(); }
}
function reset() {
  pending?.controller.abort(); pending = undefined;
  checkedAt = 0; revision = cookieRevision(); view = EMPTY_SESSION;
  clearStored(); notify();
}
export function refreshSession(force = false): Promise<void> {
  hydrate();
  if (cookieRevision() !== revision) reset();
  if (pending) return pending.promise;
  if (!force && Date.now() - checkedAt < SESSION_CACHE_TTL) return Promise.resolve();
  const controller = new AbortController();
  const promise = (async () => {
    try {
      const response = await fetch("/api/auth/session", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
      const body = await response.json();
      if (controller.signal.aborted) return;
      if ((response.ok || response.status === 401 || response.status === 403) && typeof body.revision !== "string") throw Error("Invalid identity response");
      if ((response.ok || response.status === 401 || response.status === 403) && body.revision !== cookieRevision()) {
        reset(); void refreshSession(true); return;
      }
      if (response.ok && typeof body.email === "string" && typeof body.userId === "string" && typeof body.profile?.id === "string") {
        view = { status: "signed-in", email: body.email, userId: body.userId, profile: body.profile };
      } else if (response.status === 401 || response.status === 403) {
        view = { ...EMPTY_SESSION, status: "anonymous" };
      } else throw Error("Identity unavailable");
      revision = cookieRevision(); checkedAt = Date.now();
      try { sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify({ revision, checkedAt, view })); } catch {}
    } catch {
      if (controller.signal.aborted) return;
      // A transient outage does not turn a known signed-in visitor into a guest.
      if (view.status === "checking") view = { ...EMPTY_SESSION, status: "unavailable" };
      clearStored(); checkedAt = Date.now() - SESSION_CACHE_TTL + 10000;
    } finally {
      complete(controller);
    }
  })();
  pending = { controller, promise };
  return promise;
}
/** Cross-tab messages invalidate display state; they contain no identity or token. */
export function invalidateSession() {
  reset();
  try { localStorage.setItem("chipvoice-session-change", crypto.randomUUID()); } catch {}
  void refreshSession(true);
}
export function subscribeSession(listener: () => void) {
  hydrate(); listeners.add(listener);
  if (!removeEvents) {
    const visible = () => { if (document.visibilityState === "visible") void refreshSession(); };
    const storage = (event: StorageEvent) => { if (event.key === "chipvoice-session-change") { reset(); void refreshSession(true); } };
    window.addEventListener("focus", visible); window.addEventListener("online", visible);
    window.addEventListener("chipvoice-session", invalidateSession); window.addEventListener("storage", storage);
    document.addEventListener("visibilitychange", visible);
    removeEvents = () => {
      window.removeEventListener("focus", visible); window.removeEventListener("online", visible);
      window.removeEventListener("chipvoice-session", invalidateSession); window.removeEventListener("storage", storage);
      document.removeEventListener("visibilitychange", visible); removeEvents = undefined;
    };
  }
  void refreshSession();
  return () => { listeners.delete(listener); if (!listeners.size) removeEvents?.(); };
}
export function sessionSnapshot() { hydrate(); return view; }
