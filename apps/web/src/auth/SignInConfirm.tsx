"use client";
import { useEffect, useState } from "react";
import Link, { useT } from "@/i18n/react";
import { SiteHeader, SiteFooter } from "@/ui/components";
/** The emailed link lands here first, not on a session. A mail scanner or a
 * prefetch can open this page freely; nothing is spent until this button is
 * clicked, which only a person does. */
export function SignInConfirm() {
  const t = useT();
  const [action, setAction] = useState<string | null>(null);
  useEffect(() => {
    const params = new URL(location.href).searchParams;
    setAction(params.get("token") ? `/api/auth/redeem?${params.toString()}` : "");
  }, []);
  return (
    <div className="shell">
      <SiteHeader active="signin" />
      <main className="signin-page">
        <h1>{t("Confirm sign-in")}</h1>
        {action === null ? null : action ? (
          <>
            <p>{t("Finish signing in to chipvoice on this device.")}</p>
            <form method="POST" action={action}>
              <button className="small-button dark" type="submit">
                {t("Confirm sign-in")}
              </button>
            </form>
          </>
        ) : (
          <>
            <p role="alert">
              {t(
                "This sign-in link has expired or was already used. Request a new one below.",
              )}
            </p>
            <p>
              <Link href="/signin">{t("Back to sign in")} →</Link>
            </p>
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
