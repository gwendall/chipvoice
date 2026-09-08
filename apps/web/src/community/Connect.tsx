"use client";
import { useEffect, useState } from "react";
import { useT, useErrorText } from "@/i18n/react";
import { SiteHeader, SiteFooter, Button } from "@/ui/components";
import { scopeLabels } from "./permissions";
import { Account } from "@/studio/Account";
import type { Profile } from "@/lib/projects";
import { ArtistEditor, artistRequest } from "./Artists";
import "@/create/style.css";
export default function Connect() {
  const t = useT(),
    errorText = useErrorText(),
    [code, setCode] = useState(""),
    [profiles, setProfiles] = useState<Profile[]>([]),
    [profileId, setProfileId] = useState(""),
    [days, setDays] = useState(7),
    [request, setRequest] = useState<{
      label: string;
      scopes: string[];
      status: string;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [done, setDone] = useState(false);
  useEffect(() => {
    setCode(new URL(location.href).searchParams.get("code") ?? "");
  }, []);
  const inspect = async () => {
    setBusy(true);
    setMessage("");
    setRequest(null);
    try {
      const [r, p] = await Promise.all([
        artistRequest(
          `/api/v1/agent-requests/decision?code=${encodeURIComponent(code)}`,
        ),
        artistRequest("/api/v1/profiles"),
      ]);
      setRequest(r);
      setProfiles(p.items);
      setProfileId(p.items[0]?.id ?? "");
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "Could not reach the server.",
      );
    } finally {
      setBusy(false);
    }
  };
  const decide = async (approve: boolean) => {
    setBusy(true);
    try {
      await artistRequest("/api/v1/agent-requests/decision", "POST", {
        code,
        profileId,
        days,
        approve,
      });
      setDone(true);
      setMessage(
        approve
          ? "Access authorized. Your agent can now continue."
          : "Access declined.",
      );
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "Could not reach the server.",
      );
    } finally {
      setBusy(false);
    }
  };
  const profile = profiles.find((p) => p.id === profileId);
  return (
    <>
      <SiteHeader />
      <main className="demo-main connect-panel">
        <h1>{t("Connect an agent")}</h1>
        <p>
          {t(
            "Only approve a code from an agent you asked to connect. Access can be revoked from your library.",
          )}
        </p>
        <Account />
        {!done && (
          <>
            <form
              className="project-actions"
              onSubmit={(e) => {
                e.preventDefault();
                void inspect();
              }}
            >
              <label>
                {t("Authorization code")}
                <input
                  required
                  autoComplete="off"
                  maxLength={32}
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value);
                    setRequest(null);
                  }}
                />
              </label>
              <Button disabled={busy} type="submit">
                {t(busy ? "Loading…" : "Review access")}
              </Button>
            </form>
            {request && request.status === "pending" && (
              <section>
                <h2>{request.label}</h2>
                <ul>
                  {request.scopes.map((s) => (
                    <li key={s}>{t(scopeLabels[s])}</li>
                  ))}
                </ul>
                <div className="project-actions">
                  <label>
                    {t("Artist")}
                    <select
                      aria-label={t("Artist")}
                      value={profileId}
                      onChange={(e) => setProfileId(e.target.value)}
                    >
                      {profiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.displayName || p.handle || t("New artist")}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button
                    disabled={busy}
                    onClick={() => {
                      setBusy(true);
                      void artistRequest("/api/v1/profiles", "POST")
                        .then((p) => {
                          setProfiles([...profiles, p]);
                          setProfileId(p.id);
                        })
                        .catch((e) => setMessage(e.message))
                        .finally(() => setBusy(false));
                    }}
                  >
                    {t("New artist")} ＋
                  </Button>
                </div>
                {profile && (
                  <details open>
                    <summary>{t("Edit your profile")}</summary>
                    <ArtistEditor
                      key={profile.id}
                      profile={profile}
                      onSaved={(p) =>
                        setProfiles(
                          profiles.map((v) => (v.id === p.id ? p : v)),
                        )
                      }
                    />
                  </details>
                )}
                <label>
                  {t("Access expires in")}
                  <select
                    aria-label={t("Access expires in")}
                    value={days}
                    onChange={(e) => setDays(Number(e.target.value))}
                  >
                    {[1, 7, 30].map((n) => (
                      <option key={n} value={n}>
                        {t("{count} days", { count: n })}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="project-actions">
                  <Button
                    disabled={busy || !profileId}
                    onClick={() => void decide(true)}
                  >
                    {t("Authorize this agent")}
                  </Button>
                  <Button disabled={busy} onClick={() => void decide(false)}>
                    {t("Decline")}
                  </Button>
                </div>
              </section>
            )}
            {request && request.status !== "pending" && (
              <p>{t("This request has already been answered.")}</p>
            )}
          </>
        )}
        <p role="status">{errorText(message)}</p>
      </main>
      <SiteFooter />
    </>
  );
}
