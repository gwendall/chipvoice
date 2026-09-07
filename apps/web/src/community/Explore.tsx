"use client";
import { useEffect, useState, useRef } from "react";
import Link, { useT } from "@/i18n/react";
import { SiteHeader, SiteFooter, Button } from "@/ui/components";
import { Account } from "@/studio/Account";
import type { Publication, Profile } from "@/lib/projects";
import { PixelAvatar } from "./avatar";
import "@/create/style.css";
import LocalDrafts from "./LocalDrafts";
export default function Explore({
  handle,
  mine = false,
  initialProfile,
}: {
  handle?: string;
  mine?: boolean;
  initialProfile?: Profile;
}) {
  const t = useT(),
    [items, setItems] = useState<Publication[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [query, setQuery] = useState(""),
    [chip, setChip] = useState(""),
    [sort, setSort] = useState("recent"),
    [tag, setTag] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(true),
    [profile, setProfile] = useState<Profile | null>(initialProfile ?? null),
    [favourites, setFavourites] = useState(false);
  const [form, setForm] = useState({ handle: "", displayName: "", bio: "" });
  const searchGeneration = useRef(0);
  const load = async (next?: string, signal?: AbortSignal) => {
    const generation = searchGeneration.current;
    setBusy(true);
    try {
      const params = new URLSearchParams({
        q: query,
        chip,
        sort,
        tag,
        ...(handle ? { handle } : {}),
        ...(mine ? { mine: "1" } : {}),
        ...(favourites ? { favourites: "1" } : {}),
        ...(next ? { cursor: next } : {}),
      });
      const r = await fetch(`/api/v1/projects?${params}`, { signal });
      const data = await r.json();
      if (!r.ok) throw Error(data.message ?? "Songs could not load");
      if (signal?.aborted || generation !== searchGeneration.current) return;
      setItems((current) => (next ? [...current, ...data.items] : data.items));
      setCursor(data.cursor);
      setMessage("");
    } catch (error) {
      if (!signal?.aborted && generation === searchGeneration.current)
        setMessage(
          error instanceof Error ? error.message : "Songs could not load",
        );
    } finally {
      if (!signal?.aborted && generation === searchGeneration.current)
        setBusy(false);
    }
  };
  useEffect(() => {
    searchGeneration.current++;
    const abort = new AbortController();
    const timer = setTimeout(() => void load(undefined, abort.signal), 180);
    return () => {
      searchGeneration.current++;
      clearTimeout(timer);
      abort.abort();
    };
  }, [query, chip, sort, tag, handle, mine, favourites]);
  useEffect(() => {
    if (!mine) return;
    const abort = new AbortController();
    void fetch("/api/v1/profile", { signal: abort.signal })
      .then(async (r) => {
        if (r.ok) {
          const p = await r.json();
          setProfile(p);
          setForm({
            handle: p.handle ?? "",
            displayName: p.displayName,
            bio: p.bio,
          });
        }
      })
      .catch(() => {});
    return () => abort.abort();
  }, [mine]);
  const saveProfile = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/v1/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const p = await r.json();
      if (!r.ok) throw Error(p.message ?? "Profile could not save");
      setProfile(p);
      setMessage("Profile saved.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Profile could not save");
    } finally {
      setBusy(false);
    }
  };
  const favourite = async (item: Publication) => {
    try {
      const r = await fetch(`/api/v1/projects/${item.id}/favourite`, {
        method: item.favourited ? "DELETE" : "PUT",
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.message ?? "Could not save favourite");
      setItems((current) => current.map((p) => (p.id === item.id ? data : p)));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not save favourite");
    }
  };
  return (
    <>
      <SiteHeader active="explore" />
      <main className="demo-main community">
        <div className="community-header">
          {profile && <PixelAvatar id={profile.id} size={64} />}
          <div>
            <h1>
              {handle
                ? profile?.displayName || handle
                : t(
                    mine
                      ? "Your music shelf."
                      : "Little songs. Big personalities.",
                  )}
            </h1>
            <p>
              {handle
                ? profile?.bio
                : t(
                    mine
                      ? "Your profile, saved publications and next ideas."
                      : "Original music, experiments and remixes. Open one and make it yours.",
                  )}
            </p>
          </div>
        </div>
        <div className="project-actions">
          <Link className="small-button dark" href="/create">
            {t("Create a song")} ＋
          </Link>
          <Link href={mine ? "/explore" : "/library"}>
            {t(mine ? "Explore songs" : "Your library")} →
          </Link>
        </div>
        {!mine && !handle && (
          <details className="curated-starters">
            <summary>{t("Original starters")}</summary>
            <p>
              {t("An original four-part loop, ready for your first remix.")}
            </p>
            <Link className="small-button" href="/create?starter=orbit">
              {t("Start with Pocket orbit")} →
            </Link>
          </details>
        )}
        {mine && (
          <>
            <LocalDrafts />
            <Account />
            {profile && (
              <details>
                <summary>{t("Edit your profile")}</summary>
                <form
                  className="profile-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveProfile();
                  }}
                >
                  <label>
                    {t("Username")}
                    <input
                      required
                      minLength={3}
                      maxLength={24}
                      pattern="[a-z][a-z0-9_]{2,23}"
                      value={form.handle}
                      onChange={(e) =>
                        setForm({ ...form, handle: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    {t("Display name")}
                    <input
                      maxLength={60}
                      value={form.displayName}
                      onChange={(e) =>
                        setForm({ ...form, displayName: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    {t("About you")}
                    <textarea
                      maxLength={500}
                      value={form.bio}
                      onChange={(e) =>
                        setForm({ ...form, bio: e.target.value })
                      }
                    />
                  </label>
                  <Button disabled={busy} type="submit">
                    {t("Save profile")}
                  </Button>
                  <p>
                    {t(
                      "Your pixel portrait is generated locally from your public profile ID.",
                    )}
                  </p>
                </form>
              </details>
            )}
          </>
        )}
        <div className="explore-filters">
          <input
            aria-label={t("Search songs")}
            placeholder={t("Search titles or creators…")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            aria-label={t("Console filter")}
            value={chip}
            onChange={(e) => setChip(e.target.value)}
          >
            <option value="">{t("All consoles")}</option>
            {[
              ["2a03", "Famicom"],
              ["dmg", "Game Boy"],
              ["md", "Mega Drive"],
              ["snes", "Super Famicom"],
            ].map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          <input
            aria-label={t("Tag filter")}
            placeholder={t("Tag")}
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            maxLength={24}
          />
          <select
            aria-label={t("Sort songs")}
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="recent">{t("Latest")}</option>
            <option value="popular">{t("Popular this week")}</option>
          </select>
          <Button
            aria-pressed={favourites}
            onClick={() => setFavourites(!favourites)}
          >
            {t("My favourites")}
          </Button>
        </div>
        <p role="status">{busy ? t("Loading songs…") : t.source(message)}</p>
        {!busy && !items.length && (
          <div className="community-empty">
            <h2>{t("A quiet corner, for now.")}</h2>
            <p>
              {t(
                "Try an original starter, then publish your own version. Only public songs appear here.",
              )}
            </p>
            <Link href="/create">{t("Open Pocket orbit")} →</Link>
          </div>
        )}
        <div className="song-grid">
          {items.map((item) => (
            <article className="song-card" key={item.id}>
              <div className="song-author">
                <PixelAvatar id={item.profile.id} />
                {item.profile.handle ? (
                  <Link href={`/u/${item.profile.handle}`}>
                    {item.profile.displayName || item.profile.handle}
                  </Link>
                ) : (
                  <span>{item.profile.displayName || t("Creator")}</span>
                )}
              </div>
              <h2>
                <Link href={`/p/${item.id}`}>{item.title}</Link>
              </h2>
              <div className="song-meta">
                <span>
                  {
                    (
                      {
                        "2a03": "Famicom",
                        dmg: "Game Boy",
                        md: "Mega Drive",
                        snes: "Super Famicom",
                        c64: "C64",
                      } as Record<string, string>
                    )[item.chip]
                  }
                </span>
                <span>{item.tags.join(" · ")}</span>
              </div>
              <div className="song-bottom">
                <Link href={`/p/${item.id}`}>{t("Listen / remix")} →</Link>
                <Button
                  disabled={item.owned}
                  aria-pressed={item.favourited}
                  aria-label={t("Favourite song")}
                  onClick={() => void favourite(item)}
                >
                  {item.favourited ? "♥" : "♡"} {item.favourites}
                </Button>
              </div>
              {item.owned && (
                <div className="song-bottom">
                  <span>{t(item.visibility)}</span>
                  <Button
                    onClick={() =>
                      void fetch(`/api/v1/projects/${item.id}`, {
                        method: "DELETE",
                      }).then(async (r) => {
                        if (r.ok) {
                          setItems((current) =>
                            current.filter((p) => p.id !== item.id),
                          );
                          setMessage("Publication withdrawn.");
                        } else setMessage("Could not withdraw publication.");
                      })
                    }
                  >
                    {t("Withdraw")}
                  </Button>
                </div>
              )}
            </article>
          ))}
        </div>
        {cursor && (
          <Button disabled={busy} onClick={() => void load(cursor)}>
            {t("Load more")}
          </Button>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
