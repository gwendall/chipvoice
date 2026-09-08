"use client";
import { useEffect, useState } from "react";
import Link, { useT, useErrorText } from "@/i18n/react";
import { Button } from "@/ui/components";
import type { Profile } from "@/lib/projects";
import { scopeLabels } from "./permissions";
import { PixelAvatar } from "./avatar";
export async function artistRequest(
  path: string,
  method = "GET",
  body?: unknown,
) {
  const r = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok)
    throw Error(
      data.message ?? "Could not save that change. Please try again.",
    );
  return data;
}
export function ArtistEditor({
  profile,
  onSaved,
}: {
  profile: Profile;
  onSaved: (p: Profile) => void;
}) {
  const t = useT(),
    errorText = useErrorText(),
    [form, setForm] = useState({
      handle: profile.handle ?? "",
      displayName: profile.displayName,
      bio: profile.bio,
      avatar: profile.avatar,
    }),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  return (
    <form
      className="profile-form"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        void artistRequest(`/api/v1/profiles/${profile.id}`, "PUT", form)
          .then((p) => {
            onSaved(p);
            setMessage("Profile saved.");
          })
          .catch((e) => setMessage(e.message))
          .finally(() => setBusy(false));
      }}
    >
      <PixelAvatar id={profile.id} avatar={form.avatar} size={72} />
      <label>
        {t("Username")}
        <input
          required
          minLength={3}
          maxLength={24}
          pattern="[a-z][a-z0-9_]{2,23}"
          value={form.handle}
          onChange={(e) => setForm({ ...form, handle: e.target.value })}
        />
      </label>
      <label>
        {t("Display name")}
        <input
          maxLength={60}
          value={form.displayName}
          onChange={(e) => setForm({ ...form, displayName: e.target.value })}
        />
      </label>
      <label>
        {t("About you")}
        <textarea
          maxLength={500}
          value={form.bio}
          onChange={(e) => setForm({ ...form, bio: e.target.value })}
        />
      </label>
      <label>
        {t("Portrait palette")}
        <select
          aria-label={t("Portrait palette")}
          value={form.avatar?.palette ?? ""}
          onChange={(e) =>
            setForm({
              ...form,
              avatar:
                e.target.value === ""
                  ? null
                  : {
                      palette: Number(e.target.value),
                      variant: form.avatar?.variant ?? 0,
                    },
            })
          }
        >
          <option value="">{t("Original portrait")}</option>
          {["Gold", "Forest", "Lilac", "Coral"].map((p, i) => (
            <option key={p} value={i}>
              {t(p)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("Portrait variant")}
        <input
          type="range"
          min="0"
          max="15"
          value={form.avatar?.variant ?? 0}
          onChange={(e) =>
            setForm({
              ...form,
              avatar: {
                palette: form.avatar?.palette ?? 0,
                variant: Number(e.target.value),
              },
            })
          }
        />
      </label>
      <Button disabled={busy} type="submit">
        {t(busy ? "Saving…" : "Save profile")}
      </Button>
      {profile.handle && (
        <Link href={`/u/${profile.handle}`}>{t("View artist page")} →</Link>
      )}
      <p role="status">{errorText(message)}</p>
    </form>
  );
}
export default function Artists() {
  const t = useT(),
    errorText = useErrorText(),
    [profiles, setProfiles] = useState<Profile[]>([]),
    [selected, setSelected] = useState(""),
    [grants, setGrants] = useState<
      {
        id: string;
        label: string;
        profileId: string;
        scopes: string[];
        expiresAt: number;
        revokedAt: number | null;
      }[]
    >([]),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void Promise.all([
      artistRequest("/api/v1/profiles"),
      artistRequest("/api/v1/agents"),
    ])
      .then(([p, g]) => {
        if (active) {
          setProfiles(p.items);
          setSelected(p.items[0]?.id ?? "");
          setGrants(g.items);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const current = profiles.find((p) => p.id === selected);
  if (!current) return null;
  return (
    <section className="artist-panel">
      <h2>{t("Artists & agents")}</h2>
      <p>
        {t(
          "One account, distinct artists. Each agent works only on the artist you authorize.",
        )}
      </p>
      <div className="project-actions">
        <label>
          {t("Artist")}
          <select
            aria-label={t("Artist")}
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
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
                setSelected(p.id);
              })
              .catch((e) => setMessage(e.message))
              .finally(() => setBusy(false));
          }}
        >
          {t("New artist")} ＋
        </Button>
      </div>
      <details>
        <summary>{t("Edit your profile")}</summary>
        <ArtistEditor
          key={current.id}
          profile={current}
          onSaved={(p) => {
            setProfiles(profiles.map((v) => (v.id === p.id ? p : v)));
            window.dispatchEvent(new Event("chipvoice-session"));
          }}
        />
      </details>
      <Link href="/connect">{t("Connect an agent")} →</Link>
      <ul className="agent-list">
        {grants
          .filter((g) => !g.revokedAt)
          .map((g) => (
            <li key={g.id}>
              <strong>{g.label}</strong>
              <span>
                {profiles.find((p) => p.id === g.profileId)?.displayName ||
                  t("Artist")}{" "}
                · {new Date(g.expiresAt).toISOString().slice(0, 10)}
              </span>
              <p className="agent-permissions">
                {g.scopes
                  .map((scope) => t(scopeLabels[scope] ?? scope))
                  .join(" · ")}
              </p>
              <Button
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void artistRequest(`/api/v1/agents/${g.id}`, "DELETE")
                    .then(() => setGrants(grants.filter((x) => x.id !== g.id)))
                    .catch((e) => setMessage(e.message))
                    .finally(() => setBusy(false));
                }}
              >
                {t("Revoke access")}
              </Button>
            </li>
          ))}
      </ul>
      <p role="status">{errorText(message)}</p>
    </section>
  );
}
