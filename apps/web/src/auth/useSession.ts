"use client";
import { useEffect, useState } from "react";
export type SessionState = "checking" | "signed-in" | "anonymous" | "unavailable";
/** Refresh after following an email link in another tab, or signing out here. */
export function useSession() {
  const [session, setSession] = useState<{ status: SessionState; email: string | null }>({ status: "checking", email: null });
  useEffect(() => {
    let abort: AbortController | undefined;
    const refresh = () => {
      abort?.abort();
      abort = new AbortController();
      const signal = abort.signal;
      void fetch("/api/me", { signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]), cache: "no-store" }).then(async response => {
        // Consume the response body so the browser can finish the request.
        const body = await response.json();
        if (!signal.aborted) setSession({ status: response.ok && typeof body.email === "string" ? "signed-in" : response.status === 401 ? "anonymous" : "unavailable", email: response.ok && typeof body.email === "string" ? body.email : null });
      }).catch(() => { if (!signal.aborted) setSession({ status: "unavailable", email: null }); });
    };
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    window.addEventListener("chipvoice-session", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => { abort?.abort(); window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh); window.removeEventListener("chipvoice-session", refresh); document.removeEventListener("visibilitychange", visible); };
  }, []);
  return session;
}
