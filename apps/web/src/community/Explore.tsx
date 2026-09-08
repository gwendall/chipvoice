"use client";
import {PublicationPlay} from "@/player/Player";
import { useEffect, useState, useRef } from "react";
import Link, { useT } from "@/i18n/react";
import { SiteHeader, SiteFooter, Button } from "@/ui/components";
import { Account } from "@/studio/Account";
import type { Publication, Profile } from "@/lib/projects";
import { PixelAvatar } from "./avatar";
import { useSession } from "@/auth/useSession";
import "@/create/style.css";
import { CompositionOrigin } from "./CompositionOrigin";
import Artists from "./Artists";
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
    [favourites, setFavourites] = useState(false);
  const session = useSession();
  const profile = mine ? session.profile : initialProfile;
  const searchGeneration = useRef(0);
  const load = async (next?: string, signal?: AbortSignal) => {
    const generation = searchGeneration.current;
    setBusy(true);
    try {
      const params = new URLSearchParams({
        group: "1",
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
          {(mine || handle) && (
            <PixelAvatar id={profile?.id} avatar={profile?.avatar} size={64} />
          )}
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
                ? initialProfile?.bio
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
            <Artists />
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
                <PixelAvatar
                  id={item.profile.id}
                  avatar={item.profile.avatar}
                />
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
              <CompositionOrigin origin={item.origin} />
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
                <PublicationPlay item={item} queue={items}/>
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
                <PublicationPlay item={item} queue={items}/>
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
