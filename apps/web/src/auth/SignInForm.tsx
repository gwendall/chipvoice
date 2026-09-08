"use client";
import { useEffect, useState } from "react";
import { useI18n, useT } from "@/i18n/react";
/** One email flow for the composer, account tools and the dedicated sign-in page. */
export function SignInForm({ next }: { next?: string }) {
  const t = useT(), { locale } = useI18n();
  const [email, setEmail] = useState(""), [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false), [message, setMessage] = useState(""), [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown(value => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  async function signIn() {
    setBusy(true); setMessage("");
    try {
      const destination = next ?? location.pathname + location.search + location.hash;
      const response = await fetch("/api/auth/signin", { method: "POST", signal: AbortSignal.timeout(15_000), headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, locale, next: destination }) });
      const result = await response.json();
      if (response.ok && result.emailed === true) { setSent(true); setCooldown(30); }
      else if (response.status === 429) {
        setCooldown(Math.min(300, Math.max(30, Number(response.headers.get("Retry-After")) || 30)));
        setMessage("Too many attempts. Please wait before requesting another link.");
      } else setMessage("We could not send your sign-in email. Your draft is saved. Please try again shortly.");
    } catch { setMessage("Could not reach the server. Check your connection and try again."); }
    finally { setBusy(false); }
  }
  return <form className="signin-form" onSubmit={event => { event.preventDefault(); void signIn(); }} aria-busy={busy}>
    <p>{t("Use your email to save your music. No password needed.")}</p>
    <div className="signin-fields"><label>{t("Email")}<input type="email" autoComplete="email" required maxLength={254} value={email} disabled={busy} onChange={event => { setEmail(event.target.value); setSent(false); setMessage(""); }} /></label>
    <button className="small-button dark" disabled={busy || cooldown > 0}>{t(busy ? "Sending your link…" : sent ? "Send another link" : "Send sign-in link")}</button></div>
    <div role="status" aria-live="polite">{sent && <p><strong>{t("Check your inbox")}</strong><br/>{t("Open the email link to return here. It works once, for 30 minutes. Check spam too.")}</p>}{cooldown > 0 && <p>{t("You can request another link in {seconds}s.", { seconds: cooldown })}</p>}</div>
    {message && <p role="alert">{t(message)}</p>}
  </form>;
}
