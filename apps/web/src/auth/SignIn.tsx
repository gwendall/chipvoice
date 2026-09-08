"use client";
import { useEffect, useState } from "react";
import Link, { useI18n, useT } from "@/i18n/react";
import { SiteHeader, SiteFooter } from "@/ui/components";
import { signInDestination } from "@/lib/signin-path";
import { SignInForm } from "./SignInForm";
import { useSession } from "./useSession";
export default function SignIn() {
  const t = useT(), { locale } = useI18n(), { status: session } = useSession();
  const [next, setNext] = useState("/library"), [expired, setExpired] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    setNext(signInDestination(params.get("next") ?? "/library", locale));
    setExpired(params.has("signin"));
  }, [locale]);
  return <div className="shell"><SiteHeader active="signin"/><main className="signin-page"><h1>{t("Sign in to chipvoice")}</h1>
    {session === "signed-in" ? <><p>{t("You are signed in. Your music is waiting.")}</p><Link className="small-button dark" href={next}>{t("Continue")}</Link></> : <>
    {expired && <p role="alert">{t("This sign-in link has expired or was already used. Request a new one below.")}</p>}
    <SignInForm next={next}/></>}
    <p><Link href="/create">{t("Keep composing without an account")} →</Link></p>
    </main><SiteFooter/></div>;
}
