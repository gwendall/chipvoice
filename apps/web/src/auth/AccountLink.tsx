"use client";
import Link, { useT } from "@/i18n/react";
import { PixelAvatar } from "@/community/avatar";
import { useSession } from "./useSession";

/** One account entry point, using the same portrait as the artist's song cards. */
export function AccountLink({ signInHref = "/signin", signInActive = false }: { signInHref?: string; signInActive?: boolean }) {
  const t = useT(), session = useSession();
  if (session.status === "checking") return <span className="account-link" aria-label={t("Checking your account…")} aria-busy="true"><PixelAvatar size={36}/></span>;
  if (session.status === "signed-in" && session.profile) return <Link className="account-link" href="/library" aria-label={t("Your library")} title={session.profile.displayName || session.profile.handle || t("Your library")}>
    <PixelAvatar id={session.profile.id} avatar={session.profile.avatar} size={36}/>
  </Link>;
  return <Link className="account-link account-signin" href={signInHref} aria-current={signInActive ? "page" : undefined}>{t("Sign in")}</Link>;
}
